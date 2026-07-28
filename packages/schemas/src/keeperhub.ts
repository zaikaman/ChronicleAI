// KeeperHub webhook payload schemas
import type { EventType, FlowContext } from "./domain.ts";

// ── Webhook Auth Metadata ───────────────────────────────
export interface WebhookAuthMetadata {
  signature: string;
  verified: boolean;
  timestamp?: string;
}

// ── Event Ingestion Payload ─────────────────────────────
export interface EventIngestionPayload {
  sourceEventId: string;
  eventType: EventType;
  chainId: number;
  protocol?: string;
  transactionHash?: string;
  assetSymbols?: string[];
  magnitude?: {
    value: number;
    unit: string;
  };
  capturedAt: string;
  rawPayload: Record<string, unknown>;
  /** Deterministic flow enrichment; also mirrored into rawPayload.flowContext. */
  flowContext?: FlowContext;
}

/**
 * Raw Event Tracker payload (or workflow template expansion of it).
 * Chronicle normalizes this into EventIngestionPayload when eventType is absent.
 */
export interface RawOnChainEventPayload {
  sourceEventId?: string;
  chainId: number;
  eventName: string;
  address?: string;
  transactionHash?: string;
  blockNumber?: number | string;
  blockHash?: string;
  logIndex?: number | string;
  capturedAt?: string;
  /** KeeperHub serialized args: either flat values or { value, type } wrappers. */
  args?: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
  protocol?: string;
  /** Optional already-known magnitude override from an upstream workflow step. */
  magnitude?: { value: number; unit: string };
}

/**
 * Block Dispatcher → Chronicle payload.
 * Workflows fire this on blockInterval; Chronicle fetches the block via RPC
 * and may emit gas_spike / volume_anomaly / contract_deployment events.
 */
export interface BlockIngestionPayload {
  sourceEventId?: string;
  chainId: number;
  blockNumber: number;
  blockHash?: string;
  timestamp?: number | string;
  capturedAt?: string;
  rawPayload?: Record<string, unknown>;
}

// ── Digest Run Payload ──────────────────────────────────
export interface DigestRunPayload {
  periodStart: string;
  periodEnd: string;
}

// ── Treasury Check Payload ──────────────────────────────
export interface TreasuryCheckPayload {
  capturedAt: string;
  availableBalance: number;
  currency: string;
  safetyBuffer: number;
}

// ── Revenue Routing Payload ─────────────────────────────
export interface RevenueRoutingPayload {
  periodHash: string;
  force?: boolean;
}
