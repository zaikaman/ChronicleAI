// Chronicle Registry publish service
// Handles on-chain registry writes for alerts, digests, and payout records
// via KeeperHub (production) or gated direct ethers (local tests only).

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
   * Publish an alert on-chain with a resolvable HTTPS content URI.
   * `contentUri` must be an absolute http(s) URL pointing at the public alert page.
   */
  publishAlert(
    alertId: string,
    sourceEventHash: string,
    contentUri: string,
  ): Promise<RegistryPublishResult>;

  /**
   * Publish a digest on-chain with a resolvable HTTPS content URI.
   * `contentUri` must be an absolute http(s) URL pointing at the public digest page.
   */
  publishDigest(
    digestId: string,
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
      "On-chain write path not configured. Set KEEPERHUB_API_KEY + KEEPERHUB_API_BASE_URL + CHRONICLE_REGISTRY_ADDRESS (production), or ALLOW_DIRECT_ETHERS_WRITES=true with RPC_URL/PARA_WALLET_PRIVATE_KEY (local tests only).",
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
  return {
    success: true,
    txHash: receipt.txHash,
    keeperHubRunId: receipt.keeperHubRunId,
    explorerUrl: receipt.explorerUrl,
    contentUri,
  };
}

export function createChronicleRegistryService(
  web3Client: Web3Client | null,
): ChronicleRegistryService {
  return {
    async publishAlert(alertId, _sourceEventHash, contentUri) {
      if (!web3Client) {
        return notConfigured();
      }

      try {
        const uri = requireHttpsContentUri(contentUri, "alert");
        const receipt = await web3Client.publishAlert(alertId, uri);
        return fromReceipt(receipt, uri);
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown registry error",
        };
      }
    },

    async publishDigest(digestId, sourceEventRoot, contentUri) {
      if (!web3Client) {
        return notConfigured();
      }

      try {
        const uri = requireHttpsContentUri(contentUri, "digest");
        const receipt = await web3Client.publishDigest(digestId, sourceEventRoot, uri);
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
