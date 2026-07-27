// Fetch real block data via JSON-RPC and produce Chronicle-ready events

import { BLOCK_MONITORING } from "@chronicleai/config";
import type { BlockIngestionPayload, EventIngestionPayload } from "@chronicleai/schemas";
import { ethers } from "ethers";
import {
  analyzeBlockStats,
  type BlockAnalysisResult,
  type BlockStats,
  TransactionVolumeWindow,
  weiToGwei,
} from "./block-analyzer.ts";

export interface OnChainBlockService {
  analyzeBlock(payload: BlockIngestionPayload): Promise<BlockAnalysisResult>;
}

export function createOnChainBlockService(
  rpcUrl: string | undefined,
  volumeWindow = new TransactionVolumeWindow(),
): OnChainBlockService {
  if (!rpcUrl) {
    return {
      async analyzeBlock() {
        throw new Error(
          "RPC_URL is not configured — block analysis requires a live JSON-RPC endpoint",
        );
      },
    };
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  return {
    async analyzeBlock(payload: BlockIngestionPayload): Promise<BlockAnalysisResult> {
      const block = await provider.getBlock(payload.blockNumber, false);
      if (!block) {
        throw new Error(`Block ${payload.blockNumber} not found on RPC`);
      }

      const createdContracts = await scanDeployments(
        provider,
        block,
        BLOCK_MONITORING.deploymentScanLimit,
      );

      const stats: BlockStats = {
        chainId: payload.chainId,
        blockNumber: block.number,
        blockHash: block.hash ?? payload.blockHash ?? "",
        timestamp: block.timestamp,
        baseFeeGwei: weiToGwei(block.baseFeePerGas ?? null),
        transactionCount: block.transactions.length,
        createdContracts,
      };

      return analyzeBlockStats(stats, volumeWindow, {
        sourceEventIdPrefix: payload.sourceEventId ?? "block",
        capturedAt: payload.capturedAt ?? new Date().toISOString(),
      });
    },
  };
}

async function scanDeployments(
  provider: ethers.JsonRpcProvider,
  block: ethers.Block,
  limit: number,
): Promise<string[]> {
  if (limit <= 0 || block.transactions.length === 0) return [];

  const created: string[] = [];
  const toScan = block.transactions.slice(0, limit);

  // Concurrent receipt fetches with a modest cap
  const results = await Promise.allSettled(
    toScan.map(async (txHash) => {
      const receipt = await provider.getTransactionReceipt(txHash);
      return receipt?.contractAddress ?? null;
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      created.push(result.value);
    }
  }

  return created;
}

/** Pure helper for tests that already have BlockStats. */
export function eventsFromBlockStats(
  stats: BlockStats,
  volumeWindow: TransactionVolumeWindow,
): EventIngestionPayload[] {
  return analyzeBlockStats(stats, volumeWindow).events;
}
