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
}

export interface ChronicleRegistryService {
  /** Publish an alert on-chain. Returns the transaction hash + KeeperHub run metadata. */
  publishAlert(alertId: string, sourceEventHash: string): Promise<RegistryPublishResult>;

  /** Publish a digest on-chain. Returns the transaction hash + KeeperHub run metadata. */
  publishDigest(digestId: string, sourceEventRoot: string): Promise<RegistryPublishResult>;

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

function fromReceipt(receipt: OnChainWriteReceipt): RegistryPublishResult {
  return {
    success: true,
    txHash: receipt.txHash,
    keeperHubRunId: receipt.keeperHubRunId,
    explorerUrl: receipt.explorerUrl,
  };
}

export function createChronicleRegistryService(
  web3Client: Web3Client | null,
): ChronicleRegistryService {
  return {
    async publishAlert(alertId, _sourceEventHash) {
      if (!web3Client) {
        return notConfigured();
      }

      try {
        const ipfsUri = `chronicleai://alerts/${alertId}`;
        const receipt = await web3Client.publishAlert(alertId, ipfsUri);
        return fromReceipt(receipt);
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown registry error",
        };
      }
    },

    async publishDigest(digestId, sourceEventRoot) {
      if (!web3Client) {
        return notConfigured();
      }

      try {
        const ipfsUri = `chronicleai://digests/${digestId}`;
        const receipt = await web3Client.publishDigest(digestId, sourceEventRoot, ipfsUri);
        return fromReceipt(receipt);
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
