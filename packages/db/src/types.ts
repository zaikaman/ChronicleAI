// TypeScript database row, insert, and update types matching migration column names

import type {
  AffiliateStatus,
  AlertDeliveryStatus,
  Confidence,
  DigestPublicationStatus,
  EmailSubscriberSource,
  EmailSubscriberStatus,
  EventType,
  ExecutionLogActionType,
  ExecutionLogStatus,
  MonitoredEventStatus,
  NewsletterSubscriptionStatus,
  PaymentRoute,
  PaymentStatus,
  PremiumContentType,
  PremiumItemStatus,
  TreasuryStatus,
} from "@chronicleai/schemas";

// ── Monitored Events ────────────────────────────────────
export interface MonitoredEventRow {
  id: string;
  source: string;
  source_event_id: string | null;
  event_type: EventType;
  chain_id: number;
  protocol: string | null;
  asset_symbols: string[] | null;
  magnitude: Record<string, unknown> | null;
  transaction_hash: string | null;
  observed_at: string | null;
  captured_at: string;
  significance_score: number | null;
  raw_payload: unknown;
  status: MonitoredEventStatus;
  created_at: string;
  updated_at: string;
}

export interface MonitoredEventInsert {
  source: string;
  source_event_id?: string | null;
  event_type: EventType;
  chain_id: number;
  protocol?: string | null;
  asset_symbols?: string[] | null;
  magnitude?: Record<string, unknown> | null;
  transaction_hash?: string | null;
  observed_at?: string | null;
  captured_at: string;
  significance_score?: number | null;
  raw_payload: unknown;
  status?: MonitoredEventStatus;
}

export type MonitoredEventUpdate = Partial<MonitoredEventInsert>;

// ── Public Alerts ───────────────────────────────────────
export interface PublicAlertRow {
  id: string;
  monitored_event_id: string | null;
  title: string;
  summary: string;
  source_references: string[];
  audience: string;
  destinations: Record<string, unknown> | null;
  delivery_status: AlertDeliveryStatus;
  published_at: string | null;
  dedupe_key: string | null;
  confidence: Confidence | null;
  generation_provider: string | null;
  generation_attempt_ids: string[];
  registry_tx_hash: string | null;
  source_event_hash: string | null;
  content_uri: string | null;
  content_hash: string | null;
  gas_used: string | null;
  gas_used_wei: string | null;
  keeper_hub_run_id: string | null;
  explorer_url: string | null;
  created_at: string;
  updated_at: string;
  /** Populated when list/find joins monitored_events */
  event_type?: EventType | null;
  chain_id?: number | null;
  protocol?: string | null;
}

export interface PublicAlertInsert {
  monitored_event_id?: string | null;
  title: string;
  summary: string;
  source_references: string[];
  audience?: string;
  destinations?: Record<string, unknown> | null;
  delivery_status?: AlertDeliveryStatus;
  published_at?: string | null;
  dedupe_key?: string | null;
  confidence?: Confidence | null;
  generation_provider?: string | null;
  generation_attempt_ids?: string[];
  registry_tx_hash?: string | null;
  source_event_hash?: string | null;
  content_uri?: string | null;
  content_hash?: string | null;
  gas_used?: string | null;
  gas_used_wei?: string | null;
  keeper_hub_run_id?: string | null;
  explorer_url?: string | null;
}

export type PublicAlertUpdate = Partial<PublicAlertInsert>;

// ── Daily Digests ───────────────────────────────────────
export interface DailyDigestRow {
  id: string;
  report_date: string;
  period_start: string;
  period_end: string;
  title: string;
  summary: string;
  highlights: string[];
  analysis: string | null;
  source_event_ids: string[];
  audience: string;
  publication_status: DigestPublicationStatus;
  published_at: string | null;
  registry_tx_hash: string | null;
  source_event_root: string | null;
  content_uri: string | null;
  content_hash: string | null;
  gas_used: string | null;
  gas_used_wei: string | null;
  keeper_hub_run_id: string | null;
  explorer_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyDigestInsert {
  report_date: string;
  period_start: string;
  period_end: string;
  title: string;
  summary: string;
  highlights: string[];
  analysis?: string | null;
  source_event_ids: string[];
  audience?: string;
  publication_status?: DigestPublicationStatus;
  published_at?: string | null;
  registry_tx_hash?: string | null;
  source_event_root?: string | null;
  content_uri?: string | null;
  content_hash?: string | null;
  gas_used?: string | null;
  gas_used_wei?: string | null;
  keeper_hub_run_id?: string | null;
  explorer_url?: string | null;
}

export type DailyDigestUpdate = Partial<DailyDigestInsert>;

// ── SponsoredWatch ───────────────────────────────────────
export interface SponsoredWatchRow {
  id: string;
  target_contract: string;
  watch_spec_hash: string;
  starts_at: string;
  ends_at: string;
  create_tx_hash: string | null;
  report_tx_hash: string | null;
  report_content_hash: string | null;
  content_uri: string | null;
  create_keeper_hub_run_id: string | null;
  create_explorer_url: string | null;
  report_keeper_hub_run_id: string | null;
  report_explorer_url: string | null;
  /** Numeric watch id returned by on-chain createSponsoredWatch. */
  on_chain_watch_id: number | null;
  source_event_ids: string[];
  source_event_root: string | null;
  report_title: string | null;
  report_summary: string | null;
  report_highlights: string[];
  report_analysis: string | null;
  last_monitored_at: string | null;
  monitored_event_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SponsoredWatchInsert {
  target_contract: string;
  watch_spec_hash: string;
  starts_at: string;
  ends_at: string;
  create_tx_hash?: string | null;
  report_tx_hash?: string | null;
  report_content_hash?: string | null;
  content_uri?: string | null;
  create_keeper_hub_run_id?: string | null;
  create_explorer_url?: string | null;
  report_keeper_hub_run_id?: string | null;
  report_explorer_url?: string | null;
  on_chain_watch_id?: number | null;
  source_event_ids?: string[];
  source_event_root?: string | null;
  report_title?: string | null;
  report_summary?: string | null;
  report_highlights?: string[];
  report_analysis?: string | null;
  last_monitored_at?: string | null;
  monitored_event_count?: number;
  status?: string;
}

export type SponsoredWatchUpdate = Partial<SponsoredWatchInsert>;

// ── RevenuePayout ────────────────────────────────────────
export interface RevenuePayoutRow {
  id: string;
  payout_period_hash: string;
  recipient: string;
  amount: number;
  reason_hash: string;
  payout_tx_hash: string | null;
  registry_tx_hash: string | null;
  keeper_hub_run_id: string | null;
  explorer_url: string | null;
  transfer_keeper_hub_run_id: string | null;
  transfer_explorer_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface RevenuePayoutInsert {
  payout_period_hash: string;
  recipient: string;
  amount: number;
  reason_hash: string;
  payout_tx_hash?: string | null;
  registry_tx_hash?: string | null;
  keeper_hub_run_id?: string | null;
  explorer_url?: string | null;
  transfer_keeper_hub_run_id?: string | null;
  transfer_explorer_url?: string | null;
  status?: string;
}

export type RevenuePayoutUpdate = Partial<RevenuePayoutInsert>;

// ── Premium Intelligence Items ──────────────────────────
export interface PremiumIntelligenceItemRow {
  id: string;
  slug: string;
  title: string;
  content_type: PremiumContentType;
  summary_public: string;
  content_private: unknown;
  source_event_ids: string[];
  price_amount: number;
  price_currency: string;
  payment_routes: string[];
  status: PremiumItemStatus;
  created_at: string;
  updated_at: string;
}

export interface PremiumIntelligenceItemInsert {
  slug: string;
  title: string;
  content_type: PremiumContentType;
  summary_public: string;
  content_private: unknown;
  source_event_ids: string[];
  price_amount: number;
  price_currency: string;
  payment_routes: string[];
  status?: PremiumItemStatus;
}

export type PremiumIntelligenceItemUpdate = Partial<PremiumIntelligenceItemInsert>;

// ── Payment Records ─────────────────────────────────────
export interface PaymentRecordRow {
  id: string;
  premium_item_id: string;
  payment_route: PaymentRoute;
  payer_reference: string | null;
  /**
   * Optional affiliate / referral partner wallet from subscription or payment intent.
   * Distinct from payer_reference — never the subscriber who paid.
   */
  referral_address: string | null;
  amount_requested: number | null;
  amount_settled: number | null;
  currency: string | null;
  status: PaymentStatus;
  challenge_reference: string | null;
  settlement_reference: string | null;
  requested_at: string;
  /** When the challenge stops accepting settlements (ISO-8601). */
  expires_at: string | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentRecordInsert {
  premium_item_id: string;
  payment_route: PaymentRoute;
  payer_reference?: string | null;
  referral_address?: string | null;
  amount_requested?: number | null;
  amount_settled?: number | null;
  currency?: string | null;
  status?: PaymentStatus;
  challenge_reference?: string | null;
  settlement_reference?: string | null;
  requested_at?: string;
  expires_at?: string | null;
  settled_at?: string | null;
}

export type PaymentRecordUpdate = Partial<PaymentRecordInsert>;

// ── Treasury Snapshots ──────────────────────────────────
export interface TreasurySnapshotRow {
  id: string;
  available_balance: number;
  currency: string;
  safety_buffer: number;
  revenue_total: number | null;
  estimated_generation_cost: number | null;
  estimated_transaction_cost: number | null;
  paid_request_count: number | null;
  status: TreasuryStatus;
  last_routed_at: string | null;
  last_payout_period_hash: string | null;
  total_routed_amount: number | null;
  captured_at: string;
  created_at: string;
}

export interface TreasurySnapshotInsert {
  available_balance: number;
  currency: string;
  safety_buffer: number;
  revenue_total?: number | null;
  estimated_generation_cost?: number | null;
  estimated_transaction_cost?: number | null;
  paid_request_count?: number | null;
  status?: TreasuryStatus;
  captured_at: string;
}

export type TreasurySnapshotUpdate = Partial<TreasurySnapshotInsert>;

// ── LLM Generation Attempts ────────────────────────────
export interface LLMGenerationAttemptRow {
  id: string;
  entity_type: string;
  entity_id: string | null;
  monitored_event_id: string;
  provider: string;
  attempt_order: number;
  status: string;
  latency_ms: number;
  failure_reason: string | null;
  response_metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface LLMGenerationAttemptInsert {
  entity_type?: string;
  entity_id?: string | null;
  monitored_event_id: string;
  provider: string;
  attempt_order: number;
  status: string;
  latency_ms?: number;
  failure_reason?: string | null;
  response_metadata?: Record<string, unknown> | null;
}

export type LLMGenerationAttemptUpdate = Partial<LLMGenerationAttemptInsert>;

// ── Execution Logs ──────────────────────────────────────
export interface ExecutionLogRow {
  id: string;
  action_type: ExecutionLogActionType;
  entity_type: string | null;
  entity_id: string | null;
  status: ExecutionLogStatus;
  message: string | null;
  details: unknown;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface ExecutionLogInsert {
  action_type: ExecutionLogActionType;
  entity_type?: string | null;
  entity_id?: string | null;
  status: ExecutionLogStatus;
  message?: string | null;
  details?: unknown;
  started_at?: string;
  completed_at?: string | null;
}

export type ExecutionLogUpdate = Partial<ExecutionLogInsert>;

// ── Email Subscribers ───────────────────────────────────
export interface EmailSubscriberRow {
  id: string;
  email: string;
  email_normalized: string;
  status: EmailSubscriberStatus;
  receives_digests: boolean;
  receives_alerts: boolean;
  source: EmailSubscriberSource;
  payer_reference: string | null;
  unsubscribe_token: string;
  subscribed_at: string;
  unsubscribed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailSubscriberInsert {
  email: string;
  email_normalized: string;
  status?: EmailSubscriberStatus;
  receives_digests?: boolean;
  receives_alerts?: boolean;
  source?: EmailSubscriberSource;
  payer_reference?: string | null;
  unsubscribe_token?: string;
  subscribed_at?: string;
  unsubscribed_at?: string | null;
}

export type EmailSubscriberUpdate = Partial<
  Omit<EmailSubscriberInsert, "email" | "email_normalized">
> & {
  email?: string;
  email_normalized?: string;
};

// ── x402 Newsletter Subscriptions ───────────────────────
export interface NewsletterSubscriptionRow {
  id: string;
  email: string;
  email_normalized: string;
  payer_wallet: string | null;
  status: NewsletterSubscriptionStatus;
  amount_per_period: number;
  currency: string;
  billing_period_days: number;
  current_period_start: string | null;
  current_period_end: string | null;
  next_renewal_at: string | null;
  periods_paid: number;
  grace_period_days: number;
  referral_address: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  premium_item_id: string | null;
  email_subscriber_id: string | null;
  last_payment_record_id: string | null;
  last_settlement_reference: string | null;
  last_settled_at: string | null;
  pending_challenge_reference: string | null;
  pending_payment_record_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewsletterSubscriptionInsert {
  email: string;
  email_normalized: string;
  payer_wallet?: string | null;
  status?: NewsletterSubscriptionStatus;
  amount_per_period: number;
  currency?: string;
  billing_period_days?: number;
  current_period_start?: string | null;
  current_period_end?: string | null;
  next_renewal_at?: string | null;
  periods_paid?: number;
  grace_period_days?: number;
  referral_address?: string | null;
  cancel_at_period_end?: boolean;
  cancelled_at?: string | null;
  premium_item_id?: string | null;
  email_subscriber_id?: string | null;
  last_payment_record_id?: string | null;
  last_settlement_reference?: string | null;
  last_settled_at?: string | null;
  pending_challenge_reference?: string | null;
  pending_payment_record_id?: string | null;
}

export type NewsletterSubscriptionUpdate = Partial<NewsletterSubscriptionInsert>;

// ── Referral Affiliates ─────────────────────────────────
export interface AffiliateRow {
  id: string;
  wallet_address: string;
  display_name: string | null;
  referral_code: string | null;
  status: AffiliateStatus;
  metadata: Record<string, unknown>;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AffiliateInsert {
  wallet_address: string;
  display_name?: string | null;
  referral_code?: string | null;
  status?: AffiliateStatus;
  metadata?: Record<string, unknown>;
  approved_at?: string | null;
}

export type AffiliateUpdate = Partial<
  Omit<AffiliateInsert, "wallet_address">
> & {
  wallet_address?: string;
};
