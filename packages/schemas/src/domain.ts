// Domain enums and branded ID types for ChronicleAI

// ── Event Types ──────────────────────────────────────────
export type EventType =
  | "large_swap"
  | "liquidation"
  | "gas_spike"
  | "volume_anomaly"
  | "contract_deployment";

export const EVENT_TYPES: readonly EventType[] = [
  "large_swap",
  "liquidation",
  "gas_spike",
  "volume_anomaly",
  "contract_deployment",
] as const;

// ── Alert Delivery States ───────────────────────────────
export type AlertDeliveryStatus = "draft" | "queued" | "published" | "partial_failure" | "failed";

export const ALERT_DELIVERY_STATUSES: readonly AlertDeliveryStatus[] = [
  "draft",
  "queued",
  "published",
  "partial_failure",
  "failed",
] as const;

// ── Digest Publication States ───────────────────────────
export type DigestPublicationStatus =
  | "draft"
  | "queued"
  | "published"
  | "partial_failure"
  | "failed";

export const DIGEST_PUBLICATION_STATUSES: readonly DigestPublicationStatus[] = [
  "draft",
  "queued",
  "published",
  "partial_failure",
  "failed",
] as const;

// ── Payment Routes / Statuses ───────────────────────────
export type PaymentRoute = "x402" | "mpp";

export const PAYMENT_ROUTES: readonly PaymentRoute[] = ["x402", "mpp"] as const;

export type PaymentStatus =
  | "challenge_issued"
  | "pending"
  | "settled"
  | "underpaid"
  | "expired"
  | "failed";

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "challenge_issued",
  "pending",
  "settled",
  "underpaid",
  "expired",
  "failed",
] as const;

// ── Treasury States ─────────────────────────────────────
export type TreasuryStatus = "healthy" | "warning" | "critical";

export const TREASURY_STATUSES: readonly TreasuryStatus[] = [
  "healthy",
  "warning",
  "critical",
] as const;

// ── Execution Log ───────────────────────────────────────
export type ExecutionLogActionType =
  | "monitor"
  | "generate_alert"
  | "publish_alert"
  | "generate_digest"
  | "publish_digest"
  | "payment"
  | "treasury_check"
  | "operator_notification"
  | "registry_write"
  | "payout";

export const EXECUTION_LOG_ACTION_TYPES: readonly ExecutionLogActionType[] = [
  "monitor",
  "generate_alert",
  "publish_alert",
  "generate_digest",
  "publish_digest",
  "payment",
  "treasury_check",
  "operator_notification",
  "registry_write",
  "payout",
] as const;

export type ExecutionLogStatus = "started" | "succeeded" | "retrying" | "failed";

export const EXECUTION_LOG_STATUSES: readonly ExecutionLogStatus[] = [
  "started",
  "succeeded",
  "retrying",
  "failed",
] as const;

// ── Premium Item ────────────────────────────────────────
export type PremiumContentType =
  | "deep_dive"
  | "historical_feed"
  | "structured_feed"
  | "sponsored_monitor";

export const PREMIUM_CONTENT_TYPES: readonly PremiumContentType[] = [
  "deep_dive",
  "historical_feed",
  "structured_feed",
  "sponsored_monitor",
] as const;

export type PremiumItemStatus = "draft" | "available" | "archived";

export const PREMIUM_ITEM_STATUSES: readonly PremiumItemStatus[] = [
  "draft",
  "available",
  "archived",
] as const;

// ── Monitored Event Statuses ────────────────────────────
export type MonitoredEventStatus = "received" | "qualified" | "ignored" | "failed";

export const MONITORED_EVENT_STATUSES: readonly MonitoredEventStatus[] = [
  "received",
  "qualified",
  "ignored",
  "failed",
] as const;

// ── Confidence Levels ───────────────────────────────────
export type Confidence = "high" | "medium" | "low";

export const CONFIDENCE_LEVELS: readonly Confidence[] = ["high", "medium", "low"] as const;

// ── Audience ────────────────────────────────────────────
export type Audience = "public" | "premium" | "operator";

export const AUDIENCES: readonly Audience[] = ["public", "premium", "operator"] as const;

// ── LLM Providers ───────────────────────────────────────
export type LLMProvider = "gemini" | "openai" | "groq";

export const LLM_PROVIDERS: readonly LLMProvider[] = ["gemini", "openai", "groq"] as const;

export type LLMGenerationAttemptStatus = "succeeded" | "failed" | "invalid_response";

export const LLM_GENERATION_ATTEMPT_STATUSES: readonly LLMGenerationAttemptStatus[] = [
  "succeeded",
  "failed",
  "invalid_response",
] as const;

// ── Entity Types for LLM Generation ────────────────────
export type LLMEntityType = "public_alert" | "daily_digest";

export const LLM_ENTITY_TYPES: readonly LLMEntityType[] = ["public_alert", "daily_digest"] as const;

// ── Branded ID Types ────────────────────────────────────
declare const brand: unique symbol;

export type Branded<T, B extends string> = T & { readonly [brand]: B };

export type MonitoredEventId = Branded<string, "MonitoredEvent">;
export type AlertId = Branded<string, "Alert">;
export type DigestId = Branded<string, "Digest">;
export type PremiumItemId = Branded<string, "PremiumItem">;
export type PaymentId = Branded<string, "Payment">;
export type TreasurySnapshotId = Branded<string, "TreasurySnapshot">;
export type ExecutionLogId = Branded<string, "ExecutionLog">;
