// KeeperHub digest run handler: processes scheduled digest generation triggers

import type {
  DeskIntentRepository,
  DeskSignalRepository,
  DeskTicketRepository,
  DailyDigestRepository,
  ExecutionLogRepository,
  MonitoredEventRepository,
  PublicAlertRepository,
} from "@chronicleai/db";
import {
  ACTIVE_INTELLIGENCE_CHAIN_ID,
  PRIMARY_SIGNAL_CHAIN_ID,
} from "@chronicleai/config";
import type { DigestRunPayload } from "@chronicleai/schemas";
import type {
  DigestEventSelectionService,
} from "../services/digest-event-selection-service.ts";
import {
  DigestGenerationError,
  type DigestGenerationService,
} from "../services/digest-generation-service.ts";
import type {
  DigestPublicationResult,
  DigestPublicationService,
} from "../services/digest-publication-service.ts";
import type { PremiumProductizerService } from "../services/premium-productizer-service.ts";
import {
  RESUMABLE_DIGEST_STATUSES,
  type DigestWindowService,
  type ExistingDigestSummary,
} from "../services/digest-window-service.ts";

export interface DigestRunResult {
  accepted: boolean;
  statusCode: number;
  digestId: string | undefined;
  message: string;
}

export class DigestRunHandler {
  private readonly digestRepo: DailyDigestRepository;
  private readonly eventRepo: MonitoredEventRepository;
  private readonly execLogRepo: ExecutionLogRepository;
  private readonly windowService: DigestWindowService;
  private readonly eventSelectionService: DigestEventSelectionService;
  private readonly generationService: DigestGenerationService;
  private readonly publicationService: DigestPublicationService;
  private readonly premiumProductizer: PremiumProductizerService | null;
  private readonly alertRepo: PublicAlertRepository | null;
  private readonly signalRepo: DeskSignalRepository | null;
  private readonly intentRepo: DeskIntentRepository | null;
  private readonly ticketRepo: DeskTicketRepository | null;
  private readonly executionRouting: "private_mempool" | "public" | undefined;

  constructor(deps: {
    digestRepo: DailyDigestRepository;
    eventRepo: MonitoredEventRepository;
    execLogRepo: ExecutionLogRepository;
    windowService: DigestWindowService;
    eventSelectionService: DigestEventSelectionService;
    generationService: DigestGenerationService;
    publicationService: DigestPublicationService;
    /** Mints period deep dives + structured feeds from real digest events. */
    premiumProductizer?: PremiumProductizerService | null;
    /** Optional causal graph repositories used to stamp digest source links. */
    alertRepo?: PublicAlertRepository | null;
    signalRepo?: DeskSignalRepository | null;
    intentRepo?: DeskIntentRepository | null;
    ticketRepo?: DeskTicketRepository | null;
    /**
     * Optional desk execution routing for LLM context (Phase 2).
     * When desk prefers private mempool, pass `private_mempool`.
     */
    executionRouting?: "private_mempool" | "public" | null;
  }) {
    this.digestRepo = deps.digestRepo;
    this.eventRepo = deps.eventRepo;
    this.execLogRepo = deps.execLogRepo;
    this.windowService = deps.windowService;
    this.eventSelectionService = deps.eventSelectionService;
    this.generationService = deps.generationService;
    this.publicationService = deps.publicationService;
    this.premiumProductizer = deps.premiumProductizer ?? null;
    this.alertRepo = deps.alertRepo ?? null;
    this.signalRepo = deps.signalRepo ?? null;
    this.intentRepo = deps.intentRepo ?? null;
    this.ticketRepo = deps.ticketRepo ?? null;
    this.executionRouting = deps.executionRouting ?? undefined;
  }

  async runDigest(payload: DigestRunPayload, _source = "keeperhub"): Promise<DigestRunResult> {
    const digestKind = payload.digestKind ?? "market";
    const sourceChainId =
      digestKind === "desk" ? ACTIVE_INTELLIGENCE_CHAIN_ID : PRIMARY_SIGNAL_CHAIN_ID;
    // 1. Validate the reporting window
    const windowValidation = this.windowService.validateWindow({
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
    });

    if (!windowValidation.valid) {
      return {
        accepted: false,
        statusCode: 400,
        digestId: undefined,
        message: `Invalid reporting window: ${windowValidation.reason}`,
      };
    }

    // 2. Check for existing digest — complete ones are idempotent no-ops;
    // incomplete ones (draft/queued/failed) resume publication so a crash
    // mid-publish cannot permanently block the window.
    const duplicateCheck = await this.windowService.checkDuplicate({
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      digestKind,
    });

    if (!duplicateCheck.valid && duplicateCheck.existingDigest) {
      const existing = duplicateCheck.existingDigest;
      if (RESUMABLE_DIGEST_STATUSES.has(existing.publicationStatus)) {
        return this.resumeIncompleteDigest(existing, payload);
      }

      await this.execLogRepo.append({
        action_type: "generate_digest",
        entity_type: "daily_digest",
        entity_id: existing.id,
        status: "succeeded",
        message: `Duplicate skipped: ${duplicateCheck.reason}`,
        details: {
          periodStart: payload.periodStart,
          periodEnd: payload.periodEnd,
          publicationStatus: existing.publicationStatus,
        },
      });

      return {
        accepted: true,
        statusCode: 202,
        digestId: existing.id,
        message: "Digest already exists for this window",
      };
    }

    if (!duplicateCheck.valid) {
      // Defensive: checkDuplicate said duplicate but no row summary — treat as 202.
      const existingDigestId = duplicateCheck.existingDigestId ?? null;
      await this.execLogRepo.append({
        action_type: "generate_digest",
        entity_type: "daily_digest",
        entity_id: existingDigestId,
        status: "succeeded",
        message: `Duplicate skipped: ${duplicateCheck.reason}`,
        details: { periodStart: payload.periodStart, periodEnd: payload.periodEnd },
      });

      return {
        accepted: true,
        statusCode: 202,
        digestId: existingDigestId ?? undefined,
        message: "Digest already exists for this window",
      };
    }

    // 3. Select events for the period
    const eventSelection = await this.eventSelectionService.selectEvents({
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      chainId: sourceChainId,
    });

    // 4. Generate digest content (LLM only — no template fallback)
    const reportDate = (new Date(payload.periodEnd).toISOString().split("T")[0]) ?? "unknown-date";
    const causalSources = await this.resolveCausalSources(
      eventSelection.events.map((event) => event.id),
      sourceChainId,
    );

    await this.execLogRepo.append({
      action_type: "generate_digest",
      entity_type: "monitored_event",
      entity_id: eventSelection.events.length > 0 ? eventSelection.events[0]!.id : reportDate,
      status: "started",
      message: `Starting digest generation for ${reportDate} (${eventSelection.qualifiedEvents} events)`,
      details: {
        totalEvents: eventSelection.totalEvents,
        qualifiedEvents: eventSelection.qualifiedEvents,
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
      },
    });

    let digestContent;
    try {
      digestContent = await this.generationService.generateDigest({
        reportDate,
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
        events: eventSelection.events,
        ...(this.executionRouting
          ? { executionRouting: this.executionRouting }
          : {}),
      });
    } catch (error) {
      const message =
        error instanceof DigestGenerationError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Unknown digest generation failure";

      await this.execLogRepo.append({
        action_type: "generate_digest",
        entity_type: "monitored_event",
        entity_id: eventSelection.events.length > 0 ? eventSelection.events[0]!.id : reportDate,
        status: "failed",
        message,
        details: {
          totalEvents: eventSelection.totalEvents,
          qualifiedEvents: eventSelection.qualifiedEvents,
          periodStart: payload.periodStart,
          periodEnd: payload.periodEnd,
          attempts:
            error instanceof DigestGenerationError
              ? error.attempts.map((a) => ({
                  provider: a.provider,
                  reason: a.failureReason ?? null,
                  latencyMs: a.latencyMs,
                }))
              : null,
        },
      });

      return {
        accepted: false,
        statusCode: 502,
        digestId: undefined,
        message,
      };
    }

    // 5. Persist the digest (sections stored in market_narrative + flattened analysis)
    const digestInsertData: Record<string, unknown> = {
      report_date: reportDate,
      period_start: payload.periodStart,
      period_end: payload.periodEnd,
      title: digestContent.title,
      summary: digestContent.summary,
      highlights: digestContent.highlights,
      analysis: digestContent.analysis ?? null,
      source_event_ids: digestContent.sourceEventIds,
      digest_kind: digestKind,
      chain_id: sourceChainId,
      publication_chain_id: ACTIVE_INTELLIGENCE_CHAIN_ID,
      source_alert_ids: causalSources.alertIds,
      source_signal_ids: causalSources.signalIds,
      source_intent_ids: causalSources.intentIds,
      source_ticket_ids: causalSources.ticketIds,
      audience: "public",
      publication_status: "draft",
      ...(digestContent.sections
        ? {
            market_narrative: {
              type: "digest_sections",
              version: 1,
              sections: digestContent.sections,
              stats: digestContent.stats
                ? {
                    netRiskOnUsd: digestContent.stats.netRiskOnUsd,
                    netDeRiskUsd: digestContent.stats.netDeRiskUsd,
                    cexInUsd: digestContent.stats.cexInUsd,
                    cexOutUsd: digestContent.stats.cexOutUsd,
                    mintUsd: digestContent.stats.mintUsd,
                    burnUsd: digestContent.stats.burnUsd,
                    liquidationUsd: digestContent.stats.liquidationUsd,
                    liquidationCount: digestContent.stats.liquidationCount,
                    clusterCount: digestContent.stats.clusterCount,
                  }
                : null,
            },
            // DB CHECK daily_digests_market_narrative_status_check allows
            // NULL | 'succeeded' | 'failed' only (not 'ready').
            market_narrative_status: "succeeded",
            market_narrative_provider: digestContent.generationProvider ?? null,
          }
        : {}),
    };

    const digestResult = await this.digestRepo.create(
      digestInsertData as never,
    );

    if (!digestResult.ok) {
      // Unique window index race: another worker created the row first.
      // Re-check and resume or skip rather than hard-fail.
      const raced = await this.windowService.checkDuplicate({
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
        digestKind,
      });
      if (raced.existingDigest) {
        if (RESUMABLE_DIGEST_STATUSES.has(raced.existingDigest.publicationStatus)) {
          return this.resumeIncompleteDigest(raced.existingDigest, payload);
        }
        return {
          accepted: true,
          statusCode: 202,
          digestId: raced.existingDigest.id,
          message: "Digest already exists for this window",
        };
      }

      return {
        accepted: false,
        statusCode: 500,
        digestId: undefined,
        message: `Failed to persist digest: ${digestResult.error.message}`,
      };
    }

    const digest = digestResult.value;

    // Log digest generated
    const noMajorEvents = digestContent.highlights.length === 1 &&
      digestContent.highlights[0]?.includes("No major events") === true;

    await this.execLogRepo.append({
      action_type: "generate_digest",
      entity_type: "daily_digest",
      entity_id: digest.id,
      status: "succeeded",
      message: noMajorEvents
        ? "No-major-events digest generated"
        : `Digest generated with ${digestContent.highlights.length} highlights`,
      details: {
        eventCount: eventSelection.qualifiedEvents,
        generationProvider: digestContent.generationProvider ?? null,
        confidence: digestContent.confidence,
      },
    });

    // 6. Claim + publish through all channels
    await this.digestRepo.updatePublicationStatus(digest.id, "queued");

    const sourceEventRoot = digestContent.sourceEventIds.length > 0
      ? digestContent.sourceEventIds.sort().join(",")
      : digest.id;

    const publicationResult = await this.publicationService.publishDigest({
      id: digest.id,
      title: digestContent.title,
      summary: digestContent.summary,
      highlights: digestContent.highlights,
      analysis: digestContent.analysis ?? null,
      reportDate,
      sourceEventRoot,
    });

    await this.logPublicationResult(digest.id, publicationResult);

    // 7. Premium productizer — public digest stays free; mint paid SKUs from the
    // same real event set (structured feed + multi-event deep dive).
    if (this.premiumProductizer && eventSelection.events.length > 0) {
      await this.runPremiumProductizer({
        digestId: digest.id,
        reportDate,
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
        title: digestContent.title,
        summary: digestContent.summary,
        highlights: digestContent.highlights,
        analysis: digestContent.analysis ?? null,
        eventIds: eventSelection.events.map((e) => e.id),
        sourceChainId,
      });
    }

    return {
      accepted: true,
      statusCode: 201,
      digestId: digest.id,
      message: publicationResult.success
        ? "Digest generated and published"
        : "Digest generated but publication had issues",
    };
  }

  private async resolveCausalSources(eventIds: string[], sourceChainId: number): Promise<{
    alertIds: string[];
    signalIds: string[];
    intentIds: string[];
    ticketIds: string[];
  }> {
    const empty = { alertIds: [], signalIds: [], intentIds: [], ticketIds: [] };
    if (eventIds.length === 0 || !this.alertRepo?.listByEventIds) return empty;

    try {
      const alertResult = await this.alertRepo.listByEventIds(eventIds);
      if (!alertResult.ok) return empty;

      const alerts = alertResult.value.filter(
        (alert) => alert.chain_id === sourceChainId,
      );
      const alertIds = alerts.map((alert) => alert.id);
      if (alertIds.length === 0) return empty;

      const unique = (values: Array<string | null | undefined>): string[] =>
        [...new Set(values.filter((value): value is string => Boolean(value)))];
      const linkedSignalIds = unique(alerts.map((alert) => alert.desk_signal_id));
      const linkedIntentIds = unique(alerts.map((alert) => alert.intent_id));
      const linkedTicketIds = unique(alerts.map((alert) => alert.ticket_id));

      const signals = this.signalRepo ? await this.signalRepo.listRecent(2000) : null;
      const signalRows = signals?.ok
        ? signals.value.filter(
            (signal) =>
              signal.chain_id === ACTIVE_INTELLIGENCE_CHAIN_ID &&
              ((signal.source_alert_id && alertIds.includes(signal.source_alert_id)) ||
                (signal.source_event_id && eventIds.includes(signal.source_event_id))),
          )
        : [];
      const signalIds = unique([
        ...linkedSignalIds,
        ...signalRows.map((signal) => signal.id),
      ]);

      const intents = this.intentRepo ? await this.intentRepo.listRecent(2000) : null;
      const intentRows = intents?.ok
        ? intents.value.filter(
            (intent) => intent.signal_id && signalIds.includes(intent.signal_id),
          )
        : [];
      const intentIds = unique([
        ...linkedIntentIds,
        ...intentRows.map((intent) => intent.id),
      ]);

      const tickets = this.ticketRepo ? await this.ticketRepo.listRecent(2000) : null;
      const ticketIds = unique([
        ...linkedTicketIds,
        ...(tickets?.ok
          ? tickets.value
              .filter((ticket) => intentIds.includes(ticket.intent_id))
              .map((ticket) => ticket.id)
          : []),
      ]);

      return { alertIds, signalIds, intentIds, ticketIds };
    } catch {
      // Optional causal lookups must not make digest generation unavailable.
      return empty;
    }
  }

  /**
   * Resume a digest that was generated but never fully published
   * (left in draft/queued/failed after a crash or channel failure).
   */
  private async resumeIncompleteDigest(
    existing: ExistingDigestSummary,
    payload: DigestRunPayload,
  ): Promise<DigestRunResult> {
    await this.execLogRepo.append({
      action_type: "generate_digest",
      entity_type: "daily_digest",
      entity_id: existing.id,
      status: "started",
      message: `Resuming incomplete digest (was ${existing.publicationStatus})`,
      details: {
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
        priorStatus: existing.publicationStatus,
      },
    });

    // Soft claim so concurrent ticks see "queued" instead of re-entering draft resume.
    await this.digestRepo.updatePublicationStatus(existing.id, "queued");

    const sourceEventRoot =
      existing.sourceEventRoot ??
      (existing.sourceEventIds.length > 0
        ? [...existing.sourceEventIds].sort().join(",")
        : existing.id);

    const publicationResult = await this.publicationService.publishDigest({
      id: existing.id,
      title: existing.title,
      summary: existing.summary,
      highlights: existing.highlights,
      analysis: existing.analysis,
      reportDate: existing.reportDate,
      sourceEventRoot,
    });

    await this.logPublicationResult(existing.id, publicationResult, { resumed: true });

    if (this.premiumProductizer && existing.sourceEventIds.length > 0) {
      await this.runPremiumProductizer({
        digestId: existing.id,
        reportDate: existing.reportDate,
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
        title: existing.title,
        summary: existing.summary,
        highlights: existing.highlights,
        analysis: existing.analysis,
        eventIds: existing.sourceEventIds,
        sourceChainId:
          existing.sourceChainId ??
          (payload.digestKind === "desk" ? ACTIVE_INTELLIGENCE_CHAIN_ID : PRIMARY_SIGNAL_CHAIN_ID),
      });
    }

    return {
      accepted: true,
      statusCode: publicationResult.success ? 201 : 202,
      digestId: existing.id,
      message: publicationResult.success
        ? "Incomplete digest resumed and published"
        : `Incomplete digest resume had issues: ${publicationResult.errorMessage ?? "unknown error"}`,
    };
  }

  private async logPublicationResult(
    digestId: string,
    publicationResult: DigestPublicationResult,
    extra: { resumed?: boolean } = {},
  ): Promise<void> {
    const viaKh = Boolean(publicationResult.keeperHubRunId);
    const pubResultMessage = publicationResult.success
      ? viaKh
        ? `Executed via KeeperHub (run ${publicationResult.keeperHubRunId}): digest published`
        : publicationResult.registryTxHash
          ? `Digest published (registry: ${publicationResult.registryTxHash.slice(0, 10)}...)`
          : "Digest published"
      : `Digest publication failed: ${publicationResult.errorMessage ?? "unknown error"}`;

    await this.execLogRepo.append({
      action_type: "publish_digest",
      entity_type: "daily_digest",
      entity_id: digestId,
      status: publicationResult.success ? "succeeded" : "failed",
      message: extra.resumed ? `Resume: ${pubResultMessage}` : pubResultMessage,
      details: {
        registry_tx_hash: publicationResult.registryTxHash ?? null,
        keeper_hub_run_id: publicationResult.keeperHubRunId ?? null,
        content_hash: publicationResult.contentHash ?? null,
        gas_used: publicationResult.gasUsed ?? null,
        gas_used_wei: publicationResult.gasUsedWei ?? null,
        explorer_url: publicationResult.explorerUrl ?? null,
        contentUri: publicationResult.contentUri ?? null,
        smtpRecipients: publicationResult.smtpResult?.recipientsReached ?? null,
        executedViaKeeperHub: viaKh,
        resumed: extra.resumed ?? false,
      },
    });
  }

  private async runPremiumProductizer(params: {
    digestId: string;
    reportDate: string;
    periodStart: string;
    periodEnd: string;
    title: string;
    summary: string;
    highlights: string[];
    analysis: string | null;
    eventIds: string[];
    sourceChainId: number;
  }): Promise<void> {
    if (!this.premiumProductizer) {
      return;
    }

    try {
      const fullEvents = await this.eventRepo.listInWindow({
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        status: "qualified",
        chainId: params.sourceChainId,
        limit: 2000,
      });
      const eventsForPremium = fullEvents.ok
        ? fullEvents.value
        : (await Promise.all(
            params.eventIds.map(async (id) => {
              const found = await this.eventRepo.findById(id);
              return found.ok ? found.value : null;
            }),
          )).filter(
            (e): e is NonNullable<typeof e> =>
              e != null && e.chain_id === params.sourceChainId,
          );

      if (eventsForPremium.length === 0) {
        return;
      }

      const productized = await this.premiumProductizer.productizeDigest({
        digest: {
          id: params.digestId,
          report_date: params.reportDate,
          period_start: params.periodStart,
          period_end: params.periodEnd,
          title: params.title,
          summary: params.summary,
          highlights: params.highlights,
          analysis: params.analysis,
          chain_id: params.sourceChainId,
        },
        events: eventsForPremium,
      });

      if (productized.created.length > 0 || productized.errors.length > 0) {
        await this.execLogRepo.append({
          action_type: "monitor",
          entity_type: "daily_digest",
          entity_id: params.digestId,
          status: productized.errors.length > 0 ? "failed" : "succeeded",
          message:
            productized.created.length > 0
              ? `Premium productizer minted ${productized.created.length} item(s) for digest`
              : `Premium productizer errors: ${productized.errors.join("; ")}`,
          details: {
            createdSlugs: productized.created.map((i) => i.slug),
            skipped: productized.skipped,
            errors: productized.errors,
          },
        });
      }
    } catch (error) {
      await this.execLogRepo.append({
        action_type: "monitor",
        entity_type: "daily_digest",
        entity_id: params.digestId,
        status: "failed",
        message: `Premium productizer failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}
