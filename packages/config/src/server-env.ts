// Typed server-side environment configuration
// Reads from process.env and validates required keys

import {
  CCTP_BASE_SAFETY_BUFFER_USDC,
  CCTP_COOLDOWN_MS,
  CCTP_FORWARDING_FALLBACK_MS,
  CCTP_MAX_FEE_USDC,
  CCTP_MAX_IN_FLIGHT,
  CCTP_MIN_FINALITY_THRESHOLD,
  CCTP_MINT_MAX_ATTEMPTS,
  CCTP_POLL_INTERVAL_MS,
  CCTP_POLL_TIMEOUT_MS,
  CCTP_REBALANCE_CHUNK_USDC,
  CCTP_REBALANCE_MAX_CHUNK_USDC,
  CCTP_REBALANCE_SCHEDULE_INTERVAL_MS,
  CCTP_REBALANCE_THRESHOLD_USDC,
  DESK_AGENT_FORCE_DEFEND_ON_CRITICAL_HF,
  DESK_AGENT_MAX_SIGNALS,
  DESK_AGENT_MIN_CONFIDENCE,
  DESK_AGENT_TEMPERATURE,
  DESK_AGENT_TIMEOUT_MS,
  DESK_APY_ABSURD_BPS,
  DESK_APY_CONSECUTIVE_POLLS,
  DESK_APY_DELTA_BPS,
  DESK_BASIS_BPS,
  DESK_EVENT_MICROTRADE_COOLDOWN_MS,
  DESK_EVENT_MICROTRADE_ENABLED,
  DESK_EVENT_MICROTRADE_LOOKBACK_MS,
  DESK_EVENT_MICROTRADE_USDC,
  DESK_MAINTENANCE_NOTIONAL_USDC,
  DESK_FAILED_RUN_COOLDOWN_MS,
  DESK_GAS_ELEVATED_GWEI,
  DESK_HF_CRITICAL,
  DESK_HF_WARN,
  DESK_KILL_HEARTBEAT_MS,
  DESK_MAX_AUM_USDC,
  DESK_MAX_TRADE_USDC,
  DESK_INVENTORY_TOPUP_USDC,
  DESK_MIN_AUM_USDC,
  DESK_MIN_FREE_USDC,
  DESK_ORACLE_MAX_STALENESS_MS,
  DESK_PREFER_UNWIND_FOR_FREE_USDC,
  DESK_POST_MAINTENANCE_SWEEP_COOLDOWN_MS,
  DESK_PROFIT_SWEEP_USDC,
  DESK_REBALANCE_INTERVAL_MS,
  DESK_SCHEDULE_INTERVAL_MS,
  DESK_TARGET_AUM_USDC,
  DESK_TOPUP_CHUNK_USDC,
  DESK_TOPUP_COOLDOWN_MS,
  DESK_USE_PRIVATE_MEMPOOL,
  DESK_PRIVATE_MEMPOOL_STRICT,
  DESK_KH_SIMULATE_PREFLIGHT,
  DESK_KH_SIMULATE_STRICT,
  DESK_KH_SIMULATE_TIMEOUT_MS,
  DIGEST_SCHEDULE_CHECK_INTERVAL_MS,
  PREMIUM_DESK_FEED_PRICE_USDC,
  REGISTRY_USE_PRIVATE_MEMPOOL,
  REVENUE_MIN_DISTRIBUTABLE_USDC,
  REVENUE_ROUTING_SCHEDULE_INTERVAL_MS,
  ROUTING_PROVIDER_LABEL,
  SPONSORED_WATCH_DEFAULT_DURATION_DAYS,
  SPONSORED_WATCH_MAX_DURATION_DAYS,
  SPONSORED_WATCH_MIN_DURATION_HOURS,
  SPONSORED_WATCH_PRICE_USDC,
  TREASURY_BASE_MIN_GAS_ETH,
  TREASURY_CHECK_MIN_INTERVAL_MS,
  TREASURY_CHECK_SCHEDULE_INTERVAL_MS,
  TREASURY_PRIVATE_TRANSFER_THRESHOLD_USDC,
  TREASURY_SEPOLIA_MIN_GAS_ETH,
  UTILITY_COST_PER_GENERATION_USDC,
  UTILITY_COST_PER_REGISTRY_WRITE_USDC,
} from "./defaults.ts";

export interface ServerEnv {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  keeperhubWebhookSecret: string;
  geminiApiKey: string;
  geminiModel: string;
  geminiBaseUrl: string | undefined;
  openaiApiKey: string;
  openaiModel: string;
  openaiBaseUrl: string | undefined;
  groqApiKey: string;
  groqAffiliateApiKey: string;
  groqApiKeys: string[];
  groqModel: string;
  groqBaseUrl: string | undefined;
  x402FacilitatorUrl: string | undefined;
  /**
   * Coinbase CDP Secret API Key ID — required when X402_FACILITATOR_URL is
   * https://api.cdp.coinbase.com/platform/v2/x402 (Bearer JWT on settle).
   */
  cdpApiKeyId: string | undefined;
  /**
   * Coinbase CDP Secret API Key secret (Ed25519 base64 or EC PEM). Server-only.
   */
  cdpApiKeySecret: string | undefined;
  /**
   * EVM chain ID for x402 EIP-712 domain + settlement (default Base Sepolia = 84532).
   * CDP facilitator settles human premium payments on this rail.
   * Desk / registry / capital remain on Ethereum Sepolia (see deskUsdcAddress + RPC_URL).
   */
  x402ChainId: number;
  /**
   * USDC (EIP-3009) contract address used as verifyingContract / asset for x402.
   * Default is Circle official USDC on Base Sepolia.
   * Base mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
   */
  x402UsdcAddress: string;
  /**
   * JSON-RPC URL for the x402 payment chain (Base Sepolia by default).
   * Used for receipt verification and direct EIP-3009 settle when no facilitator.
   * Falls back to BASE_SEPOLIA_RPC_URL; must not be overloaded with desk RPC_URL.
   */
  x402RpcUrl: string | undefined;
  /**
   * EIP-712 domain name for USDC TransferWithAuthorization.
   * Circle Base Sepolia / Ethereum Sepolia USDC use "USDC"; Base mainnet uses "USD Coin".
   * Override with X402_USDC_EIP712_NAME when unset defaults are wrong for the asset.
   */
  x402UsdcEip712Name: string | undefined;
  /** EIP-712 domain version for USDC (default "2"). */
  x402UsdcEip712Version: string | undefined;
  /**
   * Circle USDC on the desk / ops rail (Ethereum Sepolia by default).
   * Used for treasury→desk top-ups, sweeps, position reads, and capital manager.
   * Never reuse x402UsdcAddress here — Base USDC is a different ERC-20.
   */
  deskUsdcAddress: string;
  mppSecret: string | undefined;
  /**
   * HMAC secret for premium access receipts (min 16 chars).
   * Falls back to keeperhubWebhookSecret when unset.
   */
  premiumAccessSecret: string | undefined;
  /**
   * Optional public treasury address for x402 `to`.
   * Production preference: derive from Para MPC wallet (PARA_API_KEY).
   * Fallback: TREASURY_WALLET_PRIVATE_KEY (tests) or explicit address.
   */
  treasuryWalletAddress: string | undefined;
  /**
   * Optional EOA private key for the treasury wallet (LOCAL TESTS ONLY).
   * Production treasury spends use Para MPC (PARA_API_KEY) or KeeperHub.
   * Do not put a treasury private key in production env.
   */
  treasuryWalletPrivateKey: string | undefined;
  /**
   * Minimum treasury balance (same units as live balance, typically ETH)
   * required for on-chain registry writes and revenue routing.
   * Default 0.01 — sized for Sepolia demo treasuries.
   * Override with TREASURY_SAFETY_BUFFER.
   */
  treasurySafetyBuffer: number;
  /** Creator recovery payout recipient (required for revenue routing). */
  creatorRecoveryWallet: string | undefined;
  /**
   * Max fraction of distributable revenue for creator/deployer recovery (0–1).
   * Default 0.8 (80%). Remainder after creator + referral stays as operating reserve.
   */
  creatorRecoveryShare: number;
  /**
   * Max fraction of distributable revenue for affiliates combined (0–1). Default 0.2.
   * Eligible wallets come from the `affiliates` product registry (not env).
   */
  referralRewardShare: number;
  /**
   * Absolute currency-unit cap on total affiliate rewards per routing period. Default 1000.
   */
  referralRewardCap: number;
  /**
   * Max fraction of (availableBalance − safetyBuffer) that may be distributed per period (0–1).
   * Default 0.5.
   */
  maxPayoutShare: number;
  /**
   * Minimum milliseconds between autonomous revenue routing runs (scheduling hint / guard).
   * Default 7 days.
   */
  routingIntervalMs: number;
  /**
   * When true (default), in-process Loop 3 treasury checks run on an interval.
   * KeeperHub webhooks still work when disabled.
   */
  treasuryCheckScheduleEnabled: boolean;
  /** Wake interval for the in-process treasury-check scheduler. */
  treasuryCheckScheduleIntervalMs: number;
  /**
   * Minimum gap between successful treasury snapshots produced by the in-process
   * scheduler (default weekly). KeeperHub can still force more frequent checks.
   */
  treasuryCheckMinIntervalMs: number;
  /**
   * When true (default), in-process Loop 5 revenue routing runs on an interval
   * (still gated by routingIntervalMs / safety buffer).
   */
  revenueRoutingScheduleEnabled: boolean;
  /** Wake interval for the in-process revenue-routing scheduler. */
  revenueRoutingScheduleIntervalMs: number;
  /** USDC price for custom sponsored watch campaigns (Loop 4). */
  sponsoredWatchPriceUsdc: number;
  /** Default campaign length in days when endsAt is omitted. */
  sponsoredWatchDefaultDurationDays: number;
  /** Max campaign length in days a buyer may request. */
  sponsoredWatchMaxDurationDays: number;
  /**
   * Minimum campaign length in hours (demo short campaigns, default 1).
   * Env: SPONSORED_WATCH_MIN_DURATION_HOURS.
   */
  sponsoredWatchMinDurationHours: number;
  /** USDC-equivalent cost estimate per LLM generation log entry. */
  utilityCostPerGenerationUsdc: number;
  /** USDC-equivalent cost estimate per successful registry write log entry. */
  utilityCostPerRegistryWriteUsdc: number;
  /**
   * USDC amount retained as operating reserve before Loop 5 distribution
   * (in addition to ETH gas safety buffer). Default 0.
   * Lower for hackathon demo so micro-payouts fire more often.
   */
  treasuryUsdcOperatingReserve: number;
  /**
   * Minimum net distributable USDC for Loop 5 to create a payout (default 0.01).
   * Allows sub-dollar micro-payouts for demo cadence. Env: REVENUE_MIN_DISTRIBUTABLE_USDC.
   */
  revenueMinDistributableUsdc: number;
  /**
   * Revenue FX mode:
   * - oracle: require live Chainlink ETH/USD
   * - static: use revenueEthPerCurrencyUnit only
   * - auto: prefer Chainlink, fall back to static (default)
   */
  revenueFxMode: "oracle" | "static" | "auto";
  /**
   * Static ETH-per-currency-unit scale for transfers when FX mode is static,
   * or as auto-mode fallback when Chainlink is unavailable.
   * Example: 1e-6 means 1_000 currency units → 0.001 ETH.
   * Undefined when unset (oracle-only or auto without fallback).
   */
  revenueEthPerCurrencyUnit: number | undefined;
  chronicleRegistryAddress: string | undefined;
  /**
   * Ethereum Sepolia JSON-RPC (desk / registry / Chainlink / Para reads).
   * Do not point this at mainnet — newspaper block monitors use mainnetRpcUrl.
   */
  rpcUrl: string | undefined;
  /**
   * Ethereum mainnet JSON-RPC for newspaper gas/volume block analysis (chainId 1).
   * Required when gas-volume-block-monitor (or any chainId=1 block ingest) is live.
   * Override with MAINNET_RPC_URL / ETH_RPC_URL.
   */
  mainnetRpcUrl: string | undefined;
  /**
   * Base mainnet JSON-RPC for chainId 8453 block analysis (optional).
   * Override with BASE_RPC_URL.
   */
  baseRpcUrl: string | undefined;
  /**
   * Production Para partner API key (server-side only).
   * Enables real Para MPC treasury wallets via @getpara/rest-sdk.
   * Get from https://developer.getpara.com
   */
  paraApiKey: string | undefined;
  /**
   * Para environment: BETA (default, testnets) | PROD | SANDBOX.
   */
  paraEnvironment: "BETA" | "PROD" | "SANDBOX";
  /**
   * Identifier used to create/lookup the agent treasury wallet under Para.
   * Default: chronicleai-treasury
   */
  paraTreasuryUserIdentifier: string;
  /**
   * Identifier type for Para wallet lookup. Default CUSTOM_ID for agent wallets.
   */
  paraTreasuryUserIdentifierType: string;
  /**
   * Optional pre-created Para wallet ID. When set, skips create/list lookup.
   */
  paraWalletId: string | undefined;
  /**
   * Test-only agent/registry EOA private key. Historical env name
   * (`PARA_WALLET_PRIVATE_KEY`) — this is NOT a Para MPC credential.
   * Used only when ALLOW_DIRECT_ETHERS_WRITES=true (local unit tests).
   */
  paraWalletPrivateKey: string | undefined;
  /**
   * When true (and NODE_ENV is not production), allow direct ethers
   * sendTransaction for local unit tests. Default false.
   */
  allowDirectEthersWrites: boolean;
  /** KeeperHub REST base URL (e.g. https://app.keeperhub.com). */
  keeperhubApiBaseUrl: string | undefined;
  /** Organization API key (kh_…). Required for material production writes. */
  keeperhubApiKey: string | undefined;
  /** KeeperHub network slug / chain id for writes (default sepolia). */
  keeperhubNetwork: string;
  /**
   * Prefer KeeperHub MCP for all material writes (registry + desk + transfer).
   * Default true when KeeperHub is configured.
   * Set KEEPERHUB_MCP_ENABLED=false to force REST workflow execute only.
   */
  keeperhubMcpEnabled: boolean;
  /**
   * Explicit MCP endpoint (e.g. https://app.keeperhub.com/mcp).
   * When unset, derived as `${KEEPERHUB_API_BASE_URL}/mcp`.
   */
  keeperhubMcpUrl: string | undefined;
  /**
   * Fall back to REST workflow execute when MCP fails. Default true.
   * Set KEEPERHUB_MCP_REST_FALLBACK=false to fail closed on MCP errors.
   */
  keeperhubMcpRestFallback: boolean;
  /**
   * Use LangChain ReAct agent for alert/digest MCP path when LLM keys exist.
   * Other write methods always use deterministic MCP. Default true.
   */
  keeperhubMcpLangchainAgent: boolean;
  /**
   * Pre-imported KeeperHub workflow IDs (maps 1:1 to workflows/keeperhub/*.workflow.json).
   * Required for each write action — Direct Execution is disabled; missing IDs fail hard.
   */
  /** Write path */
  keeperhubWorkflowPublishAlert: string | undefined;
  keeperhubWorkflowPublishDigest: string | undefined;
  keeperhubWorkflowCreateSponsoredWatch: string | undefined;
  keeperhubWorkflowPublishSponsoredReport: string | undefined;
  keeperhubWorkflowPublishPremiumReceipt: string | undefined;
  keeperhubWorkflowRecordPayout: string | undefined;
  /** Desk trade-ticket registry write (chronicle-publish-trade-ticket.workflow.json). */
  keeperhubWorkflowPublishTradeTicket: string | undefined;
  /** Desk capital-move registry write (chronicle-record-capital-move.workflow.json). */
  keeperhubWorkflowRecordCapitalMove: string | undefined;
  keeperhubWorkflowTransfer: string | undefined;
  /** Desk strategy / capital KeeperHub workflow IDs (fail hard when execute path needs them). */
  keeperhubWorkflowDeskSweep: string | undefined;
  keeperhubWorkflowDeskDefend: string | undefined;
  keeperhubWorkflowDeskRotate: string | undefined;
  keeperhubWorkflowDeskOracleArb: string | undefined;
  keeperhubWorkflowDeskKillSwitch: string | undefined;
  /** Monitoring path (Event/Block trackers; optional ops references) */
  keeperhubWorkflowAaveLiquidation: string | undefined;
  keeperhubWorkflowCowTrade: string | undefined;
  keeperhubWorkflowUniswapUsdcWethSwap: string | undefined;
  keeperhubWorkflowUniswapPoolCreated: string | undefined;
  keeperhubWorkflowGasVolumeBlock: string | undefined;
  /**
   * KeeperHub desk execution wallet (public address only).
   * Never put a desk EOA private key in env — production forbids DESK_*_PRIVATE_KEY.
   */
  deskWalletAddress: string | undefined;
  /**
   * Prefer private mempool routing for desk strategy/capital KH executions.
   * Workflow JSON sets usePrivateMempool; this is Chronicle policy for logs/UI.
   * Default true. Env: DESK_USE_PRIVATE_MEMPOOL.
   */
  deskUsePrivateMempool: boolean;
  /**
   * Expect workflow strict mode (private RPC failure does not fall back to public).
   * Kill-switch residual transfers always strict. Env: DESK_PRIVATE_MEMPOOL_STRICT.
   */
  deskPrivateMempoolStrict: boolean;
  /**
   * Layer A: KeeperHub DE dry-run (`simulate: true`) before workflow execute.
   * Default true (hackathon audit trail). Env: DESK_KH_SIMULATE_PREFLIGHT.
   */
  deskKhSimulatePreflight: boolean;
  /**
   * When true with Layer A on, block execute on wouldRevert or dry-run transport error.
   * Default false (fail-open). Env: DESK_KH_SIMULATE_STRICT.
   */
  deskKhSimulateStrict: boolean;
  /** Abort KH dry-run wait after this many ms. Env: DESK_KH_SIMULATE_TIMEOUT_MS. */
  deskKhSimulateTimeoutMs: number;
  /**
   * USDC notional at/above this forces KeeperHub private transfer path (Phase 3).
   * Env: TREASURY_PRIVATE_TRANSFER_THRESHOLD_USDC.
   */
  treasuryPrivateTransferThresholdUsdc: number;
  /**
   * Registry publish/record workflows: true = full-stack private metadata;
   * false = public/sponsorship-friendly labeling. Env: REGISTRY_USE_PRIVATE_MEMPOOL.
   */
  registryUsePrivateMempool: boolean;
  /**
   * Provider label for Activity / execution_logs (not a network endpoint).
   * Default flashbots_protect. Env: ROUTING_PROVIDER_LABEL.
   */
  routingProviderLabel: string;
  /** Steady-state desk book size (USDC). */
  deskTargetAumUsdc: number;
  /** Hard ceiling on desk equity (USDC). */
  deskMaxAumUsdc: number;
  /** Below this equity, top-up is urgent (USDC). */
  deskMinAumUsdc: number;
  /** Discrete treasury → desk top-up chunk (USDC). */
  deskTopupChunkUsdc: number;
  /** Floor of liquid free USDC on desk (USDC). */
  deskMinFreeUsdc: number;
  /** Chunk to free/top-up when free USDC is below the floor (USDC). */
  deskInventoryTopupUsdc: number;
  /** Prefer on-desk unwind over treasury top-up for free-USDC shortfall. */
  deskPreferUnwindForFreeUsdc: boolean;
  /** Free-USDC profit threshold before sweep (USDC). */
  deskProfitSweepUsdc: number;
  /** Anti-thrash cooldown between top-ups (ms). */
  deskTopupCooldownMs: number;
  /**
   * After free-powder maintenance fill, skip max-AUM sweeps for this long
   * unless free is well above powder + profit threshold (ms).
   */
  deskPostMaintenanceSweepCooldownMs: number;
  /** Soft defend / alert health-factor threshold. */
  deskHfWarn: number;
  /** Hard defend health-factor threshold. */
  deskHfCritical: number;
  /** Oracle vs AMM basis entry band (bps). */
  deskBasisBps: number;
  /** Min yield edge to rotate (bps). */
  deskApyDeltaBps: number;
  /** Per-intent notional cap (USDC). */
  deskMaxTradeUsdc: number;
  /** Stale heartbeat → kill-switch eligibility (ms). */
  deskKillHeartbeatMs: number;
  /** When true, desk accepts no new risk-increasing intents. */
  deskPaused: boolean;
  /** Cooldown after a failed strategy run (ms). */
  deskFailedRunCooldownMs: number;
  /** Max oracle updatedAt age before refusing opens (ms). */
  deskOracleMaxStalenessMs: number;
  /** Consecutive APY polls required before rotation. */
  deskApyConsecutivePolls: number;
  /** APY edge (bps) treated as data-quality / unreliable for yield thesis. */
  deskApyAbsurdBps: number;
  /** Min interval between maintenance rebalance fills (ms). */
  deskRebalanceIntervalMs: number;
  /** Notional cap for maintenance free-powder legs (USDC). */
  deskMaintenanceNotionalUsdc: number;
  /** Gas gwei treated as elevated. */
  deskGasElevatedGwei: number;
  /**
   * When true, qualified newspaper events (large_swap / gas_spike / volume_anomaly)
   * may authorize a policy-capped desk microtrade on the next desk tick.
   * Default true.
   */
  deskEventMicrotradeEnabled: boolean;
  /** Per-event microtrade notional cap (USDC). */
  deskEventMicrotradeUsdc: number;
  /** Min ms between event-linked microtrade attempts. */
  deskEventMicrotradeCooldownMs: number;
  /** Lookback window (ms) for qualifying monitored events. */
  deskEventMicrotradeLookbackMs: number;
  /** Premium desk feed price (USDC). */
  premiumDeskFeedPriceUsdc: number;
  /**
   * When true (default), in-process desk capital + strategy ticks run on an interval.
   * KeeperHub-signed POST /keeperhub/desk/capital and /tick still work when disabled.
   */
  deskScheduleEnabled: boolean;
  /** Wake interval for the in-process desk scheduler (capital then execute tick). */
  deskScheduleIntervalMs: number;
  /**
   * When true (default), scheduled desk ticks pass execute=true so approved
   * intents run via KeeperHub. Set false for evaluate-only / dry-run deploys.
   */
  deskScheduleExecute: boolean;
  /**
   * Preferred LLM provider for the desk agent (gemini|openai|groq).
   * Empty → auto: first keyed provider in Gemini → Groq → OpenAI order.
   * LLM is always mandatory for strategy decisions (no off-switch).
   */
  deskAgentLlmProvider: string | undefined;
  /** Optional model override for the desk agent. */
  deskAgentModel: string | undefined;
  /** Hard timeout for agent completion (ms). */
  deskAgentTimeoutMs: number;
  /** Decision temperature for structured agent JSON. */
  deskAgentTemperature: number;
  /** Max recent signals in agent context. */
  deskAgentMaxSignals: number;
  /** Below this confidence, treat propose as hold (unless force-defend). */
  deskAgentMinConfidence: number;
  /** When true, ignore agent hold/defer for risk_defend if HF is critical. */
  deskAgentForceDefendOnCriticalHf: boolean;
  // ── CCTP rebalance (Base Sepolia → Ethereum Sepolia) ──
  /** Master feature flag for automated CCTP rebalance. Default false. */
  cctpRebalanceEnabled: boolean;
  /** Iris API base URL (sandbox default for testnet). */
  cctpIrisBaseUrl: string;
  /** Prefer Forwarding Service when fee quote succeeds. Default true. */
  cctpUseForwarding: boolean;
  /** CCTP V2 TokenMessenger address (testnet default shared across domains). */
  cctpTokenMessenger: string;
  /** CCTP V2 MessageTransmitter address. */
  cctpMessageTransmitter: string;
  /** Source domain (Base Sepolia = 6). */
  cctpSourceDomain: number;
  /** Destination domain (Ethereum Sepolia = 0). */
  cctpDestDomain: number;
  /** Fast Transfer threshold (default 1000). */
  cctpMinFinalityThreshold: number;
  cctpBaseSafetyBufferUsdc: number;
  cctpRebalanceThresholdUsdc: number;
  cctpRebalanceChunkUsdc: number;
  cctpRebalanceMaxChunkUsdc: number;
  cctpMaxInFlight: number;
  cctpCooldownMs: number;
  cctpMaxFeeUsdc: number;
  cctpPollIntervalMs: number;
  cctpPollTimeoutMs: number;
  treasurySepoliaMinGasEth: number;
  treasuryBaseMinGasEth: number;
  cctpMintMaxAttempts: number;
  cctpForwardingFallbackMs: number;
  cctpRebalanceScheduleIntervalMs: number;
  /**
   * When true, desk starvation may break cooldown (demo only). Default false.
   */
  cctpForceOnDeskStarvation: boolean;
  /**
   * Legacy CCTP operator private key for multi-chain approve/burn/mint when
   * Para is not configured. Preferred production path is Para MPC treasury
   * (burn from treasury pocket). Mint recipient remains treasury; never set
   * mint recipient to this key.
   */
  cctpOperatorPrivateKey: string | undefined;
  smtpHost: string | undefined;
  smtpPort: number | undefined;
  smtpUser: string | undefined;
  smtpPass: string | undefined;
  smtpFromAddress: string | undefined;
  /**
   * Monthly x402 newsletter price in USDC (human units, e.g. 2 = 2 USDC).
   * Default 2 USDC / billing period.
   */
  newsletterMonthlyPriceUsdc: number;
  /** Billing period length in days for recurring newsletter agreements. Default 30. */
  newsletterBillingPeriodDays: number;
  /** Days after period end before entitlement expires. Default 3. */
  newsletterGracePeriodDays: number;
  /**
   * Ingest bot token (webhook receiver for KeeperHub→Telegram→Chronicle bridge).
   * Privacy mode must be OFF so the bot sees other bots' messages in the group.
   * Resolved from TELEGRAM_INGEST_BOT_TOKEN, falling back to TELEGRAM_BOT_TOKEN.
   */
  telegramIngestBotToken: string | undefined;
  /**
   * Send bot token — used by Chronicle for post-registry alert/digest broadcasts.
   * Must be a *different* bot than the ingest bot (Telegram bots never receive
   * their own messages). Use this same token in KeeperHub → Connections → Telegram.
   * From TELEGRAM_SEND_BOT_TOKEN.
   */
  telegramSendBotToken: string | undefined;
  /**
   * @deprecated Alias of `telegramIngestBotToken` (TELEGRAM_BOT_TOKEN legacy name).
   * Prefer `telegramIngestBotToken` / `telegramSendBotToken`.
   */
  telegramBotToken: string | undefined;
  /** Telegram chat/channel ID that receives alert broadcasts. */
  telegramChatId: string | undefined;
  /**
   * Shared secret for Telegram Bot API webhook auth
   * (`X-Telegram-Bot-Api-Secret-Token`). Required to enable POST /telegram/webhook.
   * 1–256 chars: A–Z a–z 0–9 _ -
   */
  telegramWebhookSecret: string | undefined;
  /**
   * Chat ID allowed for KeeperHub→Telegram→Chronicle ingest (supergroup / channel).
   * Defaults to TELEGRAM_CHAT_ID when unset.
   */
  telegramIngestChatId: string | undefined;
  /**
   * Public HTTPS origin of this API (no path), e.g. https://chronicleai-xxx.herokuapp.com.
   * Used to auto-register Telegram setWebhook on boot so deploys do not need a manual script.
   */
  publicApiBaseUrl: string | undefined;
  /**
   * When true (default), Chronicle runs an in-process daily digest scheduler that
   * generates the previous completed UTC day via DigestRunHandler (idempotent).
   * Disable with DIGEST_SCHEDULE_ENABLED=false if an external KeeperHub schedule
   * is the only trigger you want.
   */
  digestScheduleEnabled: boolean;
  /** Override check interval for the digest scheduler (ms). */
  digestScheduleIntervalMs: number;
  frontendOrigin: string;
  port: number;
  nodeEnv: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

/** Base Sepolia — x402 + CDP facilitator payment rail. */
const DEFAULT_X402_CHAIN_ID = 84_532;
/** Circle official USDC on Base Sepolia (EIP-3009). */
const DEFAULT_X402_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
/** Circle official USDC on Ethereum Sepolia — desk / capital manager only. */
const DEFAULT_DESK_USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${name}: expected a positive integer, got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

function parseNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Invalid ${name}: expected a non-negative integer, got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

function parsePositiveNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${name}: expected a positive number, got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

function parseEvmAddressEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const address = raw.trim();
  if (!EVM_ADDRESS_RE.test(address)) {
    throw new Error(
      `Invalid ${name}: expected a 0x-prefixed 40-hex EVM address, got ${JSON.stringify(raw)}`,
    );
  }
  return address;
}

function parseUnitIntervalEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(
      `Invalid ${name}: expected a number in [0, 1], got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

function parseNonNegativeNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `Invalid ${name}: expected a non-negative number, got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

function parseParaEnvironment(raw: string | undefined): "BETA" | "PROD" | "SANDBOX" {
  const value = (raw ?? "BETA").trim().toUpperCase();
  if (value === "PROD" || value === "PRODUCTION") {
    return "PROD";
  }
  if (value === "SANDBOX") {
    return "SANDBOX";
  }
  return "BETA";
}

function parseRevenueFxMode(raw: string | undefined): "oracle" | "static" | "auto" {
  const value = (raw ?? "auto").trim().toLowerCase();
  if (value === "oracle" || value === "static" || value === "auto") {
    return value;
  }
  throw new Error(
    `Invalid REVENUE_FX_MODE: expected oracle|static|auto, got ${JSON.stringify(raw)}`,
  );
}

/**
 * Optional positive number; returns undefined when unset (not a silent zero).
 */
function parseOptionalPositiveNumberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${name}: expected a positive number, got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

let currentGroqKeyIndex = 0;
type GroqKeyIndexPersister = (nextIndex: number) => void;
let groqKeyIndexPersister: GroqKeyIndexPersister | null = null;

/**
 * Register a callback to persist the Groq key rotation index to database (e.g. Supabase).
 */
export function registerGroqKeyIndexPersister(persister: GroqKeyIndexPersister | null): void {
  groqKeyIndexPersister = persister;
}

/**
 * Explicitly sets the current Groq key rotation index (e.g. loaded from database on boot).
 */
export function setGroqKeyIndex(index: number): void {
  currentGroqKeyIndex = Math.max(0, Math.floor(index));
}

/**
 * Returns the current Groq key rotation index.
 */
export function getGroqKeyIndex(): number {
  return currentGroqKeyIndex;
}

/**
 * Resets the Groq key rotation index back to 0 (useful for testing).
 */
export function resetGroqKeyIndex(): void {
  currentGroqKeyIndex = 0;
}

/**
 * Returns all configured Groq API keys from process.env (or provided map).
 * Scans GROQ_API_KEY, GROQ_API_KEY_1, GROQ_API_KEY_2, GROQ_API_KEY_3, ...
 */
export function getGroqApiKeys(
  envMap: Record<string, string | undefined> = process.env,
): string[] {
  const keys: string[] = [];

  const addIfValid = (val: string | undefined) => {
    const trimmed = val?.trim();
    if (trimmed && !keys.includes(trimmed)) {
      keys.push(trimmed);
    }
  };

  // 1. Primary key: GROQ_API_KEY or GROQ_API_KEY_1
  addIfValid(envMap.GROQ_API_KEY);
  addIfValid(envMap.GROQ_API_KEY_1);

  // 2. Sequential scan: GROQ_API_KEY_2, GROQ_API_KEY_3, ...
  let i = 2;
  while (true) {
    const k = envMap[`GROQ_API_KEY_${i}`];
    if (k === undefined) break;
    addIfValid(k);
    i++;
  }

  // 3. Dynamic scan for any non-sequential GROQ_API_KEY_\d+ keys
  const numberedKeyNames = Object.keys(envMap)
    .filter((k) => /^GROQ_API_KEY_\d+$/i.test(k))
    .sort((a, b) => {
      const numA = parseInt(a.replace(/^GROQ_API_KEY_/i, ""), 10);
      const numB = parseInt(b.replace(/^GROQ_API_KEY_/i, ""), 10);
      return numA - numB;
    });

  for (const keyName of numberedKeyNames) {
    addIfValid(envMap[keyName]);
  }

  return keys;
}

/**
 * Returns the next Groq API key in round-robin sequence.
 * Rotates through all available keys dynamically for each call/request.
 */
export function getNextGroqApiKey(
  envMap: Record<string, string | undefined> = process.env,
): string {
  const keys = getGroqApiKeys(envMap);
  if (keys.length === 0) return "";
  const key = keys[currentGroqKeyIndex % keys.length];
  currentGroqKeyIndex = (currentGroqKeyIndex + 1) % keys.length;
  if (groqKeyIndexPersister) {
    try {
      groqKeyIndexPersister(currentGroqKeyIndex);
    } catch {
      // Ignore background persistence errors
    }
  }
  return key ?? "";
}

/**
 * Returns the starting index for round-robin rotation and advances the global index.
 */
export function advanceAndGetGroqKeyIndex(totalKeys: number): number {
  if (totalKeys <= 0) return 0;
  const index = currentGroqKeyIndex % totalKeys;
  currentGroqKeyIndex = (currentGroqKeyIndex + 1) % totalKeys;
  if (groqKeyIndexPersister) {
    try {
      groqKeyIndexPersister(currentGroqKeyIndex);
    } catch {
      // Ignore background persistence errors
    }
  }
  return index;
}


const DEFAULT_ROUTING_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Fail-hard production readiness checks for circular-economy / on-chain paths.
 * Call after loadServerEnv when NODE_ENV=production.
 */
export function assertProductionReadiness(env: ServerEnv): void {
  if (env.nodeEnv !== "production") {
    return;
  }

  const errors: string[] = [];

  const hasKeeperHub =
    Boolean(env.keeperhubApiKey?.trim()) &&
    Boolean(env.keeperhubApiBaseUrl?.trim()) &&
    Boolean(env.chronicleRegistryAddress?.trim());

  const hasPara = Boolean(env.paraApiKey?.trim());
  const hasParaRegistry =
    hasPara && Boolean(env.rpcUrl?.trim()) && Boolean(env.chronicleRegistryAddress?.trim());

  if (!hasKeeperHub && !hasParaRegistry) {
    errors.push(
      "On-chain write path required: configure KeeperHub (KEEPERHUB_API_KEY + KEEPERHUB_API_BASE_URL + CHRONICLE_REGISTRY_ADDRESS) and/or Para MPC registry path (PARA_API_KEY + RPC_URL + CHRONICLE_REGISTRY_ADDRESS)",
    );
  }

  if (!env.creatorRecoveryWallet || !EVM_ADDRESS_RE.test(env.creatorRecoveryWallet)) {
    errors.push(
      "CREATOR_RECOVERY_WALLET must be a valid 0x EVM address for production revenue routing",
    );
  }

  if (!env.mppSecret?.trim() && !env.x402FacilitatorUrl?.trim() && !env.rpcUrl?.trim()) {
    errors.push(
      "Payment rails incomplete: set MPP_SECRET and/or X402_FACILITATOR_URL (or RPC_URL for on-chain x402 settlement)",
    );
  }

  if (env.revenueFxMode === "static" && env.revenueEthPerCurrencyUnit == null) {
    errors.push(
      "REVENUE_FX_MODE=static requires REVENUE_ETH_PER_CURRENCY_UNIT > 0",
    );
  }

  if (env.revenueFxMode === "oracle" && !env.rpcUrl?.trim()) {
    errors.push("REVENUE_FX_MODE=oracle requires RPC_URL for Chainlink ETH/USD");
  }

  if (
    env.creatorRecoveryShare + env.referralRewardShare > 1 + 1e-9
  ) {
    errors.push(
      `CREATOR_RECOVERY_SHARE (${env.creatorRecoveryShare}) + REFERRAL_REWARD_SHARE (${env.referralRewardShare}) must be ≤ 1`,
    );
  }

  // Direct ethers keys must never be the production spend path
  if (env.allowDirectEthersWrites) {
    errors.push(
      "ALLOW_DIRECT_ETHERS_WRITES must not be true in production",
    );
  }
  if (env.treasuryWalletPrivateKey?.trim() || env.paraWalletPrivateKey?.trim()) {
    errors.push(
      "Production must not set TREASURY_WALLET_PRIVATE_KEY or PARA_WALLET_PRIVATE_KEY — use PARA_API_KEY (MPC) and/or KeeperHub",
    );
  }

  // Trade tickets / premium receipts must never publish localhost contentUri in prod.
  const origin = env.frontendOrigin?.trim() ?? "";
  if (!origin) {
    errors.push("FRONTEND_ORIGIN is required in production for on-chain contentUri");
  } else {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== "https:") {
        errors.push(
          `FRONTEND_ORIGIN must use https in production (got ${parsed.protocol}//${parsed.host})`,
        );
      }
      if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(parsed.hostname)) {
        errors.push(
          "FRONTEND_ORIGIN must not be localhost in production — set a public SPA origin",
        );
      }
    } catch {
      errors.push(`FRONTEND_ORIGIN is not a valid absolute URL: ${origin}`);
    }
  }

  // Desk hot wallet must remain a KeeperHub execution wallet — never an in-process EOA key.
  if (
    process.env.DESK_PRIVATE_KEY?.trim() ||
    process.env.DESK_WALLET_PRIVATE_KEY?.trim() ||
    process.env.DESK_EOA_PRIVATE_KEY?.trim()
  ) {
    errors.push(
      "Production must not set DESK_PRIVATE_KEY / DESK_WALLET_PRIVATE_KEY / DESK_EOA_PRIVATE_KEY — desk signing is KeeperHub org wallet only",
    );
  }

  if (env.deskWalletAddress && !EVM_ADDRESS_RE.test(env.deskWalletAddress)) {
    errors.push("DESK_WALLET_ADDRESS must be a valid 0x EVM address when set");
  }

  if (env.deskMinAumUsdc > env.deskTargetAumUsdc) {
    errors.push(
      `DESK_MIN_AUM_USDC (${env.deskMinAumUsdc}) must be ≤ DESK_TARGET_AUM_USDC (${env.deskTargetAumUsdc})`,
    );
  }
  if (env.deskTargetAumUsdc > env.deskMaxAumUsdc) {
    errors.push(
      `DESK_TARGET_AUM_USDC (${env.deskTargetAumUsdc}) must be ≤ DESK_MAX_AUM_USDC (${env.deskMaxAumUsdc})`,
    );
  }
  if (env.deskHfCritical >= env.deskHfWarn) {
    errors.push(
      `DESK_HF_CRITICAL (${env.deskHfCritical}) must be < DESK_HF_WARN (${env.deskHfWarn})`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Production environment is not ready:\n- ${errors.join("\n- ")}`,
    );
  }
}

export function loadServerEnv(): ServerEnv {
  const nodeEnv = optionalEnv("NODE_ENV", "development") as string;

  const creatorRecoveryShare = parseUnitIntervalEnv("CREATOR_RECOVERY_SHARE", 0.8);
  const referralRewardShare = parseUnitIntervalEnv("REFERRAL_REWARD_SHARE", 0.2);
  const revenueFxMode = parseRevenueFxMode(optionalEnv("REVENUE_FX_MODE", "auto"));
  const revenueEthPerCurrencyUnit = parseOptionalPositiveNumberEnv(
    "REVENUE_ETH_PER_CURRENCY_UNIT",
  );

  if (revenueFxMode === "static" && revenueEthPerCurrencyUnit == null) {
    // Development convenience: static mode without explicit value uses demo scale.
    // Production is fail-hard via assertProductionReadiness.
    if (nodeEnv === "production") {
      throw new Error(
        "REVENUE_FX_MODE=static requires REVENUE_ETH_PER_CURRENCY_UNIT in production",
      );
    }
  }

  if (creatorRecoveryShare + referralRewardShare > 1 + 1e-9) {
    throw new Error(
      `CREATOR_RECOVERY_SHARE (${creatorRecoveryShare}) + REFERRAL_REWARD_SHARE (${referralRewardShare}) must be ≤ 1`,
    );
  }

  // Two-bot Telegram bridge: ingest receives webhooks; send posts (KeeperHub + broadcasts).
  // TELEGRAM_BOT_TOKEN remains a legacy alias for the ingest bot.
  const telegramIngestBotToken =
    optionalEnv("TELEGRAM_INGEST_BOT_TOKEN") ?? optionalEnv("TELEGRAM_BOT_TOKEN");
  const telegramSendBotToken = optionalEnv("TELEGRAM_SEND_BOT_TOKEN");

  // Desk policy knobs — validate ranges once at load (not only in production).
  const deskTargetAumUsdc = parsePositiveNumberEnv(
    "DESK_TARGET_AUM_USDC",
    DESK_TARGET_AUM_USDC,
  );
  const deskMaxAumUsdc = parsePositiveNumberEnv("DESK_MAX_AUM_USDC", DESK_MAX_AUM_USDC);
  const deskMinAumUsdc = parsePositiveNumberEnv("DESK_MIN_AUM_USDC", DESK_MIN_AUM_USDC);
  const deskTopupChunkUsdc = parsePositiveNumberEnv(
    "DESK_TOPUP_CHUNK_USDC",
    DESK_TOPUP_CHUNK_USDC,
  );
  const deskMinFreeUsdc = parsePositiveNumberEnv(
    "DESK_MIN_FREE_USDC",
    DESK_MIN_FREE_USDC,
  );
  const deskInventoryTopupUsdc = parsePositiveNumberEnv(
    "DESK_INVENTORY_TOPUP_USDC",
    DESK_INVENTORY_TOPUP_USDC,
  );
  const deskPreferUnwindForFreeUsdc =
    (
      optionalEnv(
        "DESK_PREFER_UNWIND_FOR_FREE_USDC",
        DESK_PREFER_UNWIND_FOR_FREE_USDC ? "true" : "false",
      ) ?? (DESK_PREFER_UNWIND_FOR_FREE_USDC ? "true" : "false")
    ).toLowerCase() !== "false";
  const deskProfitSweepUsdc = parsePositiveNumberEnv(
    "DESK_PROFIT_SWEEP_USDC",
    DESK_PROFIT_SWEEP_USDC,
  );
  const deskTopupCooldownMs = parsePositiveIntEnv(
    "DESK_TOPUP_COOLDOWN_MS",
    DESK_TOPUP_COOLDOWN_MS,
  );
  const deskPostMaintenanceSweepCooldownMs = parsePositiveIntEnv(
    "DESK_POST_MAINTENANCE_SWEEP_COOLDOWN_MS",
    DESK_POST_MAINTENANCE_SWEEP_COOLDOWN_MS,
  );
  const deskHfWarn = parsePositiveNumberEnv("DESK_HF_WARN", DESK_HF_WARN);
  const deskHfCritical = parsePositiveNumberEnv("DESK_HF_CRITICAL", DESK_HF_CRITICAL);
  const deskBasisBps = parsePositiveIntEnv("DESK_BASIS_BPS", DESK_BASIS_BPS);
  const deskApyDeltaBps = parsePositiveIntEnv("DESK_APY_DELTA_BPS", DESK_APY_DELTA_BPS);
  const deskMaxTradeUsdc = parsePositiveNumberEnv(
    "DESK_MAX_TRADE_USDC",
    DESK_MAX_TRADE_USDC,
  );
  const deskKillHeartbeatMs = parsePositiveIntEnv(
    "DESK_KILL_HEARTBEAT_MS",
    DESK_KILL_HEARTBEAT_MS,
  );
  const deskFailedRunCooldownMs = parsePositiveIntEnv(
    "DESK_FAILED_RUN_COOLDOWN_MS",
    DESK_FAILED_RUN_COOLDOWN_MS,
  );
  const deskOracleMaxStalenessMs = parsePositiveIntEnv(
    "DESK_ORACLE_MAX_STALENESS_MS",
    DESK_ORACLE_MAX_STALENESS_MS,
  );
  const deskApyConsecutivePolls = parsePositiveIntEnv(
    "DESK_APY_CONSECUTIVE_POLLS",
    DESK_APY_CONSECUTIVE_POLLS,
  );
  const deskApyAbsurdBps = parsePositiveIntEnv(
    "DESK_APY_ABSURD_BPS",
    DESK_APY_ABSURD_BPS,
  );
  const deskRebalanceIntervalMs = parsePositiveIntEnv(
    "DESK_REBALANCE_INTERVAL_MS",
    DESK_REBALANCE_INTERVAL_MS,
  );
  const deskMaintenanceNotionalUsdc = parsePositiveNumberEnv(
    "DESK_MAINTENANCE_NOTIONAL_USDC",
    DESK_MAINTENANCE_NOTIONAL_USDC,
  );
  const deskGasElevatedGwei = parsePositiveNumberEnv(
    "DESK_GAS_ELEVATED_GWEI",
    DESK_GAS_ELEVATED_GWEI,
  );
  const deskEventMicrotradeEnabled =
    (
      optionalEnv(
        "DESK_EVENT_MICROTRADE_ENABLED",
        DESK_EVENT_MICROTRADE_ENABLED ? "true" : "false",
      ) ?? (DESK_EVENT_MICROTRADE_ENABLED ? "true" : "false")
    ).toLowerCase() === "true";
  const deskEventMicrotradeUsdc = parsePositiveNumberEnv(
    "DESK_EVENT_MICROTRADE_USDC",
    DESK_EVENT_MICROTRADE_USDC,
  );
  const deskEventMicrotradeCooldownMs = parsePositiveIntEnv(
    "DESK_EVENT_MICROTRADE_COOLDOWN_MS",
    DESK_EVENT_MICROTRADE_COOLDOWN_MS,
  );
  const deskEventMicrotradeLookbackMs = parsePositiveIntEnv(
    "DESK_EVENT_MICROTRADE_LOOKBACK_MS",
    DESK_EVENT_MICROTRADE_LOOKBACK_MS,
  );
  const premiumDeskFeedPriceUsdc = parsePositiveNumberEnv(
    "PREMIUM_DESK_FEED_PRICE_USDC",
    PREMIUM_DESK_FEED_PRICE_USDC,
  );
  const deskPaused =
    (optionalEnv("DESK_PAUSED", "false") ?? "false").toLowerCase() === "true";

  const deskWalletRaw = optionalEnv("DESK_WALLET_ADDRESS")?.trim();
  if (deskWalletRaw && !EVM_ADDRESS_RE.test(deskWalletRaw)) {
    throw new Error(
      `Invalid DESK_WALLET_ADDRESS: expected a 0x-prefixed 40-hex EVM address, got ${JSON.stringify(deskWalletRaw)}`,
    );
  }

  if (deskMinAumUsdc > deskTargetAumUsdc) {
    throw new Error(
      `DESK_MIN_AUM_USDC (${deskMinAumUsdc}) must be ≤ DESK_TARGET_AUM_USDC (${deskTargetAumUsdc})`,
    );
  }
  if (deskTargetAumUsdc > deskMaxAumUsdc) {
    throw new Error(
      `DESK_TARGET_AUM_USDC (${deskTargetAumUsdc}) must be ≤ DESK_MAX_AUM_USDC (${deskMaxAumUsdc})`,
    );
  }
  if (deskHfCritical >= deskHfWarn) {
    throw new Error(
      `DESK_HF_CRITICAL (${deskHfCritical}) must be < DESK_HF_WARN (${deskHfWarn})`,
    );
  }
  if (deskTopupChunkUsdc > deskMaxAumUsdc) {
    throw new Error(
      `DESK_TOPUP_CHUNK_USDC (${deskTopupChunkUsdc}) must be ≤ DESK_MAX_AUM_USDC (${deskMaxAumUsdc})`,
    );
  }
  if (deskInventoryTopupUsdc > deskMaxAumUsdc) {
    throw new Error(
      `DESK_INVENTORY_TOPUP_USDC (${deskInventoryTopupUsdc}) must be ≤ DESK_MAX_AUM_USDC (${deskMaxAumUsdc})`,
    );
  }
  if (deskMinFreeUsdc > deskMaxAumUsdc) {
    throw new Error(
      `DESK_MIN_FREE_USDC (${deskMinFreeUsdc}) must be ≤ DESK_MAX_AUM_USDC (${deskMaxAumUsdc})`,
    );
  }
  if (deskEventMicrotradeUsdc > deskMaxTradeUsdc) {
    throw new Error(
      `DESK_EVENT_MICROTRADE_USDC (${deskEventMicrotradeUsdc}) must be ≤ DESK_MAX_TRADE_USDC (${deskMaxTradeUsdc})`,
    );
  }

  // Never allow desk private keys even in development — signing is KeeperHub-only.
  if (
    process.env.DESK_PRIVATE_KEY?.trim() ||
    process.env.DESK_WALLET_PRIVATE_KEY?.trim() ||
    process.env.DESK_EOA_PRIVATE_KEY?.trim()
  ) {
    throw new Error(
      "DESK_PRIVATE_KEY / DESK_WALLET_PRIVATE_KEY / DESK_EOA_PRIVATE_KEY must not be set. " +
        "Desk execution uses the KeeperHub org wallet; only DESK_WALLET_ADDRESS (public) is allowed.",
    );
  }

  return {
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    keeperhubWebhookSecret: requireEnv("KEEPERHUB_WEBHOOK_SECRET"),
    geminiApiKey: optionalEnv("GEMINI_API_KEY", "") as string,
    geminiModel: optionalEnv("GEMINI_MODEL", "gemini-2.0-flash") as string,
    geminiBaseUrl: optionalEnv("GEMINI_BASE_URL"),
    openaiApiKey: optionalEnv("OPENAI_API_KEY", "") as string,
    openaiModel: optionalEnv("OPENAI_MODEL", "gpt-4o-mini") as string,
    openaiBaseUrl: optionalEnv("OPENAI_BASE_URL"),
    groqApiKeys: getGroqApiKeys(),
    get groqApiKey() {
      return getNextGroqApiKey();
    },
    groqAffiliateApiKey: optionalEnv("GROQ_AFFILIATE_API_KEY", "") as string,
    groqModel: optionalEnv("GROQ_MODEL", "llama-3.3-70b-versatile") as string,
    groqBaseUrl: optionalEnv("GROQ_BASE_URL"),
    x402FacilitatorUrl: optionalEnv("X402_FACILITATOR_URL"),
    cdpApiKeyId: optionalEnv("CDP_API_KEY_ID"),
    cdpApiKeySecret: optionalEnv("CDP_API_KEY_SECRET"),
    x402ChainId: parsePositiveIntEnv("X402_CHAIN_ID", DEFAULT_X402_CHAIN_ID),
    x402UsdcAddress: parseEvmAddressEnv("X402_USDC_ADDRESS", DEFAULT_X402_USDC_ADDRESS),
    x402RpcUrl:
      optionalEnv("X402_RPC_URL")?.trim() ||
      optionalEnv("BASE_SEPOLIA_RPC_URL")?.trim() ||
      undefined,
    x402UsdcEip712Name: optionalEnv("X402_USDC_EIP712_NAME"),
    x402UsdcEip712Version: optionalEnv("X402_USDC_EIP712_VERSION"),
    deskUsdcAddress: parseEvmAddressEnv("DESK_USDC_ADDRESS", DEFAULT_DESK_USDC_ADDRESS),
    mppSecret: optionalEnv("MPP_SECRET"),
    premiumAccessSecret: optionalEnv("PREMIUM_ACCESS_SECRET"),
    treasuryWalletAddress: optionalEnv("TREASURY_WALLET_ADDRESS"),
    treasuryWalletPrivateKey: optionalEnv("TREASURY_WALLET_PRIVATE_KEY"),
    treasurySafetyBuffer: parseNonNegativeNumberEnv("TREASURY_SAFETY_BUFFER", 0.01),
    creatorRecoveryWallet: optionalEnv("CREATOR_RECOVERY_WALLET"),
    creatorRecoveryShare,
    referralRewardShare,
    referralRewardCap: parseNonNegativeNumberEnv("REFERRAL_REWARD_CAP", 1000),
    maxPayoutShare: parseUnitIntervalEnv("MAX_PAYOUT_SHARE", 0.5),
    routingIntervalMs: parsePositiveIntEnv(
      "ROUTING_INTERVAL_MS",
      DEFAULT_ROUTING_INTERVAL_MS,
    ),
    treasuryCheckScheduleEnabled:
      (optionalEnv("TREASURY_CHECK_SCHEDULE_ENABLED", "true") ?? "true").toLowerCase() !==
      "false",
    treasuryCheckScheduleIntervalMs: parsePositiveIntEnv(
      "TREASURY_CHECK_SCHEDULE_INTERVAL_MS",
      TREASURY_CHECK_SCHEDULE_INTERVAL_MS,
    ),
    treasuryCheckMinIntervalMs: parsePositiveIntEnv(
      "TREASURY_CHECK_MIN_INTERVAL_MS",
      TREASURY_CHECK_MIN_INTERVAL_MS,
    ),
    revenueRoutingScheduleEnabled:
      (optionalEnv("REVENUE_ROUTING_SCHEDULE_ENABLED", "true") ?? "true").toLowerCase() !==
      "false",
    revenueRoutingScheduleIntervalMs: parsePositiveIntEnv(
      "REVENUE_ROUTING_SCHEDULE_INTERVAL_MS",
      REVENUE_ROUTING_SCHEDULE_INTERVAL_MS,
    ),
    sponsoredWatchPriceUsdc: parsePositiveNumberEnv(
      "SPONSORED_WATCH_PRICE_USDC",
      SPONSORED_WATCH_PRICE_USDC,
    ),
    sponsoredWatchDefaultDurationDays: parsePositiveIntEnv(
      "SPONSORED_WATCH_DEFAULT_DURATION_DAYS",
      SPONSORED_WATCH_DEFAULT_DURATION_DAYS,
    ),
    sponsoredWatchMaxDurationDays: parsePositiveIntEnv(
      "SPONSORED_WATCH_MAX_DURATION_DAYS",
      SPONSORED_WATCH_MAX_DURATION_DAYS,
    ),
    sponsoredWatchMinDurationHours: parsePositiveIntEnv(
      "SPONSORED_WATCH_MIN_DURATION_HOURS",
      SPONSORED_WATCH_MIN_DURATION_HOURS,
    ),
    utilityCostPerGenerationUsdc: parseNonNegativeNumberEnv(
      "UTILITY_COST_PER_GENERATION_USDC",
      UTILITY_COST_PER_GENERATION_USDC,
    ),
    utilityCostPerRegistryWriteUsdc: parseNonNegativeNumberEnv(
      "UTILITY_COST_PER_REGISTRY_WRITE_USDC",
      UTILITY_COST_PER_REGISTRY_WRITE_USDC,
    ),
    treasuryUsdcOperatingReserve: parseNonNegativeNumberEnv(
      "TREASURY_USDC_OPERATING_RESERVE",
      0,
    ),
    revenueMinDistributableUsdc: parseNonNegativeNumberEnv(
      "REVENUE_MIN_DISTRIBUTABLE_USDC",
      REVENUE_MIN_DISTRIBUTABLE_USDC,
    ),
    revenueFxMode,
    revenueEthPerCurrencyUnit:
      revenueEthPerCurrencyUnit ??
      (revenueFxMode === "static" || revenueFxMode === "auto" ? 0.000001 : undefined),
    chronicleRegistryAddress: optionalEnv("CHRONICLE_REGISTRY_ADDRESS"),
    rpcUrl: optionalEnv("RPC_URL"),
    mainnetRpcUrl:
      optionalEnv("MAINNET_RPC_URL")?.trim() ||
      optionalEnv("ETH_RPC_URL")?.trim() ||
      undefined,
    baseRpcUrl: optionalEnv("BASE_RPC_URL")?.trim() || undefined,
    paraApiKey: optionalEnv("PARA_API_KEY"),
    paraEnvironment: parseParaEnvironment(optionalEnv("PARA_ENVIRONMENT", "BETA")),
    paraTreasuryUserIdentifier:
      optionalEnv("PARA_TREASURY_USER_IDENTIFIER", "chronicleai-treasury") as string,
    paraTreasuryUserIdentifierType:
      optionalEnv("PARA_TREASURY_USER_IDENTIFIER_TYPE", "CUSTOM_ID") as string,
    paraWalletId: optionalEnv("PARA_WALLET_ID"),
    paraWalletPrivateKey: optionalEnv("PARA_WALLET_PRIVATE_KEY"),
    allowDirectEthersWrites:
      optionalEnv("ALLOW_DIRECT_ETHERS_WRITES", "false")?.toLowerCase() === "true",
    keeperhubApiBaseUrl: optionalEnv("KEEPERHUB_API_BASE_URL"),
    keeperhubApiKey: optionalEnv("KEEPERHUB_API_KEY"),
    keeperhubNetwork: optionalEnv("KEEPERHUB_NETWORK", "sepolia") as string,
    // Default ON: all material writes prefer KeeperHub MCP when KH is configured.
    // Opt out with KEEPERHUB_MCP_ENABLED=false for REST-only workflow execute.
    keeperhubMcpEnabled:
      (optionalEnv("KEEPERHUB_MCP_ENABLED", "true") ?? "true").toLowerCase() !==
      "false",
    keeperhubMcpUrl: optionalEnv("KEEPERHUB_MCP_URL"),
    keeperhubMcpRestFallback:
      (optionalEnv("KEEPERHUB_MCP_REST_FALLBACK", "true") ?? "true").toLowerCase() !==
      "false",
    keeperhubMcpLangchainAgent:
      (optionalEnv("KEEPERHUB_MCP_LANGCHAIN_AGENT", "true") ?? "true").toLowerCase() !==
      "false",
    keeperhubWorkflowPublishAlert: optionalEnv("KEEPERHUB_WORKFLOW_PUBLISH_ALERT"),
    keeperhubWorkflowPublishDigest: optionalEnv("KEEPERHUB_WORKFLOW_PUBLISH_DIGEST"),
    keeperhubWorkflowCreateSponsoredWatch: optionalEnv(
      "KEEPERHUB_WORKFLOW_CREATE_SPONSORED_WATCH",
    ),
    keeperhubWorkflowPublishSponsoredReport: optionalEnv(
      "KEEPERHUB_WORKFLOW_PUBLISH_SPONSORED_REPORT",
    ),
    keeperhubWorkflowPublishPremiumReceipt: optionalEnv(
      "KEEPERHUB_WORKFLOW_PUBLISH_PREMIUM_RECEIPT",
    ),
    keeperhubWorkflowRecordPayout: optionalEnv("KEEPERHUB_WORKFLOW_RECORD_PAYOUT"),
    keeperhubWorkflowPublishTradeTicket: optionalEnv(
      "KEEPERHUB_WORKFLOW_PUBLISH_TRADE_TICKET",
    ),
    keeperhubWorkflowRecordCapitalMove: optionalEnv(
      "KEEPERHUB_WORKFLOW_RECORD_CAPITAL_MOVE",
    ),
    keeperhubWorkflowTransfer: optionalEnv("KEEPERHUB_WORKFLOW_TRANSFER"),
    keeperhubWorkflowDeskSweep: optionalEnv("KEEPERHUB_WORKFLOW_DESK_SWEEP"),
    keeperhubWorkflowDeskDefend: optionalEnv("KEEPERHUB_WORKFLOW_DESK_DEFEND"),
    keeperhubWorkflowDeskRotate: optionalEnv("KEEPERHUB_WORKFLOW_DESK_ROTATE"),
    keeperhubWorkflowDeskOracleArb: optionalEnv("KEEPERHUB_WORKFLOW_DESK_ORACLE_ARB"),
    keeperhubWorkflowDeskKillSwitch: optionalEnv("KEEPERHUB_WORKFLOW_DESK_KILL_SWITCH"),
    keeperhubWorkflowAaveLiquidation: optionalEnv("KEEPERHUB_WORKFLOW_AAVE_LIQUIDATION"),
    keeperhubWorkflowCowTrade: optionalEnv("KEEPERHUB_WORKFLOW_COW_TRADE"),
    keeperhubWorkflowUniswapUsdcWethSwap: optionalEnv(
      "KEEPERHUB_WORKFLOW_UNISWAP_USDC_WETH_SWAP",
    ),
    keeperhubWorkflowUniswapPoolCreated: optionalEnv(
      "KEEPERHUB_WORKFLOW_UNISWAP_POOL_CREATED",
    ),
    keeperhubWorkflowGasVolumeBlock: optionalEnv("KEEPERHUB_WORKFLOW_GAS_VOLUME_BLOCK"),
    deskWalletAddress: deskWalletRaw,
    deskUsePrivateMempool:
      (optionalEnv(
        "DESK_USE_PRIVATE_MEMPOOL",
        DESK_USE_PRIVATE_MEMPOOL ? "true" : "false",
      ) ?? (DESK_USE_PRIVATE_MEMPOOL ? "true" : "false")).toLowerCase() !== "false",
    deskPrivateMempoolStrict:
      (optionalEnv(
        "DESK_PRIVATE_MEMPOOL_STRICT",
        DESK_PRIVATE_MEMPOOL_STRICT ? "true" : "false",
      ) ?? (DESK_PRIVATE_MEMPOOL_STRICT ? "true" : "false")).toLowerCase() !==
      "false",
    deskKhSimulatePreflight:
      (
        optionalEnv(
          "DESK_KH_SIMULATE_PREFLIGHT",
          DESK_KH_SIMULATE_PREFLIGHT ? "true" : "false",
        ) ?? (DESK_KH_SIMULATE_PREFLIGHT ? "true" : "false")
      ).toLowerCase() === "true",
    deskKhSimulateStrict:
      (
        optionalEnv(
          "DESK_KH_SIMULATE_STRICT",
          DESK_KH_SIMULATE_STRICT ? "true" : "false",
        ) ?? (DESK_KH_SIMULATE_STRICT ? "true" : "false")
      ).toLowerCase() === "true",
    deskKhSimulateTimeoutMs: parsePositiveIntEnv(
      "DESK_KH_SIMULATE_TIMEOUT_MS",
      DESK_KH_SIMULATE_TIMEOUT_MS,
    ),
    treasuryPrivateTransferThresholdUsdc: parsePositiveNumberEnv(
      "TREASURY_PRIVATE_TRANSFER_THRESHOLD_USDC",
      TREASURY_PRIVATE_TRANSFER_THRESHOLD_USDC,
    ),
    registryUsePrivateMempool:
      (optionalEnv(
        "REGISTRY_USE_PRIVATE_MEMPOOL",
        REGISTRY_USE_PRIVATE_MEMPOOL ? "true" : "false",
      ) ?? (REGISTRY_USE_PRIVATE_MEMPOOL ? "true" : "false")).toLowerCase() !==
      "false",
    routingProviderLabel:
      optionalEnv("ROUTING_PROVIDER_LABEL", ROUTING_PROVIDER_LABEL)?.trim() ||
      ROUTING_PROVIDER_LABEL,
    deskTargetAumUsdc,
    deskMaxAumUsdc,
    deskMinAumUsdc,
    deskTopupChunkUsdc,
    deskMinFreeUsdc,
    deskInventoryTopupUsdc,
    deskPreferUnwindForFreeUsdc,
    deskProfitSweepUsdc,
    deskTopupCooldownMs,
    deskPostMaintenanceSweepCooldownMs,
    deskHfWarn,
    deskHfCritical,
    deskBasisBps,
    deskApyDeltaBps,
    deskMaxTradeUsdc,
    deskKillHeartbeatMs,
    deskPaused,
    deskFailedRunCooldownMs,
    deskOracleMaxStalenessMs,
    deskApyConsecutivePolls,
    deskApyAbsurdBps,
    deskRebalanceIntervalMs,
    deskMaintenanceNotionalUsdc,
    deskGasElevatedGwei,
    deskEventMicrotradeEnabled,
    deskEventMicrotradeUsdc,
    deskEventMicrotradeCooldownMs,
    deskEventMicrotradeLookbackMs,
    premiumDeskFeedPriceUsdc,
    deskScheduleEnabled:
      (optionalEnv("DESK_SCHEDULE_ENABLED", "true") ?? "true").toLowerCase() !== "false",
    deskScheduleIntervalMs: parsePositiveIntEnv(
      "DESK_SCHEDULE_INTERVAL_MS",
      DESK_SCHEDULE_INTERVAL_MS,
    ),
    deskScheduleExecute:
      (optionalEnv("DESK_SCHEDULE_EXECUTE", "true") ?? "true").toLowerCase() !== "false",
    deskAgentLlmProvider: (() => {
      const raw = optionalEnv("DESK_AGENT_LLM_PROVIDER")?.trim().toLowerCase();
      if (!raw) return undefined;
      if (raw === "gemini" || raw === "openai" || raw === "groq") {
        return raw;
      }
      throw new Error(
        `Invalid DESK_AGENT_LLM_PROVIDER: expected gemini|openai|groq, got ${JSON.stringify(raw)}`,
      );
    })(),
    deskAgentModel: optionalEnv("DESK_AGENT_MODEL")?.trim() || undefined,
    deskAgentTimeoutMs: parsePositiveIntEnv(
      "DESK_AGENT_TIMEOUT_MS",
      DESK_AGENT_TIMEOUT_MS,
    ),
    deskAgentTemperature: (() => {
      const raw = optionalEnv("DESK_AGENT_TEMPERATURE");
      if (raw === undefined || raw === "") return DESK_AGENT_TEMPERATURE;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 2) {
        throw new Error(
          `DESK_AGENT_TEMPERATURE must be a number in [0, 2], got ${JSON.stringify(raw)}`,
        );
      }
      return n;
    })(),
    deskAgentMaxSignals: parsePositiveIntEnv(
      "DESK_AGENT_MAX_SIGNALS",
      DESK_AGENT_MAX_SIGNALS,
    ),
    deskAgentMinConfidence: (() => {
      const raw = optionalEnv("DESK_AGENT_MIN_CONFIDENCE");
      if (raw === undefined || raw === "") return DESK_AGENT_MIN_CONFIDENCE;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        throw new Error(
          `DESK_AGENT_MIN_CONFIDENCE must be a number in [0, 1], got ${JSON.stringify(raw)}`,
        );
      }
      return n;
    })(),
    deskAgentForceDefendOnCriticalHf:
      (
        optionalEnv(
          "DESK_AGENT_FORCE_DEFEND_ON_CRITICAL_HF",
          DESK_AGENT_FORCE_DEFEND_ON_CRITICAL_HF ? "true" : "false",
        ) ?? (DESK_AGENT_FORCE_DEFEND_ON_CRITICAL_HF ? "true" : "false")
      ).toLowerCase() !== "false",
    smtpHost: optionalEnv("SMTP_HOST"),
    smtpPort: optionalEnv("SMTP_PORT") ? Number(optionalEnv("SMTP_PORT")) : undefined,
    smtpUser: optionalEnv("SMTP_USER"),
    smtpPass: optionalEnv("SMTP_PASS"),
    smtpFromAddress: optionalEnv("SMTP_FROM_ADDRESS"),
    newsletterMonthlyPriceUsdc: parsePositiveNumberEnv(
      "NEWSLETTER_MONTHLY_PRICE_USDC",
      2,
    ),
    newsletterBillingPeriodDays: parsePositiveIntEnv(
      "NEWSLETTER_BILLING_PERIOD_DAYS",
      30,
    ),
    newsletterGracePeriodDays: parseNonNegativeIntEnv(
      "NEWSLETTER_GRACE_PERIOD_DAYS",
      3,
    ),
    telegramIngestBotToken,
    telegramSendBotToken,
    telegramBotToken: telegramIngestBotToken,
    telegramChatId: optionalEnv("TELEGRAM_CHAT_ID"),
    telegramWebhookSecret: optionalEnv("TELEGRAM_WEBHOOK_SECRET"),
    telegramIngestChatId: optionalEnv("TELEGRAM_INGEST_CHAT_ID"),
    publicApiBaseUrl: optionalEnv("PUBLIC_API_BASE_URL"),
    digestScheduleEnabled:
      (optionalEnv("DIGEST_SCHEDULE_ENABLED", "true") ?? "true").toLowerCase() !==
      "false",
    digestScheduleIntervalMs: parsePositiveIntEnv(
      "DIGEST_SCHEDULE_INTERVAL_MS",
      DIGEST_SCHEDULE_CHECK_INTERVAL_MS,
    ),
    cctpRebalanceEnabled:
      (optionalEnv("CCTP_REBALANCE_ENABLED", "false") ?? "false").toLowerCase() ===
      "true",
    cctpIrisBaseUrl: (
      optionalEnv("CCTP_IRIS_BASE_URL", "https://iris-api-sandbox.circle.com") ??
      "https://iris-api-sandbox.circle.com"
    ).replace(/\/+$/, ""),
    cctpUseForwarding:
      (optionalEnv("CCTP_USE_FORWARDING", "true") ?? "true").toLowerCase() !==
      "false",
    cctpTokenMessenger: parseEvmAddressEnv(
      "CCTP_TOKEN_MESSENGER",
      "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    ),
    cctpMessageTransmitter: parseEvmAddressEnv(
      "CCTP_MESSAGE_TRANSMITTER",
      "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    ),
    cctpSourceDomain: parseNonNegativeIntEnv("CCTP_SOURCE_DOMAIN", 6),
    cctpDestDomain: parseNonNegativeIntEnv("CCTP_DEST_DOMAIN", 0),
    cctpMinFinalityThreshold: parsePositiveIntEnv(
      "CCTP_MIN_FINALITY_THRESHOLD",
      CCTP_MIN_FINALITY_THRESHOLD,
    ),
    cctpBaseSafetyBufferUsdc: parseNonNegativeNumberEnv(
      "CCTP_BASE_SAFETY_BUFFER_USDC",
      CCTP_BASE_SAFETY_BUFFER_USDC,
    ),
    cctpRebalanceThresholdUsdc: parsePositiveNumberEnv(
      "CCTP_REBALANCE_THRESHOLD_USDC",
      CCTP_REBALANCE_THRESHOLD_USDC,
    ),
    cctpRebalanceChunkUsdc: parsePositiveNumberEnv(
      "CCTP_REBALANCE_CHUNK_USDC",
      CCTP_REBALANCE_CHUNK_USDC,
    ),
    cctpRebalanceMaxChunkUsdc: parsePositiveNumberEnv(
      "CCTP_REBALANCE_MAX_CHUNK_USDC",
      CCTP_REBALANCE_MAX_CHUNK_USDC,
    ),
    cctpMaxInFlight: parsePositiveIntEnv("CCTP_MAX_IN_FLIGHT", CCTP_MAX_IN_FLIGHT),
    cctpCooldownMs: parsePositiveIntEnv("CCTP_COOLDOWN_MS", CCTP_COOLDOWN_MS),
    cctpMaxFeeUsdc: parseNonNegativeNumberEnv("CCTP_MAX_FEE_USDC", CCTP_MAX_FEE_USDC),
    cctpPollIntervalMs: parsePositiveIntEnv(
      "CCTP_POLL_INTERVAL_MS",
      CCTP_POLL_INTERVAL_MS,
    ),
    cctpPollTimeoutMs: parsePositiveIntEnv(
      "CCTP_POLL_TIMEOUT_MS",
      CCTP_POLL_TIMEOUT_MS,
    ),
    treasurySepoliaMinGasEth: parseNonNegativeNumberEnv(
      "TREASURY_SEPOLIA_MIN_GAS_ETH",
      TREASURY_SEPOLIA_MIN_GAS_ETH,
    ),
    treasuryBaseMinGasEth: parseNonNegativeNumberEnv(
      "TREASURY_BASE_MIN_GAS_ETH",
      TREASURY_BASE_MIN_GAS_ETH,
    ),
    cctpMintMaxAttempts: parsePositiveIntEnv(
      "CCTP_MINT_MAX_ATTEMPTS",
      CCTP_MINT_MAX_ATTEMPTS,
    ),
    cctpForwardingFallbackMs: parsePositiveIntEnv(
      "CCTP_FORWARDING_FALLBACK_MS",
      CCTP_FORWARDING_FALLBACK_MS,
    ),
    cctpRebalanceScheduleIntervalMs: parsePositiveIntEnv(
      "CCTP_REBALANCE_SCHEDULE_INTERVAL_MS",
      CCTP_REBALANCE_SCHEDULE_INTERVAL_MS,
    ),
    cctpForceOnDeskStarvation:
      (optionalEnv("CCTP_FORCE_ON_DESK_STARVATION", "false") ?? "false").toLowerCase() ===
      "true",
    cctpOperatorPrivateKey: optionalEnv("CCTP_OPERATOR_PRIVATE_KEY")?.trim() || undefined,
    frontendOrigin: requireEnv("FRONTEND_ORIGIN"),
    port: Number(optionalEnv("PORT", "4000")),
    nodeEnv,
  };
}
