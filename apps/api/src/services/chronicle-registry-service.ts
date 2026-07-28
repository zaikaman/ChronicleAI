// Chronicle Registry publish service
// Handles on-chain registry writes for alerts, digests, and payout records
// via KeeperHub (production) or gated direct ethers (local tests only).
//
// IDEA signatures:
//   publishAlert(contentHash, sourceEventHash, contentUri)
//   publishDigest(contentHash, sourceEventRoot, contentUri)
//   recordPayout(...)

import type { OnChainWriteReceipt } from "./on-chain-write-receipt.ts";
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
}

function notConfigured(): RegistryPublishResult {
  return {
    success: false,
    errorMessage:
      "On-chain write path not configured. Set KEEPERHUB_API_KEY + KEEPERHUB_API_BASE_URL + CHRONICLE_REGISTRY_ADDRESS (production KeeperHub org wallet), or ALLOW_DIRECT_ETHERS_WRITES=true with RPC_URL/PARA_WALLET_PRIVATE_KEY test EOA (local tests only — not Para MPC).",
  };
}

function requireHttpsContentUri(contentUri: string, kind: "alert" | "digest"): string {
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
  return trimmed;
}

function fromReceipt(
  receipt: OnChainWriteReceipt,
  contentUri?: string,
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
  if (contentUri !== undefined) {
    result.contentUri = contentUri;
  }
  return result;
}

export function createChronicleRegistryService(
  web3Client: Web3Client | null,
): ChronicleRegistryService {
  return {
    async publishAlert(contentHash, sourceEventHash, contentUri) {
      if (!web3Client) {
        return notConfigured();
      }

      try {
        const uri = requireHttpsContentUri(contentUri, "alert");
        // Pass sourceEventHash on-chain — no longer dropped as _sourceEventHash.
        const receipt = await web3Client.publishAlert(contentHash, sourceEventHash, uri);
        return fromReceipt(receipt, uri);
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
        const uri = requireHttpsContentUri(contentUri, "digest");
        const receipt = await web3Client.publishDigest(contentHash, sourceEventRoot, uri);
        return fromReceipt(receipt, uri);
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
  };
}
