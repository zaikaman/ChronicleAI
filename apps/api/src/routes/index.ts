// Central route registration

import { type Express, Router, type Router as RouterType } from "express";
import { healthRoutes } from "./health-routes.ts";

const apiRouter: RouterType = Router();

// Register all routes
apiRouter.use(healthRoutes);

// Story routes will be registered by the setup function
export function registerRoutes(app: Express): void {
  app.use(apiRouter);
}

export { apiRouter };

// Lazy setup function to avoid circular dependencies
import type { ServerEnv } from "@chronicleai/config";
import { registerGroqKeyIndexPersister, setGroqKeyIndex } from "@chronicleai/config";
import type {
  AffiliateRepository,
  ChroniclePassSessionRepository,
  DailyDigestRepository,
  EmailSubscriberRepository,
  ExecutionLogRepository,
  LLMGenerationAttemptRepository,
  MonitoredEventRepository,
  NewsletterSubscriptionRepository,
  PaymentRecordRepository,
  PremiumIntelligenceRepository,
  PublicAlertRepository,
  TreasurySnapshotRepository,
} from "@chronicleai/db";
import {
  createAffiliateAgentJobRepository,
  createDeskAgentRunRepository,
  createDeskCapitalMoveRepository,
  createDeskControlStateRepository,
  createDeskHeartbeatRepository,
  createDeskIntentRepository,
  createDeskPositionRepository,
  createDeskSignalRepository,
  createDeskTicketRepository,
  createServerSupabaseClient,
  createSystemControlStateRepository,
} from "@chronicleai/db";
import type { LLMProvider } from "@chronicleai/schemas";
import {
  type CctpRebalanceService,
  cctpExplorerUrls,
  createCctpRebalanceWorker,
  deployableToDeskUsdc,
  evaluateDeskCctpStarvation,
  getCctpRebalanceRepo,
  getCctpService,
  registerCctpRebalanceRepo,
  registerCctpService,
  tryCreateCctpRebalanceStackFromEnv,
} from "../cctp/index.ts";
import {
  createCapitalManager,
  createDeskControlPlane,
  createDeskScheduler,
  createDeskSignalIngestService,
  createDeskTradingAgent,
  createExecutionBridgeFromEnv,
  createFailureClassifier,
  createHeartbeatService,
  createIntentService,
  createKhSimulatePreflightFromEnv,
  createKillSwitchService,
  createNarrativeService,
  createPolicyEngine,
  createPositionService,
  createSignalEngine,
  createSignalFusionJudge,
  createStrategyRunner,
  createTicketService,
  deskPolicyConfigFromEnv,
  getDeskControlPlane,
  registerDeskControlPlane,
} from "../desk/index.ts";
import { BlockIngestionHandler } from "../keeperhub/block-ingestion-handler.ts";
import { EventIngestionHandler } from "../keeperhub/event-ingestion-handler.ts";
import {
  keeperhubMarketplaceAuthMiddleware,
  keeperhubSignatureMiddleware,
} from "../middleware/keeperhub-signature.ts";
import { createEventNormalizer } from "../monitoring/event-normalizer.ts";
import {
  blockRpcUrlsFromEnv,
  createOnChainBlockService,
} from "../monitoring/on-chain-block-service.ts";
import { createPriceOracle } from "../monitoring/price-oracle-service.ts";
import { X402PaymentAdapter } from "../payments/x402-payment-adapter.ts";
import { createAlertPublicationService } from "../services/alert-publication-service.ts";
import { createAlertToSignalService } from "../services/alert-to-signal-service.ts";
import { ChroniclePassAuthService } from "../services/chronicle-pass-auth-service.ts";
import {
  registerChroniclePassAuthService,
  registerChroniclePassService,
} from "../services/chronicle-pass-bridge.ts";
import { createChroniclePassService } from "../services/chronicle-pass-service.ts";
import {
  type ChronicleRegistryService,
  createChronicleRegistryService,
} from "../services/chronicle-registry-service.ts";
import { createDeskTriggerAlertService } from "../services/desk-trigger-alert-service.ts";
import { warnIfPrivateRoutingMisconfigured } from "../services/keeperhub-private-capability.ts";
import { type LLMProviderMap, createProviderConfigs } from "../services/llm-provider-client.ts";
import { createNewsletterSubscriptionService } from "../services/newsletter-subscription-service.ts";
import { PaymentSettlementService } from "../services/payment-settlement-service.ts";
import { createPremiumReceiptPublicationService } from "../services/premium-receipt-publication-service.ts";
import { createPremiumReceiptPublicationWorker } from "../services/premium-receipt-publication-worker.ts";
import {
  createTelegramBindingHandler,
  sendTelegramBotMessage,
} from "../services/telegram-binding-service.ts";
import {
  ensureTelegramWebhook,
  resolvePublicApiBaseUrl,
} from "../services/telegram-webhook-registration.ts";
import { createTreasuryRegistryGate } from "../services/treasury-registry-gate.ts";
import { createTreasuryStatusService } from "../services/treasury-status-service.ts";
import { createAlertRoutes } from "./alert-routes.ts";
import { createDeskRoutes } from "./desk-routes.ts";
import { createKeeperhubBlockRoutes } from "./keeperhub-block-routes.ts";
import { createKeeperhubDeskRoutes } from "./keeperhub-desk-routes.ts";
import { createKeeperhubEventRoutes } from "./keeperhub-event-routes.ts";
import { createTelegramWebhookRoutes } from "./telegram-webhook-routes.ts";
import { createTreasuryCctpRoutes } from "./treasury-cctp-routes.ts";

export interface US1Dependencies {
  eventRepo: MonitoredEventRepository;
  alertRepo: PublicAlertRepository;
  execLogRepo: ExecutionLogRepository;
  llmAttemptRepo: LLMGenerationAttemptRepository;
  /** Latest treasury snapshots for FR-026 treasury-gated registry writes. */
  treasuryRepo: TreasurySnapshotRepository;
  /** Optional: mints paid deep dives when alert clusters form. */
  premiumProductizer?:
    | import("../services/premium-productizer-service.ts").PremiumProductizerService
    | null;
  /** One-time Telegram codes for private Watch alerts. */
  telegramBindingRepo?: import("@chronicleai/db").TelegramBindingRepository | null;
}

export function setupUS1Routes(_app: Express, env: ServerEnv, deps: US1Dependencies): void {
  // KeeperHub-backed registry writes for publishAlert (null if not configured)
  const web3Client = createWeb3Client(env, { execLogRepo: deps.execLogRepo });
  const registryService = createChronicleRegistryService(web3Client, {
    strictContentUri: env.nodeEnv === "production",
  });
  const treasuryGate = createTreasuryRegistryGate(
    deps.treasuryRepo,
    createTreasuryStatusService(),
    { safetyBuffer: env.treasurySafetyBuffer },
  );

  // Community channel: Telegram post-registry alert fan-out (IDEA Loop 1 step 5).
  // Prefer TELEGRAM_SEND_BOT_TOKEN so the ingest bot is never also the broadcaster
  // (bots do not receive their own messages — two-bot rule).
  const telegramBroadcastToken =
    env.telegramSendBotToken ?? env.telegramIngestBotToken ?? env.telegramBotToken;
  const notificationService = createNotificationService(deps.execLogRepo, {
    community: {
      telegramBotToken: telegramBroadcastToken,
      telegramChatId: env.telegramChatId,
    },
  });
  const channels = notificationService.getConfiguredChannels();
  if (!channels.telegram) {
    console.warn(
      "TELEGRAM_SEND_BOT_TOKEN (or legacy TELEGRAM_BOT_TOKEN) + TELEGRAM_CHAT_ID not set — alert community broadcasts will log only",
    );
  } else if (!env.telegramSendBotToken && env.telegramIngestBotToken) {
    console.warn(
      "TELEGRAM_SEND_BOT_TOKEN not set — broadcasts use the ingest bot; KeeperHub must still use a *separate* send bot so the bridge can receive CHRONICLE_INGEST messages",
    );
  }
  if (
    env.telegramSendBotToken &&
    env.telegramIngestBotToken &&
    env.telegramSendBotToken === env.telegramIngestBotToken
  ) {
    console.warn(
      "TELEGRAM_SEND_BOT_TOKEN and TELEGRAM_INGEST_BOT_TOKEN are identical — bots cannot receive their own messages; create two bots",
    );
  }

  // Event ingestion handler
  const handler = new EventIngestionHandler({
    eventRepo: deps.eventRepo,
    alertRepo: deps.alertRepo,
    execLogRepo: deps.execLogRepo,
    llmAttemptRepo: deps.llmAttemptRepo,
    providerConfigs: createProviderConfigs(env),
    registryService,
    frontendOrigin: env.frontendOrigin,
    notificationService,
    treasuryGate,
    premiumProductizer: deps.premiumProductizer ?? null,
  });

  // RPC_URL is Ethereum Sepolia for desk/registry. Mainnet event enrichment
  // uses MAINNET_RPC_URL so source-chain reads stay on the observed network.
  const priceOracle = createPriceOracle(env.rpcUrl, {
    rpcChainId: ACTIVE_INTELLIGENCE_CHAIN_ID,
    rpcUrlsByChainId: {
      [CHAIN_ID_ETHEREUM]: env.mainnetRpcUrl,
      [ACTIVE_INTELLIGENCE_CHAIN_ID]: env.rpcUrl,
    },
    timeoutMs: 6_000,
  });
  const eventNormalizer = createEventNormalizer(priceOracle);
  // Block analysis must use the RPC for the payload chainId. Mainnet gas monitors
  // (chain 1, e.g. block ~25.6M) fail if routed to Sepolia RPC_URL.
  const blockService = createOnChainBlockService({
    rpcUrlsByChainId: blockRpcUrlsFromEnv(env),
  });
  const blockHandler = new BlockIngestionHandler(blockService, handler, deps.execLogRepo);

  // Phase 9–10: desk rails — signal ingest, capital, tick, kill, public/product HTTP
  const deskPolicyConfig = deskPolicyConfigFromEnv(env);
  // Mutable pause flag shared with kill-switch (policy reads config.paused each evaluate).
  // Hydrated from desk_control_state on boot so pause survives restarts.
  let deskPausedRuntime = deskPolicyConfig.paused;
  const deskPolicyConfigLive = {
    ...deskPolicyConfig,
    get paused() {
      return deskPausedRuntime;
    },
  };
  const deskPolicy = createPolicyEngine(deskPolicyConfigLive);
  const deskSupabase = createServerSupabaseClient({
    supabaseUrl: env.supabaseUrl,
    supabaseServiceRoleKey: env.supabaseServiceRoleKey,
  });
  const deskSignalRepo = createDeskSignalRepository(deskSupabase);
  const deskIntentRepo = createDeskIntentRepository(deskSupabase);
  const deskPositionRepo = createDeskPositionRepository(deskSupabase);
  const deskCapitalMoveRepo = createDeskCapitalMoveRepository(deskSupabase);
  const deskTicketRepo = createDeskTicketRepository(deskSupabase);
  const deskHeartbeatRepo = createDeskHeartbeatRepository(deskSupabase);
  const deskAgentRunRepo = createDeskAgentRunRepository(deskSupabase);
  const deskControlStateRepo = createDeskControlStateRepository(deskSupabase);
  const systemControlStateRepo = createSystemControlStateRepository(deskSupabase);

  // Restore Groq key rotation index from database on boot
  void systemControlStateRepo.get().then((res) => {
    if (res.ok) {
      setGroqKeyIndex(res.value.groq_key_index);
      console.info(
        `[system] Groq key rotation index restored from database: ${res.value.groq_key_index}`,
      );
    }
  });

  // Register persister so whenever advanceAndGetGroqKeyIndex rotates the index, it persists to DB
  registerGroqKeyIndexPersister((nextIndex) => {
    void systemControlStateRepo.upsert({ groq_key_index: nextIndex }).catch(() => {});
  });

  // LLM providers for desk agent (Gemini → Groq → OpenAI)
  const deskLlmProviders: LLMProviderMap = createProviderConfigs(env);

  const deskAgentPreferred = (env.deskAgentLlmProvider as LLMProvider | undefined) ?? undefined;
  const deskFusionJudge = createSignalFusionJudge(deskLlmProviders, {
    preferredProvider: deskAgentPreferred,
    timeoutMs: env.deskAgentTimeoutMs,
    temperature: env.deskAgentTemperature,
  });

  const deskSignalEngine = createSignalEngine({
    policy: deskPolicy,
    config: deskPolicyConfig,
    signals: deskSignalRepo,
    fusionJudge: deskFusionJudge,
  });
  handler.setAlertToSignalService(
    createAlertToSignalService({
      alertRepo: deps.alertRepo,
      signalEngine: deskSignalEngine,
    }),
  );

  // Shared publication path for Desk-trigger Alerts (best-effort; never blocks Desk).
  const deskTriggerPublication = createAlertPublicationService(
    deps.alertRepo,
    registryService,
    env.frontendOrigin,
    notificationService,
    treasuryGate,
    deps.execLogRepo,
  );
  const deskTriggerAlerts = createDeskTriggerAlertService({
    alertRepo: deps.alertRepo,
    signalRepo: deskSignalRepo,
    publicationService: deskTriggerPublication,
  });

  const deskSignalIngest = createDeskSignalIngestService({
    signalEngine: deskSignalEngine,
    signals: deskSignalRepo,
    config: deskPolicyConfig,
    rpcUrl: env.rpcUrl,
    deskTriggerAlerts,
  });

  const deskLlmConfigured = Boolean(
    env.geminiApiKey?.trim() || env.openaiApiKey?.trim() || env.groqApiKey?.trim(),
  );

  // LLM agent is hardwired (no DESK_AGENT_ENABLED). Without an API key the
  // control plane fail-closes to hold — there is no legacy signal→intent path.
  const deskTradingAgent = createDeskTradingAgent(deskLlmProviders, {
    preferredProvider: deskAgentPreferred,
    modelOverride: env.deskAgentModel,
    timeoutMs: env.deskAgentTimeoutMs,
    temperature: env.deskAgentTemperature,
    maxTradeUsdc: env.deskMaxTradeUsdc,
    minConfidence: env.deskAgentMinConfidence,
    forceDefendOnCriticalHf: env.deskAgentForceDefendOnCriticalHf,
  });

  const deskFailureClassifier = createFailureClassifier(deskLlmProviders, {
    preferredProvider: deskAgentPreferred,
    timeoutMs: env.deskAgentTimeoutMs,
    temperature: env.deskAgentTemperature,
  });
  const deskNarrative = createNarrativeService(deskLlmProviders, {
    preferredProvider: deskAgentPreferred,
    timeoutMs: env.deskAgentTimeoutMs,
  });

  const deskIntentService = createIntentService(deskIntentRepo);
  const deskTicketService = createTicketService({
    tickets: deskTicketRepo,
    intents: deskIntentRepo,
    registry: registryService,
    frontendOrigin: env.frontendOrigin,
    strictContentUri: env.nodeEnv === "production",
  });
  const deskHeartbeatService = createHeartbeatService({
    heartbeats: deskHeartbeatRepo,
    killHeartbeatMs: deskPolicyConfig.killHeartbeatMs,
  });

  const deskWalletAddress = env.deskWalletAddress?.trim() || null;
  const deskPositionService =
    env.rpcUrl && deskWalletAddress
      ? createPositionService({
          config: {
            rpcUrl: env.rpcUrl,
            deskWalletAddress,
            usdcAddress: env.deskUsdcAddress,
          },
          positions: deskPositionRepo,
          priceOracle,
        })
      : null;

  const deskExecutionBridge = createExecutionBridgeFromEnv(env, {
    execLogRepo: deps.execLogRepo,
  });
  /** Layer A: KH dry-run (simulate:true only). Default on; strict still off. */
  const deskKhSimulatePreflight = createKhSimulatePreflightFromEnv(env);
  const deskTreasury = resolveTreasuryWallet(env);
  const deskParaTreasury = createParaTreasuryClientFromEnv(env);
  // Reuse the registry web3 client (Para / KeeperHub transfer path for top-ups).
  const deskWeb3 = web3Client;

  let deskKillSwitchRef: ReturnType<typeof createKillSwitchService> | null = null;

  const deskCapitalManager =
    deskWalletAddress && deskTreasury.address
      ? createCapitalManager({
          config: deskPolicyConfigLive,
          deskWalletAddress,
          treasuryAddress: deskTreasury.address,
          capitalMoves: deskCapitalMoveRepo,
          paraTreasury: deskParaTreasury,
          web3: deskWeb3,
          executionBridge: deskExecutionBridge,
          registry: registryService,
          execLogRepo: deps.execLogRepo,
          isKillSwitchArmed: () => deskKillSwitchRef?.isArmed() ?? false,
          treasuryPrivateTransferThresholdUsdc: env.treasuryPrivateTransferThresholdUsdc,
          readDeskUsdcBalance: deskPositionService
            ? () => deskPositionService.readTokenBalances(deskWalletAddress).then((b) => b.usdc)
            : null,
        })
      : null;

  const deskKillSwitch = createKillSwitchService({
    executionBridge: deskExecutionBridge,
    capitalManager: deskCapitalManager,
    heartbeat: deskHeartbeatService,
    controlState: deskControlStateRepo,
    setDeskPaused: (paused) => {
      deskPausedRuntime = paused || deskPolicyConfig.paused;
    },
    getDeskPaused: () => deskPausedRuntime,
  });
  deskKillSwitchRef = deskKillSwitch;

  // Restore kill/pause from DB before accepting traffic-driven ticks.
  void deskKillSwitch.hydrate().then((state) => {
    if (state.armed || deskPausedRuntime) {
      console.info(
        `[desk] control state restored: armed=${String(state.armed)}${
          state.armedReason ? ` reason=${state.armedReason}` : ""
        } paused=${String(deskPausedRuntime)}`,
      );
    }
  });

  // Intents left in "executing" when the process died cannot resume in-process
  // workflows — fail them so single-flight does not block forever.
  void deskIntentRepo.listByStatus("executing", 100).then(async (result) => {
    if (!result.ok) {
      console.warn(`[desk] failed to list executing intents on boot: ${result.error.message}`);
      return;
    }
    let reaped = 0;
    for (const intent of result.value) {
      const updated = await deskIntentRepo.update(intent.id, {
        status: "failed",
        error_message: "abandoned_on_process_restart",
      });
      if (updated.ok) reaped += 1;
    }
    if (reaped > 0) {
      console.info(`[desk] reaped ${reaped} executing intent(s) abandoned on process restart`);
    }
  });

  const deskStrategyRunner = createStrategyRunner({
    config: deskPolicyConfigLive,
    policy: deskPolicy,
    intents: deskIntentService,
    executionBridge: deskExecutionBridge,
    tickets: deskTicketService,
    execLogRepo: deps.execLogRepo,
    routingPolicyEnv: {
      deskUsePrivateMempool: env.deskUsePrivateMempool,
      deskPrivateMempoolStrict: env.deskPrivateMempoolStrict,
      registryUsePrivateMempool: env.registryUsePrivateMempool,
      routingProviderLabel: env.routingProviderLabel,
      chainId: mapNetworkToChainId(env.keeperhubNetwork, 11_155_111),
    },
    khSimulatePreflight: deskKhSimulatePreflight,
  });

  // Late-bound CCTP service: control plane + starvation probe close over this ref.
  let cctpServiceRef: CctpRebalanceService | null = null;

  const deskControlPlane = createDeskControlPlane({
    config: deskPolicyConfigLive,
    // Desk / registry rail is Ethereum Sepolia — never the x402 payment chain.
    chainId: mapNetworkToChainId(env.keeperhubNetwork, 11_155_111),
    deskWalletAddress,
    treasuryWalletAddress: deskTreasury.address ?? null,
    usdcOperatingReserve: env.treasuryUsdcOperatingReserve,
    treasurySafetyBufferEth: env.treasurySafetyBuffer,
    heartbeats: deskHeartbeatService,
    positions: deskPositionService,
    intents: deskIntentService,
    tickets: deskTicketService,
    capitalManager: deskCapitalManager,
    capitalMoves: deskCapitalMoveRepo,
    killSwitch: deskKillSwitch,
    strategyRunner: deskStrategyRunner,
    signals: deskSignalRepo,
    alertRepo: deps.alertRepo,
    deskTriggerAlerts,
    executionBridge: deskExecutionBridge,
    controlState: deskControlStateRepo,
    agent: deskTradingAgent,
    agentRuns: deskAgentRunRepo,
    agentConfig: {
      llmConfigured: deskLlmConfigured,
      maxSignals: env.deskAgentMaxSignals,
      minConfidence: env.deskAgentMinConfidence,
      forceDefendOnCriticalHf: env.deskAgentForceDefendOnCriticalHf,
    },
    failureClassifier: deskFailureClassifier,
    narrative: deskNarrative,
    execLogRepo: deps.execLogRepo,
    routingPolicyEnv: {
      deskUsePrivateMempool: env.deskUsePrivateMempool,
      deskPrivateMempoolStrict: env.deskPrivateMempoolStrict,
      registryUsePrivateMempool: env.registryUsePrivateMempool,
      routingProviderLabel: env.routingProviderLabel,
      chainId: mapNetworkToChainId(env.keeperhubNetwork, 11_155_111),
    },
    monitoredEvents: deps.eventRepo,
    loadTreasuryBalances: async () => {
      const balances = await loadLiveTreasuryBalances({
        ...(env.rpcUrl !== undefined ? { rpcUrl: env.rpcUrl } : {}),
        usdcAddress: env.deskUsdcAddress,
        usdcDecimals: 6,
        ...(deskTreasury.address !== undefined ? { treasuryAddress: deskTreasury.address } : {}),
        ...(deskParaTreasury != null ? { paraTreasury: deskParaTreasury } : {}),
      });
      if (!balances) return null;
      return { usdcBalance: balances.usdcBalance, ethBalance: balances.ethBalance };
    },
    loadDualRailTreasuryBalances: async () => {
      if (!cctpServiceRef) return null;
      try {
        return await cctpServiceRef.readBalances();
      } catch (error) {
        console.warn(
          "[desk] dual-rail treasury read failed:",
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    },
    cctpBaseSafetyBufferUsdc: env.cctpBaseSafetyBufferUsdc,
    cctpRebalanceThresholdUsdc: env.cctpRebalanceThresholdUsdc,
    getDeskPaused: () => deskPausedRuntime,
    setDeskPaused: (paused) => {
      deskPausedRuntime = paused || deskPolicyConfig.paused;
    },
  });
  registerDeskControlPlane(deskControlPlane);

  if (!deskWalletAddress) {
    console.warn(
      "DESK_WALLET_ADDRESS not set — desk capital/strategy execution will not mark live positions",
    );
  }
  if (!deskExecutionBridge) {
    console.warn(
      "KeeperHub desk execution bridge not configured — set KEEPERHUB_API_KEY + strategy workflow IDs for strategy/kill execution",
    );
  }
  if (!deskLlmConfigured) {
    console.error(
      "[desk-agent] no LLM API key (GEMINI/OPENAI/GROQ) — strategy trading fail-closed (hold + force-defend only; LLM is the only decision path)",
    );
  } else {
    console.info(
      `[desk-agent] mandatory LLM path live (provider preference=${env.deskAgentLlmProvider ?? "auto"}, minConfidence=${env.deskAgentMinConfidence})`,
    );
  }

  // Phase 4: warn when private policy is on but KH Sepolia lacks private mempool capability.
  void warnIfPrivateRoutingMisconfigured({
    apiBaseUrl: env.keeperhubApiBaseUrl,
    apiKey: env.keeperhubApiKey,
    privatePolicyEnabled: env.deskUsePrivateMempool || env.registryUsePrivateMempool,
    chainId: mapNetworkToChainId(env.keeperhubNetwork, 11_155_111),
  });

  // ── CCTP rebalance (Base Sepolia → Ethereum Sepolia) ──
  // Feature flag: CCTP_REBALANCE_ENABLED gates automated ticks; force route still works.
  // CCTP_FORCE_ON_DESK_STARVATION: when true, cooldown may be skipped if desk is
  // starved for Sepolia USDC while Base is flush (demo only).
  const cctpStack = tryCreateCctpRebalanceStackFromEnv({
    env,
    supabase: deskSupabase,
    activityLogger: {
      async append(actionType, status, params) {
        const result = await deps.execLogRepo.append({
          action_type: actionType,
          entity_type: params?.entityType ?? null,
          entity_id: params?.entityId ?? null,
          status,
          message: params?.message ?? null,
          details: params?.details ?? {},
          started_at: new Date().toISOString(),
          completed_at:
            status === "succeeded" || status === "failed" ? new Date().toISOString() : null,
        });
        if (!result.ok) {
          console.warn("[cctp] activity log append failed:", result.error.message);
        }
      },
    },
    getDeskStarved: async () => {
      if (!env.cctpForceOnDeskStarvation) return false;
      const svc = cctpServiceRef;
      if (!svc) return false;
      try {
        const balances = await svc.readBalances();
        const plane = getDeskControlPlane();
        let deskEquityUsdc = 0;
        if (plane) {
          const status = await plane.getStatus();
          deskEquityUsdc = status.equityUsdc ?? 0;
        }
        const result = evaluateDeskCctpStarvation({
          deskEquityUsdc,
          minAumUsdc: deskPolicyConfigLive.minAumUsdc,
          targetAumUsdc: deskPolicyConfigLive.targetAumUsdc,
          treasurySepoliaUsdc: balances.treasurySepoliaUsdc,
          usdcOperatingReserve: env.treasuryUsdcOperatingReserve,
          topupChunkUsdc: deskPolicyConfigLive.topupChunkUsdc,
          treasuryBaseUsdc: balances.treasuryBaseUsdc,
          baseSafetyBufferUsdc: env.cctpBaseSafetyBufferUsdc,
          rebalanceThresholdUsdc: env.cctpRebalanceThresholdUsdc,
        });
        if (result.starved) {
          console.info(`[cctp] desk starvation detected — may skip cooldown: ${result.detail}`);
        }
        return result.starved;
      } catch (error) {
        console.warn(
          "[cctp] desk starvation probe failed:",
          error instanceof Error ? error.message : error,
        );
        return false;
      }
    },
  });
  const cctpService = cctpStack.service;
  cctpServiceRef = cctpService;
  registerCctpService(cctpService);
  registerCctpRebalanceRepo(cctpService && "repo" in cctpStack ? cctpStack.repo : null);
  let cctpWorker: ReturnType<typeof createCctpRebalanceWorker> | null = null;

  if (cctpService) {
    cctpWorker = createCctpRebalanceWorker({
      service: cctpService,
      intervalMs: env.cctpRebalanceScheduleIntervalMs,
      // Always run the worker when the stack is configured so in-flight rows
      // resume even when automated new burns are disabled by the feature flag.
      enabled: true,
    });
    cctpWorker.start();
    const backend = "executorBackend" in cctpStack ? cctpStack.executorBackend : "unknown";
    console.info(
      `[cctp] rebalance service ready (backend=${backend}, enabled=${String(env.cctpRebalanceEnabled)}, ` +
        `forceOnDeskStarvation=${String(env.cctpForceOnDeskStarvation)}, ` +
        `intervalMs=${env.cctpRebalanceScheduleIntervalMs}, mintOnIrisComplete=true, ` +
        `forwarding=${String(env.cctpUseForwarding)})`,
    );
  } else {
    console.info(`[cctp] rebalance service not configured: ${cctpStack.reason}`);
  }

  // In-process desk capital + mandatory agent + strategy loop (execute via KeeperHub when configured)
  // Order: CCTP → capital → strategy (plan §5.4)
  if (env.deskScheduleEnabled && deskWalletAddress) {
    const deskScheduler = createDeskScheduler({
      controlPlane: deskControlPlane,
      intervalMs: env.deskScheduleIntervalMs,
      execute: env.deskScheduleExecute,
      enabled: true,
      ...(cctpWorker ? { cctp: cctpWorker } : {}),
    });
    deskScheduler.start();
  } else if (!deskWalletAddress) {
    console.info(
      "[desk-scheduler] disabled — set DESK_WALLET_ADDRESS for autonomous capital/strategy ticks",
    );
  } else {
    console.info(
      "[desk-scheduler] disabled (DESK_SCHEDULE_ENABLED=false) — use POST /keeperhub/desk/capital and /keeperhub/desk/tick",
    );
  }

  // KeeperHub events + blocks + desk (with signature middleware)
  const keeperhubRouter = Router();
  keeperhubRouter.use("/keeperhub", keeperhubSignatureMiddleware(env.keeperhubWebhookSecret));
  keeperhubRouter.use(createKeeperhubEventRoutes(handler, eventNormalizer));
  keeperhubRouter.use(createKeeperhubBlockRoutes(blockHandler));
  keeperhubRouter.use(
    createKeeperhubDeskRoutes({
      signalIngest: deskSignalIngest,
      controlPlane: deskControlPlane,
    }),
  );
  apiRouter.use(keeperhubRouter);

  // Admin/demo CCTP treasury routes (auth: X-ChronicleAI-* HMAC headers).
  // Middleware is path-scoped so public routes (/alerts, /desk, …) stay open.
  const treasuryCctpRouter = Router();
  treasuryCctpRouter.use(
    "/treasury/cctp",
    keeperhubSignatureMiddleware(env.keeperhubWebhookSecret),
  );
  treasuryCctpRouter.use(
    createTreasuryCctpRoutes({
      service: cctpService,
      usdcOperatingReserve: env.treasuryUsdcOperatingReserve,
    }),
  );
  apiRouter.use(treasuryCctpRouter);

  // Public desk product surface (no auth)
  apiRouter.use(createDeskRoutes(deskControlPlane));

  // Telegram free-plan bridge: KeeperHub Event/Block/desk_read → Telegram → Chronicle ingest
  // + private-chat /start + CHRONICLE_BIND for Watch Telegram connect (Phase 2).
  if (env.telegramWebhookSecret) {
    const ingestChatId = env.telegramIngestChatId ?? env.telegramChatId;
    // Binding replies MUST come from the bot that owns the webhook (the ingest
    // bot): Telegram only delivers private DMs to that bot, and a bot can only
    // reply to chats that have messaged it. Replying from the send bot would
    // 400 "chat not found" whenever the two bots differ (documented setup).
    const replyBotToken = env.telegramIngestBotToken ?? env.telegramBotToken;
    let bindingHandler:
      | import("../services/telegram-ingest-service.ts").TelegramBindingHandler
      | null = null;
    if (deps.telegramBindingRepo && replyBotToken) {
      const token = replyBotToken;
      bindingHandler = createTelegramBindingHandler({
        bindingRepo: deps.telegramBindingRepo,
        reply: async ({ chatId, text }) => {
          const sent = await sendTelegramBotMessage({
            botToken: token,
            chatId,
            text,
          });
          return sent.ok ? { ok: true as const } : { ok: false as const, error: sent.error };
        },
      });
      console.info("[telegram] Watch binding handler enabled (/start + CHRONICLE_BIND)");
    } else if (!deps.telegramBindingRepo) {
      console.warn(
        "[telegram] telegramBindingRepo missing — private Watch Telegram connect disabled",
      );
    }

    apiRouter.use(
      createTelegramWebhookRoutes({
        eventHandler: handler,
        eventNormalizer,
        blockHandler,
        webhookSecret: env.telegramWebhookSecret,
        allowedChatId: ingestChatId,
        deskSignalIngest,
        bindingHandler,
      }),
    );
    if (!ingestChatId) {
      console.warn(
        "TELEGRAM_WEBHOOK_SECRET set but TELEGRAM_INGEST_CHAT_ID / TELEGRAM_CHAT_ID missing — accepting ingest from any chat (set a group id in production)",
      );
    } else {
      console.info(`Telegram ingest bridge enabled (POST /telegram/webhook, chat ${ingestChatId})`);
    }

    // Idempotent setWebhook on every boot — Telegram keeps the URL across deploys;
    // this only re-registers when URL is missing/wrong or secret was rotated.
    // Always register on the *ingest* bot (never the send bot).
    const publicApiBase = resolvePublicApiBaseUrl(env);
    const ingestBotToken = env.telegramIngestBotToken ?? env.telegramBotToken;
    if (ingestBotToken && publicApiBase) {
      void ensureTelegramWebhook({
        botToken: ingestBotToken,
        secretToken: env.telegramWebhookSecret,
        publicApiBaseUrl: publicApiBase,
      }).then((result) => {
        if (result.status === "already_configured") {
          console.info(`[telegram] webhook already set: ${result.url}`);
        } else if (result.status === "updated") {
          console.info(`[telegram] webhook registered: ${result.url}`);
        } else if (result.status === "skipped") {
          console.warn(`[telegram] webhook registration skipped: ${result.reason}`);
        } else {
          console.error(`[telegram] webhook registration failed: ${result.error}`);
        }
      });
    } else if (!ingestBotToken) {
      console.warn(
        "TELEGRAM_INGEST_BOT_TOKEN (or TELEGRAM_BOT_TOKEN) missing — route is up but setWebhook will not run until the ingest bot token is set",
      );
    } else {
      console.warn(
        "PUBLIC_API_BASE_URL (or HEROKU_APP_NAME) missing — cannot auto-register Telegram webhook",
      );
    }
  } else {
    console.warn(
      "TELEGRAM_WEBHOOK_SECRET not set — Telegram KeeperHub bridge disabled (POST /telegram/webhook)",
    );
  }

  // Public alerts (no auth required)
  apiRouter.use(createAlertRoutes(deps.alertRepo, deskSignalRepo));
}

// ── US2: Daily Digest Routes ───────────────────────────

import {
  ACTIVE_INTELLIGENCE_CHAIN_ID,
  CHAIN_ID_ETHEREUM,
  DIGEST_SCHEDULE_GRACE_MINUTES,
} from "@chronicleai/config";
import { DigestRunHandler } from "../keeperhub/digest-run-handler.ts";
import { createDigestEventSelectionService } from "../services/digest-event-selection-service.ts";
import { createDigestGenerationService } from "../services/digest-generation-service.ts";
import { createDigestPublicationService } from "../services/digest-publication-service.ts";
import { registerDigestRunHandler } from "../services/digest-run-bridge.ts";
import { createDigestScheduler } from "../services/digest-scheduler.ts";
import { createDigestWindowService } from "../services/digest-window-service.ts";
import { createNotificationService } from "../services/notification-service.ts";
import {
  createParaTreasuryClientFromEnv,
  mapNetworkToChainId,
} from "../services/para-treasury-client.ts";
import { createSmtpEmailService } from "../services/smtp-email-service.ts";
import { resolveTreasuryWallet } from "../services/treasury-wallet.ts";
import { createWeb3Client } from "../services/web3-client-service.ts";
import { createDigestRoutes } from "./digest-routes.ts";
import { createKeeperhubDigestRoutes } from "./keeperhub-digest-routes.ts";
import { createSubscriberRoutes } from "./subscriber-routes.ts";
import { createSubscriptionRoutes } from "./subscription-routes.ts";

export interface US2Dependencies {
  eventRepo: MonitoredEventRepository;
  /** Public Alerts are the durable root for digest causal source links. */
  alertRepo: PublicAlertRepository;
  digestRepo: DailyDigestRepository;
  execLogRepo: ExecutionLogRepository;
  /** Multi-provider LLM attempt logging for digest generation (Gemini → Groq → OpenAI). */
  llmAttemptRepo: LLMGenerationAttemptRepository;
  subscriberRepo: EmailSubscriberRepository;
  /** Latest treasury snapshots for FR-026 treasury-gated registry writes. */
  treasuryRepo: TreasurySnapshotRepository;
  /** Required for recurring x402 newsletter agreements + premium digest fan-out. */
  newsletterRepo: NewsletterSubscriptionRepository;
  /** Chronicle Pass wallet-auth session store (nonces + session token hashes). */
  passSessionRepo: ChroniclePassSessionRepository;
  premiumRepo: PremiumIntelligenceRepository;
  paymentRecordRepo: PaymentRecordRepository;
  /** Validates referralAddress on newsletter subscribe against approved partners. */
  affiliateRepo: AffiliateRepository;
  /** Credits affiliate USDC ledger when newsletter x402 settlements succeed. */
  earningsService: import("../services/affiliate-earnings-service.ts").AffiliateEarningsService;
  /** Funds credited affiliate rewards into the KeeperHub execution wallet. */
  fundingService?:
    | import("../services/affiliate-funding-service.ts").AffiliateFundingService
    | null;
  /** Optional: mints period deep dives + structured feeds after digest runs. */
  premiumProductizer?:
    | import("../services/premium-productizer-service.ts").PremiumProductizerService
    | null;
}

export function setupUS2Routes(_app: Express, env: ServerEnv, deps: US2Dependencies): void {
  // Initialize services
  const web3Client = createWeb3Client(env, { execLogRepo: deps.execLogRepo });
  const registryService = createChronicleRegistryService(web3Client, {
    strictContentUri: env.nodeEnv === "production",
  });
  const treasuryGate = createTreasuryRegistryGate(
    deps.treasuryRepo,
    createTreasuryStatusService(),
    { safetyBuffer: env.treasurySafetyBuffer },
  );

  // Recurring x402 monthly newsletter (agreement + renewals + paid digests)
  const treasury = resolveTreasuryWallet(env);
  const treasuryAddressHolder = { address: treasury.address };
  if (web3Client?.isParaTreasuryBacked()) {
    void web3Client
      .getTreasuryAddress()
      .then((address) => {
        if (address) {
          treasuryAddressHolder.address = address;
        }
      })
      .catch(() => {
        // Non-fatal: x402 challenges still use the static/fallback treasury address.
      });
  }

  const x402Adapter = new X402PaymentAdapter({
    facilitatorUrl: env.x402FacilitatorUrl ?? undefined,
    cdpApiKeyId: env.cdpApiKeyId ?? undefined,
    cdpApiKeySecret: env.cdpApiKeySecret ?? undefined,
    treasuryWalletAddress: () => treasuryAddressHolder.address,
    // Payment rail RPC (Base Sepolia) — never desk RPC_URL (Ethereum Sepolia).
    rpcUrl: env.x402RpcUrl ?? env.rpcUrl ?? undefined,
    settlementPrivateKey: treasury.privateKey ?? undefined,
    chainId: env.x402ChainId,
    usdcAddress: env.x402UsdcAddress,
    usdcEip712Name: env.x402UsdcEip712Name ?? undefined,
    usdcEip712Version: env.x402UsdcEip712Version ?? undefined,
  });

  const settlementService = new PaymentSettlementService({
    paymentRecordRepo: deps.paymentRecordRepo,
    execLogRepo: deps.execLogRepo,
    adapters: new Map([["x402", x402Adapter]]),
    // Same ledger path as premium payments — newsletter settlements must credit affiliates.
    earningsService: deps.earningsService,
    fundingService: deps.fundingService ?? null,
  });

  const newsletterService = createNewsletterSubscriptionService({
    newsletterRepo: deps.newsletterRepo,
    premiumRepo: deps.premiumRepo,
    paymentRecordRepo: deps.paymentRecordRepo,
    subscriberRepo: deps.subscriberRepo,
    execLogRepo: deps.execLogRepo,
    x402Adapter,
    settlementService,
    affiliateRepo: deps.affiliateRepo,
    config: {
      monthlyPriceUsdc: env.newsletterMonthlyPriceUsdc,
      billingPeriodDays: env.newsletterBillingPeriodDays,
      gracePeriodDays: env.newsletterGracePeriodDays,
    },
  });

  // Ensure catalog product exists so payment_records FK always has a target.
  void newsletterService.ensureNewsletterProduct().catch((error) => {
    console.warn(
      "Failed to ensure monthly newsletter product:",
      error instanceof Error ? error.message : error,
    );
  });

  const smtpService = createSmtpEmailService({
    host: env.smtpHost,
    port: env.smtpPort,
    user: env.smtpUser,
    pass: env.smtpPass,
    fromAddress: env.smtpFromAddress,
    resolveRecipients: async (channel) => {
      // Digests go to paid active x402 newsletter subscribers (IDEA Loop 2 step 6).
      // Alerts continue to free email_subscribers opt-ins.
      if (channel === "digest") {
        return newsletterService.listPremiumDigestEmails();
      }
      const result = await deps.subscriberRepo.listActiveEmails(channel);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
  });
  const notificationService = createNotificationService(deps.execLogRepo, {
    community: {
      telegramBotToken:
        env.telegramSendBotToken ?? env.telegramIngestBotToken ?? env.telegramBotToken,
      telegramChatId: env.telegramChatId,
    },
  });

  const windowService = createDigestWindowService(deps.digestRepo);
  const eventSelectionService = createDigestEventSelectionService(deps.eventRepo);
  const digestProviderConfigs = createProviderConfigs(env);
  digestProviderConfigs.groq = {
    ...digestProviderConfigs.groq,
    apiKey: env.groqAffiliateApiKey,
    rotateGroqKeys: false,
  };
  const generationService = createDigestGenerationService(
    digestProviderConfigs,
    deps.llmAttemptRepo,
  );
  const publicationService = createDigestPublicationService(
    deps.digestRepo,
    registryService,
    env.frontendOrigin,
    smtpService,
    notificationService,
    treasuryGate,
    deps.execLogRepo,
  );

  const handler = new DigestRunHandler({
    digestRepo: deps.digestRepo,
    eventRepo: deps.eventRepo,
    alertRepo: deps.alertRepo,
    execLogRepo: deps.execLogRepo,
    windowService,
    eventSelectionService,
    generationService,
    publicationService,
    premiumProductizer: deps.premiumProductizer ?? null,
    executionRouting: env.deskUsePrivateMempool ? "private_mempool" : "public",
  });

  // Late-bind for Telegram free-plan digest_run bridge (US1 webhook route)
  registerDigestRunHandler(handler);

  // KeeperHub digest run (with signature middleware)
  const keeperhubRouter = Router();
  keeperhubRouter.use("/keeperhub", keeperhubSignatureMiddleware(env.keeperhubWebhookSecret));
  keeperhubRouter.use(createKeeperhubDigestRoutes(handler));
  apiRouter.use(keeperhubRouter);

  // Latest digest (no auth required)
  apiRouter.use(createDigestRoutes(deps.digestRepo));

  // Chronicle Pass: wallet auth + self-service subscription management
  const passAuthService = new ChroniclePassAuthService({
    sessionRepo: deps.passSessionRepo,
    config: { chainId: env.x402ChainId },
  });
  const passService = createChroniclePassService({
    newsletterService,
    newsletterRepo: deps.newsletterRepo,
    paymentRecordRepo: deps.paymentRecordRepo,
    subscriberRepo: deps.subscriberRepo,
    premiumRepo: deps.premiumRepo,
    monthlyPriceUsdc: env.newsletterMonthlyPriceUsdc,
  });
  registerChroniclePassAuthService(passAuthService);
  registerChroniclePassService(passService);

  apiRouter.use(
    createSubscriptionRoutes({
      authService: passAuthService,
      passService,
      secureCookies: env.nodeEnv === "production",
    }),
  );

  // Best-effort expiry sweep for stale challenges/sessions.
  const PASS_SESSION_SWEEP_MS = 5 * 60_000;
  const runPassSessionSweep = () => {
    void passAuthService.expireSweep().then((expired) => {
      if (expired > 0) {
        console.info(`Chronicle Pass session sweep: expired ${expired} challenge(s)/session(s)`);
      }
    });
  };
  runPassSessionSweep();
  setInterval(runPassSessionSweep, PASS_SESSION_SWEEP_MS).unref?.();

  // Free email opt-in + recurring x402 newsletter subscribe / settle
  apiRouter.use(createSubscriberRoutes(deps.subscriberRepo, newsletterService));

  // Billing cycle: active → past_due → expired without renewal
  const NEWSLETTER_BILLING_SWEEP_MS = 5 * 60_000;
  const runNewsletterBillingSweep = () => {
    void newsletterService.processBillingCycle().then((result) => {
      if (result.pastDue || result.expired || result.cancelledAtPeriodEnd) {
        console.info(
          `Newsletter billing sweep: pastDue=${result.pastDue} expired=${result.expired} cancelledAtPeriodEnd=${result.cancelledAtPeriodEnd}`,
        );
      }
      if (result.errors.length > 0) {
        console.warn("Newsletter billing sweep errors:", result.errors.join(" | "));
      }
    });
  };
  runNewsletterBillingSweep();
  setInterval(runNewsletterBillingSweep, NEWSLETTER_BILLING_SWEEP_MS).unref?.();

  // In-process daily digest generation (previous completed UTC day).
  // This is the primary free-tier schedule path — KeeperHub Pro webhooks are not required.
  // External triggers (signed POST /keeperhub/digests/run or Telegram digest_run) remain supported.
  if (env.digestScheduleEnabled) {
    createDigestScheduler({
      handler,
      intervalMs: env.digestScheduleIntervalMs,
      graceMinutes: DIGEST_SCHEDULE_GRACE_MINUTES,
    }).start();
  } else {
    console.info(
      "[digest-scheduler] disabled (DIGEST_SCHEDULE_ENABLED=false) — use POST /keeperhub/digests/run or Telegram digest_run",
    );
  }
}

// ── US3: Premium Access & Sponsored Watch Routes ────────

import type { SponsoredWatchRepository } from "@chronicleai/db";
import type { PaymentRoute } from "@chronicleai/schemas";
import { createDeskFeedAccessGate } from "../desk/index.ts";
import { MppPaymentAdapter } from "../payments/mpp-payment-adapter.ts";
import type { PaymentAdapter } from "../payments/payment-adapter.ts";
import {
  PremiumAccessReceiptService,
  resolvePremiumAccessSecret,
} from "../services/premium-access-receipt-service.ts";
import { createSponsoredWatchReportService } from "../services/sponsored-watch-report-service.ts";
import { createSponsoredWatchService } from "../services/sponsored-watch-service.ts";
import { fetchAndDecodeWatchIdFromTxHash } from "../services/sponsored-watch-id.ts";
import { registerTelegramWatchRequestHandler } from "../services/telegram-watch-ingest-bridge.ts";
import { createTelegramWatchRequestHandler } from "../services/telegram-watch-ingest-service.ts";
import { createKeeperhubSponsoredWatchRoutes } from "./keeperhub-sponsored-watch-routes.ts";
import { createKeeperhubMarketplaceProxyRoutes } from "./keeperhub-marketplace-proxy-routes.ts";
import { createPaymentRoutes } from "./payment-routes.ts";
import { createPremiumDeskRoutes } from "./premium-desk-routes.ts";
import { createPremiumRoutes } from "./premium-routes.ts";

export interface US3Dependencies {
  premiumRepo: PremiumIntelligenceRepository;
  paymentRecordRepo: PaymentRecordRepository;
  execLogRepo: ExecutionLogRepository;
  watchRepo: SponsoredWatchRepository;
  /** Required for Loop 4 campaign-window event correlation. */
  eventRepo: MonitoredEventRepository;
  /** Public alerts for public watch alert delivery (registry + Telegram). */
  alertRepo: PublicAlertRepository;
  /** Validates referralAddress on premium payment challenges. */
  affiliateRepo: AffiliateRepository;
  /** First-touch referral attribution (wallet connect). */
  attributionRepo: import("@chronicleai/db").ReferralAttributionRepository;
  /** Credits affiliate USDC ledger on settlement. */
  earningsService: import("../services/affiliate-earnings-service.ts").AffiliateEarningsService;
  /** Funds credited affiliate rewards into the KeeperHub execution wallet. */
  fundingService?:
    | import("../services/affiliate-funding-service.ts").AffiliateFundingService
    | null;
  /** Resolves Telegram binding codes at prepare + settle. */
  telegramBindingRepo?: import("@chronicleai/db").TelegramBindingRepository | null;
}

/** Interval for automated sponsored-watch activate / monitor / complete (Loop 4). */
const SPONSORED_WATCH_CYCLE_MS = 60_000;

export function setupUS3Routes(_app: Express, env: ServerEnv, deps: US3Dependencies): void {
  const web3Client = createWeb3Client(env, { execLogRepo: deps.execLogRepo });
  const treasury = resolveTreasuryWallet(env);

  apiRouter.use(createKeeperhubMarketplaceProxyRoutes(env));

  // Production: resolve Para MPC treasury address (async warm-up; x402 uses sync fallback then refresh)
  const treasuryAddressHolder = { address: treasury.address };
  if (web3Client?.isParaTreasuryBacked()) {
    void web3Client
      .getTreasuryAddress()
      .then((address) => {
        if (address) {
          treasuryAddressHolder.address = address;
          console.info(`[para] Production treasury MPC wallet ready: ${address}`);
        }
      })
      .catch((error) => {
        console.error(
          "[para] Failed to ensure Para MPC treasury wallet:",
          error instanceof Error ? error.message : error,
        );
      });
  }

  // Initialize payment adapters
  const adapters = new Map<PaymentRoute, PaymentAdapter>();
  adapters.set(
    "x402",
    new X402PaymentAdapter({
      facilitatorUrl: env.x402FacilitatorUrl ?? undefined,
      cdpApiKeyId: env.cdpApiKeyId ?? undefined,
      cdpApiKeySecret: env.cdpApiKeySecret ?? undefined,
      // Prefer Para MPC address (production) once warm-up completes
      treasuryWalletAddress: () => treasuryAddressHolder.address,
      // Real settlement rail: facilitator (preferred) or direct EIP-3009 submission.
      // Gas key is only for submitting transferWithAuthorization — not the Para MPC spend key.
      // Payment rail RPC (Base Sepolia); desk ops use RPC_URL (Ethereum Sepolia).
      rpcUrl: env.x402RpcUrl ?? env.rpcUrl ?? undefined,
      settlementPrivateKey: treasury.privateKey ?? undefined,
      // Env-driven EIP-712 domain (defaults: Base Sepolia + Circle USDC name "USDC")
      chainId: env.x402ChainId,
      usdcAddress: env.x402UsdcAddress,
      usdcEip712Name: env.x402UsdcEip712Name ?? undefined,
      usdcEip712Version: env.x402UsdcEip712Version ?? undefined,
    }),
  );
  adapters.set("mpp", new MppPaymentAdapter({ mppSecret: env.mppSecret ?? undefined }));

  const receiptService = new PremiumAccessReceiptService({
    secret: resolvePremiumAccessSecret({
      premiumAccessSecret: env.premiumAccessSecret,
      keeperhubWebhookSecret: env.keeperhubWebhookSecret,
    }),
  });

  const registryService: ChronicleRegistryService | null = createChronicleRegistryService(
    web3Client,
    { strictContentUri: env.nodeEnv === "production" },
  );
  const premiumReceiptService = createPremiumReceiptPublicationService({
    paymentRecordRepo: deps.paymentRecordRepo,
    execLogRepo: deps.execLogRepo,
    registry: registryService,
    frontendOrigin: env.frontendOrigin,
  });
  const premiumReceiptWorker = createPremiumReceiptPublicationWorker({
    paymentRecordRepo: deps.paymentRecordRepo,
    premiumRepo: deps.premiumRepo,
    publisher: premiumReceiptService,
  });
  premiumReceiptWorker.start();

  // Shared Loop 4 service: create on payment, monitor window, auto-publish report + alerts
  const watchReportService = createSponsoredWatchReportService({
    providerConfigs: createProviderConfigs(env),
  });
  const telegramBroadcastToken =
    env.telegramSendBotToken ?? env.telegramIngestBotToken ?? env.telegramBotToken;
  const watchNotificationService = createNotificationService(deps.execLogRepo, {
    community: {
      telegramBotToken: telegramBroadcastToken,
      telegramChatId: env.telegramChatId,
    },
    // Private Watch DMs go out from the bot the user messaged (/start issued
    // the binding code) — the webhook-registered ingest bot. Community
    // broadcasts stay on the send bot.
    dmBotToken: env.telegramIngestBotToken ?? env.telegramBotToken ?? null,
  });
  const watchRegistryService = createChronicleRegistryService(web3Client, {
    strictContentUri: env.nodeEnv === "production",
  });
  // No treasury gate here (US3 lacks treasuryRepo); registry still writes when KeeperHub is up.
  const watchAlertPublication = createAlertPublicationService(
    deps.alertRepo,
    watchRegistryService,
    env.frontendOrigin,
    watchNotificationService,
    null,
    deps.execLogRepo,
  );
  const watchService = createSponsoredWatchService({
    watchRepo: deps.watchRepo,
    execLogRepo: deps.execLogRepo,
    web3Client,
    eventRepo: deps.eventRepo,
    frontendOrigin: env.frontendOrigin,
    reportService: watchReportService,
    notificationService: watchNotificationService,
    alertRepo: deps.alertRepo,
    alertPublicationService: watchAlertPublication,
  });

  // Free-tier Marketplace workflow path: the paid workflow sends the six
  // caller-facing fields through Telegram. ChronicleAI derives the internal
  // campaign fields and executes the existing createSponsoredWatch workflow.
  if (deps.telegramBindingRepo) {
    registerTelegramWatchRequestHandler(
      createTelegramWatchRequestHandler({
        bindingRepo: deps.telegramBindingRepo,
        watchRepo: deps.watchRepo,
        watchService,
        marketplaceSlug: "chronicleai-paid-onchain-watch-v2",
        minDurationHours: env.sponsoredWatchMinDurationHours,
        maxDurationHours: env.sponsoredWatchMaxDurationDays * 24,
      }),
    );
    console.info("KeeperHub Watch Telegram registration bridge enabled");
  }

  // Premium routes
  apiRouter.use(
    createPremiumRoutes({
      premiumRepo: deps.premiumRepo,
      paymentRecordRepo: deps.paymentRecordRepo,
      execLogRepo: deps.execLogRepo,
      watchRepo: deps.watchRepo,
      receiptService,
    }),
  );

  // Phase 10.3: premium x402 desk feed (full intents / tickets / stream)
  const deskControlPlaneForPremium = getDeskControlPlane();
  if (deskControlPlaneForPremium) {
    const deskFeedGate = createDeskFeedAccessGate({
      premiumRepo: deps.premiumRepo,
      paymentRecordRepo: deps.paymentRecordRepo,
      receiptService,
      priceUsdc: env.premiumDeskFeedPriceUsdc,
    });
    void deskFeedGate.ensureProduct().catch((error) => {
      console.warn(
        "Failed to ensure desk feed premium product:",
        error instanceof Error ? error.message : error,
      );
    });
    apiRouter.use(
      createPremiumDeskRoutes({
        controlPlane: deskControlPlaneForPremium,
        deskFeedGate,
      }),
    );
  } else {
    console.warn("Desk control plane not registered — /premium/desk/* routes disabled");
  }

  // Payment routes return access immediately; premium registry publication is
  // queued and recovered by the durable payment-record worker.
  apiRouter.use(
    createPaymentRoutes({
      premiumRepo: deps.premiumRepo,
      paymentRecordRepo: deps.paymentRecordRepo,
      execLogRepo: deps.execLogRepo,
      watchRepo: deps.watchRepo,
      adapters,
      receiptService,
      web3Client,
      premiumReceiptService,
      enqueuePremiumReceipt: premiumReceiptWorker.enqueue,
      watchService,
      affiliateRepo: deps.affiliateRepo,
      attributionRepo: deps.attributionRepo,
      earningsService: deps.earningsService,
      fundingService: deps.fundingService ?? null,
      secureCookies: env.nodeEnv === "production",
      frontendOrigin: env.frontendOrigin,
      strictContentUri: env.nodeEnv === "production",
      sponsoredWatchDefaultDurationDays: env.sponsoredWatchDefaultDurationDays,
      sponsoredWatchProductConfig: {
        priceUsdc: env.sponsoredWatchPriceUsdc,
        defaultDurationDays: env.sponsoredWatchDefaultDurationDays,
        maxDurationDays: env.sponsoredWatchMaxDurationDays,
        minDurationHours: env.sponsoredWatchMinDurationHours,
      },
      telegramBindingRepo: deps.telegramBindingRepo ?? null,
    }),
  );

  // Marketplace HTTP bridge uses a separate secret so a public paid listing
  // cannot call internal scheduled-webhook endpoints with the same credential.
  if (deps.telegramBindingRepo) {
    const marketplaceBridgeRouter = Router();
    marketplaceBridgeRouter.use(
      "/keeperhub",
      keeperhubMarketplaceAuthMiddleware(env.keeperhubMarketplaceBridgeSecret ?? ""),
    );
    marketplaceBridgeRouter.use(
      createKeeperhubSponsoredWatchRoutes(watchService, {
        bindingRepo: deps.telegramBindingRepo,
        marketplaceSlug: "chronicleai-paid-onchain-watch-v2",
        defaultDurationDays: env.sponsoredWatchDefaultDurationDays,
        minDurationHours: env.sponsoredWatchMinDurationHours,
        maxDurationHours: env.sponsoredWatchMaxDurationDays * 24,
        resolveWatchIdFromTransaction: (txHash) =>
          fetchAndDecodeWatchIdFromTxHash(txHash, env.keeperhubNetwork, env.rpcUrl),
      }),
    );
    apiRouter.use(marketplaceBridgeRouter);
  } else {
    console.warn("KeeperHub Watch Marketplace bridge disabled: Telegram binding repository is unavailable");
  }

  // KeeperHub-triggered campaign cycle (scheduled workflow) + signed webhook
  const keeperhubRouter = Router();
  keeperhubRouter.use("/keeperhub", keeperhubSignatureMiddleware(env.keeperhubWebhookSecret));
  keeperhubRouter.use(createKeeperhubSponsoredWatchRoutes(watchService));
  apiRouter.use(keeperhubRouter);

  // In-process Loop 4 driver: activate / monitor / complete ended campaigns
  const runSponsoredWatchCycle = () => {
    void watchService.processCampaignCycle().then((result) => {
      if (
        result.activated ||
        result.monitored ||
        result.completed ||
        result.repaired ||
        result.failed
      ) {
        console.info(
          `Sponsored watch cycle: activated=${result.activated} monitored=${result.monitored} completed=${result.completed} repaired=${result.repaired} failed=${result.failed}`,
        );
      }
      if (result.errors.length > 0) {
        console.warn("Sponsored watch cycle errors:", result.errors.join(" | "));
      }
    });
  };
  runSponsoredWatchCycle();
  setInterval(runSponsoredWatchCycle, SPONSORED_WATCH_CYCLE_MS).unref?.();
}

// ── US4: Public Agent Activity, Treasury & Revenue Payouts ─

import type { AgentActivityRepository, PayoutRecordRepository } from "@chronicleai/db";
import { RevenueRoutingHandler } from "../keeperhub/revenue-routing-handler.ts";
import { TreasuryCheckHandler } from "../keeperhub/treasury-check-handler.ts";
import { createAffiliateAgentService } from "../services/affiliate-agent-service.ts";
import { createAffiliateDashboardService } from "../services/affiliate-dashboard-service.ts";
import { createAffiliateWithdrawalService } from "../services/affiliate-withdrawal-service.ts";
import { createAgentActivityService } from "../services/agent-activity-service.ts";
import { createRevenueFxService } from "../services/revenue-fx-service.ts";
import { createRevenueRoutingScheduler } from "../services/revenue-routing-scheduler.ts";
import { createRevenueRoutingService } from "../services/revenue-routing-service.ts";
import { loadLiveTreasuryBalances } from "../services/treasury-balances.ts";
import { createTreasuryCheckScheduler } from "../services/treasury-check-scheduler.ts";
import { createTreasuryUtilityMetricsProvider } from "../services/treasury-utility-metrics.ts";
import { createActivityRoutes } from "./activity-routes.ts";
import { createAffiliateRoutes } from "./affiliate-routes.ts";
import { createKeeperhubRevenueRoutes } from "./keeperhub-revenue-routes.ts";
import { createKeeperhubTreasuryRoutes } from "./keeperhub-treasury-routes.ts";

export interface US4Dependencies {
  treasuryRepo: TreasurySnapshotRepository;
  payoutRepo: PayoutRecordRepository;
  paymentRecordRepo: PaymentRecordRepository;
  execLogRepo: ExecutionLogRepository;
  activityRepo: AgentActivityRepository;
  /** Product registry of approved referral partners. */
  affiliateRepo: AffiliateRepository;
  attributionRepo: import("@chronicleai/db").ReferralAttributionRepository;
  earningRepo: import("@chronicleai/db").AffiliateEarningRepository;
  withdrawalRepo: import("@chronicleai/db").AffiliateWithdrawalRepository;
}

export function setupUS4Routes(_app: Express, env: ServerEnv, deps: US4Dependencies): void {
  const web3Client = createWeb3Client(env, { execLogRepo: deps.execLogRepo });
  const registryService = createChronicleRegistryService(web3Client, {
    strictContentUri: env.nodeEnv === "production",
  });
  const treasuryService = createTreasuryStatusService();
  const notificationService = createNotificationService(deps.execLogRepo, {
    community: {
      telegramBotToken:
        env.telegramSendBotToken ?? env.telegramIngestBotToken ?? env.telegramBotToken,
      telegramChatId: env.telegramChatId,
    },
  });
  const treasury = resolveTreasuryWallet(env);
  const paraTreasury = createParaTreasuryClientFromEnv(env);

  if (paraTreasury) {
    void paraTreasury
      .ensureWallet()
      .then((wallet) => {
        console.info(
          `[para] Revenue routing treasury MPC wallet: ${wallet.address} (id=${wallet.walletId})`,
        );
      })
      .catch((error) => {
        console.error(
          "[para] Failed to ensure Para MPC treasury for revenue routing:",
          error instanceof Error ? error.message : error,
        );
      });
  } else if (!treasury.privateKey && treasury.provider !== "keeperhub") {
    console.warn(
      "No production treasury spend path: set PARA_API_KEY for Para MPC, or KeeperHub write config, or TREASURY_WALLET_PRIVATE_KEY for local tests only",
    );
  }

  if (!env.creatorRecoveryWallet) {
    console.warn(
      "CREATOR_RECOVERY_WALLET is not set — KeeperHub revenue routing will reject until configured",
    );
  } else if (
    treasury.address &&
    env.creatorRecoveryWallet.toLowerCase() === treasury.address.toLowerCase()
  ) {
    console.warn(
      "CREATOR_RECOVERY_WALLET matches TREASURY address — payouts will send treasury funds back to itself. Use a separate creator destination wallet.",
    );
  }

  const priceOracle = createPriceOracle(env.rpcUrl, {
    rpcChainId: ACTIVE_INTELLIGENCE_CHAIN_ID,
    timeoutMs: 6_000,
  });
  const fxService = createRevenueFxService({
    priceOracle,
    chainId: mapNetworkToChainId(env.keeperhubNetwork, ACTIVE_INTELLIGENCE_CHAIN_ID),
    mode: env.revenueFxMode,
    staticEthPerCurrencyUnit: env.revenueEthPerCurrencyUnit,
  });

  const routingService = env.creatorRecoveryWallet
    ? createRevenueRoutingService(
        {
          treasuryRepo: deps.treasuryRepo,
          paymentRepo: deps.paymentRecordRepo,
          payoutRepo: deps.payoutRepo,
          execLogRepo: deps.execLogRepo,
          affiliateRepo: deps.affiliateRepo,
          treasuryService,
          registryService,
          web3Client,
          fxService,
        },
        {
          creatorRecoveryWallet: env.creatorRecoveryWallet,
          creatorRecoveryShare: env.creatorRecoveryShare,
          referralRewardShare: env.referralRewardShare,
          referralRewardCap: env.referralRewardCap,
          maxPayoutShare: env.maxPayoutShare,
          routingIntervalMs: env.routingIntervalMs,
          safetyBuffer: env.treasurySafetyBuffer,
          usdcOperatingReserve: env.treasuryUsdcOperatingReserve,
          minDistributableUsdc: env.revenueMinDistributableUsdc,
        },
      )
    : {
        async routeRevenue(periodHash?: string) {
          return {
            outcome: "failed" as const,
            routed: false,
            totalRevenue: 0,
            creatorRecoveryAmount: 0,
            referralRewardsAmount: 0,
            payoutPeriodHash: periodHash ?? `period_${Date.now()}`,
            payoutIds: [] as string[],
            errorMessage: "CREATOR_RECOVERY_WALLET is not configured — cannot route revenue",
          };
        },
      };

  const utilityMetricsProvider = createTreasuryUtilityMetricsProvider({
    treasuryRepo: deps.treasuryRepo,
    execLogRepo: deps.execLogRepo,
    costs: {
      costPerGenerationUsdc: env.utilityCostPerGenerationUsdc,
      costPerRegistryWriteUsdc: env.utilityCostPerRegistryWriteUsdc,
    },
  });

  const treasuryHandler = new TreasuryCheckHandler({
    treasuryRepo: deps.treasuryRepo,
    execLogRepo: deps.execLogRepo,
    treasuryService,
    notificationService,
    safetyBuffer: env.treasurySafetyBuffer,
    utilityMetricsProvider,
    ...(paraTreasury
      ? {
          liveBalanceProvider: async () => {
            const eth = await paraTreasury.getNativeBalanceEth();
            return {
              availableBalance: eth,
              currency: "ETH",
              source: "para-mpc" as const,
            };
          },
        }
      : {}),
  });

  const revenueHandler = new RevenueRoutingHandler({
    routingService,
    execLogRepo: deps.execLogRepo,
  });

  // In-process Loop 3 weekly treasury check (also accepts KeeperHub webhooks)
  if (env.treasuryCheckScheduleEnabled) {
    const treasuryScheduler = createTreasuryCheckScheduler({
      handler: treasuryHandler,
      intervalMs: env.treasuryCheckScheduleIntervalMs,
      minIntervalMs: env.treasuryCheckMinIntervalMs,
      getLatestCapturedAt: async () => {
        const latest = await deps.treasuryRepo.findLatest();
        if (!latest.ok || !latest.value) return null;
        return latest.value.captured_at;
      },
    });
    treasuryScheduler.start();
  } else {
    console.info(
      "[treasury-scheduler] disabled (TREASURY_CHECK_SCHEDULE_ENABLED=false) — use POST /keeperhub/treasury/check",
    );
  }

  // In-process Loop 5 revenue routing (still gated by ROUTING_INTERVAL_MS)
  if (env.revenueRoutingScheduleEnabled && env.creatorRecoveryWallet) {
    const revenueScheduler = createRevenueRoutingScheduler({
      handler: revenueHandler,
      intervalMs: env.revenueRoutingScheduleIntervalMs,
    });
    revenueScheduler.start();
  } else if (!env.creatorRecoveryWallet) {
    console.info("[revenue-scheduler] disabled — CREATOR_RECOVERY_WALLET not set");
  } else {
    console.info(
      "[revenue-scheduler] disabled (REVENUE_ROUTING_SCHEDULE_ENABLED=false) — use POST /keeperhub/revenue/route",
    );
  }

  const activityService = createAgentActivityService(deps.activityRepo, {
    getLiveTreasuryBalances: () => {
      const treasuryAddress = treasury.address ?? env.treasuryWalletAddress;
      return loadLiveTreasuryBalances({
        ...(env.rpcUrl !== undefined ? { rpcUrl: env.rpcUrl } : {}),
        // Sepolia desk pocket — Base payment USDC is rebalanced via CCTP (Phase 1+).
        usdcAddress: env.deskUsdcAddress,
        usdcDecimals: 6,
        ...(treasuryAddress !== undefined ? { treasuryAddress } : {}),
        ...(paraTreasury != null ? { paraTreasury } : {}),
      });
    },
    getDualRailTreasury: async () => {
      const svc = getCctpService();
      if (!svc) return null;
      try {
        const [balances, status] = await Promise.all([svc.readBalances(), svc.getStatus()]);
        const deployable = deployableToDeskUsdc(
          balances.treasurySepoliaUsdc,
          env.treasuryUsdcOperatingReserve,
        );
        const topupChunk = env.deskTopupChunkUsdc ?? 10;
        const noteParts: string[] = [
          "Earn on Base Sepolia (x402); deploy on Ethereum Sepolia via Circle CCTP.",
        ];
        if (balances.inFlightUsdc > 0) {
          noteParts.push(`${balances.inFlightUsdc} USDC in-flight on CCTP (not yet deployable).`);
        } else if (
          balances.treasurySepoliaUsdc < env.treasuryUsdcOperatingReserve + topupChunk &&
          balances.treasuryBaseUsdc - env.cctpBaseSafetyBufferUsdc >= env.cctpRebalanceThresholdUsdc
        ) {
          noteParts.push(
            "Sepolia float is low while Base is flush — awaiting CCTP rebalance before desk top-up.",
          );
        }
        const recent = status.recent.slice(0, 8).map((row) => {
          const explorers = cctpExplorerUrls({
            burnTxHash: row.burn_tx_hash,
            mintTxHash: row.mint_tx_hash,
          });
          let durationMs: number | null = null;
          if (row.burned_at && row.minted_at) {
            const a = Date.parse(row.burned_at);
            const b = Date.parse(row.minted_at);
            if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
              durationMs = b - a;
            }
          }
          return {
            id: row.id,
            status: row.status,
            amountUsdc: row.amount_usdc,
            mode: row.mode,
            burnTxHash: row.burn_tx_hash,
            mintTxHash: row.mint_tx_hash,
            burnExplorerUrl: explorers.burnExplorerUrl,
            mintExplorerUrl: explorers.mintExplorerUrl,
            errorMessage: row.error_message,
            burnedAt: row.burned_at,
            mintedAt: row.minted_at,
            createdAt: row.created_at,
            durationMs,
          };
        });
        const dual: {
          walletAddress?: string;
          baseUsdc: number;
          sepoliaUsdc: number;
          baseEth: number;
          sepoliaEth: number;
          inFlightCctpUsdc: number;
          deployableToDeskUsdc: number;
          usdcOperatingReserve: number;
          cctpEnabled: boolean;
          capitalPlaneNote: string;
          recentTransfers: typeof recent;
        } = {
          baseUsdc: balances.treasuryBaseUsdc,
          sepoliaUsdc: balances.treasurySepoliaUsdc,
          baseEth: balances.treasuryBaseEth,
          sepoliaEth: balances.treasurySepoliaEth,
          inFlightCctpUsdc: balances.inFlightUsdc,
          deployableToDeskUsdc: deployable,
          usdcOperatingReserve: env.treasuryUsdcOperatingReserve,
          cctpEnabled: env.cctpRebalanceEnabled,
          capitalPlaneNote: noteParts.join(" "),
          recentTransfers: recent,
        };
        const treasuryAddr = env.treasuryWalletAddress?.trim();
        if (treasuryAddr) dual.walletAddress = treasuryAddr;
        return dual;
      } catch (error) {
        console.warn(
          "[activity] dual-rail CCTP treasury snapshot failed:",
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    },
  });

  const dashboardService = createAffiliateDashboardService({
    affiliateRepo: deps.affiliateRepo,
    attributionRepo: deps.attributionRepo,
    earningRepo: deps.earningRepo,
    withdrawalRepo: deps.withdrawalRepo,
  });

  const withdrawalService = createAffiliateWithdrawalService({
    affiliateRepo: deps.affiliateRepo,
    withdrawalRepo: deps.withdrawalRepo,
    dashboardService,
    payoutRepo: deps.payoutRepo,
    execLogRepo: deps.execLogRepo,
    registryService,
    web3Client,
    fxService,
    withdrawalChainId: env.x402ChainId,
  });

  const agentJobRepo = createAffiliateAgentJobRepository(
    createServerSupabaseClient({
      supabaseUrl: env.supabaseUrl,
      supabaseServiceRoleKey: env.supabaseServiceRoleKey,
    }),
  );

  const agentService = createAffiliateAgentService({
    dashboardService,
    withdrawalService,
    jobRepo: agentJobRepo,
    // Real LLM tool-calling (Gemini → Groq → OpenAI); falls back to deterministic tools if no keys.
    providerConfigs: createProviderConfigs(env),
  });

  // KeeperHub treasury check (with signature middleware)
  const keeperhubRouter = Router();
  keeperhubRouter.use("/keeperhub", keeperhubSignatureMiddleware(env.keeperhubWebhookSecret));
  keeperhubRouter.use(createKeeperhubTreasuryRoutes(treasuryHandler));
  keeperhubRouter.use(createKeeperhubRevenueRoutes(revenueHandler));
  apiRouter.use(keeperhubRouter);

  // Public agent activity (no auth) + page-based activity list endpoints
  apiRouter.use(
    createActivityRoutes({
      activityService,
      execLogRepo: deps.execLogRepo,
      paymentRecordRepo: deps.paymentRecordRepo,
      payoutRepo: deps.payoutRepo,
      cctpRebalanceRepo: getCctpRebalanceRepo(),
    }),
  );

  // Affiliate program: register, attribute, dashboard, payout agent (KeeperHub withdrawals)
  apiRouter.use(
    createAffiliateRoutes({
      affiliateRepo: deps.affiliateRepo,
      attributionRepo: deps.attributionRepo,
      dashboardService,
      agentService,
    }),
  );
}
