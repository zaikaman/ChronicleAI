// Agent activity test fixtures
// Treasury, payout, and sponsored watch fixtures

import type { RevenuePayoutRow, SponsoredWatchRow, TreasurySnapshotRow } from "@chronicleai/db";

// ── Treasury Snapshot Fixtures ────────────────────────────

export function createHealthyTreasurySnapshot(
  overrides?: Partial<TreasurySnapshotRow>,
): TreasurySnapshotRow {
  return {
    id: `treasury-healthy-${Date.now()}`,
    available_balance: 50_000,
    currency: "USDC",
    safety_buffer: 10_000,
    revenue_total: 25_000,
    estimated_generation_cost: 5_000,
    estimated_transaction_cost: 1_000,
    paid_request_count: 150,
    status: "healthy",
    last_routed_at: null,
    last_payout_period_hash: null,
    total_routed_amount: null,
    captured_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createWarningTreasurySnapshot(
  overrides?: Partial<TreasurySnapshotRow>,
): TreasurySnapshotRow {
  return {
    id: `treasury-warning-${Date.now()}`,
    available_balance: 8_000,
    currency: "USDC",
    safety_buffer: 10_000,
    revenue_total: 12_000,
    estimated_generation_cost: 6_000,
    estimated_transaction_cost: 2_000,
    paid_request_count: 80,
    status: "warning",
    last_routed_at: null,
    last_payout_period_hash: null,
    total_routed_amount: null,
    captured_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createCriticalTreasurySnapshot(
  overrides?: Partial<TreasurySnapshotRow>,
): TreasurySnapshotRow {
  return {
    id: `treasury-critical-${Date.now()}`,
    available_balance: 2_000,
    currency: "USDC",
    safety_buffer: 10_000,
    revenue_total: 5_000,
    estimated_generation_cost: 8_000,
    estimated_transaction_cost: 3_000,
    paid_request_count: 30,
    status: "critical",
    last_routed_at: null,
    last_payout_period_hash: null,
    total_routed_amount: null,
    captured_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── Payout Record Fixtures ───────────────────────────────

export function createPendingPayout(overrides?: Partial<RevenuePayoutRow>): RevenuePayoutRow {
  return {
    id: `payout-pending-${Date.now()}`,
    payout_period_hash: `period_${Date.now()}`,
    recipient: "0xcreatorrecovery00000000000000000000000000001",
    amount: 5_000,
    reason_hash: "0xreasonhash00000000000000000000000000000000000000001",
    payout_tx_hash: null,
    registry_tx_hash: null,
    keeper_hub_run_id: null,
    explorer_url: null,
    transfer_keeper_hub_run_id: null,
    transfer_explorer_url: null,
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createTransferredPayout(overrides?: Partial<RevenuePayoutRow>): RevenuePayoutRow {
  return {
    id: `payout-transferred-${Date.now()}`,
    payout_period_hash: `period_${Date.now() - 86400000}`,
    recipient: "0xcreatorrecovery00000000000000000000000000001",
    amount: 3_500,
    reason_hash: "0xreasonhash00000000000000000000000000000000000000002",
    payout_tx_hash: "0x" + "a".repeat(64),
    registry_tx_hash: "0x" + "b".repeat(64),
    keeper_hub_run_id: "exec_payout_1",
    explorer_url: "https://sepolia.etherscan.io/tx/0x" + "b".repeat(64),
    transfer_keeper_hub_run_id: "exec_xfer_1",
    transfer_explorer_url: "https://sepolia.etherscan.io/tx/0x" + "a".repeat(64),
    status: "transferred",
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createFailedPayout(overrides?: Partial<RevenuePayoutRow>): RevenuePayoutRow {
  return {
    id: `payout-failed-${Date.now()}`,
    payout_period_hash: `period_${Date.now() - 172800000}`,
    recipient: "0xcreatorrecovery00000000000000000000000000001",
    amount: 2_000,
    reason_hash: "0xreasonhash00000000000000000000000000000000000000003",
    payout_tx_hash: null,
    registry_tx_hash: null,
    keeper_hub_run_id: null,
    explorer_url: null,
    transfer_keeper_hub_run_id: null,
    transfer_explorer_url: null,
    status: "failed",
    created_at: new Date(Date.now() - 172800000).toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── Sponsored Watch Fixtures ─────────────────────────────

export function createActiveSponsoredWatch(
  overrides?: Partial<SponsoredWatchRow>,
): SponsoredWatchRow {
  return {
    id: `watch-active-${Date.now()}`,
    target_contract: "0x1234567890abcdef1234567890abcdef12345678",
    watch_spec_hash: "0x" + "c".repeat(64),
    starts_at: new Date(Date.now() - 86400000).toISOString(),
    ends_at: new Date(Date.now() + 6 * 86400000).toISOString(),
    create_tx_hash: "0x" + "d".repeat(64),
    report_tx_hash: null,
    report_content_hash: null,
    content_uri: null,
    create_keeper_hub_run_id: "exec_watch_create",
    create_explorer_url: "https://sepolia.etherscan.io/tx/0x" + "d".repeat(64),
    report_keeper_hub_run_id: null,
    report_explorer_url: null,
    on_chain_watch_id: 1,
    source_event_ids: [],
    source_event_root: null,
    report_title: null,
    report_summary: null,
    report_highlights: [],
    report_analysis: null,
    last_monitored_at: new Date().toISOString(),
    monitored_event_count: 0,
    status: "monitoring",
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createCompletedSponsoredWatch(
  overrides?: Partial<SponsoredWatchRow>,
): SponsoredWatchRow {
  return {
    id: `watch-completed-${Date.now()}`,
    target_contract: "0xabcdef1234567890abcdef1234567890abcdef12",
    watch_spec_hash: "0x" + "e".repeat(64),
    starts_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    ends_at: new Date(Date.now() - 86400000).toISOString(),
    create_tx_hash: "0x" + "f".repeat(64),
    report_tx_hash: "0x" + "a1".repeat(32),
    report_content_hash: "0x" + "b2".repeat(32),
    content_uri: "https://chronicleai.app/reports/watch-completed-001",
    create_keeper_hub_run_id: "exec_watch_create_done",
    create_explorer_url: "https://sepolia.etherscan.io/tx/0x" + "f".repeat(64),
    report_keeper_hub_run_id: "exec_watch_report",
    report_explorer_url: "https://sepolia.etherscan.io/tx/0x" + "a1".repeat(32),
    on_chain_watch_id: 2,
    source_event_ids: ["event-001"],
    source_event_root: "0x" + "c3".repeat(32),
    report_title: "Sponsored Watch Report",
    report_summary: "Campaign complete",
    report_highlights: ["1. sample event"],
    report_analysis: "Analysis body",
    last_monitored_at: new Date(Date.now() - 86400000).toISOString(),
    monitored_event_count: 1,
    status: "completed",
    created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}
