// API contract schemas matching the OpenAPI specification
import type {
  AlertDeliveryStatus,
  Confidence,
  DigestPublicationStatus,
  EmailSubscriberSource,
  EventType,
  PaymentRoute,
  PaymentStatus,
  TreasuryStatus,
} from "./domain.ts";

// ── Public Alert ────────────────────────────────────────
export interface PublicAlertResponse {
  id: string;
  title: string;
  summary: string;
  sourceReferences: string[];
  deliveryStatus: AlertDeliveryStatus;
  publishedAt: string;
  confidence?: Confidence;
  generationProvider?: string;
  registryTxHash?: string;
  sourceEventHash?: string;
  contentUri?: string;
  keeperHubRunId?: string;
  explorerUrl?: string;
  /** From joined monitored_events when available */
  eventType?: EventType;
  chainId?: number;
  protocol?: string;
}

// ── LLM Generation Attempt (response) ───────────────────
export interface LLMGenerationAttemptResponse {
  provider: string;
  attemptOrder: number;
  status: string;
  latencyMs: number;
  failureReason?: string;
}

// ── Daily Digest ────────────────────────────────────────
export interface DailyDigestResponse {
  id: string;
  reportDate: string;
  title: string;
  summary: string;
  highlights: string[];
  analysis?: string;
  publicationStatus: DigestPublicationStatus;
  publishedAt?: string;
  registryTxHash?: string;
  sourceEventRoot?: string;
  contentUri?: string;
  keeperHubRunId?: string;
  explorerUrl?: string;
}

// ── Digest Run Response (from KeeperHub trigger) ───────
export interface DigestRunResponse {
  accepted: boolean;
  digestId?: string;
  statusCode: number;
  message: string;
}

// ── Premium Item Teaser ─────────────────────────────────
export interface PremiumItemTeaserResponse {
  id: string;
  title: string;
  summaryPublic: string;
  priceAmount: number;
  priceCurrency: string;
  paymentRoutes: string[];
}

// ── Premium Item (full, after payment) ──────────────────
export interface PremiumItemResponse extends PremiumItemTeaserResponse {
  contentPrivate: Record<string, unknown>;
  sourceReferences: string[];
}

// ── Payment Challenge ───────────────────────────────────
export interface PaymentChallengeResponse {
  challengeReference: string;
  premiumItemId: string;
  paymentRoute: PaymentRoute;
  amountRequested: number;
  currency: string;
  expiresAt: string;
}

// ── Payment Record ──────────────────────────────────────
export interface PaymentRecordResponse {
  id: string;
  premiumItemId: string;
  paymentRoute: PaymentRoute;
  status: PaymentStatus;
  settlementReference?: string;
}

// ── KeeperHub Event (ingestion payload) ─────────────────
export interface KeeperHubEventPayload {
  sourceEventId: string;
  eventType: EventType;
  chainId: number;
  protocol?: string;
  transactionHash?: string;
  magnitude?: {
    value: number;
    unit: string;
  };
  capturedAt: string;
  rawPayload: Record<string, unknown>;
}

// ── KeeperHub Digest Trigger ────────────────────────────
export interface KeeperHubDigestTriggerPayload {
  periodStart: string;
  periodEnd: string;
}

// ── KeeperHub Treasury Check ────────────────────────────
export interface KeeperHubTreasuryCheckPayload {
  capturedAt: string;
  availableBalance: number;
  currency: string;
  safetyBuffer: number;
}

// ── Payment Challenge Request ───────────────────────────
export interface PaymentChallengeRequest {
  premiumItemId: string;
  paymentRoute: PaymentRoute;
  payerReference?: string;
}

// ── Payment Settlement Request ──────────────────────────
export interface PaymentSettlementRequest {
  challengeReference: string;
  paymentRoute: PaymentRoute;
  settlementReference: string;
  amountSettled?: number;
  currency?: string;
}

// ── Payment Settlement Response ─────────────────────────
export interface PaymentSettlementResponse {
  settled: boolean;
  paymentRecordId: string;
  verification: {
    amountSettled: number;
    currency: string;
    settlementReference?: string;
    payerReference?: string;
  };
  /**
   * HMAC-signed access receipt. Present this as
   * `Authorization: Bearer <token>` (or X-Premium-Access-Receipt)
   * when calling GET /premium/items/:id.
   */
  accessReceipt?: string;
  accessReceiptExpiresAt?: string;
  error?: string;
  sponsoredWatch?: {
    id: string;
    targetContract: string;
    status: string;
    createTxHash?: string | null;
    createExplorerUrl?: string | null;
    onChainWatchId?: number | null;
    startsAt?: string;
    endsAt?: string;
    reportTxHash?: string | null;
    reportExplorerUrl?: string | null;
    sourceEventRoot?: string | null;
  };
}

// ── Public Agent Activity ───────────────────────────────
export interface AgentActivityResponse {
  alerts: PublicAlertResponse[];
  digests: DailyDigestResponse[];
  payments: PaymentRecordResponse[];
  treasury: {
    availableBalance: number;
    safetyBuffer: number;
    status: TreasuryStatus;
  };
  executionLogs: Array<Record<string, unknown>>;
  payouts?: Array<Record<string, unknown>>;
  activeSponsoredWatches?: Array<Record<string, unknown>>;
}

// ── Email Subscription ──────────────────────────────────
export interface SubscribeRequest {
  email: string;
  receivesDigests?: boolean;
  receivesAlerts?: boolean;
  payerReference?: string;
  source?: EmailSubscriberSource;
}

export interface UnsubscribeRequest {
  email?: string;
  token?: string;
}

export interface SubscribeResponse {
  email: string;
  status: "active";
  receivesDigests: boolean;
  receivesAlerts: boolean;
  /** True when an existing unsubscribed address was re-activated. */
  reactivated: boolean;
}

export interface UnsubscribeResponse {
  email: string;
  status: "unsubscribed";
}

// ── Response Wrappers ───────────────────────────────────
export interface ItemsResponse<T> {
  items: T[];
}
