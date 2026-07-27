// Web3/Ethers client service for Chronicle Registry contract interaction

import type { ServerEnv } from "@chronicleai/config";
import { ethers } from "ethers";

/**
 * TRUSTED_CLIENT_OK: ethers is the canonical Ethereum SDK used here because
 * ChronicleAI requires deterministic ABI-encoded registry writes
 * (publishAlert, publishDigest, createSponsoredWatch, publishSponsoredReport,
 * recordPayout) with full event log access. Native fetch is not a substitute
 * for ABI encoding, transaction signing, and event decoding.
 */

export interface Web3Client {
  /** Return the connected signer address. */
  getSignerAddress(): Promise<string>;

  /** Publish an alert hash on-chain. Returns the transaction hash. */
  publishAlert(alertHash: string, ipfsUri: string): Promise<string>;

  /** Publish a digest hash on-chain. Returns the transaction hash. */
  publishDigest(digestHash: string, sourceEventRoot: string, ipfsUri: string): Promise<string>;

  /** Create a sponsored watch campaign on-chain. Returns the watch ID and tx hash. */
  createSponsoredWatch(
    targetContract: string,
    watchSpecHash: string,
    startsAt: number,
    endsAt: number,
  ): Promise<{ watchId: number; txHash: string }>;

  /** Publish a sponsored report on-chain. Returns the transaction hash. */
  publishSponsoredReport(watchId: number, reportContentHash: string, reportUri: string): Promise<string>;

  /** Record a payout on-chain. Returns the transaction hash. */
  recordPayout(payoutPeriodHash: string, recipient: string, amount: number, reasonHash: string): Promise<string>;

  /** Send native transfer. Returns the transaction hash. */
  sendTransfer(to: string, amountEth: number): Promise<string>;
}

// Minimum ABI for ChronicleRegistry interactions
const REGISTRY_ABI = [
  "function publishAlert(bytes32 alertHash, string calldata ipfsUri) external",
  "function publishDigest(bytes32 digestHash, bytes32 sourceEventRoot, string calldata ipfsUri) external",
  "function createSponsoredWatch(address targetContract, bytes32 watchSpecHash, uint256 startsAt, uint256 endsAt) external returns (uint256 watchId)",
  "function publishSponsoredReport(uint256 watchId, bytes32 reportContentHash, string calldata reportUri) external",
  "function recordPayout(bytes32 payoutPeriodHash, address recipient, uint256 amount, bytes32 reasonHash) external",
  "function owner() external view returns (address)",
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContractMethod = (...args: any[]) => Promise<{ wait: () => Promise<{ hash: string; logs: Array<{ topics?: string[]; data?: string }> }> }>;

interface EthersContract {
  publishAlert: ContractMethod;
  publishDigest: ContractMethod;
  createSponsoredWatch: ContractMethod;
  publishSponsoredReport: ContractMethod;
  recordPayout: ContractMethod;
  owner: () => Promise<string>;
}

export function createWeb3Client(env: ServerEnv): Web3Client | null {
  if (!env.rpcUrl || !env.chronicleRegistryAddress || !env.paraWalletPrivateKey) {
    return null;
  }

  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const wallet = new ethers.Wallet(env.paraWalletPrivateKey, provider);
  const registryAddress = env.chronicleRegistryAddress;

  const registryContract = new ethers.Contract(registryAddress, REGISTRY_ABI, wallet) as unknown as EthersContract;

  function hashString(input: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(input));
  }

  return {
    async getSignerAddress() {
      return await wallet.getAddress();
    },

    async publishAlert(alertHash, ipfsUri) {
      const tx = await registryContract.publishAlert(hashString(alertHash), ipfsUri);
      const receipt = await tx.wait();
      if (!receipt || typeof receipt.hash !== "string") {
        throw new Error("publishAlert transaction failed");
      }
      return receipt.hash;
    },

    async publishDigest(digestHash, sourceEventRoot, ipfsUri) {
      const tx = await registryContract.publishDigest(
        hashString(digestHash),
        hashString(sourceEventRoot),
        ipfsUri,
      );
      const receipt = await tx.wait();
      if (!receipt || typeof receipt.hash !== "string") {
        throw new Error("publishDigest transaction failed");
      }
      return receipt.hash;
    },

    async createSponsoredWatch(targetContract, watchSpecHash, startsAt, endsAt) {
      const tx = await registryContract.createSponsoredWatch(
        targetContract,
        hashString(watchSpecHash),
        startsAt,
        endsAt,
      );
      const receipt = await tx.wait();
      if (!receipt || typeof receipt.hash !== "string") {
        throw new Error("createSponsoredWatch transaction failed");
      }
      const eventLog = receipt.logs.find(
        (log) => log.topics?.[0] === hashString("SponsoredWatchCreated(uint256,address,bytes32,uint256,uint256)"),
      );
      const watchId = eventLog ? Number(eventLog.data ?? "0x0") : 0;
      return { watchId, txHash: receipt.hash };
    },

    async publishSponsoredReport(watchId, reportContentHash, reportUri) {
      const tx = await registryContract.publishSponsoredReport(
        watchId,
        hashString(reportContentHash),
        reportUri,
      );
      const receipt = await tx.wait();
      if (!receipt || typeof receipt.hash !== "string") {
        throw new Error("publishSponsoredReport transaction failed");
      }
      return receipt.hash;
    },

    async recordPayout(payoutPeriodHash, recipient, amount, reasonHash) {
      const tx = await registryContract.recordPayout(
        hashString(payoutPeriodHash),
        recipient,
        ethers.parseEther(String(amount)),
        hashString(reasonHash),
      );
      const receipt = await tx.wait();
      if (!receipt || typeof receipt.hash !== "string") {
        throw new Error("recordPayout transaction failed");
      }
      return receipt.hash;
    },

    async sendTransfer(to, amountEth) {
      const tx = await wallet.sendTransaction({
        to,
        value: ethers.parseEther(String(amountEth)),
      });
      const receipt = await tx.wait();
      if (!receipt || typeof receipt.hash !== "string") {
        throw new Error("sendTransfer transaction failed");
      }
      return receipt.hash;
    },
  };
}
