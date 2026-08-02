// Fetch real block data via JSON-RPC and produce Chronicle-ready events.
// RPC is resolved per payload.chainId so mainnet gas monitors never hit desk Sepolia.

import {
  BLOCK_MONITORING,
  CHAIN_ID_BASE,
  CHAIN_ID_BASE_SEPOLIA,
  CHAIN_ID_ETHEREUM,
  CHAIN_ID_SEPOLIA,
  chainLabel,
} from "@chronicleai/config";
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

/**
 * Per-chain JSON-RPC endpoints for block analysis.
 * Keys are EVM chain IDs. Values are HTTP RPC URLs (trimmed non-empty).
 */
export type BlockRpcUrlsByChainId = Partial<Record<number, string | undefined>>;

export interface OnChainBlockServiceOptions {
  /**
   * Explicit RPC URL per chainId. Preferred over a single shared URL so
   * newspaper mainnet monitors (chain 1) never query desk Sepolia RPC_URL.
   */
  rpcUrlsByChainId?: BlockRpcUrlsByChainId;
  /**
   * Legacy single-URL mode: used only when `rpcUrlsByChainId` is empty/undefined.
   * Prefer the multi-chain map in production.
   */
  rpcUrl?: string | undefined;
}

/** Env var name operators should set for a given chainId (for error messages). */
export function rpcEnvHintForChain(chainId: number): string {
  switch (chainId) {
    case CHAIN_ID_ETHEREUM:
      return "MAINNET_RPC_URL";
    case CHAIN_ID_SEPOLIA:
      return "RPC_URL";
    case CHAIN_ID_BASE_SEPOLIA:
      return "X402_RPC_URL (or BASE_SEPOLIA_RPC_URL)";
    case CHAIN_ID_BASE:
      return "BASE_RPC_URL";
    default:
      return `RPC URL for chain ${chainId}`;
  }
}

/**
 * Resolve the HTTP RPC URL for a block-analysis chainId.
 * Empty / whitespace values are treated as unset.
 */
export function resolveBlockRpcUrl(
  chainId: number,
  options: OnChainBlockServiceOptions,
): string | undefined {
  const fromMap = options.rpcUrlsByChainId?.[chainId]?.trim();
  if (fromMap) return fromMap;

  const hasAnyMapped = Object.values(options.rpcUrlsByChainId ?? {}).some(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
  // Multi-chain mode is active: do not fall back to a foreign-chain default URL.
  // That was the bug — mainnet block 25_650_600 queried against Sepolia RPC_URL.
  if (hasAnyMapped) return undefined;

  const legacy = options.rpcUrl?.trim();
  return legacy || undefined;
}

/**
 * Build the production RPC map from ServerEnv-shaped fields.
 * Keeps route wiring free of chain-id literals.
 */
export function blockRpcUrlsFromEnv(env: {
  rpcUrl?: string | undefined;
  mainnetRpcUrl?: string | undefined;
  x402RpcUrl?: string | undefined;
  baseRpcUrl?: string | undefined;
}): BlockRpcUrlsByChainId {
  return {
    [CHAIN_ID_ETHEREUM]: env.mainnetRpcUrl,
    [CHAIN_ID_SEPOLIA]: env.rpcUrl,
    [CHAIN_ID_BASE_SEPOLIA]: env.x402RpcUrl,
    [CHAIN_ID_BASE]: env.baseRpcUrl,
  };
}

export function createOnChainBlockService(
  rpcConfig: string | OnChainBlockServiceOptions | undefined,
  volumeWindow = new TransactionVolumeWindow(),
): OnChainBlockService {
  const options: OnChainBlockServiceOptions =
    typeof rpcConfig === "string" || rpcConfig === undefined
      ? { rpcUrl: rpcConfig }
      : rpcConfig;

  const anyRpcConfigured =
    Boolean(options.rpcUrl?.trim()) ||
    Object.values(options.rpcUrlsByChainId ?? {}).some(
      (v) => typeof v === "string" && v.trim().length > 0,
    );

  if (!anyRpcConfigured) {
    return {
      async analyzeBlock(payload) {
        throw new Error(
          `RPC_URL is not configured for chain ${payload.chainId} (${chainLabel(payload.chainId)}). ` +
            `Set ${rpcEnvHintForChain(payload.chainId)} so block analysis can use a live JSON-RPC endpoint.`,
        );
      },
    };
  }

  function clientFor(chainId: number, rpcUrl: string) {
    return createPublicClient({
      chain: chainFromId(chainId),
      transport: http(rpcUrl),
    });
  }

  return {
    async analyzeBlock(payload: BlockIngestionPayload): Promise<BlockAnalysisResult> {
      const rpcUrl = resolveBlockRpcUrl(payload.chainId, options);
      if (!rpcUrl) {
        const label = chainLabel(payload.chainId);
        const hint = rpcEnvHintForChain(payload.chainId);
        throw new Error(
          `RPC_URL is not configured for chain ${payload.chainId} (${label}). ` +
            `Set ${hint} so block ${payload.blockNumber} is fetched on the correct network.`,
        );
      }

      const client = clientFor(payload.chainId, rpcUrl);
      let block: Awaited<ReturnType<PublicClient["getBlock"]>>;
      try {
        block = await client.getBlock({
          blockNumber: BigInt(payload.blockNumber),
        });
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        // Surface chain + RPC mismatch clearly (viem: Block at number "N" could not be found).
        if (/could not be found/i.test(raw) || /Block at number/i.test(raw)) {
          throw new Error(
            `Block ${payload.blockNumber} not found on chain ${payload.chainId} (${chainLabel(payload.chainId)}). ` +
              `Confirm the workflow chainId matches the RPC (${rpcEnvHintForChain(payload.chainId)}). ` +
              `Underlying: ${raw}`,
          );
        }
        throw error instanceof Error
          ? error
          : new Error(`Block fetch failed: ${raw}`);
      }

      if (!block) {
        throw new Error(
          `Block ${payload.blockNumber} not found on chain ${payload.chainId} (${chainLabel(payload.chainId)})`,
        );
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
