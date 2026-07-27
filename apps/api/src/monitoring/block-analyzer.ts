// Analyze block headers for gas spikes and transaction-volume anomalies

import { BLOCK_MONITORING, EVENT_THRESHOLDS } from "@chronicleai/config";
import type { EventIngestionPayload } from "@chronicleai/schemas";

export interface BlockStats {
  chainId: number;
  blockNumber: number;
  blockHash: string;
  timestamp: number;
  /** Base fee in gwei (EIP-1559). Null on pre-London / non-EIP1559 chains. */
  baseFeeGwei: number | null;
  transactionCount: number;
  /** Contract addresses created in scanned receipts (if enabled). */
  createdContracts: string[];
}

export interface BlockAnalysisResult {
  events: EventIngestionPayload[];
  stats: BlockStats;
  volumeZScore: number | null;
}

/**
 * Per-process rolling window of transaction counts, keyed by chainId.
 * Sufficient for single-instance API deploys; multi-instance should move
 * this window to Redis/Postgres if horizontal scale is required.
 */
export class TransactionVolumeWindow {
  private readonly windows = new Map<number, number[]>();
  private readonly maxSize: number;

  constructor(maxSize = BLOCK_MONITORING.volumeWindowSize) {
    this.maxSize = maxSize;
  }

  push(chainId: number, txCount: number): number | null {
    let series = this.windows.get(chainId);
    if (!series) {
      series = [];
      this.windows.set(chainId, series);
    }
    series.push(txCount);
    if (series.length > this.maxSize) {
      series.shift();
    }
    if (series.length < BLOCK_MONITORING.volumeMinSamples) {
      return null;
    }
    return computeZScore(series, txCount);
  }

  /** Test helper */
  reset(): void {
    this.windows.clear();
  }
}

export function computeZScore(samples: number[], value: number): number | null {
  if (samples.length < 2) return null;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance =
    samples.reduce((acc, n) => acc + (n - mean) ** 2, 0) / (samples.length - 1);
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return 0;
  return (value - mean) / stddev;
}

export function weiToGwei(wei: bigint | null | undefined): number | null {
  if (wei === null || wei === undefined) return null;
  // 1 gwei = 1e9 wei
  return Number(wei) / 1e9;
}

export function analyzeBlockStats(
  stats: BlockStats,
  volumeWindow: TransactionVolumeWindow,
  options?: { sourceEventIdPrefix?: string; capturedAt?: string },
): BlockAnalysisResult {
  const capturedAt = options?.capturedAt ?? new Date().toISOString();
  const prefix = options?.sourceEventIdPrefix ?? "block";
  const events: EventIngestionPayload[] = [];

  const zScore = volumeWindow.push(stats.chainId, stats.transactionCount);

  if (stats.baseFeeGwei !== null) {
    const gasThreshold = EVENT_THRESHOLDS.gas_spike.minMagnitude;
    if (stats.baseFeeGwei >= gasThreshold) {
      events.push({
        sourceEventId: `${prefix}-${stats.chainId}-${stats.blockNumber}-gas_spike`,
        eventType: "gas_spike",
        chainId: stats.chainId,
        magnitude: { value: stats.baseFeeGwei, unit: "gwei" },
        capturedAt,
        rawPayload: {
          blockNumber: stats.blockNumber,
          blockHash: stats.blockHash,
          baseFeeGwei: stats.baseFeeGwei,
          transactionCount: stats.transactionCount,
          timestamp: stats.timestamp,
        },
      });
    }
  }

  if (zScore !== null) {
    const volThreshold = EVENT_THRESHOLDS.volume_anomaly.minMagnitude;
    if (Math.abs(zScore) >= volThreshold) {
      events.push({
        sourceEventId: `${prefix}-${stats.chainId}-${stats.blockNumber}-volume_anomaly`,
        eventType: "volume_anomaly",
        chainId: stats.chainId,
        magnitude: { value: Math.abs(zScore), unit: "z_score" },
        capturedAt,
        rawPayload: {
          blockNumber: stats.blockNumber,
          blockHash: stats.blockHash,
          transactionCount: stats.transactionCount,
          zScore,
          timestamp: stats.timestamp,
        },
      });
    }
  }

  for (const address of stats.createdContracts) {
    events.push({
      sourceEventId: `${prefix}-${stats.chainId}-${stats.blockNumber}-deploy-${address.toLowerCase()}`,
      eventType: "contract_deployment",
      chainId: stats.chainId,
      assetSymbols: [address],
      magnitude: { value: 0, unit: "any" },
      capturedAt,
      rawPayload: {
        blockNumber: stats.blockNumber,
        blockHash: stats.blockHash,
        createdContract: address,
        timestamp: stats.timestamp,
      },
    });
  }

  return { events, stats, volumeZScore: zScore };
}
