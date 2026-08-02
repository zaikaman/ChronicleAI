// API contract schemas matching the OpenAPI specification
import type {
  AlertActionStatus,
  AlertDeliveryStatus,
  AlertKind,
  AlertSignalStatus,
  Confidence,
  DeskPolicyVerdict,
  DeskSignalType,
  DigestKind,
  DigestPublicationStatus,
  DigestSections,
  EmailSubscriberSource,
  EventType,
  FlowContext,
  NewsletterSubscriptionStatus,
  PaymentRoute,
  PaymentStatus,
  TreasuryStatus,
} from "./domain.ts";

// ── Pagination (page-based list envelopes) ───────────────
/** Metadata for page-based list endpoints (`?page=&limit=`). */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** Standard paginated list response used by public feeds. */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMeta;
}

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
  /** bytes32 content hash written on-chain (IDEA proof field). */
  contentHash?: string;
  contentUri?: string;
  /** Gas units consumed by the registry write (decimal string). */
  gasUsed?: string;
  /** Total gas cost in wei when reported by KeeperHub. */
  gasUsedWei?: string;
  keeperHubRunId?: string;
  explorerUrl?: string;
  /** From joined monitored_events when available */
  eventType?: EventType;
  chainId?: number;
  protocol?: string;
  /** Deterministic capital-flow roles/direction when enrichment resolved. */
  flowContext?: FlowContext;
  alertKind?: AlertKind;
  publicationChainId?: number;
  sourceDedupeKey?: string;
  signalType?: DeskSignalType;
  signalStatus?: AlertSignalStatus;
  policyVerdict?: DeskPolicyVerdict;
  actionStatus?: AlertActionStatus;
  intentId?: string;
  ticketId?: string;
  transactionHash?: string;
  actionTransactionHash?: string;
  actionKeeperHubRunId?: string;
  actionExplorerUrl?: string;
  deterministicEvidence?: Record<string, unknown>;
  causalChain?: AlertCausalChain;
}

export interface AlertCausalSignal {
  id: string;
  signalType: DeskSignalType;
  origin: "alert" | "desk_read" | "manual";
  sourceAlertId?: string;
  sourceEventId?: string;
  chainId: number;
  policyVerdict: DeskPolicyVerdict;
  severity: number;
  features: Record<string, unknown>;
  sources: Record<string, unknown>;
  dedupeKey: string;
  createdAt: string;
}

export interface AlertCausalDecision {
  verdict: DeskPolicyVerdict;
  intentId?: string;
  reasonCodes: string[];
  actionStatus: AlertActionStatus;
}

export interface AlertCausalAction {
  intentId?: string;
  ticketId?: string;
  status: AlertActionStatus;
  transactionHash?: string;
  keeperHubRunId?: string;
  explorerUrl?: string;
}

export interface AlertCausalProof {
  sourceTransactionHash?: string;
  registryTransactionHash?: string;
  transactionHash?: string;
  contentHash?: string;
  contentUri?: string;
  explorerUrl?: string;
}

export interface AlertCausalChain {
  alertId: string;
  sourceEventId?: string;
  signal?: AlertCausalSignal;
  decision?: AlertCausalDecision;
  action?: AlertCausalAction;
  proof?: AlertCausalProof;
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
  /** Sectioned desk copy when available (also flattened into analysis). */
  sections?: DigestSections;
  publicationStatus: DigestPublicationStatus;
  publishedAt?: string;
  registryTxHash?: string;
  sourceEventRoot?: string;
  /** bytes32 content hash written on-chain (IDEA proof field). */
  contentHash?: string;
  contentUri?: string;
  /** Gas units consumed by the registry write (decimal string). */
  gasUsed?: string;
  /** Total gas cost in wei when reported by KeeperHub. */
  gasUsedWei?: string;
  keeperHubRunId?: string;
  explorerUrl?: string;
  digestKind?: DigestKind;
  chainId?: number;
  publicationChainId?: number;
  sourceAlertIds?: string[];
  sourceSignalIds?: string[];
  sourceIntentIds?: string[];
  sourceTicketIds?: string[];
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
  /** Observation/source chain for the premium intelligence item. */
  sourceChainId?: number;
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

// ── Agent payment discovery (machine-readable) ──────────
/** Audience for a payment rail — human wallet UI vs automated clients. */
export type PaymentRouteAudience = "human" | "machine" | "both" | "dual";

export interface AgentPaymentRouteInfo {
  id: PaymentRoute | "auto" | string;
  label: string;
  audience: PaymentRouteAudience;
  /** Settlement verification mechanism (e.g. eip712, hmac_sha256). */
  verificationType: string;
  currency: string;
  /** Human-readable network / settlement venue. */
  network: string;
  description: string;
}

export interface AgentPaymentEndpoints {
  discovery: string;
  wellKnown: string;
  listPremiumItems: string;
  accessPremiumItem: string;
  createChallenge: string;
  settlePayment: string;
  createSponsoredWatchChallenge: string;
  listSponsoredWatches: string;
  /** Premium desk feed (x402) — optional for agents that trade on desk proofs. */
  deskIntents?: string;
  deskTicket?: string;
  deskStream?: string;
}

/**
 * Desk feed product surface for agents (OpenAPI-style discovery).
 * Routing copy is Sepolia private submission path — not mainnet sandwich claims.
 */
export interface AgentDeskFeedDiscovery {
  productSlug: string;
  priceNote: string;
  executionRouting: string;
  endpoints: {
    intents: string;
    ticket: string;
    stream: string;
  };
}

export interface AgentMppFlowGuide {
  summary: string;
  steps: string[];
  challengeRequest: {
    method: string;
    path: string;
    body: Record<string, unknown>;
  };
  settleRequest: {
    method: string;
    path: string;
    body: Record<string, unknown>;
    settlementReferenceFormat: string;
  };
  accessRequest: {
    method: string;
    path: string;
    headers: Record<string, string>;
  };
  notes: string[];
}

/**
 * Machine-readable payment rail discovery for agents.
 * Served at GET /payments and GET /.well-known/agent-payments.
 */
export interface AgentPaymentsDiscovery {
  version: "1";
  name: string;
  description: string;
  routes: AgentPaymentRouteInfo[];
  endpoints: AgentPaymentEndpoints;
  mpp: AgentMppFlowGuide;
  humanUi: {
    path: string;
    paymentRoute: PaymentRoute;
    note: string;
  };
  /** Premium desk feed catalog + private-routing product note (Phase 4). */
  deskFeed?: AgentDeskFeedDiscovery;
}

// ── Payment Record ──────────────────────────────────────
export interface PaymentRecordResponse {
  id: string;
  premiumItemId: string;
  paymentRoute: PaymentRoute;
  status: PaymentStatus;
  settlementReference?: string;
  amountRequested?: number;
  amountSettled?: number;
  currency?: string;
  /** Affiliate partner wallet when payment intent carried referral metadata. */
  referralAddress?: string;
  requestedAt?: string;
  settledAt?: string;
  /** On-chain publishPremiumReceipt proof (when published after settle). */
  registryTxHash?: string;
  keeperHubRunId?: string;
  explorerUrl?: string;
  contentUri?: string;
}

// ── Public subscription + referral analytics (Activity) ─
export interface PaymentRouteMixEntry {
  route: PaymentRoute | string;
  settledCount: number;
  settledVolume: number;
  /** Share of settled volume in [0, 1]. */
  volumeShare: number;
}

export interface SubscriptionAnalytics {
  /** Monthly recurring revenue from entitled newsletter subscriptions (normalized to 30-day months). */
  mrr: number;
  mrrCurrency: string;
  activeNewsletterSubscriptions: number;
  /** Payment challenges that completed settlement. */
  settledPayments: number;
  /** All payment challenges (any status). */
  totalPaymentAttempts: number;
  /**
   * Settled / total payment attempts. 0 when there are no attempts.
   * Measures paywall conversion, not free email list signup.
   */
  conversionRate: number;
  /** Settled volume by payment rail (x402 / mpp / other). */
  routeMix: PaymentRouteMixEntry[];
  totalSettledVolume: number;
  referredSettledCount: number;
  referredSettledVolume: number;
}

export interface ReferralAttributionPartner {
  referralAddress: string;
  displayName: string | null;
  referralCode: string | null;
  affiliateStatus: string | null;
  settledPaymentCount: number;
  attributedVolume: number;
  currency: string;
  /** Distinct newsletter subscriptions that carried this referral. */
  newsletterSubscriptionCount: number;
}

export interface ReferralAttribution {
  partners: ReferralAttributionPartner[];
  totalReferredVolume: number;
  totalReferredPayments: number;
  currency: string;
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
  blockNumber?: number;
  blockHash?: string;
  logIndex?: number;
  sourceContract?: string;
  normalizedFeatures?: Record<string, unknown>;
  sourceDedupeKey?: string;
}

// ── KeeperHub Digest Trigger ────────────────────────────
export interface KeeperHubDigestTriggerPayload {
  periodStart: string;
  periodEnd: string;
  digestKind?: DigestKind;
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
  /**
   * Optional affiliate / referral partner wallet from intent metadata.
   * Distinct from payerReference — used for capped revenue-routing attribution.
   */
  referralAddress?: string;
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
  /**
   * Soft-fail on-chain publishPremiumReceipt proof. Settlement succeeds even
   * when the registry write fails; check success / errorMessage accordingly.
   */
  premiumReceipt?: {
    attempted: boolean;
    success: boolean;
    registryTxHash?: string;
    keeperHubRunId?: string;
    explorerUrl?: string;
    contentUri?: string;
    errorMessage?: string;
  };
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
    /**
     * Gas runway (ETH). Drives healthy/warning/critical vs safetyBuffer.
     * Kept as availableBalance for backward compatibility with older clients.
     */
    availableBalance: number;
    safetyBuffer: number;
    /** Unit of availableBalance / safetyBuffer — always ETH for gas health. */
    currency: string;
    status: TreasuryStatus;
    /** Live (or snapshot) native gas balance in ETH. */
    ethBalance: number;
    /**
     * Live USDC revenue float on the treasury wallet (human units).
     * Prefer sepoliaUsdcBalance when dual-rail is available; this remains the
     * Sepolia / deployable pocket for backward compatibility.
     */
    usdcBalance?: number;
    /** Public treasury wallet address when known. */
    walletAddress?: string;
    /**
     * Base Sepolia USDC (x402 payment rail). Omitted when dual-rail read fails.
     */
    baseUsdcBalance?: number;
    /**
     * Ethereum Sepolia USDC (desk / ops rail). Mirrors usdcBalance when both present.
     */
    sepoliaUsdcBalance?: number;
    /** Base Sepolia native ETH (gas for CCTP approve/burn). */
    baseEthBalance?: number;
    /** Ethereum Sepolia native ETH (gas for mint / registry). */
    sepoliaEthBalance?: number;
    /** Sum of unfinished CCTP rebalance amounts (USDC). */
    inFlightCctpUsdc?: number;
    /**
     * Sepolia USDC deployable to desk after USDC operating reserve.
     * `max(0, sepoliaUsdc - usdcOperatingReserve)`.
     */
    deployableToDeskUsdc?: number;
    /** USDC operating reserve held on Sepolia (not deployable to desk). */
    usdcOperatingReserve?: number;
    /** Whether automated CCTP rebalance is enabled. */
    cctpEnabled?: boolean;
    /** Human-readable dual-rail capital note (e.g. awaiting CCTP). */
    capitalPlaneNote?: string;
    /** Estimated LLM / synthesis cost from the latest treasury audit (USDC-eq). */
    estimatedGenerationCost?: number | null;
    /** Estimated registry / gas cost from the latest treasury audit (USDC-eq). */
    estimatedTransactionCost?: number | null;
    /** Settled paid request count from the latest snapshot. */
    paidRequestCount?: number | null;
    /** Settled revenue total from the latest snapshot (USDC). */
    revenueTotal?: number | null;
    /** ISO capture time of the latest snapshot. */
    capturedAt?: string;
  };
  /**
   * Recent CCTP rebalance transfers for Activity (Base burn → Sepolia mint).
   * Omitted when the CCTP rail is not configured.
   */
  cctpRebalances?: Array<{
    id: string;
    status: string;
    amountUsdc: number;
    mode: string;
    burnTxHash?: string | null;
    mintTxHash?: string | null;
    burnExplorerUrl?: string | null;
    mintExplorerUrl?: string | null;
    errorMessage?: string | null;
    burnedAt?: string | null;
    mintedAt?: string | null;
    createdAt: string;
    durationMs?: number | null;
  }>;
  executionLogs: Array<Record<string, unknown>>;
  payouts?: Array<Record<string, unknown>>;
  activeSponsoredWatches?: Array<Record<string, unknown>>;
  /** Public subscription economics (MRR, conversion, route mix). */
  subscriptionAnalytics?: SubscriptionAnalytics;
  /** Public referral partner attribution from payment/newsletter intent metadata. */
  referralAttribution?: ReferralAttribution;
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

// ── Recurring x402 Newsletter Subscription ──────────────
export interface NewsletterSubscribeRequest {
  email: string;
  /** EVM wallet that will sign the x402 TransferWithAuthorization. */
  payerReference?: string;
  /**
   * Optional referral partner wallet (must be an approved affiliate in the registry).
   * Prefer resolving via referral code on the site, then pass the wallet here.
   */
  referralAddress?: string;
}

// ── Referral Affiliates ─────────────────────────────────
export interface AffiliateRegisterRequest {
  /** EVM payout wallet for referral rewards. */
  walletAddress: string;
  displayName?: string;
  /** Optional short code for ?ref= links (unique). */
  referralCode?: string;
}

export interface AffiliateResponse {
  id: string;
  walletAddress: string;
  displayName: string | null;
  referralCode: string | null;
  status: "pending" | "approved" | "suspended";
  approvedAt: string | null;
  createdAt: string;
}

export interface NewsletterRenewRequest {
  email?: string;
  payerWallet?: string;
}

export interface NewsletterCancelRequest {
  email?: string;
  payerWallet?: string;
  /** When true (default), access continues until current_period_end. */
  atPeriodEnd?: boolean;
}

export interface NewsletterSettlementRequest {
  challengeReference: string;
  settlementReference: string;
}

export interface NewsletterSubscriptionResponse {
  id: string;
  email: string;
  status: NewsletterSubscriptionStatus;
  amountPerPeriod: number;
  currency: string;
  billingPeriodDays: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextRenewalAt: string | null;
  periodsPaid: number;
  payerWallet: string | null;
  referralAddress: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  lastSettledAt: string | null;
  /** True when the subscriber is entitled to premium digests right now. */
  entitled: boolean;
}

export interface NewsletterChallengeResponse {
  subscriptionId: string;
  email: string;
  status: NewsletterSubscriptionStatus;
  challengeReference: string;
  paymentRoute: "x402";
  amountRequested: number;
  currency: string;
  expiresAt: string;
  challengeData: Record<string, unknown>;
  paymentRecordId: string;
  billingPeriodDays: number;
  agreementType: "recurring_newsletter";
}

export interface NewsletterSettlementResponse {
  settled: boolean;
  subscription: NewsletterSubscriptionResponse;
  paymentRecordId: string;
  verification: {
    amountSettled: number;
    currency: string;
    settlementReference: string;
    payerReference?: string;
  };
}

// ── Response Wrappers ───────────────────────────────────
export interface ItemsResponse<T> {
  items: T[];
}
