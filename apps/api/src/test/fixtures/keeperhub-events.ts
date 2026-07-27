// KeeperHub event test fixtures

import type { EventIngestionPayload } from "@chronicleai/schemas";

export function createQualifyingEvent(
  overrides?: Partial<EventIngestionPayload>,
): EventIngestionPayload {
  return {
    sourceEventId: `test-qualifying-${Date.now()}`,
    eventType: "large_swap",
    chainId: 1,
    protocol: "Uniswap",
    assetSymbols: ["ETH", "USDC"],
    magnitude: { value: 2_500_000, unit: "USD" },
    transactionHash: "0xabc123def456",
    capturedAt: new Date().toISOString(),
    rawPayload: { block: 12345678, tx: "0xabc123def456" },
    ...overrides,
  };
}

export function createIgnoredEvent(
  overrides?: Partial<EventIngestionPayload>,
): EventIngestionPayload {
  return {
    sourceEventId: `test-ignored-${Date.now()}`,
    eventType: "large_swap",
    chainId: 1,
    protocol: "Uniswap",
    assetSymbols: ["ETH", "USDC"],
    magnitude: { value: 100, unit: "USD" }, // Below threshold
    transactionHash: "0xignored123",
    capturedAt: new Date().toISOString(),
    rawPayload: { block: 12345678, tx: "0xignored123" },
    ...overrides,
  };
}

export function createMalformedEvent(): Record<string, unknown> {
  return {
    // Missing required fields: sourceEventId, eventType, chainId, capturedAt
    protocol: "Uniswap",
    magnitude: { value: 100, unit: "USD" },
  };
}

export function createUnsignedEvent(): EventIngestionPayload {
  return createQualifyingEvent({ sourceEventId: `test-unsigned-${Date.now()}` });
}

export function createDuplicateEvent(baseEvent: EventIngestionPayload): EventIngestionPayload {
  return {
    ...baseEvent,
    sourceEventId: baseEvent.sourceEventId, // Same sourceEventId
    rawPayload: { ...baseEvent.rawPayload, duplicate: true },
  };
}

export function createGeminiFailureEvent(
  overrides?: Partial<EventIngestionPayload>,
): EventIngestionPayload {
  return createQualifyingEvent({
    sourceEventId: `test-gemini-fail-${Date.now()}`,
    eventType: "liquidation",
    magnitude: { value: 1_200_000, unit: "USD" },
    ...overrides,
  });
}

export function createOpenAIFailureEvent(
  overrides?: Partial<EventIngestionPayload>,
): EventIngestionPayload {
  return createQualifyingEvent({
    sourceEventId: `test-openai-fail-${Date.now()}`,
    eventType: "gas_spike",
    magnitude: { value: 850, unit: "gwei" },
    ...overrides,
  });
}

export function createGroqFailureEvent(
  overrides?: Partial<EventIngestionPayload>,
): EventIngestionPayload {
  return createQualifyingEvent({
    sourceEventId: `test-groq-fail-${Date.now()}`,
    eventType: "contract_deployment",
    ...overrides,
  });
}

export function createAllProvidersFailedEvent(
  overrides?: Partial<EventIngestionPayload>,
): EventIngestionPayload {
  return createQualifyingEvent({
    sourceEventId: `test-all-fail-${Date.now()}`,
    eventType: "volume_anomaly",
    magnitude: { value: 3.2, unit: "z_score" },
    ...overrides,
  });
}

/** Raw Event Tracker Swap fixture (server-side normalization path). */
export function createRawUniswapSwapEvent(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    chainId: 1,
    eventName: "Swap",
    address: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
    transactionHash: `0xrawswap${Date.now().toString(16)}`,
    logIndex: 0,
    args: {
      amount0: { value: String(2_500_000n * 1_000_000n), type: "int256" },
      amount1: { value: String(-(10n ** 18n)), type: "int256" },
    },
    protocol: "Uniswap V3",
    ...overrides,
  };
}
