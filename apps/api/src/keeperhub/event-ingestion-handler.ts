// KeeperHub event ingestion orchestrator

import type {
  MonitoredEventRepository,
  PublicAlertRepository,
  ExecutionLogRepository,
} from "@chronicleai/db";
import { ConflictError } from "@chronicleai/db";
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

export interface IngestionResult {
  accepted: boolean;
  statusCode: number;
  alertId?: string;
  message: string;
  /** Set when a liquidation cluster was also synthesized from this ingest. */
  clusterAlertId?: string;
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
  }) {
    this.eventRepo = deps.eventRepo;
    this.alertRepo = deps.alertRepo;
    this.execLogRepo = deps.execLogRepo;
    this.llmAttemptRepo = deps.llmAttemptRepo;
    this.premiumProductizer = deps.premiumProductizer ?? null;
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

  async ingest(payload: EventIngestionPayload, source = "keeperhub"): Promise<IngestionResult> {
    const flowContext: FlowContext | null =
      payload.flowContext ?? extractFlowContext(payload.rawPayload);

    // Ensure flowContext is mirrored into raw_payload for persistence / digests
    const rawPayload = flowContext
      ? { ...payload.rawPayload, flowContext }
      : payload.rawPayload;

    // 1. Persist the raw event first
    const eventResult = await this.eventRepo.create({
      source,
      source_event_id: payload.sourceEventId,
      event_type: payload.eventType,
      chain_id: payload.chainId,
      protocol: payload.protocol ?? null,
      asset_symbols: payload.assetSymbols ?? null,
      magnitude: (payload.magnitude as Record<string, unknown> | null) ?? null,
      transaction_hash: payload.transactionHash ?? null,
      captured_at: payload.capturedAt,
      raw_payload: rawPayload,
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
        source_event_id: payload.sourceEventId,
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
    const clusterCount =
      payload.eventType === "liquidation_cluster" &&
      typeof rawPayload.count === "number"
        ? rawPayload.count
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

    // 6. Generate LLM alert content
    await this.execLogRepo.append({
      action_type: "generate_alert",
      entity_type: "monitored_event",
      entity_id: event.id,
      status: "started",
      message: "Starting LLM alert generation",
    });

    const generationResult = await this.contentService.generateAlert({
      monitoredEventId: event.id,
      eventType: payload.eventType,
      chainId: payload.chainId,
      protocol: payload.protocol ?? null,
      assetSymbols: payload.assetSymbols ?? null,
      magnitude: payload.magnitude ?? null,
      transactionHash: payload.transactionHash ?? null,
      significanceScore: qualification.score,
      source,
      sourceEventId: payload.sourceEventId,
      capturedAt: payload.capturedAt,
      flowContext,
      clusterCount: clusterCount ?? null,
    });

    if (!generationResult.success || !generationResult.content) {
      // All providers failed
      await this.eventRepo.updateStatus(event.id, "failed");
      await this.execLogRepo.append({
        action_type: "generate_alert",
        entity_type: "monitored_event",
        entity_id: event.id,
        status: "failed",
        message: "Alert generation failed: all LLM providers failed",
        details: {
          attempts: generationResult.attempts.map((a) => ({
            provider: a.provider,
            failure_reason: a.failureReason,
            latency_ms: a.latencyMs,
          })),
        },
      });

      const clusterAlertId = await this.maybeEmitLiquidationCluster(payload, source);

      return {
        accepted: true,
        statusCode: 202,
        message: "Event accepted but alert generation failed (all providers failed)",
        ...(clusterAlertId ? { clusterAlertId } : {}),
      };
    }

    // 7. Create the public alert record
    const alertResult = await this.alertRepo.create({
      monitored_event_id: event.id,
      title: generationResult.content.title,
      summary: generationResult.content.summary,
      source_references: generationResult.content.sourceReferences,
      audience: "public",
      dedupe_key: dedupeKey,
      confidence: generationResult.content.confidence,
      delivery_status: "draft",
    });

    if (!alertResult.ok) {
      return {
        accepted: true,
        statusCode: 500,
        message: `Event persisted but alert creation failed: ${alertResult.error.message}`,
      };
    }

    const alert = alertResult.value;

    // Record generation succeeded log
    await this.execLogRepo.append({
      action_type: "generate_alert",
      entity_type: "public_alert",
      entity_id: alert.id,
      status: "succeeded",
      message: `Alert generated using ${generationResult.providerUsed}`,
      details: {
        provider: generationResult.providerUsed,
        title: generationResult.content.title,
        attempts: generationResult.attempts.length,
        ...(flowContext
          ? { direction: flowContext.direction, venue: flowContext.venue ?? null }
          : {}),
      },
    });

    // 8. Publish the alert (local feed + KeeperHub registry write)
    const publicationResult = await this.publicationService.publishAlert(
      alert.id,
      payload.transactionHash ?? payload.sourceEventId,
    );

    await this.execLogRepo.append({
      action_type: "publish_alert",
      entity_type: "public_alert",
      entity_id: alert.id,
      status: publicationResult.success ? "succeeded" : "failed",
      message: publicationResult.message,
      details: {
        registry_tx_hash: publicationResult.registryTxHash,
        keeper_hub_run_id: publicationResult.keeperHubRunId,
        explorer_url: publicationResult.explorerUrl,
        content_hash: publicationResult.contentHash,
        gas_used: publicationResult.gasUsed,
        gas_used_wei: publicationResult.gasUsedWei,
        executedViaKeeperHub: Boolean(publicationResult.keeperHubRunId),
        community_broadcast: publicationResult.communityBroadcast
          ? {
              destinations: publicationResult.communityBroadcast.destinations,
              failures: publicationResult.communityBroadcast.failures,
              delivered: publicationResult.communityBroadcast.delivered,
            }
          : null,
      },
    });

    // 9. Premium productizer — free alert stays free; mint paid SKUs only when
    // related events form a cluster/cascade (non-fatal on failure).
    if (this.premiumProductizer) {
      try {
        const productized = await this.premiumProductizer.productizeAfterQualifiedEvent(event);
        if (productized.created.length > 0 || productized.errors.length > 0) {
          await this.execLogRepo.append({
            action_type: "monitor",
            entity_type: "monitored_event",
            entity_id: event.id,
            status: productized.errors.length > 0 ? "failed" : "succeeded",
            message:
              productized.created.length > 0
                ? `Premium productizer minted ${productized.created.length} item(s)`
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
          entity_type: "monitored_event",
          entity_id: event.id,
          status: "failed",
          message: `Premium productizer failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    // 10. Liquidation cluster synthesizer (inline after liq ingest)
    const clusterAlertId = await this.maybeEmitLiquidationCluster(payload, source);

    return {
      accepted: true,
      statusCode: 202,
      alertId: alert.id,
      message: publicationResult.success
        ? "Alert generated and published"
        : `Alert generated but publication failed: ${publicationResult.message}`,
      ...(clusterAlertId ? { clusterAlertId } : {}),
    };
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
