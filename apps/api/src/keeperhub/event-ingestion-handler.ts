// KeeperHub event ingestion orchestrator

import type {
  MonitoredEventRepository,
  PublicAlertRepository,
  ExecutionLogRepository,
} from "@chronicleai/db";
import { ConflictError } from "@chronicleai/db";
import {
  ACTIVE_INTELLIGENCE_CHAIN_ID,
  PRIMARY_SIGNAL_CHAIN_ID,
  chainLabel,
  isAllowedSignalSourceChain,
} from "@chronicleai/config";
import type { EventIngestionPayload, FlowContext } from "@chronicleai/schemas";
import { extractFlowContext } from "../monitoring/flow-enrichment.ts";
import {
  createEventQualificationService,
  type EventQualificationService,
} from "../services/event-qualification-service.ts";
import {
  createAlertDedupeService,
  type AlertDedupeService,
} from "../services/alert-dedupe-service.ts";
import {
  createPublicAlertContentService,
  type LLMProviderMap,
  type PublicAlertContentService,
} from "../services/public-alert-content-service.ts";
import {
  createAlertPublicationService,
  type AlertPublicationService,
} from "../services/alert-publication-service.ts";
import {
  createLiquidationClusterService,
  type LiquidationClusterService,
} from "../services/liquidation-cluster-service.ts";
import type { ChronicleRegistryService } from "../services/chronicle-registry-service.ts";
import type { NotificationService } from "../services/notification-service.ts";
import type { PremiumProductizerService } from "../services/premium-productizer-service.ts";
import type { TreasuryRegistryGate } from "../services/treasury-registry-gate.ts";
import type { LLMGenerationAttemptRepository } from "@chronicleai/db";
import {
  alertSignalProjectionForEvent,
  type AlertToSignalService,
} from "../services/alert-to-signal-service.ts";

export interface IngestionResult {
  accepted: boolean;
  statusCode: number;
  alertId?: string;
  signalId?: string;
  signalStatus?: "not_eligible" | "created" | "failed";
  actionStatus?: "not_created" | "pending" | "deferred" | "ignored" | "failed";
  message: string;
  /** Set when a liquidation cluster was also synthesized from this ingest. */
  clusterAlertId?: string;
}

function sourceReferencesForPayload(payload: EventIngestionPayload): string[] {
  return [
    payload.sourceEventId,
    payload.transactionHash,
    payload.blockHash,
    payload.blockNumber !== undefined ? `block:${payload.blockNumber}` : undefined,
    payload.logIndex !== undefined ? `log:${payload.logIndex}` : undefined,
    payload.sourceContract,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

/**
 * The legacy database constraint is unique on (source, source_event_id).
 * Keep the stored identifier chain-qualified so identical monitor IDs from
 * Mainnet and Sepolia remain distinct without requiring another migration.
 */
export function chainQualifiedSourceEventId(
  chainId: number,
  sourceEventId: string,
): string {
  const prefix = `${chainId}:`;
  return sourceEventId.startsWith(prefix) ? sourceEventId : `${prefix}${sourceEventId}`;
}

function deterministicEvidenceForPayload(
  payload: EventIngestionPayload,
  sourceDedupeKey: string,
): Record<string, unknown> {
  return {
    sourceEventId: payload.sourceEventId,
    eventType: payload.eventType,
    chainId: payload.chainId,
    protocol: payload.protocol ?? null,
    transactionHash: payload.transactionHash ?? null,
    blockNumber: payload.blockNumber ?? null,
    blockHash: payload.blockHash ?? null,
    logIndex: payload.logIndex ?? null,
    sourceContract: payload.sourceContract ?? null,
    assetSymbols: payload.assetSymbols ?? null,
    magnitude: payload.magnitude ?? null,
    normalizedFeatures: payload.normalizedFeatures ?? {},
    publicationChainId: ACTIVE_INTELLIGENCE_CHAIN_ID,
    ...(payload.arrayLength !== undefined ? { arrayLength: payload.arrayLength } : {}),
    sourceDedupeKey,
  };
}

function deterministicAlertTitle(payload: EventIngestionPayload): string {
  const subject = payload.protocol ? `${payload.protocol} ${payload.eventType}` : payload.eventType;
  return `${subject} observed on ${chainLabel(payload.chainId)}`;
}

function deterministicAlertSummary(
  payload: EventIngestionPayload,
  score: number,
): string {
  const magnitude = payload.magnitude
    ? ` Magnitude: ${payload.magnitude.value} ${payload.magnitude.unit}.`
    : "";
  const tx = payload.transactionHash ? ` Source transaction: ${payload.transactionHash}.` : "";
  return `Structured ${payload.eventType} evidence was observed on ${chainLabel(payload.chainId)} with qualification score ${score.toFixed(2)}.${magnitude}${tx} Publication and any execution context remain on ${chainLabel(ACTIVE_INTELLIGENCE_CHAIN_ID)}.`;
}

export class EventIngestionHandler {
  private readonly eventRepo: MonitoredEventRepository;
  private readonly alertRepo: PublicAlertRepository;
  private readonly execLogRepo: ExecutionLogRepository;
  private readonly llmAttemptRepo: LLMGenerationAttemptRepository;
  private readonly qualificationService: EventQualificationService;
  private readonly dedupeService: AlertDedupeService;
  private readonly contentService: PublicAlertContentService;
  private readonly publicationService: AlertPublicationService;
  private readonly clusterService: LiquidationClusterService;
  private readonly premiumProductizer: PremiumProductizerService | null;
  private alertToSignalService: AlertToSignalService | null;
  /** Guard against recursive cluster re-entry. */
  private synthesizingCluster = false;

  constructor(deps: {
    eventRepo: MonitoredEventRepository;
    alertRepo: PublicAlertRepository;
    execLogRepo: ExecutionLogRepository;
    llmAttemptRepo: LLMGenerationAttemptRepository;
    providerConfigs: LLMProviderMap;
    registryService?: ChronicleRegistryService | null;
    /** Public SPA origin (FRONTEND_ORIGIN) for HTTPS alert content URIs. */
    frontendOrigin?: string;
    /** Community channel (Telegram) for post-registry alert fan-out. */
    notificationService?: NotificationService | null;
    /** Treasury gate for FR-026 registry write suspension. */
    treasuryGate?: TreasuryRegistryGate | null;
    /** Mints paid deep dives when event clusters / cascades form. */
    premiumProductizer?: PremiumProductizerService | null;
    /** Projects the deterministic Alert into at most one desk signal. */
    alertToSignalService?: AlertToSignalService | null;
  }) {
    this.eventRepo = deps.eventRepo;
    this.alertRepo = deps.alertRepo;
    this.execLogRepo = deps.execLogRepo;
    this.llmAttemptRepo = deps.llmAttemptRepo;
    this.premiumProductizer = deps.premiumProductizer ?? null;
    this.alertToSignalService = deps.alertToSignalService ?? null;
    this.qualificationService = createEventQualificationService();
    this.dedupeService = createAlertDedupeService();
    this.contentService = createPublicAlertContentService(
      deps.providerConfigs,
      deps.llmAttemptRepo,
    );
    this.publicationService = createAlertPublicationService(
      deps.alertRepo,
      deps.registryService ?? null,
      deps.frontendOrigin,
      deps.notificationService ?? null,
      deps.treasuryGate ?? null,
      deps.execLogRepo,
    );
    this.clusterService = createLiquidationClusterService(deps.eventRepo);
  }

  setAlertToSignalService(service: AlertToSignalService | null): void {
    this.alertToSignalService = service;
  }

  async ingest(payload: EventIngestionPayload, source = "keeperhub"): Promise<IngestionResult> {
    if (!isAllowedSignalSourceChain(payload.chainId)) {
      return {
        accepted: false,
        statusCode: 400,
        message: `Unsupported signal source chain ${payload.chainId}; allowed sources are Ethereum Mainnet (${PRIMARY_SIGNAL_CHAIN_ID}) and Ethereum Sepolia (${ACTIVE_INTELLIGENCE_CHAIN_ID})`,
      };
    }

    const flowContext: FlowContext | null =
      payload.flowContext ?? extractFlowContext(payload.rawPayload);

    const sourceDedupeKey =
      payload.sourceDedupeKey ??
      `${source}:${payload.chainId}:${payload.eventType}:${payload.sourceEventId}`;
    const persistedSourceEventId = chainQualifiedSourceEventId(
      payload.chainId,
      payload.sourceEventId,
    );
    const deterministicEvidence = deterministicEvidenceForPayload(
      payload,
      sourceDedupeKey,
    );

    // Ensure flowContext is mirrored into raw_payload for persistence / digests
    const rawPayload = {
      ...payload.rawPayload,
      ...(payload.arrayLength !== undefined ? { arrayLength: payload.arrayLength } : {}),
      ...(flowContext ? { flowContext } : {}),
      deterministicEvidence,
    };

    // 1. Persist the raw event first
    const eventResult = await this.eventRepo.create({
      source,
      source_event_id: persistedSourceEventId,
      event_type: payload.eventType,
      chain_id: payload.chainId,
      protocol: payload.protocol ?? null,
      asset_symbols: payload.assetSymbols ?? null,
      magnitude: (payload.magnitude as Record<string, unknown> | null) ?? null,
      transaction_hash: payload.transactionHash ?? null,
      captured_at: payload.capturedAt,
      raw_payload: rawPayload,
      block_number: payload.blockNumber ?? null,
      block_hash: payload.blockHash ?? null,
      log_index: payload.logIndex ?? null,
      source_contract: payload.sourceContract ?? null,
      normalized_evidence: payload.normalizedFeatures ?? {},
      source_dedupe_key: sourceDedupeKey,
      status: "received",
    });

    if (!eventResult.ok) {
      if (eventResult.error instanceof ConflictError) {
        return {
          accepted: false,
          statusCode: 409,
          message: `Duplicate event: ${eventResult.error.message}`,
        };
      }
      return {
        accepted: false,
        statusCode: 500,
        message: `Failed to persist event: ${eventResult.error.message}`,
      };
    }

    const event = eventResult.value;

    // 2. Log event received
    await this.execLogRepo.append({
      action_type: "monitor",
      entity_type: "monitored_event",
      entity_id: event.id,
      status: "started",
      message: `Event received: ${payload.eventType} on chain ${payload.chainId}`,
      details: {
        source_event_id: persistedSourceEventId,
        ...(flowContext
          ? {
              direction: flowContext.direction,
              fromRole: flowContext.fromRole,
              toRole: flowContext.toRole,
            }
          : {}),
      },
    });

    // 3. Qualify the event
    const rawRecord = rawPayload as Record<string, unknown>;
    const clusterCount =
      payload.eventType === "liquidation_cluster" &&
      typeof rawRecord.count === "number"
        ? rawRecord.count
        : undefined;

    const qualification = this.qualificationService.qualify({
      eventType: payload.eventType,
      magnitude: payload.magnitude ?? null,
      chainId: payload.chainId,
      ...(clusterCount !== undefined ? { clusterCount } : {}),
    });

    if (!qualification.qualified) {
      await this.eventRepo.updateStatus(event.id, "ignored");
      await this.execLogRepo.append({
        action_type: "monitor",
        entity_type: "monitored_event",
        entity_id: event.id,
        status: "succeeded",
        message: `Event ignored: ${qualification.reason}`,
        details: { reason: qualification.reason },
      });

      // Still attempt cluster synthesis for under-threshold single liqs that count toward a cluster
      const clusterAlertId = await this.maybeEmitLiquidationCluster(payload, source);

      return {
        accepted: true,
        statusCode: 202,
        message: "Event accepted but did not qualify for an alert",
        ...(clusterAlertId ? { clusterAlertId } : {}),
      };
    }

    // 4. Update event status to qualified
    await this.eventRepo.updateStatus(event.id, "qualified", qualification.score);

    // 5. Check for duplicate alert (source event OR cluster-key rate limit)
    const clusterKey = flowContext?.clusterKey ?? null;
    const dedupeKey = this.dedupeService.generateDedupeKey({
      sourceEventId: payload.sourceEventId,
      source,
      eventType: payload.eventType,
      chainId: payload.chainId,
      clusterKey,
      capturedAt: payload.capturedAt,
    });
    const clusterScoped = Boolean(clusterKey && dedupeKey.includes("-cluster-"));

    const existingAlert = await this.alertRepo.findByDedupeKey(dedupeKey);
    if (
      existingAlert &&
      this.dedupeService.isWithinWindow(existingAlert.created_at, { clusterScoped })
    ) {
      await this.execLogRepo.append({
        action_type: "publish_alert",
        entity_type: "public_alert",
        entity_id: existingAlert.id,
        status: "succeeded",
        message: clusterScoped
          ? "Duplicate suppressed: cluster-key rate limit (same flow within hour)"
          : "Duplicate skipped: alert already exists for this event",
        details: { dedupe_key: dedupeKey, cluster_scoped: clusterScoped },
      });

      const clusterAlertId = await this.maybeEmitLiquidationCluster(payload, source);

      return {
        accepted: true,
        statusCode: 202,
        alertId: existingAlert.id,
        message: clusterScoped
          ? "Cluster-key rate limit: public alert suppressed (event stored)"
          : "Duplicate event suppressed",
        ...(clusterAlertId ? { clusterAlertId } : {}),
      };
    }

    // 6. Create the deterministic public Alert shell before any LLM call.
    // This makes the public observation and its causal evidence durable even
    // when enrichment, publication, or registry anchoring is unavailable.
    const signalProjection = this.alertToSignalService
      ? alertSignalProjectionForEvent(payload.eventType)
      : null;
    const alertResult = await this.alertRepo.create({
      monitored_event_id: event.id,
      title: deterministicAlertTitle(payload),
      summary: deterministicAlertSummary(payload, qualification.score),
      source_references: sourceReferencesForPayload(payload),
      audience: "public",
      dedupe_key: dedupeKey,
      delivery_status: "queued",
      alert_kind:
        payload.eventType === "liquidation" ||
        payload.eventType === "liquidation_cluster" ||
        (payload.eventType === "gas_spike" && payload.chainId === ACTIVE_INTELLIGENCE_CHAIN_ID)
          ? "desk_trigger"
          : "market_event",
      event_type: payload.eventType,
      chain_id: payload.chainId,
      publication_chain_id: ACTIVE_INTELLIGENCE_CHAIN_ID,
      source_dedupe_key: sourceDedupeKey,
      signal_type: signalProjection?.signalType ?? null,
      signal_status: signalProjection ? "pending" : "not_eligible",
      action_status: signalProjection ? signalProjection.defaultActionStatus : "ignored",
      transaction_hash: payload.transactionHash ?? null,
      deterministic_evidence: deterministicEvidence,
      confidence: qualification.score >= 0.8 ? "high" : qualification.score >= 0.55 ? "medium" : "low",
    });

    if (!alertResult.ok) {
      return {
        accepted: true,
        statusCode: 500,
        message: `Event persisted but alert creation failed: ${alertResult.error.message}`,
      };
    }

    const alert = alertResult.value;

    // 7. Project structured evidence into at most one Desk Signal. Signal
    // failure changes only the causal status; it never removes the Alert or
    // changes the event back to failed.
    let signalResult: Awaited<ReturnType<AlertToSignalService["project"]>> | null = null;
    if (this.alertToSignalService) {
      signalResult = await this.alertToSignalService.project({
        alert,
        event,
      });
    }

    // 8. Enrichment, registry publication, and premium productization are
    // asynchronous side effects. The deterministic Alert is already visible.
    void this.enrichAndPublishAlert({
      alertId: alert.id,
      eventId: event.id,
      payload,
      source,
      qualificationScore: qualification.score,
      flowContext,
      clusterCount: clusterCount ?? null,
    });

    // 9. Premium productizer — free alert stays free; mint paid SKUs only when
    // related events form a cluster/cascade (non-fatal on failure).
    // 10. Liquidation cluster synthesizer (inline after liq ingest)
    const clusterAlertId = await this.maybeEmitLiquidationCluster(payload, source);

    return {
      accepted: true,
      statusCode: 202,
      alertId: alert.id,
      ...(signalResult?.signalId ? { signalId: signalResult.signalId } : {}),
      ...(signalResult ? { signalStatus: signalResult.status, actionStatus: signalResult.actionStatus } : {}),
      message: signalResult?.reason ?? "Deterministic Alert accepted; enrichment and publication queued",
      ...(clusterAlertId ? { clusterAlertId } : {}),
    };
  }

  private async enrichAndPublishAlert(params: {
    alertId: string;
    eventId: string;
    payload: EventIngestionPayload;
    source: string;
    qualificationScore: number;
    flowContext: FlowContext | null;
    clusterCount: number | null;
  }): Promise<void> {
    const {
      alertId,
      eventId,
      payload,
      source,
      qualificationScore,
      flowContext,
      clusterCount,
    } = params;
    let generationSucceeded = false;

    try {
      await this.execLogRepo.append({
        action_type: "generate_alert",
        entity_type: "monitored_event",
        entity_id: eventId,
        status: "started",
        message: "Starting asynchronous LLM alert enrichment",
      });

      const generationResult = await this.contentService.generateAlert({
        monitoredEventId: eventId,
        eventType: payload.eventType,
        chainId: payload.chainId,
        protocol: payload.protocol ?? null,
        assetSymbols: payload.assetSymbols ?? null,
        magnitude: payload.magnitude ?? null,
        transactionHash: payload.transactionHash ?? null,
        significanceScore: qualificationScore,
        source,
        sourceEventId: payload.sourceEventId,
        capturedAt: payload.capturedAt,
        flowContext,
        clusterCount,
      });

      if (generationResult.success && generationResult.content) {
        generationSucceeded = true;
        if (this.alertRepo.updateContent) {
          await this.alertRepo.updateContent(alertId, {
            title: generationResult.content.title,
            summary: generationResult.content.summary,
            sourceReferences: generationResult.content.sourceReferences,
            confidence: generationResult.content.confidence,
          });
        }
        if (generationResult.providerUsed) {
          await this.alertRepo.updateGenerationMetadata(alertId, {
            generationProvider: generationResult.providerUsed,
          });
        }
        await this.execLogRepo.append({
          action_type: "generate_alert",
          entity_type: "public_alert",
          entity_id: alertId,
          status: "succeeded",
          message: `Alert enriched using ${generationResult.providerUsed ?? "configured provider"}`,
          details: {
            provider: generationResult.providerUsed ?? null,
            attempts: generationResult.attempts.length,
          },
        });
      } else {
        await this.execLogRepo.append({
          action_type: "generate_alert",
          entity_type: "public_alert",
          entity_id: alertId,
          status: "failed",
          message: "Alert enrichment failed; deterministic Alert shell retained",
          details: {
            attempts: generationResult.attempts.map((attempt) => ({
              provider: attempt.provider,
              failure_reason: attempt.failureReason ?? null,
              latency_ms: attempt.latencyMs,
            })),
          },
        });
      }
    } catch (error) {
      await this.execLogRepo.append({
        action_type: "generate_alert",
        entity_type: "public_alert",
        entity_id: alertId,
        status: "failed",
        message: `Alert enrichment failed; deterministic shell retained: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    try {
      const publicationResult = await this.publicationService.publishAlert(
        alertId,
        payload.transactionHash ?? payload.sourceEventId,
      );
      await this.execLogRepo.append({
        action_type: "publish_alert",
        entity_type: "public_alert",
        entity_id: alertId,
        status: publicationResult.success ? "succeeded" : "failed",
        message: publicationResult.message,
        details: {
          generationSucceeded,
          registry_tx_hash: publicationResult.registryTxHash,
          keeper_hub_run_id: publicationResult.keeperHubRunId,
          explorer_url: publicationResult.explorerUrl,
          content_hash: publicationResult.contentHash,
          gas_used: publicationResult.gasUsed,
          gas_used_wei: publicationResult.gasUsedWei,
          executedViaKeeperHub: Boolean(publicationResult.keeperHubRunId),
        },
      });
    } catch (error) {
      await this.alertRepo.updateDeliveryStatus(alertId, "partial_failure");
      await this.execLogRepo.append({
        action_type: "publish_alert",
        entity_type: "public_alert",
        entity_id: alertId,
        status: "failed",
        message: `Alert publication failed; Alert remains available: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    if (!this.premiumProductizer) return;
    try {
      const eventResult = await this.eventRepo.findById(eventId);
      if (!eventResult.ok) throw eventResult.error;
      const productized = await this.premiumProductizer.productizeAfterQualifiedEvent(
        eventResult.value,
      );
      if (productized.created.length > 0 || productized.errors.length > 0) {
        await this.execLogRepo.append({
          action_type: "monitor",
          entity_type: "monitored_event",
          entity_id: eventId,
          status: productized.errors.length > 0 ? "failed" : "succeeded",
          message:
            productized.created.length > 0
              ? `Premium productizer minted ${productized.created.length} item(s)`
              : `Premium productizer errors: ${productized.errors.join("; ")}`,
          details: {
            createdSlugs: productized.created.map((item) => item.slug),
            skipped: productized.skipped,
            errors: productized.errors,
          },
        });
      }
    } catch (error) {
      await this.execLogRepo.append({
        action_type: "monitor",
        entity_type: "monitored_event",
        entity_id: eventId,
        status: "failed",
        message: `Premium productizer failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * After a liquidation event is stored, try to emit a single synthetic
   * liquidation_cluster for the current window. Idempotent via sourceEventId.
   */
  private async maybeEmitLiquidationCluster(
    payload: EventIngestionPayload,
    source: string,
  ): Promise<string | undefined> {
    if (payload.eventType !== "liquidation") return undefined;
    if (this.synthesizingCluster) return undefined;

    try {
      this.synthesizingCluster = true;
      const candidate = await this.clusterService.maybeSynthesize({
        chainId: payload.chainId,
        protocol: payload.protocol ?? null,
        capturedAt: payload.capturedAt,
      });

      if (!candidate) return undefined;

      await this.execLogRepo.append({
        action_type: "monitor",
        entity_type: "monitored_event",
        entity_id: null,
        status: "started",
        message: `Synthesizing liquidation cluster: ${candidate.count} liqs, $${candidate.totalUsd.toFixed(0)}`,
        details: {
          sourceEventId: candidate.payload.sourceEventId,
          count: candidate.count,
          totalUsd: candidate.totalUsd,
          windowStart: candidate.windowStartIso,
          memberEventIds: candidate.memberEventIds,
        },
      });

      // Ingest under "chronicle" source so synthetic events are distinguishable
      const result = await this.ingest(candidate.payload, "chronicle");
      return result.alertId;
    } catch (error) {
      await this.execLogRepo.append({
        action_type: "monitor",
        entity_type: "monitored_event",
        entity_id: null,
        status: "failed",
        message: `Liquidation cluster synthesis failed: ${error instanceof Error ? error.message : String(error)}`,
        details: { sourceEventId: payload.sourceEventId, parentSource: source },
      });
      return undefined;
    } finally {
      this.synthesizingCluster = false;
    }
  }
}
