// Fetch real block data via JSON-RPC and produce Chronicle-ready events

import { BLOCK_MONITORING } from "@chronicleai/config";
import type { BlockIngestionPayload, EventIngestionPayload } from "@chronicleai/schemas";
import {
  type Hash,
  type PublicClient,
  createPublicClient,
  http,
} from "viem";
import { chainFromId } from "../lib/viem-chain.ts";
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

  // Chain is resolved per payload.chainId so multi-chain ingest can share the helper.
  function clientFor(chainId: number) {
    return createPublicClient({
      chain: chainFromId(chainId),
      transport: http(rpcUrl),
    });
  }

  return {
    async analyzeBlock(payload: BlockIngestionPayload): Promise<BlockAnalysisResult> {
      const client = clientFor(payload.chainId);
      const block = await client.getBlock({
        blockNumber: BigInt(payload.blockNumber),
      });
      if (!block) {
        throw new Error(`Block ${payload.blockNumber} not found on RPC`);
      }

      const createdContracts = await scanDeployments(
        client,
        block.transactions as Hash[],
        BLOCK_MONITORING.deploymentScanLimit,
      );

      const stats: BlockStats = {
        chainId: payload.chainId,
        blockNumber: Number(block.number),
        blockHash: block.hash ?? payload.blockHash ?? "",
        timestamp: Number(block.timestamp),
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
  client: PublicClient,
  transactions: readonly Hash[],
  limit: number,
): Promise<string[]> {
  if (limit <= 0 || transactions.length === 0) return [];

  const created: string[] = [];
  const toScan = transactions.slice(0, limit);

  // Concurrent receipt fetches with a modest cap
  const results = await Promise.allSettled(
    toScan.map(async (txHash) => {
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      return receipt.contractAddress ?? null;
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
