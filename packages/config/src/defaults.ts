// Shared configuration defaults

// ── Event Threshold Defaults ─────────────────────────────
export const EVENT_THRESHOLDS = {
  large_swap: { minMagnitude: 1_000_000, unit: "USD" },
  liquidation: { minMagnitude: 500_000, unit: "USD" },
  gas_spike: { minMagnitude: 500, unit: "gwei" },
  volume_anomaly: { minMagnitude: 2.0, unit: "z_score" },
  contract_deployment: { minMagnitude: 0, unit: "any" },
} as const;

// ── Deduplication ───────────────────────────────────────
export const DEDUPE_WINDOW_MS = 86_400_000; // 24 hours in milliseconds

// ── Payment Defaults ────────────────────────────────────
export const PAYMENT_CHALLENGE_EXPIRY_MS = 600_000; // 10 minutes in milliseconds

// ── Dashboard Row Limits ───────────────────────────────
export const DASHBOARD_ROW_LIMITS = {
  alerts: 50,
  digests: 10,
  payments: 25,
  executionLogs: 100,
} as const;

// ── LLM Provider Fallback Order ─────────────────────────
export const LLM_FALLBACK_ORDER = ["gemini", "openai", "groq"] as const;

// ── Alert Generation Defaults ───────────────────────────
export const ALERT_GENERATION_TIMEOUT_MS = 30_000; // 30 seconds per provider

// ── Digest Reporting Window Defaults ────────────────────
export const DIGEST_REPORTING_WINDOW_HOURS = 24;
