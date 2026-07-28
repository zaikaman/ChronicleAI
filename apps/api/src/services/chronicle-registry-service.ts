// Chronicle Registry publish service
// Handles on-chain registry writes for alerts, digests, payouts, trade tickets,
// premium receipts, and capital moves via KeeperHub (production) or gated direct
// ethers (local tests only).
//
// IDEA / Desk signatures:
//   publishAlert(contentHash, sourceEventHash, contentUri)
//   publishDigest(contentHash, sourceEventRoot, contentUri)
//   publishPremiumReceipt(contentHash, sourceEventHash, contentUri)
//   recordPayout(...)
//   publishTradeTicket(ticketHash, signalHash, intentHash, contentUri)
//   recordCapitalMove(moveId, from, to, amountUsdc, reasonHash)

import type { OnChainWriteReceipt } from "./on-chain-write-receipt.ts";
import { toBytes32Hash } from "./keeperhub-write-client.ts";
import type { Web3Client } from "./web3-client-service.ts";

export interface RegistryPublishResult {
  success: boolean;
  errorMessage?: string;
  /** Present only on successful writes. */
  txHash?: string;
  keeperHubRunId?: string;
  explorerUrl?: string;
  /** HTTPS content URI written on-chain (when applicable). */
  contentUri?: string;
  /** Gas units consumed by the registry write (decimal string). */
  gasUsed?: string;
  /** Total gas cost in wei when reported (decimal string). */
  gasUsedWei?: string;
  /** Normalized bytes32 content hash that was written on-chain. */
  contentHash?: string;
}

export interface ChronicleRegistryService {
  /**
   * Publish an alert on-chain with source-event hash and resolvable HTTPS content URI.
   * Maps to IDEA `publishAlert(contentHash, sourceEventHash, contentUri)`.
   */
  publishAlert(
    contentHash: string,
    sourceEventHash: string,
    contentUri: string,
  ): Promise<RegistryPublishResult>;

  /**
   * Publish a digest on-chain with source-event root and resolvable HTTPS content URI.
   * Maps to IDEA `publishDigest(contentHash, sourceEventRoot, contentUri)`.
   */
  publishDigest(
    contentHash: string,
    sourceEventRoot: string,
    contentUri: string,
  ): Promise<RegistryPublishResult>;

  /** Record a payout on-chain. Returns the transaction hash + KeeperHub run metadata. */
  recordPayout(
    payoutPeriodHash: string,
    recipient: string,
    amount: number,
    transferTxHash: string,
  ): Promise<RegistryPublishResult>;

  /**
   * Publish a desk trade ticket on-chain.
   * Maps to `publishTradeTicket(ticketHash, signalHash, intentHash, contentUri)`.
   * contentUri should resolve to `/desk/tickets/:id` on the Chronicle frontend.
   */
  publishTradeTicket(
    ticketHash: string,
    signalHash: string,
    intentHash: string,
    contentUri: string,
  ): Promise<RegistryPublishResult>;

  /**
   * Premium access receipt: publishPremiumReceipt(contentHash, sourceEventHash, contentUri).
   */
  publishPremiumReceipt(
    contentHash: string,
    sourceEventHash: string,
    contentUri: string,
  ): Promise<RegistryPublishResult>;

  /**
   * Record a desk capital move (top-up / sweep / emergency return) on-chain.
   * amountUsdc is human USDC units (encoded as 6-decimal base units on-chain).
   */
  recordCapitalMove(
    moveId: string,
    from: string,
    to: string,
    amountUsdc: number,
    reasonHash: string,
  ): Promise<RegistryPublishResult>;
}

function notConfigured(): RegistryPublishResult {
  return {
    success: false,
    errorMessage:
      "On-chain write path not configured. Set KEEPERHUB_API_KEY + KEEPERHUB_API_BASE_URL + CHRONICLE_REGISTRY_ADDRESS (production KeeperHub org wallet), or ALLOW_DIRECT_ETHERS_WRITES=true with RPC_URL/PARA_WALLET_PRIVATE_KEY test EOA (local tests only — not Para MPC).",
  };
}

function requireHttpsContentUri(
  contentUri: string,
  kind: "alert" | "digest" | "trade ticket" | "premium receipt",
  options?: { requireHttpsProtocol?: boolean; rejectLocalhost?: boolean },
): string {
  const trimmed = contentUri.trim();
  if (!trimmed) {
    throw new Error(`${kind} contentUri is required for on-chain registry publication`);
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(
      `${kind} contentUri must be an absolute http(s) URL (got: ${contentUri}). ` +
        "Use FRONTEND_ORIGIN-based public pages, not custom schemes like chronicleai://.",
    );
  }
  if (options?.requireHttpsProtocol && !/^https:\/\//i.test(trimmed)) {
    throw new Error(
      `${kind} contentUri must use https in production (got: ${contentUri}). ` +
        "Set FRONTEND_ORIGIN to a public https SPA origin.",
    );
  }
  if (options?.rejectLocalhost) {
    try {
      const host = new URL(trimmed).hostname;
      if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(host)) {
        throw new Error(
          `${kind} contentUri must not use localhost in production (got: ${contentUri}). ` +
            "Set FRONTEND_ORIGIN to a public https SPA origin.",
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("localhost")) {
        throw error;
      }
      // Invalid URL already rejected above by protocol check path.
    }
  }
  return trimmed;
}

function fromReceipt(
  receipt: OnChainWriteReceipt,
  extras?: { contentUri?: string; contentHash?: string },
): RegistryPublishResult {
  const result: RegistryPublishResult = {
    success: true,
    txHash: receipt.txHash,
  };
  if (receipt.keeperHubRunId !== undefined) {
    result.keeperHubRunId = receipt.keeperHubRunId;
  }
  if (receipt.explorerUrl !== undefined) {
    result.explorerUrl = receipt.explorerUrl;
  }
  if (receipt.gasUsed !== undefined) {
    result.gasUsed = receipt.gasUsed;
  }
  if (receipt.gasUsedWei !== undefined) {
    result.gasUsedWei = receipt.gasUsedWei;
  }
  if (extras?.contentUri !== undefined) {
    result.contentUri = extras.contentUri;
  }
  if (extras?.contentHash !== undefined) {
    result.contentHash = extras.contentHash;
  }
  return result;
}

export function createChronicleRegistryService(
  web3Client: Web3Client | null,
  options?: {
    /**
     * When true (NODE_ENV=production), trade-ticket / premium contentUri must be
     * https and must not point at localhost.
     */
    strictContentUri?: boolean;
  },
): ChronicleRegistryService {
  const strict = options?.strictContentUri === true;
  const uriOpts = strict
    ? { requireHttpsProtocol: true, rejectLocalhost: true }
    : undefined;

  return {
    async publishAlert(contentHash, sourceEventHash, contentUri) {
      if (!web3Client) {
        return notConfigured();
      }

      try {
        const uri = requireHttpsContentUri(contentUri, "alert", uriOpts);
        const normalizedHash = toBytes32Hash(contentHash);
        // Pass sourceEventHash on-chain — no longer dropped as _sourceEventHash.
        const receipt = await web3Client.publishAlert(normalizedHash, sourceEventHash, uri);
        return fromReceipt(receipt, { contentUri: uri, contentHash: normalizedHash });
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown registry error",
        };
      }
    },

    async publishDigest(contentHash, sourceEventRoot, contentUri) {
      if (!web3Client) {
        return notConfigured();
      }

      try {
        const uri = requireHttpsContentUri(contentUri, "digest", uriOpts);
        const normalizedHash = toBytes32Hash(contentHash);
        const receipt = await web3Client.publishDigest(normalizedHash, sourceEventRoot, uri);
        return fromReceipt(receipt, { contentUri: uri, contentHash: normalizedHash });
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown registry error",
        };
      }
    },

    async recordPayout(payoutPeriodHash, recipient, amount, transferTxHash) {
      if (!web3Client) {
        return notConfigured();
      }

      try {
        const receipt = await web3Client.recordPayout(
          payoutPeriodHash,
          recipient,
          amount,
          transferTxHash,
        );
        return fromReceipt(receipt);
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown registry error",
        };
      }
    },

    async publishTradeTicket(ticketHash, signalHash, intentHash, contentUri) {
      if (!web3Client) {
        return notConfigured();
      }

      try {
        const uri = requireHttpsContentUri(contentUri, "trade ticket", uriOpts);
        const normalizedTicket = toBytes32Hash(ticketHash);
        const receipt = await web3Client.publishTradeTicket(
          normalizedTicket,
          signalHash,
          intentHash,
          uri,
        );
        return fromReceipt(receipt, {
          contentUri: uri,
          contentHash: normalizedTicket,
        });
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown registry error",
        };
      }
    },

    async publishPremiumReceipt(contentHash, sourceEventHash, contentUri) {
      if (!web3Client) {
        return notConfigured();
      }

      try {
        const uri = requireHttpsContentUri(contentUri, "premium receipt", uriOpts);
        const normalizedHash = toBytes32Hash(contentHash);
        const sourceHash = toBytes32Hash(sourceEventHash);
        const receipt = await web3Client.publishPremiumReceipt(
          normalizedHash,
          sourceHash,
          uri,
        );
        return fromReceipt(receipt, { contentUri: uri, contentHash: normalizedHash });
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown registry error",
        };
      }
    },

    async recordCapitalMove(moveId, from, to, amountUsdc, reasonHash) {
      if (!web3Client) {
        return notConfigured();
      }

      try {
        const receipt = await web3Client.recordCapitalMove(
          moveId,
          from,
          to,
          amountUsdc,
          reasonHash,
        );
        return fromReceipt(receipt, { contentHash: toBytes32Hash(moveId) });
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown registry error",
        };
      }
    },
  };
}
