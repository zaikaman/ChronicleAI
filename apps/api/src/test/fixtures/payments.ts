// Payment test fixtures for premium items and payment records

import type { PremiumIntelligenceItemRow, PaymentRecordRow } from "@chronicleai/db";

// ── Premium Item Fixtures ──────────────────────────────────

export const MOCK_PREMIUM_DEEP_DIVE: PremiumIntelligenceItemRow = {
  id: "premium-deep-dive-001",
  slug: "deep-dive-001",
  title: "Deep Dive: DeFi Liquidation Cascade Analysis",
  content_type: "deep_dive",
  summary_public: "In-depth analysis of recent liquidation cascades across major DeFi protocols.",
  content_private: {
    sections: [
      {
        title: "Executive Summary",
        body: "Analysis of 12 liquidation events across Aave, Compound, and Morpho Blue totaling $47.2M in forced liquidations.",
      },
      {
        title: "Key Findings",
        findings: [
          "3 cascading liquidations on Aave v3 due to ETH price drop",
          "Compound saw 7 isolated liquidations with no cascade",
          "Morpho Blue recorded 2 partial liquidations with healthy collateral recovery",
        ],
      },
    ],
    analysis:
      "The liquidation patterns suggest improved cross-protocol risk isolation compared to the 2022 cascade events.",
  },
  source_event_ids: ["event-liq-001", "event-liq-002", "event-liq-003"],
  price_amount: 5,
  price_currency: "USDC",
  payment_routes: ["x402", "mpp"],
  status: "available",
  created_at: "2026-07-06T00:00:00.000Z",
  updated_at: "2026-07-06T00:00:00.000Z",
};

export const MOCK_PREMIUM_SPONSORED_MONITOR: PremiumIntelligenceItemRow = {
  id: "premium-sponsored-001",
  slug: "sponsored-monitor-001",
  title: "Sponsored: DEX Liquidity Pool Monitoring",
  content_type: "sponsored_monitor",
  summary_public: "Sponsor a 7-day monitoring campaign for a specific DEX liquidity pool.",
  content_private: {
    campaign: {
      description: "Real-time monitoring of pool imbalance, large swaps, and impermanent loss alerts",
      deliverables: ["Daily imbalance reports", "Swap anomaly alerts", "Final campaign summary"],
    },
  },
  source_event_ids: [],
  price_amount: 100,
  price_currency: "USDC",
  payment_routes: ["x402", "mpp"],
  status: "available",
  created_at: "2026-07-06T00:00:00.000Z",
  updated_at: "2026-07-06T00:00:00.000Z",
};

export const MOCK_PREMIUM_HISTORICAL_FEED: PremiumIntelligenceItemRow = {
  id: "premium-historical-001",
  slug: "historical-feed-001",
  title: "Historical Feed: Q2 2026 Protocol Activity",
  content_type: "historical_feed",
  summary_public: "Structured feed of Q2 2026 on-chain activity for major protocols.",
  content_private: {
    feedEntries: [
      { timestamp: "2026-04-01T00:00:00Z", protocol: "Aave", events: 45, volumeUsd: 12000000 },
      { timestamp: "2026-04-02T00:00:00Z", protocol: "Uniswap", events: 89, volumeUsd: 34000000 },
    ],
  },
  source_event_ids: [],
  price_amount: 10,
  price_currency: "USDC",
  payment_routes: ["x402", "mpp"],
  status: "available",
  created_at: "2026-07-06T00:00:00.000Z",
  updated_at: "2026-07-06T00:00:00.000Z",
};

export const MOCK_PREMIUM_ARCHIVED: PremiumIntelligenceItemRow = {
  ...MOCK_PREMIUM_DEEP_DIVE,
  id: "premium-archived-001",
  slug: "archived-item-001",
  status: "archived",
};

// ── Payment Record Fixtures ────────────────────────────────

export const MOCK_PAYMENT_CHALLENGE_ISSUED: PaymentRecordRow = {
  id: "payment-challenge-001",
  premium_item_id: "premium-deep-dive-001",
  payment_route: "x402",
  payer_reference: null,
  amount_requested: 5,
  amount_settled: null,
  currency: "USDC",
  status: "challenge_issued",
  challenge_reference: "x402_challenge_001",
  settlement_reference: null,
  requested_at: new Date().toISOString(),
  settled_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export const MOCK_PAYMENT_SETTLED: PaymentRecordRow = {
  id: "payment-settled-001",
  premium_item_id: "premium-deep-dive-001",
  payment_route: "x402",
  payer_reference: "0xpayerwallet000000000000000000000000000001",
  amount_requested: 5,
  amount_settled: 5,
  currency: "USDC",
  status: "settled",
  challenge_reference: "x402_challenge_settled_001",
  settlement_reference: "0xsettlementtx00000000000000000000000000000000001",
  requested_at: new Date(Date.now() - 60000).toISOString(),
  settled_at: new Date().toISOString(),
  created_at: new Date(Date.now() - 60000).toISOString(),
  updated_at: new Date().toISOString(),
};

export const MOCK_PAYMENT_UNDERPAID: PaymentRecordRow = {
  id: "payment-underpaid-001",
  premium_item_id: "premium-deep-dive-001",
  payment_route: "mpp",
  payer_reference: "mpp-client-underpaid",
  amount_requested: 5,
  amount_settled: 2,
  currency: "USDC",
  status: "underpaid",
  challenge_reference: "mpp_challenge_underpaid_001",
  settlement_reference: "mpp:underpaid_hmac_signature",
  requested_at: new Date(Date.now() - 120000).toISOString(),
  settled_at: null,
  created_at: new Date(Date.now() - 120000).toISOString(),
  updated_at: new Date().toISOString(),
};

export const MOCK_PAYMENT_EXPIRED: PaymentRecordRow = {
  id: "payment-expired-001",
  premium_item_id: "premium-deep-dive-001",
  payment_route: "x402",
  payer_reference: null,
  amount_requested: 5,
  amount_settled: null,
  currency: "USDC",
  status: "expired",
  challenge_reference: "x402_expired_challenge_001",
  settlement_reference: null,
  requested_at: new Date(Date.now() - 7200000).toISOString(),
  settled_at: null,
  created_at: new Date(Date.now() - 7200000).toISOString(),
  updated_at: new Date().toISOString(),
};

export const MOCK_PAYMENT_FAILED: PaymentRecordRow = {
  id: "payment-failed-001",
  premium_item_id: "premium-deep-dive-001",
  payment_route: "x402",
  payer_reference: null,
  amount_requested: 5,
  amount_settled: null,
  currency: "USDC",
  status: "failed",
  challenge_reference: "x402_failed_challenge_001",
  settlement_reference: null,
  requested_at: new Date(Date.now() - 3600000).toISOString(),
  settled_at: null,
  created_at: new Date(Date.now() - 3600000).toISOString(),
  updated_at: new Date().toISOString(),
};
