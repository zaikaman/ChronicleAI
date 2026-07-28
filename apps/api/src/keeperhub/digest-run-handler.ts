// KeeperHub digest run handler: processes scheduled digest generation triggers

import type {
  DailyDigestRepository,
  ExecutionLogRepository,
  MonitoredEventRepository,
} from "@chronicleai/db";
import type { DigestRunPayload } from "@chronicleai/schemas";
import type { DigestWindowService } from "../services/digest-window-service.ts";
import type { DigestEventSelectionService } from "../services/digest-event-selection-service.ts";
import type { DigestGenerationService } from "../services/digest-generation-service.ts";
import type { DigestPublicationService } from "../services/digest-publication-service.ts";

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

  constructor(deps: {
    digestRepo: DailyDigestRepository;
    eventRepo: MonitoredEventRepository;
    execLogRepo: ExecutionLogRepository;
    windowService: DigestWindowService;
    eventSelectionService: DigestEventSelectionService;
    generationService: DigestGenerationService;
    publicationService: DigestPublicationService;
  }) {
    this.digestRepo = deps.digestRepo;
    this.eventRepo = deps.eventRepo;
    this.execLogRepo = deps.execLogRepo;
    this.windowService = deps.windowService;
    this.eventSelectionService = deps.eventSelectionService;
    this.generationService = deps.generationService;
    this.publicationService = deps.publicationService;
  }

  async runDigest(payload: DigestRunPayload, _source = "keeperhub"): Promise<DigestRunResult> {
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

    // 2. Check for duplicate digest
    const duplicateCheck = await this.windowService.checkDuplicate({
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
    });

    if (!duplicateCheck.valid) {
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
    });

    // 4. Generate digest content
    const reportDate = (new Date(payload.periodEnd).toISOString().split("T")[0]) ?? "unknown-date";

    const digestContent = await this.generationService.generateDigest({
      reportDate,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      events: eventSelection.events,
    });

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

    // 5. Persist the digest
    const digestInsertData: Record<string, unknown> = {
      report_date: reportDate,
      period_start: payload.periodStart,
      period_end: payload.periodEnd,
      title: digestContent.title,
      summary: digestContent.summary,
      highlights: digestContent.highlights,
      analysis: digestContent.analysis ?? null,
      source_event_ids: digestContent.sourceEventIds,
      audience: "public",
      publication_status: "draft",
    };

    const digestResult = await this.digestRepo.create(
      digestInsertData as never,
    );

    if (!digestResult.ok) {
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

    // 6. Publish through all channels
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

    // 7. Log publication result
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
      entity_id: digest.id,
      status: publicationResult.success ? "succeeded" : "failed",
      message: pubResultMessage,
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
      },
    });

    return {
      accepted: true,
      statusCode: 201,
      digestId: digest.id,
      message: publicationResult.success
        ? "Digest generated and published"
        : "Digest generated but publication had issues",
    };
  }
}
