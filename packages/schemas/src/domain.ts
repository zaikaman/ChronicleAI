// Domain enums and branded ID types for ChronicleAI

// ── Event Types ──────────────────────────────────────────
export type EventType =
  | "large_swap"
  | "liquidation"
  | "liquidation_cluster" // synthetic, Chronicle-generated
  | "gas_spike"
  | "volume_anomaly"
  | "contract_deployment"
  | "cex_inflow"
  | "cex_outflow"
  | "protocol_deposit"
  | "protocol_withdraw"
  | "stablecoin_mint"
  | "stablecoin_burn";

export const EVENT_TYPES: readonly EventType[] = [
  "large_swap",
  "liquidation",
  "liquidation_cluster",
  "gas_spike",
  "volume_anomaly",
  "contract_deployment",
  "cex_inflow",
  "cex_outflow",
  "protocol_deposit",
  "protocol_withdraw",
  "stablecoin_mint",
  "stablecoin_burn",
] as const;

// ── Flow enrichment (capital-direction context) ─────────
export type EntityRole = "exchange" | "protocol" | "treasury" | "router" | "unknown";

export const ENTITY_ROLES: readonly EntityRole[] = [
  "exchange",
  "protocol",
  "treasury",
  "router",
  "unknown",
] as const;

export type FlowDirection =
  | "risk_on"
  | "de_risk"
  | "rebalance"
  | "supply_expand"
  | "supply_contract"
  | "unknown";

export const FLOW_DIRECTIONS: readonly FlowDirection[] = [
  "risk_on",
  "de_risk",
  "rebalance",
  "supply_expand",
  "supply_contract",
  "unknown",
] as const;

/**
 * Deterministic capital-flow context attached after normalization.
 * Stored in monitored_events.raw_payload.flowContext (no DB migration required).
 */
export interface FlowContext {
  fromRole: EntityRole;
  toRole: EntityRole;
  fromLabel?: string;
  toLabel?: string;
  direction: FlowDirection;
  venue?: string;
  clusterKey?: string;
  counterpartyAddress?: string;
  subjectAddress?: string;
}

// ── Daily digest sectioned copy ─────────────────────────
export interface DigestSections {
  capitalDirection: string;
  exchangeAndProtocolFlows: string;
  stressBoard: string;
  storyOfTheDay: string;
  coverageNote: string;
}

// ── Alert Delivery States ───────────────────────────────
export type AlertDeliveryStatus = "draft" | "queued" | "published" | "partial_failure" | "failed";

export const ALERT_DELIVERY_STATUSES: readonly AlertDeliveryStatus[] = [
  "draft",
  "queued",
  "published",
  "partial_failure",
  "failed",
] as const;

/** Public alert classification used to separate newsroom events from desk triggers. */
export type AlertKind = "market_event" | "desk_trigger";

export const ALERT_KINDS: readonly AlertKind[] = ["market_event", "desk_trigger"] as const;

/** State of the deterministic Alert -> Desk Signal projection. */
export type AlertSignalStatus = "not_eligible" | "pending" | "created" | "failed";

export const ALERT_SIGNAL_STATUSES: readonly AlertSignalStatus[] = [
  "not_eligible",
  "pending",
  "created",
  "failed",
] as const;

/** State of the causal desk action linked to an Alert. */
export type AlertActionStatus =
  | "not_created"
  | "pending"
  | "submitted"
  | "filled"
  | "failed"
  | "deferred"
  | "ignored";

export const ALERT_ACTION_STATUSES: readonly AlertActionStatus[] = [
  "not_created",
  "pending",
  "submitted",
  "filled",
  "failed",
  "deferred",
  "ignored",
] as const;

export type DigestKind = "market" | "desk";

export const DIGEST_KINDS: readonly DigestKind[] = ["market", "desk"] as const;

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
  | "treasury_audit"
  | "notification"
  | "registry_write"
  | "payout"
  | "cctp_rebalance"
  /** Desk LLM agent proposal persist / fail and desk tick lifecycle. */
  | "desk_agent"
  /** Desk intent propose / fill / fail. */
  | "desk_intent"
  /** KeeperHub desk strategy / capital workflow start & terminal. */
  | "desk_workflow"
  /** Sponsored watch create / report registry path. */
  | "sponsored_watch"
  /** Premium access on-chain receipt registry write. */
  | "premium_receipt"
  /** Newspaper event → desk microtrade attempt (Phase 5). */
  | "desk_event_microtrade";

export const EXECUTION_LOG_ACTION_TYPES: readonly ExecutionLogActionType[] = [
  "monitor",
  "generate_alert",
  "publish_alert",
  "generate_digest",
  "publish_digest",
  "payment",
  "treasury_check",
  "treasury_audit",
  "notification",
  "registry_write",
  "payout",
  "cctp_rebalance",
  "desk_agent",
  "desk_intent",
  "desk_workflow",
  "sponsored_watch",
  "premium_receipt",
  "desk_event_microtrade",
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
  | "sponsored_monitor"
  | "monthly_newsletter";

export const PREMIUM_CONTENT_TYPES: readonly PremiumContentType[] = [
  "deep_dive",
  "historical_feed",
  "structured_feed",
  "sponsored_monitor",
  "monthly_newsletter",
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
export type Audience = "public" | "premium";

export const AUDIENCES: readonly Audience[] = ["public", "premium"] as const;

// ── LLM Providers ───────────────────────────────────────
export type LLMProvider = "gemini" | "openai" | "groq";

export const LLM_PROVIDERS: readonly LLMProvider[] = ["gemini", "groq", "openai"] as const;

export type LLMGenerationAttemptStatus = "succeeded" | "failed" | "invalid_response";

export const LLM_GENERATION_ATTEMPT_STATUSES: readonly LLMGenerationAttemptStatus[] = [
  "succeeded",
  "failed",
  "invalid_response",
] as const;

// ── Entity Types for LLM Generation ────────────────────
export type LLMEntityType = "public_alert" | "daily_digest" | "premium_intelligence_item";

export const LLM_ENTITY_TYPES: readonly LLMEntityType[] = [
  "public_alert",
  "daily_digest",
  "premium_intelligence_item",
] as const;

// ── Email Subscribers ───────────────────────────────────
export type EmailSubscriberStatus = "active" | "unsubscribed";

export const EMAIL_SUBSCRIBER_STATUSES: readonly EmailSubscriberStatus[] = [
  "active",
  "unsubscribed",
] as const;

export type EmailSubscriberSource = "web" | "api" | "premium" | "import";

export const EMAIL_SUBSCRIBER_SOURCES: readonly EmailSubscriberSource[] = [
  "web",
  "api",
  "premium",
  "import",
] as const;

// ── x402 Newsletter Subscriptions (recurring) ───────────
export type NewsletterSubscriptionStatus =
  | "pending"
  | "active"
  | "past_due"
  | "cancelled"
  | "expired";

export const NEWSLETTER_SUBSCRIPTION_STATUSES: readonly NewsletterSubscriptionStatus[] = [
  "pending",
  "active",
  "past_due",
  "cancelled",
  "expired",
] as const;

/** Canonical premium catalog slug for the monthly x402 newsletter product. */
export const MONTHLY_NEWSLETTER_SLUG = "monthly-newsletter-x402" as const;

/** Default billing period for recurring x402 newsletter agreements (days). */
export const DEFAULT_NEWSLETTER_BILLING_PERIOD_DAYS = 30;

/** Default grace window after period end before status becomes expired (days). */
export const DEFAULT_NEWSLETTER_GRACE_PERIOD_DAYS = 3;

// ── Referral Affiliates ─────────────────────────────────
/** Partner status for referral earnings eligibility. Only `approved` can earn and withdraw. */
export type AffiliateStatus = "pending" | "approved" | "suspended";

export const AFFILIATE_STATUSES: readonly AffiliateStatus[] = [
  "pending",
  "approved",
  "suspended",
] as const;

// ── Desk (Chronicle Desk trading rails) ─────────────────
export type DeskSignalType =
  | "health_factor"
  | "apy_delta"
  | "oracle_basis"
  | "gas_regime"
  | "liquidation_cluster"
  | "event_flow"
  | "event_supply"
  | "event_protocol_flow"
  | "capital_tick"
  | "manual";

export const DESK_SIGNAL_TYPES: readonly DeskSignalType[] = [
  "health_factor",
  "apy_delta",
  "oracle_basis",
  "gas_regime",
  "liquidation_cluster",
  "event_flow",
  "event_supply",
  "event_protocol_flow",
  "capital_tick",
  "manual",
] as const;

export type DeskPolicyVerdict = "trade" | "defend" | "defer" | "ignore";

export const DESK_POLICY_VERDICTS: readonly DeskPolicyVerdict[] = [
  "trade",
  "defend",
  "defer",
  "ignore",
] as const;

export type DeskStrategy = "risk_defend" | "yield_rotation" | "oracle_amm";

export const DESK_STRATEGIES: readonly DeskStrategy[] = [
  "risk_defend",
  "yield_rotation",
  "oracle_amm",
] as const;

export type DeskIntentStatus =
  | "proposed"
  | "approved"
  | "executing"
  | "filled"
  | "failed"
  | "deferred"
  | "cancelled";

export const DESK_INTENT_STATUSES: readonly DeskIntentStatus[] = [
  "proposed",
  "approved",
  "executing",
  "filled",
  "failed",
  "deferred",
  "cancelled",
] as const;

/** Intent statuses that count as in-flight for single-flight policy. */
export const DESK_OPEN_INTENT_STATUSES: readonly DeskIntentStatus[] = [
  "proposed",
  "approved",
  "executing",
] as const;

export type DeskCapitalDirection = "topup" | "sweep" | "emergency_return";

export const DESK_CAPITAL_DIRECTIONS: readonly DeskCapitalDirection[] = [
  "topup",
  "sweep",
  "emergency_return",
] as const;

export type DeskHeartbeatSource = "api" | "scheduler" | "workflow";

export const DESK_HEARTBEAT_SOURCES: readonly DeskHeartbeatSource[] = [
  "api",
  "scheduler",
  "workflow",
] as const;

/** Ethereum Sepolia — sole executable desk chain (v1). */
export const DESK_CHAIN_ID = 11155111 as const;

// ── CCTP Rebalance (Base Sepolia → Ethereum Sepolia) ────
export type CctpRebalanceStatus =
  | "pending"
  | "approving"
  | "burning"
  | "awaiting_attestation"
  | "minting"
  | "minted"
  | "failed"
  | "stuck";

export const CCTP_REBALANCE_STATUSES: readonly CctpRebalanceStatus[] = [
  "pending",
  "approving",
  "burning",
  "awaiting_attestation",
  "minting",
  "minted",
  "failed",
  "stuck",
] as const;

/** Non-terminal statuses counted as in-flight for policy + resume. */
export const CCTP_IN_FLIGHT_STATUSES: readonly CctpRebalanceStatus[] = [
  "pending",
  "approving",
  "burning",
  "awaiting_attestation",
  "minting",
  "stuck",
] as const;

/** Statuses the resume worker may advance (attestation poll / mint). */
export const CCTP_RESUMABLE_STATUSES: readonly CctpRebalanceStatus[] = [
  "awaiting_attestation",
  "minting",
  "stuck",
] as const;

export type CctpRebalanceMode = "direct" | "forwarding";

export const CCTP_REBALANCE_MODES: readonly CctpRebalanceMode[] = ["direct", "forwarding"] as const;

/** v1 direction only: revenue rail → desk rail. */
export type CctpRebalanceDirection = "base_to_sepolia";

export const CCTP_REBALANCE_DIRECTIONS: readonly CctpRebalanceDirection[] = [
  "base_to_sepolia",
] as const;

/**
 * Legal status transitions for CCTP rebalance rows.
 * Terminal: minted, failed. stuck may resume into awaiting_attestation | minting | minted.
 */
export const CCTP_ALLOWED_TRANSITIONS: Readonly<
  Record<CctpRebalanceStatus, readonly CctpRebalanceStatus[]>
> = {
  pending: ["approving", "failed"],
  approving: ["burning", "failed"],
  burning: ["awaiting_attestation", "failed"],
  awaiting_attestation: ["minting", "minted", "stuck", "failed"],
  minting: ["minted", "stuck", "failed"],
  stuck: ["awaiting_attestation", "minting", "minted", "failed"],
  minted: [],
  failed: [],
} as const;

export function isCctpTransitionAllowed(
  from: CctpRebalanceStatus,
  to: CctpRebalanceStatus,
): boolean {
  return (CCTP_ALLOWED_TRANSITIONS[from] as readonly CctpRebalanceStatus[]).includes(to);
}

// ── Desk LLM Agent ──────────────────────────────────────
export type DeskAgentAction = "propose" | "defer" | "defend" | "hold";

export const DESK_AGENT_ACTIONS: readonly DeskAgentAction[] = [
  "propose",
  "defer",
  "defend",
  "hold",
] as const;

/**
 * Allowlisted leg hints the agent may emit. Unknown values are stripped
 * before any mapping to KeeperHub workflows.
 */
export type DeskAgentLegsHint =
  | "repay_debt"
  | "withdraw_risk"
  | "usdc_to_link"
  | "link_to_usdc"
  | "aave_supply_link"
  | "aave_withdraw_link"
  | "usdc_to_weth"
  | "weth_to_usdc"
  | "none";

export const DESK_AGENT_LEGS_HINTS: readonly DeskAgentLegsHint[] = [
  "repay_debt",
  "withdraw_risk",
  "usdc_to_link",
  "link_to_usdc",
  "aave_supply_link",
  "aave_withdraw_link",
  "usdc_to_weth",
  "weth_to_usdc",
  "none",
] as const;

/** Soft fusion labels for borderline signals (Role D). */
export type DeskSignalFusionLabel = "actionable" | "data_quality" | "noise" | "wait_for_confirm";

export const DESK_SIGNAL_FUSION_LABELS: readonly DeskSignalFusionLabel[] = [
  "actionable",
  "data_quality",
  "noise",
  "wait_for_confirm",
] as const;

/** Failure recovery next-step allowlist (Role C). */
export type DeskFailureRecoveryAction =
  | "retry_smaller"
  | "cooldown"
  | "arm_kill"
  | "hold"
  | "ignore";

export const DESK_FAILURE_RECOVERY_ACTIONS: readonly DeskFailureRecoveryAction[] = [
  "retry_smaller",
  "cooldown",
  "arm_kill",
  "hold",
  "ignore",
] as const;

/**
 * Canonical LLM desk PM proposal. Persist under intent policy_snapshot.agent
 * and/or desk_agent_runs.proposal.
 */
export interface DeskAgentProposal {
  version: 1;
  action: DeskAgentAction;
  strategy: DeskStrategy | null;
  notionalUsdc: number;
  priority: number;
  confidence: number;
  thesis: string;
  riskNotes: string[];
  legsHint: DeskAgentLegsHint[];
  declineReasons: string[];
  model?: string | undefined;
  toolCallCount?: number | undefined;
  latencyMs?: number | undefined;
  /** Set when code forced risk_defend despite agent hold/defer. */
  forceDefendOverride?: boolean | undefined;
  /**
   * Set when code forced yield_rotation maintenance free-powder despite agent
   * hold/defer or a non-maintenance propose (free USDC below inventory floor).
   */
  forceMaintenanceOverride?: boolean | undefined;
}

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
export type DeskSignalId = Branded<string, "DeskSignal">;
export type DeskIntentId = Branded<string, "DeskIntent">;
export type DeskPositionId = Branded<string, "DeskPosition">;
export type DeskCapitalMoveId = Branded<string, "DeskCapitalMove">;
export type DeskTicketId = Branded<string, "DeskTicket">;
export type DeskHeartbeatId = Branded<string, "DeskHeartbeat">;
export type CctpRebalanceTransferId = Branded<string, "CctpRebalanceTransfer">;
