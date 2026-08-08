// Shared configuration defaults

// ── Event Threshold Defaults ─────────────────────────────
// Tuned to cut newspaper noise: only material market moves qualify for alerts.
// large_swap $500k / liquidation >$0.01; gas ≥50 gwei; volume ≥3σ.
// contract_deployment is off by default (every create would spam alerts).
// New capital-flow types: CEX/protocol $500k; stablecoin mint/burn $1M; cluster dual gate.
export const EVENT_THRESHOLDS = {
  large_swap: { minMagnitude: 500_000, unit: "USD" },
  /** Any non-dust liquidation USD qualifies (filters zero / near-zero only). */
  liquidation: { minMagnitude: 0.01, unit: "USD" },
  /**
   * Synthetic liquidation cluster: notional floor (USD).
   * Count floor is LIQUIDATION_CLUSTER.minCount (dual gate in qualification).
   */
  liquidation_cluster: { minMagnitude: 50_000, unit: "USD" },
  /** Elevated mainnet base fee — normal 1–30 gwei blocks no longer alert. */
  gas_spike: { minMagnitude: 50, unit: "gwei" },
  volume_anomaly: { minMagnitude: 3.0, unit: "z_score" },
  /** Disabled: qualification service rejects unless explicitly re-enabled. */
  contract_deployment: { minMagnitude: Number.MAX_SAFE_INTEGER, unit: "any" },
  cex_inflow: { minMagnitude: 500_000, unit: "USD" },
  cex_outflow: { minMagnitude: 500_000, unit: "USD" },
  protocol_deposit: { minMagnitude: 500_000, unit: "USD" },
  protocol_withdraw: { minMagnitude: 500_000, unit: "USD" },
  /** Higher than swaps — mints are noisy at large scale. */
  stablecoin_mint: { minMagnitude: 1_000_000, unit: "USD" },
  stablecoin_burn: { minMagnitude: 1_000_000, unit: "USD" },
} as const;

// ── Liquidation cluster synthesizer ─────────────────────
export const LIQUIDATION_CLUSTER = {
  /** Rolling window for counting liquidations on the same chain/protocol. */
  windowMinutes: 30,
  /** Minimum liquidations in the window (paired with notional floor). */
  minCount: 3,
  /** Minimum aggregate notional USD (mirrors EVENT_THRESHOLDS.liquidation_cluster). */
  minNotionalUsd: 50_000,
} as const;

// ── Private routing policy (KEEP-137 / Flashbots Protect · Sepolia) ─
/** Prefer private mempool for desk strategy/capital KH executions. */
export const DESK_USE_PRIVATE_MEMPOOL = true;
/** Expect workflow strict mode (private RPC failure does not fall back). */
export const DESK_PRIVATE_MEMPOOL_STRICT = true;
/**
 * Layer A: KeeperHub Direct Execution dry-run before workflow broadcast.
 * Default true for hackathon demo (audit trail: sim → submit → outcome).
 * Soft fail-open unless DESK_KH_SIMULATE_STRICT=true.
 * Env: DESK_KH_SIMULATE_PREFLIGHT (set false to disable).
 */
export const DESK_KH_SIMULATE_PREFLIGHT = true;
/**
 * When true with Layer A enabled, block risk-increasing execute on wouldRevert / transport error.
 * Env: DESK_KH_SIMULATE_STRICT
 */
export const DESK_KH_SIMULATE_STRICT = false;
/** Abort KH dry-run wait after this many ms. Env: DESK_KH_SIMULATE_TIMEOUT_MS */
export const DESK_KH_SIMULATE_TIMEOUT_MS = 15_000;
/** Legacy compatibility default; treasury transfers use the public KH path. */
export const TREASURY_PRIVATE_TRANSFER_THRESHOLD_USDC = 50;
/** Registry publish/record: false = public/sponsorship-friendly labeling. */
export const REGISTRY_USE_PRIVATE_MEMPOOL = false;
/** Provider label for Activity / execution_logs (not a network endpoint). */
export const ROUTING_PROVIDER_LABEL = "flashbots_protect";

// ── Public alert publication rate-limit by flow cluster ─
/** Suppress duplicate public alerts for the same (type, clusterKey) within this window. */
export const ALERT_CLUSTER_DEDUPE_WINDOW_MS = 60 * 60_000; // 60 minutes

// ── On-chain monitoring defaults (Block Dispatcher path) ─
export const BLOCK_MONITORING = {
  /** Rolling window length for per-chain transaction-count z-scores. */
  volumeWindowSize: 100,
  /** Minimum samples before volume anomaly z-score is computed. */
  volumeMinSamples: 5,
  /** How many recent receipts to scan for contract creations per block (0 = skip). */
  deploymentScanLimit: 25,
} as const;

// ── Deduplication ───────────────────────────────────────
export const DEDUPE_WINDOW_MS = 86_400_000; // 24 hours in milliseconds

// Aave protocol-flow correlation
/** Lookaround used to find same-block Aave flow counterparts in the event store. */
export const AAVE_FLOW_CORRELATION_LOOKAROUND_MS = 5 * 60_000;
/** Fallback time window when block numbers are unavailable. */
export const AAVE_FLOW_CORRELATION_TIME_WINDOW_MS = 2 * 60_000;
/** Maximum qualified events inspected for a single correlation check. */
export const AAVE_FLOW_CORRELATION_MAX_CANDIDATES = 500;
/** Relative USD tolerance used only when raw token amounts are unavailable. */
export const AAVE_FLOW_CORRELATION_MAGNITUDE_TOLERANCE = 0.005;

// ── Payment Defaults ────────────────────────────────────
export const PAYMENT_CHALLENGE_EXPIRY_MS = 600_000; // 10 minutes in milliseconds

// ── Chronicle Pass (monthly subscription) ────────────────
/** Default Chronicle Pass monthly price in USDC (4.99). */
export const CHRONICLE_PASS_PRICE_USDC_DEFAULT = 4.99;

// ── Dashboard Row Limits ───────────────────────────────
export const DASHBOARD_ROW_LIMITS = {
  alerts: 50,
  digests: 10,
  payments: 25,
  executionLogs: 100,
} as const;

// ── LLM Provider Fallback Order ─────────────────────────
/** Newspaper + desk agent: Groq → OpenAI (Gemini removed for now). */
export const LLM_FALLBACK_ORDER = ["groq", "openai"] as const;

/** Desk agent uses the same fallback order as the newspaper path. */
export const DESK_AGENT_LLM_FALLBACK_ORDER = LLM_FALLBACK_ORDER;

// ── Alert Generation Defaults ───────────────────────────
export const ALERT_GENERATION_TIMEOUT_MS = 30_000; // 30 seconds per provider

/**
 * Alert generation should sample the rotated Groq pool, then fall back to
 * OpenAI. Trying every configured key serially can delay publication for
 * minutes when the pool is rate-limited.
 */
export const PUBLIC_ALERT_MAX_GROQ_KEY_ATTEMPTS = 2;

// ── Digest Generation Defaults ──────────────────────────
/** Longer timeout: digests synthesize many events into a full report. */
export const DIGEST_GENERATION_TIMEOUT_MS = 60_000; // 60 seconds per provider

// ── Premium deep-dive generation ────────────────────────
/** Timeout per provider for paid deep-dive / historical narrative synthesis. */
export const PREMIUM_GENERATION_TIMEOUT_MS = 60_000;

// ── Digest Reporting Window Defaults ────────────────────
export const DIGEST_REPORTING_WINDOW_HOURS = 24;

/**
 * How often the in-process digest scheduler wakes up to check whether the
 * previous completed UTC reporting window still needs a digest.
 * Default: every 15 minutes (cheap; generation itself is idempotent).
 */
export const DIGEST_SCHEDULE_CHECK_INTERVAL_MS = 15 * 60_000;

/**
 * Minutes after UTC midnight before the scheduler will generate yesterday's
 * digest (lets late events settle). Default: 15 minutes.
 */
export const DIGEST_SCHEDULE_GRACE_MINUTES = 15;

// ── Loop 3 / Loop 5 autonomous maintenance schedules ────
/** How often the treasury-check scheduler wakes (default 1 hour). */
export const TREASURY_CHECK_SCHEDULE_INTERVAL_MS = 60 * 60_000;
/** Minimum gap between successful treasury snapshots (default 7 days / weekly). */
export const TREASURY_CHECK_MIN_INTERVAL_MS = 7 * 24 * 60 * 60_000;
/** How often the revenue-routing scheduler wakes (default 1 hour). */
export const REVENUE_ROUTING_SCHEDULE_INTERVAL_MS = 60 * 60_000;
/**
 * How often the Chronicle Desk in-process scheduler wakes (default 15 min).
 * Each wake: capital manager (top-up/sweep) then strategy tick with execute=true.
 * Aligns under free-tier poll cadence (~30m) without thrashing KH runs.
 */
export const DESK_SCHEDULE_INTERVAL_MS = 15 * 60_000;

// ── Loop 3 utility cost estimates (USDC-equivalent units) ─
/** Estimated LLM / generation cost per generate_alert or generate_digest log. */
export const UTILITY_COST_PER_GENERATION_USDC = 0.02;
/** Estimated gas / registry write cost per successful registry_write log. */
export const UTILITY_COST_PER_REGISTRY_WRITE_USDC = 0.05;

// ── Loop 4 sponsored watch product defaults ─────────────
/** Default USDC price for a custom sponsored monitoring campaign. */
export const SPONSORED_WATCH_PRICE_USDC = 1;
/** Default campaign length when buyer does not specify endsAt. */
export const SPONSORED_WATCH_DEFAULT_DURATION_DAYS = 7;
/** Max campaign duration (days) a buyer may request. */
export const SPONSORED_WATCH_MAX_DURATION_DAYS = 90;
/**
 * Minimum campaign length in hours (hackathon short demo = 1h).
 * Buyers may request durationHours ≥ this value.
 */
export const SPONSORED_WATCH_MIN_DURATION_HOURS = 1;

// ── Loop 5 micro-payout demo defaults ───────────────────
/**
 * Minimum distributable USDC for a routing run to create payouts.
 * Demo-friendly floor allows sub-dollar micro-payouts (e.g. 0.40).
 */
export const REVENUE_MIN_DISTRIBUTABLE_USDC = 0.01;

// ── Premium productizer (auto deep dives / feeds) ────────
/** Rolling window used to detect related-event clusters after an alert. */
export const PREMIUM_CLUSTER_WINDOW_HOURS = 6;
/** Minimum related events in the window to mint a cluster deep dive. */
export const PREMIUM_MIN_CLUSTER_EVENTS = 3;
/** Minimum liquidation events for a cascade deep dive. */
export const PREMIUM_CASCADE_MIN_LIQUIDATIONS = 3;
/** Minimum total liquidation USD for a cascade deep dive. */
export const PREMIUM_CASCADE_MIN_TOTAL_USD = 100_000;
/** Minimum digest-window events to mint a period deep dive. */
export const PREMIUM_DIGEST_MIN_EVENTS_FOR_DEEP_DIVE = 2;
/** Lookback window for protocol historical feeds. */
export const PREMIUM_HISTORICAL_LOOKBACK_DAYS = 7;
/** Minimum events for a protocol historical feed SKU. */
export const PREMIUM_HISTORICAL_MIN_EVENTS = 5;
/** Base USDC price for auto-minted deep dives (scales slightly with event count). */
export const PREMIUM_DEEP_DIVE_BASE_PRICE_USDC = 3;
/** USDC price for machine-readable structured feeds. */
export const PREMIUM_STRUCTURED_FEED_PRICE_USDC = 0.5;
/** USDC price for multi-day historical protocol feeds. */
export const PREMIUM_HISTORICAL_FEED_PRICE_USDC = 5;

// ── Chronicle Desk policy defaults (testnet; env-overridable) ─
// Sized for the funded Sepolia demo book (~$1k Aave inventory), not a $50 toy desk.
// Sweeps still reserve DESK_MIN_FREE_USDC dry powder (see evaluateSweepEligibility).
/** Steady-state desk book size (USDC). */
export const DESK_TARGET_AUM_USDC = 1000;
/** Hard ceiling on desk equity (USDC). Headroom above a ~$1–1.1k live book. */
export const DESK_MAX_AUM_USDC = 2000;
/** Below this equity, top-up is urgent (USDC). */
export const DESK_MIN_AUM_USDC = 200;
/** Discrete treasury → desk top-up chunk (USDC). */
export const DESK_TOPUP_CHUNK_USDC = 10;
/** Floor of liquid free USDC on desk for opening risk-increasing trades. */
export const DESK_MIN_FREE_USDC = 10;
/** Chunk of free USDC to restore when below min free inventory. */
export const DESK_INVENTORY_TOPUP_USDC = 10;
/**
 * When free USDC is below the floor, prefer partial on-desk unwind
 * (Aave withdraw + swap / free LINK swap) over treasury minting.
 */
export const DESK_PREFER_UNWIND_FOR_FREE_USDC = true;
/** Free-USDC profit threshold before sweep (USDC). */
export const DESK_PROFIT_SWEEP_USDC = 15;
/** Anti-thrash cooldown between top-ups (ms). */
export const DESK_TOPUP_COOLDOWN_MS = 3_600_000; // 1h
/**
 * After a free-powder maintenance fill, skip max-AUM sweeps for this long
 * unless free USDC is well above minFree + profit threshold.
 * Prevents capital tick from immediately undoing dry powder.
 */
export const DESK_POST_MAINTENANCE_SWEEP_COOLDOWN_MS = 20 * 60_000; // 20m
/** Soft defend / alert health-factor threshold. */
export const DESK_HF_WARN = 1.5;
/** Hard defend (repay / delever) health-factor threshold. */
export const DESK_HF_CRITICAL = 1.2;
/** Oracle vs AMM basis entry band (bps). */
export const DESK_BASIS_BPS = 50;
/** Min yield edge to rotate (bps). */
export const DESK_APY_DELTA_BPS = 50;
/** Per-intent notional cap (USDC). */
export const DESK_MAX_TRADE_USDC = 15;
/** Stale desk process → kill-switch eligibility (ms). */
export const DESK_KILL_HEARTBEAT_MS = 6 * 60 * 60_000; // 6h
/** Cooldown after a failed strategy run before re-proposing (ms). */
export const DESK_FAILED_RUN_COOLDOWN_MS = 15 * 60_000; // 15m
/** Max age for Chainlink oracle updatedAt before refusing opens (ms). */
export const DESK_ORACLE_MAX_STALENESS_MS = 60 * 60_000; // 1h
/** Consecutive APY polls required before rotation may open. */
export const DESK_APY_CONSECUTIVE_POLLS = 2;
/**
 * APY edge above this (bps) is treated as testnet/data-quality unreliable.
 * Maintenance rebalance may still free inventory; never treat as a yield thesis.
 */
export const DESK_APY_ABSURD_BPS = 5_000;
/**
 * When enabled, Sepolia APY/oracle values above the absurd-data ceilings may
 * still qualify as executable edges. Hard policy gates remain in force.
 */
export const DESK_TRUST_TESTNET_SIGNALS = true;
/** Min interval between maintenance rebalance fills (ms). Default 6h. */
export const DESK_REBALANCE_INTERVAL_MS = 6 * 60 * 60_000;
/**
 * Notional cap for maintenance free-powder / rebalance legs (USDC).
 * Effective size is min(this, maxTradeUsdc, freeable inventory).
 */
export const DESK_MAINTENANCE_NOTIONAL_USDC = 10;
/** Gas gwei above this is treated as elevated (defer non-defend). */
export const DESK_GAS_ELEVATED_GWEI = 50;
/** Premium machine-readable desk feed price (USDC). */
export const PREMIUM_DESK_FEED_PRICE_USDC = 0.5;
/**
 * Event-linked microtrade (newspaper → desk). On by default for demo churn;
 * set DESK_EVENT_MICROTRADE_ENABLED=false to disable.
 */
export const DESK_EVENT_MICROTRADE_ENABLED = true;
/** Per-event microtrade notional cap (USDC); also clamped by maxTradeUsdc. */
export const DESK_EVENT_MICROTRADE_USDC = 5;
/** Min ms between event-linked microtrade attempts (default 1h). */
export const DESK_EVENT_MICROTRADE_COOLDOWN_MS = 3_600_000;
/**
 * How far back (ms) to look for qualified newspaper events / gas spikes
 * that can authorize a microtrade. Defaults to the cooldown window.
 */
export const DESK_EVENT_MICROTRADE_LOOKBACK_MS = 3_600_000;

// ── Chronicle Desk LLM agent defaults ───────────────────
// LLM is the only strategy decision path (no DESK_AGENT_ENABLED off-switch).
/** Hard timeout for a single agent LLM completion (ms). */
export const DESK_AGENT_TIMEOUT_MS = 600_000;
/** Decision temperature (low for structured JSON). */
export const DESK_AGENT_TEMPERATURE = 0.2;
/** Slightly higher temperature for post-trade narrative only. */
export const DESK_AGENT_NARRATIVE_TEMPERATURE = 0.4;
/** Max recent signals in agent context. */
export const DESK_AGENT_MAX_SIGNALS = 15;
/** Below this confidence, treat propose as hold (unless force-defend). */
export const DESK_AGENT_MIN_CONFIDENCE = 0.35;
/** When HF < critical, ignore agent hold/defer for risk_defend. */
export const DESK_AGENT_FORCE_DEFEND_ON_CRITICAL_HF = true;
/** Max thesis length stored/accepted from the model. */
export const DESK_AGENT_THESIS_MAX_CHARS = 800;

// ── CCTP rebalance policy defaults (testnet Base → Sepolia) ─
/** Never burn Base USDC below this residual (human USDC). */
export const CCTP_BASE_SAFETY_BUFFER_USDC = 5;
/** Min Base surplus above buffer before rebalance eligible (human USDC). */
export const CCTP_REBALANCE_THRESHOLD_USDC = 10;
/** Target burn amount per job (human USDC). */
export const CCTP_REBALANCE_CHUNK_USDC = 10;
/** Hard cap per rebalance (human USDC). */
export const CCTP_REBALANCE_MAX_CHUNK_USDC = 50;
/** Concurrent unfinished CCTP transfers. */
export const CCTP_MAX_IN_FLIGHT = 1;
/** Min time between successful burns (ms). */
export const CCTP_COOLDOWN_MS = 900_000; // 15m
/** Max fee budget (human USDC). */
export const CCTP_MAX_FEE_USDC = 0.05;
/** Iris poll interval (ms). */
export const CCTP_POLL_INTERVAL_MS = 5_000;
/** Mark stuck if attestation never completes (ms). */
export const CCTP_POLL_TIMEOUT_MS = 1_800_000; // 30m
/** Block Mode A mint if Sepolia gas too low (ETH). */
export const TREASURY_SEPOLIA_MIN_GAS_ETH = 0.01;
/** Block burn if Base gas too low (ETH). */
export const TREASURY_BASE_MIN_GAS_ETH = 0.005;
/** Fast Transfer minFinalityThreshold. */
export const CCTP_MIN_FINALITY_THRESHOLD = 1_000;
/** Max mint retries before failed. */
export const CCTP_MINT_MAX_ATTEMPTS = 3;
/** How often the CCTP rebalance worker wakes (ms). Phase 4 wires this. */
export const CCTP_REBALANCE_SCHEDULE_INTERVAL_MS = 3 * 60_000; // 3m
/**
 * Legacy: previously waited this long for Circle forwardTxHash before Mode A.
 * Mint now starts as soon as Iris is complete; env kept for config compatibility.
 */
export const CCTP_FORWARDING_FALLBACK_MS = 10 * 60_000; // 10m
