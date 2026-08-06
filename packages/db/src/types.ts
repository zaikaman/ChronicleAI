// TypeScript database row, insert, and update types matching migration column names

import type {
  AffiliateStatus,
  AlertActionStatus,
  AlertDeliveryStatus,
  AlertKind,
  AlertSignalStatus,
  CctpRebalanceDirection,
  CctpRebalanceMode,
  CctpRebalanceStatus,
  Confidence,
  DeskCapitalDirection,
  DeskHeartbeatSource,
  DeskIntentStatus,
  DeskPolicyVerdict,
  DeskSignalType,
  DeskStrategy,
  DigestKind,
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
  block_number?: number | null;
  block_hash?: string | null;
  log_index?: number | null;
  source_contract?: string | null;
  normalized_evidence?: Record<string, unknown>;
  source_dedupe_key?: string | null;
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
  block_number?: number | null;
  block_hash?: string | null;
  log_index?: number | null;
  source_contract?: string | null;
  normalized_evidence?: Record<string, unknown>;
  source_dedupe_key?: string | null;
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
  alert_kind?: AlertKind;
  /** Denormalized source chain used for active/legacy API scopes. */
  chain_id?: number | null;
  publication_chain_id?: number;
  source_dedupe_key?: string | null;
  desk_signal_id?: string | null;
  signal_type?: DeskSignalType | null;
  signal_status?: AlertSignalStatus;
  policy_verdict?: DeskPolicyVerdict | null;
  action_status?: AlertActionStatus;
  intent_id?: string | null;
  ticket_id?: string | null;
  transaction_hash?: string | null;
  action_transaction_hash?: string | null;
  action_keeper_hub_run_id?: string | null;
  action_explorer_url?: string | null;
  deterministic_evidence?: Record<string, unknown>;
  /** Populated when list/find joins monitored_events */
  source_event_id?: string | null;
  event_type?: EventType | null;
  protocol?: string | null;
  /** Flow enrichment from monitored_events.raw_payload.flowContext when joined. */
  flow_context?: Record<string, unknown> | null;
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
  alert_kind?: AlertKind;
  event_type?: EventType | null;
  chain_id?: number | null;
  publication_chain_id?: number;
  source_dedupe_key?: string | null;
  desk_signal_id?: string | null;
  signal_type?: DeskSignalType | null;
  signal_status?: AlertSignalStatus;
  policy_verdict?: DeskPolicyVerdict | null;
  action_status?: AlertActionStatus;
  intent_id?: string | null;
  ticket_id?: string | null;
  transaction_hash?: string | null;
  action_transaction_hash?: string | null;
  action_keeper_hub_run_id?: string | null;
  action_explorer_url?: string | null;
  deterministic_evidence?: Record<string, unknown>;
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
  market_narrative?: Record<string, unknown> | null;
  market_narrative_provider?: string | null;
  /** DB CHECK: null | 'succeeded' | 'failed'. */
  market_narrative_status?: "succeeded" | "failed" | null;
  created_at: string;
  updated_at: string;
  digest_kind?: DigestKind;
  chain_id?: number;
  publication_chain_id?: number;
  source_alert_ids?: string[];
  source_signal_ids?: string[];
  source_intent_ids?: string[];
  source_ticket_ids?: string[];
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
  /** Sectioned digest copy + precomputed stats (JSON). */
  market_narrative?: Record<string, unknown> | null;
  market_narrative_provider?: string | null;
  /** DB CHECK: null | 'succeeded' | 'failed' (not 'ready'). */
  market_narrative_status?: "succeeded" | "failed" | null;
  digest_kind?: DigestKind;
  chain_id?: number;
  publication_chain_id?: number;
  source_alert_ids?: string[];
  source_signal_ids?: string[];
  source_intent_ids?: string[];
  source_ticket_ids?: string[];
}

export type DailyDigestUpdate = Partial<DailyDigestInsert>;

// ── SponsoredWatch ───────────────────────────────────────
export type SponsoredWatchTargetKind = "contract" | "wallet";
export type SponsoredWatchVisibility = "public" | "private";

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
  watch_spec?: Record<string, unknown> | null;
  /** contract (default) or wallet — wallet watches match ERC-20 Transfer from/to. */
  target_kind: SponsoredWatchTargetKind;
  /** Owner Telegram chat id for private alert delivery. */
  telegram_chat_id: string | null;
  /** public = registry alert + community Telegram; private = owner Telegram only. */
  visibility: SponsoredWatchVisibility;
  last_alert_sent_at: string | null;
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
  target_kind?: SponsoredWatchTargetKind;
  telegram_chat_id?: string | null;
  visibility?: SponsoredWatchVisibility;
  last_alert_sent_at?: string | null;
  status?: string;
}

export type SponsoredWatchUpdate = Partial<SponsoredWatchInsert>;

// ── TelegramBinding ──────────────────────────────────────
export interface TelegramBindingRow {
  id: string;
  code: string;
  chat_id: string;
  username: string | null;
  wallet_address: string | null;
  source: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface TelegramBindingInsert {
  code: string;
  chat_id: string;
  username?: string | null;
  wallet_address?: string | null;
  source?: string;
  expires_at?: string;
  used_at?: string | null;
}

export type TelegramBindingUpdate = Partial<
  Pick<TelegramBindingInsert, "wallet_address" | "used_at" | "username">
>;

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
  source_chain_id?: number;
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
  source_chain_id?: number;
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
  /** On-chain publishPremiumReceipt proof (soft-fail; may be null if registry write failed). */
  registry_tx_hash: string | null;
  keeper_hub_run_id: string | null;
  explorer_url: string | null;
  content_uri: string | null;
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
  registry_tx_hash?: string | null;
  keeper_hub_run_id?: string | null;
  explorer_url?: string | null;
  content_uri?: string | null;
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

export type AffiliateUpdate = Partial<Omit<AffiliateInsert, "wallet_address">> & {
  wallet_address?: string;
};

// ── Referral Attributions (first-touch wallet → affiliate) ─
export type ReferralAttributionSource = "web_connect" | "payment_intent" | "manual";

export interface ReferralAttributionRow {
  id: string;
  referred_wallet: string;
  affiliate_wallet: string;
  referral_code: string | null;
  source: ReferralAttributionSource;
  attributed_at: string;
  created_at: string;
  updated_at: string;
}

export interface ReferralAttributionInsert {
  referred_wallet: string;
  affiliate_wallet: string;
  referral_code?: string | null;
  source?: ReferralAttributionSource;
  attributed_at?: string;
}

// ── Affiliate Earnings (ledger credits) ─────────────────
export interface AffiliateEarningRow {
  id: string;
  affiliate_wallet: string;
  referred_wallet: string;
  payment_record_id: string;
  payment_amount: number;
  reward_share: number;
  reward_amount: number;
  currency: string;
  created_at: string;
}

export interface AffiliateEarningInsert {
  affiliate_wallet: string;
  referred_wallet: string;
  payment_record_id: string;
  payment_amount: number;
  reward_share: number;
  reward_amount: number;
  currency?: string;
}

// ── Affiliate Funding Transfers (treasury → KeeperHub float) ───────────────
export type AffiliateFundingTransferStatus = "pending" | "processing" | "completed" | "failed";

export interface AffiliateFundingTransferRow {
  id: string;
  affiliate_earning_id: string;
  amount: number;
  currency: string;
  destination_wallet: string;
  chain_id: number;
  token_address: string;
  status: AffiliateFundingTransferStatus;
  attempt_count: number;
  tx_hash: string | null;
  explorer_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AffiliateFundingTransferInsert {
  affiliate_earning_id: string;
  amount: number;
  currency?: string;
  destination_wallet: string;
  chain_id: number;
  token_address: string;
  status?: AffiliateFundingTransferStatus;
}

// ── Affiliate Withdrawals (agent-initiated) ─────────────
export type AffiliateWithdrawalStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface AffiliateWithdrawalRow {
  id: string;
  affiliate_wallet: string;
  amount: number;
  currency: string;
  status: AffiliateWithdrawalStatus;
  agent_message: string | null;
  payout_record_id: string | null;
  payout_tx_hash: string | null;
  registry_tx_hash: string | null;
  keeper_hub_run_id: string | null;
  explorer_url: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface AffiliateWithdrawalInsert {
  affiliate_wallet: string;
  amount: number;
  currency?: string;
  status?: AffiliateWithdrawalStatus;
  agent_message?: string | null;
  payout_record_id?: string | null;
  payout_tx_hash?: string | null;
  registry_tx_hash?: string | null;
  keeper_hub_run_id?: string | null;
  explorer_url?: string | null;
  error_message?: string | null;
  completed_at?: string | null;
}

export type AffiliateWithdrawalUpdate = Partial<AffiliateWithdrawalInsert>;

// ── Desk Signals ────────────────────────────────────────
export interface DeskSignalRow {
  id: string;
  signal_type: DeskSignalType;
  chain_id: number;
  severity: number;
  features: Record<string, unknown>;
  sources: Record<string, unknown>;
  policy_verdict: DeskPolicyVerdict;
  dedupe_key: string;
  created_at: string;
  source_alert_id?: string | null;
  source_event_id?: string | null;
  signal_origin?: "alert" | "desk_read" | "manual";
  source_dedupe_key?: string | null;
  source_evidence?: Record<string, unknown>;
}

export interface DeskSignalInsert {
  signal_type: DeskSignalType;
  chain_id?: number;
  severity?: number;
  features?: Record<string, unknown>;
  sources?: Record<string, unknown>;
  policy_verdict?: DeskPolicyVerdict;
  dedupe_key: string;
  created_at?: string;
  source_alert_id?: string | null;
  source_event_id?: string | null;
  signal_origin?: "alert" | "desk_read" | "manual";
  source_dedupe_key?: string | null;
  source_evidence?: Record<string, unknown>;
}

// ── Desk Intents ────────────────────────────────────────
export interface DeskIntentRow {
  id: string;
  signal_id: string | null;
  strategy: DeskStrategy;
  status: DeskIntentStatus;
  notional_usdc: number;
  legs: unknown[];
  reason_codes: string[];
  policy_snapshot: Record<string, unknown>;
  keeper_hub_run_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeskIntentInsert {
  signal_id?: string | null;
  strategy: DeskStrategy;
  status?: DeskIntentStatus;
  notional_usdc?: number;
  legs?: unknown[];
  reason_codes?: string[];
  policy_snapshot?: Record<string, unknown>;
  keeper_hub_run_id?: string | null;
  error_message?: string | null;
}

export type DeskIntentUpdate = Partial<DeskIntentInsert>;

// ── Desk Positions ──────────────────────────────────────
export interface DeskPositionRow {
  id: string;
  as_of: string;
  desk_address: string;
  usdc: number;
  weth: number;
  link: number;
  aave: Record<string, unknown>;
  morpho: Record<string, unknown> | null;
  lido: Record<string, unknown> | null;
  equity_usdc: number;
  raw: Record<string, unknown>;
  created_at: string;
}

export interface DeskPositionInsert {
  as_of: string;
  desk_address: string;
  usdc?: number;
  weth?: number;
  link?: number;
  aave?: Record<string, unknown>;
  morpho?: Record<string, unknown> | null;
  lido?: Record<string, unknown> | null;
  equity_usdc?: number;
  raw?: Record<string, unknown>;
}

// ── Desk Capital Moves ──────────────────────────────────
export interface DeskCapitalMoveRow {
  id: string;
  direction: DeskCapitalDirection;
  amount_usdc: number;
  from_address: string;
  to_address: string;
  tx_hash: string | null;
  explorer_url: string | null;
  reason: string | null;
  treasury_usdc_after: number | null;
  desk_equity_after: number | null;
  /** recordCapitalMove registry audit tx (distinct from transfer tx_hash). */
  registry_tx_hash: string | null;
  keeper_hub_run_id: string | null;
  registry_explorer_url: string | null;
  created_at: string;
}

export interface DeskCapitalMoveInsert {
  direction: DeskCapitalDirection;
  amount_usdc: number;
  from_address: string;
  to_address: string;
  tx_hash?: string | null;
  explorer_url?: string | null;
  reason?: string | null;
  treasury_usdc_after?: number | null;
  desk_equity_after?: number | null;
  registry_tx_hash?: string | null;
  keeper_hub_run_id?: string | null;
  registry_explorer_url?: string | null;
}

export type DeskCapitalMoveUpdate = Partial<
  Pick<
    DeskCapitalMoveInsert,
    | "tx_hash"
    | "explorer_url"
    | "reason"
    | "treasury_usdc_after"
    | "desk_equity_after"
    | "registry_tx_hash"
    | "keeper_hub_run_id"
    | "registry_explorer_url"
  >
>;

// ── Desk Tickets ────────────────────────────────────────
export interface DeskTicketRow {
  id: string;
  intent_id: string;
  ticket_hash: string;
  signal_hash: string | null;
  intent_hash: string | null;
  content_uri: string | null;
  tx_hash: string | null;
  keeper_hub_run_id: string | null;
  explorer_url: string | null;
  summary: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface DeskTicketInsert {
  intent_id: string;
  ticket_hash: string;
  signal_hash?: string | null;
  intent_hash?: string | null;
  content_uri?: string | null;
  tx_hash?: string | null;
  keeper_hub_run_id?: string | null;
  explorer_url?: string | null;
  summary?: string | null;
  payload?: Record<string, unknown>;
}

export type DeskTicketUpdate = Partial<Omit<DeskTicketInsert, "intent_id" | "ticket_hash">> & {
  ticket_hash?: string;
};

// ── Desk Heartbeats ─────────────────────────────────────
export interface DeskHeartbeatRow {
  id: string;
  source: DeskHeartbeatSource;
  created_at: string;
}

export interface DeskHeartbeatInsert {
  source: DeskHeartbeatSource;
  created_at?: string;
}

// ── Desk Agent Runs ─────────────────────────────────────
export interface DeskAgentRunRow {
  id: string;
  created_at: string;
  model: string | null;
  latency_ms: number | null;
  proposal: Record<string, unknown>;
  context_digest: Record<string, unknown>;
  intent_id: string | null;
  error_message: string | null;
}

export interface DeskAgentRunInsert {
  model?: string | null;
  latency_ms?: number | null;
  proposal: Record<string, unknown>;
  context_digest?: Record<string, unknown>;
  intent_id?: string | null;
  error_message?: string | null;
  created_at?: string;
}

export type DeskAgentRunUpdate = Partial<DeskAgentRunInsert>;

// ── Desk Control State (singleton kill switch + pause) ──
/** Fixed singleton primary key for desk_control_state. */
export const DESK_CONTROL_STATE_ID = "default" as const;

export interface DeskControlStateRow {
  id: string;
  kill_armed: boolean;
  kill_armed_at: string | null;
  kill_armed_reason: string | null;
  last_trip_at: string | null;
  last_trip_reason: string | null;
  last_keeper_hub_run_id: string | null;
  last_tx_hash: string | null;
  desk_paused: boolean;
  /** Last successful maintenance free-powder / rebalance fill (ISO). */
  last_maintenance_at: string | null;
  /** Last event-linked microtrade fill / intent for cooldown (ISO). */
  last_event_microtrade_at: string | null;
  updated_at: string;
}

export interface DeskControlStateUpsert {
  kill_armed?: boolean;
  kill_armed_at?: string | null;
  kill_armed_reason?: string | null;
  last_trip_at?: string | null;
  last_trip_reason?: string | null;
  last_keeper_hub_run_id?: string | null;
  last_tx_hash?: string | null;
  desk_paused?: boolean;
  last_maintenance_at?: string | null;
  last_event_microtrade_at?: string | null;
}

// ── CCTP Rebalance Transfers ────────────────────────────
export interface CctpRebalanceTransferRow {
  id: string;
  status: CctpRebalanceStatus;
  direction: CctpRebalanceDirection;
  source_domain: number;
  destination_domain: number;
  source_chain_id?: number;
  destination_chain_id: number;
  amount_usdc: number;
  amount_atomic: string;
  max_fee_atomic: string | null;
  min_finality_threshold: number | null;
  mode: CctpRebalanceMode;
  treasury_address: string;
  mint_recipient: string;
  approve_tx_hash: string | null;
  burn_tx_hash: string | null;
  message_bytes: string | null;
  attestation: string | null;
  message_hash: string | null;
  mint_tx_hash: string | null;
  iris_status: string | null;
  error_message: string | null;
  attempt_count: number;
  burned_at: string | null;
  attested_at: string | null;
  minted_at: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface CctpRebalanceTransferInsert {
  status?: CctpRebalanceStatus;
  direction?: CctpRebalanceDirection;
  source_domain?: number;
  destination_domain?: number;
  source_chain_id?: number;
  destination_chain_id?: number;
  amount_usdc: number;
  amount_atomic: string;
  max_fee_atomic?: string | null;
  min_finality_threshold?: number | null;
  mode: CctpRebalanceMode;
  treasury_address: string;
  mint_recipient?: string;
  approve_tx_hash?: string | null;
  burn_tx_hash?: string | null;
  message_bytes?: string | null;
  attestation?: string | null;
  message_hash?: string | null;
  mint_tx_hash?: string | null;
  iris_status?: string | null;
  error_message?: string | null;
  attempt_count?: number;
  burned_at?: string | null;
  attested_at?: string | null;
  minted_at?: string | null;
  metadata?: Record<string, unknown>;
}

/** Patch fields allowed on status transitions (not status itself). */
export type CctpRebalanceTransferPatch = Partial<
  Omit<
    CctpRebalanceTransferInsert,
    | "status"
    | "direction"
    | "amount_usdc"
    | "amount_atomic"
    | "mode"
    | "treasury_address"
    | "mint_recipient"
  >
> & {
  status?: never;
};

// ── System Control State (singleton Groq key rotation index) ──
/** Fixed singleton primary key for system_control_state. */
export const SYSTEM_CONTROL_STATE_ID = "default" as const;

export interface SystemControlStateRow {
  id: string;
  groq_key_index: number;
  updated_at: string;
}

export interface SystemControlStateUpsert {
  groq_key_index?: number;
}

// ── Affiliate Agent Jobs ───────────────────────────
export interface AffiliateAgentJobRow {
  id: string;
  affiliate_wallet: string;
  status: string;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AffiliateAgentJobInsert {
  id: string;
  affiliate_wallet: string;
  status: string;
  request: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type AffiliateAgentJobUpdate = Partial<AffiliateAgentJobInsert>;
