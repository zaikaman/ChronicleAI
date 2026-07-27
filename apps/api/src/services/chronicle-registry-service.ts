// Chronicle Registry publish service
// Handles on-chain registry writes for alerts, digests, and payout records

import type { Web3Client } from "./web3-client-service.ts";

export interface RegistryPublishResult {
  success: boolean;
  txHash?: string;
  errorMessage?: string;
}

export interface ChronicleRegistryService {
  /** Publish an alert on-chain. Returns the transaction hash. */
  publishAlert(alertId: string, sourceEventHash: string): Promise<RegistryPublishResult>;

  /** Publish a digest on-chain. Returns the transaction hash. */
  publishDigest(digestId: string, sourceEventRoot: string): Promise<RegistryPublishResult>;

  /** Record a payout on-chain. Returns the transaction hash. */
  recordPayout(payoutPeriodHash: string, transferTxHash: string): Promise<RegistryPublishResult>;
}

export function createChronicleRegistryService(
  web3Client: Web3Client | null,
): ChronicleRegistryService {
  return {
    async publishAlert(alertId, sourceEventHash) {
      if (!web3Client) {
        return {
          success: false,
          errorMessage:
            "Web3 client not configured (missing RPC_URL, registry address, or wallet key)",
        };
      }

      try {
        const ipfsUri = `chronicleai://alerts/${alertId}`;
        const txHash = await web3Client.publishAlert(alertId, ipfsUri);
        return { success: true, txHash };
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown registry error",
        };
      }
    },

    async publishDigest(digestId, sourceEventRoot) {
      if (!web3Client) {
        return {
          success: false,
          errorMessage:
            "Web3 client not configured (missing RPC_URL, registry address, or wallet key)",
        };
      }

      try {
        const ipfsUri = `chronicleai://digests/${digestId}`;
        const txHash = await web3Client.publishDigest(digestId, sourceEventRoot, ipfsUri);
        return { success: true, txHash };
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown registry error",
        };
      }
    },

    async recordPayout(payoutPeriodHash, transferTxHash) {
      if (!web3Client) {
        return {
          success: false,
          errorMessage:
            "Web3 client not configured (missing RPC_URL, registry address, or wallet key)",
        };
      }

      try {
        const recipient = "0x0000000000000000000000000000000000000000";
        const amount = 0;
        const reasonHash = transferTxHash;
        const txHash = await web3Client.recordPayout(
          payoutPeriodHash,
          recipient,
          amount,
          reasonHash,
        );
        return { success: true, txHash };
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown registry error",
        };
      }
    },
  };
}
