// TypeScript database row, insert, and update types matching migration column names

import type {
  AlertDeliveryStatus,
  Confidence,
  DigestPublicationStatus,
  EventType,
  ExecutionLogActionType,
  ExecutionLogStatus,
  MonitoredEventStatus,
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
  created_at: string;
  updated_at: string;
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
}

export type DailyDigestUpdate = Partial<DailyDigestInsert>;

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
  amount_requested: number | null;
  amount_settled: number | null;
  currency: string | null;
  status: PaymentStatus;
  challenge_reference: string | null;
  settlement_reference: string | null;
  requested_at: string;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentRecordInsert {
  premium_item_id: string;
  payment_route: PaymentRoute;
  payer_reference?: string | null;
  amount_requested?: number | null;
  amount_settled?: number | null;
  currency?: string | null;
  status?: PaymentStatus;
  challenge_reference?: string | null;
  settlement_reference?: string | null;
  requested_at?: string;
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
