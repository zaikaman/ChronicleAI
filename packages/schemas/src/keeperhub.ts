// KeeperHub webhook payload schemas
import type { EventType } from "./domain.ts";

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
