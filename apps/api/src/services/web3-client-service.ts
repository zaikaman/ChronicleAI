// Web3 write facade for Chronicle Registry + treasury transfers.
//
// Production / demo path: KeeperHub is the ONLY write path (Direct Execution
// API and/or imported write workflows). Direct ethers sendTransaction is
// hard-disabled unless ALLOW_DIRECT_ETHERS_WRITES=true (local unit tests only).

import type { ServerEnv } from "@chronicleai/config";
import { ethers } from "ethers";
import {
  createKeeperHubWriteClient,
  isKeeperHubWriteConfigured,
} from "./keeperhub-write-client.ts";
import type { OnChainWriteReceipt, SponsoredWatchWriteReceipt } from "./on-chain-write-receipt.ts";
import { resolveTreasuryWallet } from "./treasury-wallet.ts";

/**
 * TRUSTED_CLIENT_OK: ethers remains used for ABI encoding / local test signing
 * only. Material production writes go through KeeperHubWriteClient.
 */

export interface Web3Client {
  /** Return the Para/registry signer address when known (direct mode only). */
  getSignerAddress(): Promise<string>;

  /** Return the treasury address that funds revenue splits (if configured). */
  getTreasuryAddress(): Promise<string | undefined>;

  /** Whether this client routes writes through KeeperHub. */
  isKeeperHubBacked(): boolean;

  publishAlert(alertHash: string, ipfsUri: string): Promise<OnChainWriteReceipt>;

  publishDigest(
    digestHash: string,
    sourceEventRoot: string,
    ipfsUri: string,
  ): Promise<OnChainWriteReceipt>;

  createSponsoredWatch(
    targetContract: string,
    watchSpecHash: string,
    startsAt: number,
    endsAt: number,
  ): Promise<SponsoredWatchWriteReceipt>;

  publishSponsoredReport(
    watchId: number,
    reportContentHash: string,
    sourceEventRoot: string,
    reportUri: string,
  ): Promise<OnChainWriteReceipt>;

  recordPayout(
    payoutPeriodHash: string,
    recipient: string,
    amount: number,
    reasonHash: string,
  ): Promise<OnChainWriteReceipt>;

  /**
   * Send native transfer from the treasury / org wallet.
   * Production: KeeperHub transfer execution. Direct: TREASURY_WALLET_PRIVATE_KEY.
   */
  sendTransfer(to: string, amountEth: number): Promise<OnChainWriteReceipt>;
}

const REGISTRY_ABI = [
  "function publishAlert(bytes32 alertHash, string calldata ipfsUri) external",
  "function publishDigest(bytes32 digestHash, bytes32 sourceEventRoot, string calldata ipfsUri) external",
  "function createSponsoredWatch(address targetContract, bytes32 watchSpecHash, uint256 startsAt, uint256 endsAt) external returns (uint256 watchId)",
  "function publishSponsoredReport(uint256 watchId, bytes32 reportContentHash, bytes32 sourceEventRoot, string calldata reportUri) external",
  "function recordPayout(bytes32 payoutPeriodHash, address recipient, uint256 amount, bytes32 reasonHash) external",
  "function owner() external view returns (address)",
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContractMethod = (
  ...args: any[]
) => Promise<{
  wait: () => Promise<{ hash: string; logs: Array<{ topics?: string[]; data?: string }> }>;
}>;

interface EthersContract {
  publishAlert: ContractMethod;
  publishDigest: ContractMethod;
  createSponsoredWatch: ContractMethod;
  publishSponsoredReport: ContractMethod;
  recordPayout: ContractMethod;
  owner: () => Promise<string>;
}

function hashString(input: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(input));
}

function explorerUrlFor(txHash: string, network?: string): string {
  const n = (network ?? "base-sepolia").toLowerCase();
  if (n === "base" || n === "8453") {
    return `https://basescan.org/tx/${txHash}`;
  }
  if (n === "sepolia" || n === "11155111") {
    return `https://sepolia.etherscan.io/tx/${txHash}`;
  }
  if (n === "ethereum" || n === "mainnet" || n === "1") {
    return `https://etherscan.io/tx/${txHash}`;
  }
  return `https://sepolia.basescan.org/tx/${txHash}`;
}

function isDirectEthersAllowed(env: ServerEnv): boolean {
  // Never allow direct ethers sends in production, even if the flag is set.
  if (env.nodeEnv === "production") {
    return false;
  }
  return env.allowDirectEthersWrites === true;
}

function createKeeperHubBackedWeb3Client(env: ServerEnv): Web3Client {
  const kh = createKeeperHubWriteClient({
    apiBaseUrl: env.keeperhubApiBaseUrl as string,
    apiKey: env.keeperhubApiKey as string,
    network: env.keeperhubNetwork,
    registryAddress: env.chronicleRegistryAddress as string,
    workflowIds: {
      publishAlert: env.keeperhubWorkflowPublishAlert,
      publishDigest: env.keeperhubWorkflowPublishDigest,
      createSponsoredWatch: env.keeperhubWorkflowCreateSponsoredWatch,
      publishSponsoredReport: env.keeperhubWorkflowPublishSponsoredReport,
      recordPayout: env.keeperhubWorkflowRecordPayout,
      transfer: env.keeperhubWorkflowTransfer,
    },
  });

  const treasury = resolveTreasuryWallet(env);

  return {
    async getSignerAddress() {
      return "keeperhub-org-wallet";
    },

    async getTreasuryAddress() {
      return treasury.address;
    },

    isKeeperHubBacked() {
      return true;
    },

    publishAlert: (alertHash, ipfsUri) => kh.publishAlert(alertHash, ipfsUri),
    publishDigest: (digestHash, sourceEventRoot, ipfsUri) =>
      kh.publishDigest(digestHash, sourceEventRoot, ipfsUri),
    createSponsoredWatch: (targetContract, watchSpecHash, startsAt, endsAt) =>
      kh.createSponsoredWatch(targetContract, watchSpecHash, startsAt, endsAt),
    publishSponsoredReport: (watchId, reportContentHash, sourceEventRoot, reportUri) =>
      kh.publishSponsoredReport(watchId, reportContentHash, sourceEventRoot, reportUri),
    recordPayout: (payoutPeriodHash, recipient, amount, reasonHash) =>
      kh.recordPayout(payoutPeriodHash, recipient, amount, reasonHash),
    sendTransfer: (to, amountEth) => kh.sendTransfer(to, amountEth),
  };
}

/**
 * Direct ethers client — LOCAL UNIT TESTS ONLY.
 * Gated by ALLOW_DIRECT_ETHERS_WRITES=true and never enabled in production.
 */
function createDirectEthersWeb3Client(env: ServerEnv): Web3Client {
  if (!env.rpcUrl || !env.chronicleRegistryAddress || !env.paraWalletPrivateKey) {
    throw new Error(
      "Direct ethers client requires RPC_URL, CHRONICLE_REGISTRY_ADDRESS, and PARA_WALLET_PRIVATE_KEY",
    );
  }

  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const paraWallet = new ethers.Wallet(env.paraWalletPrivateKey, provider);
  const registryContract = new ethers.Contract(
    env.chronicleRegistryAddress,
    REGISTRY_ABI,
    paraWallet,
  ) as unknown as EthersContract;

  const treasury = resolveTreasuryWallet(env);
  const treasuryWallet = treasury.privateKey
    ? new ethers.Wallet(treasury.privateKey, provider)
    : undefined;

  const network = env.keeperhubNetwork;

  async function waitReceipt(
    tx: { wait: () => Promise<{ hash: string; logs: Array<{ topics?: string[]; data?: string }> } | null> },
  ): Promise<{ hash: string; logs: Array<{ topics?: string[]; data?: string }> }> {
    const receipt = await tx.wait();
    if (!receipt || typeof receipt.hash !== "string") {
      throw new Error("Transaction failed or returned no hash");
    }
    return receipt;
  }

  return {
    async getSignerAddress() {
      return await paraWallet.getAddress();
    },

    async getTreasuryAddress() {
      if (treasuryWallet) {
        return await treasuryWallet.getAddress();
      }
      return treasury.address;
    },

    isKeeperHubBacked() {
      return false;
    },

    async publishAlert(alertHash, ipfsUri) {
      const tx = await registryContract.publishAlert(hashString(alertHash), ipfsUri);
      const receipt = await waitReceipt(tx);
      return {
        txHash: receipt.hash,
        explorerUrl: explorerUrlFor(receipt.hash, network),
      };
    },

    async publishDigest(digestHash, sourceEventRoot, ipfsUri) {
      const tx = await registryContract.publishDigest(
        hashString(digestHash),
        hashString(sourceEventRoot),
        ipfsUri,
      );
      const receipt = await waitReceipt(tx);
      return {
        txHash: receipt.hash,
        explorerUrl: explorerUrlFor(receipt.hash, network),
      };
    },

    async createSponsoredWatch(targetContract, watchSpecHash, startsAt, endsAt) {
      const tx = await registryContract.createSponsoredWatch(
        targetContract,
        hashString(watchSpecHash),
        startsAt,
        endsAt,
      );
      const receipt = await waitReceipt(tx);
      // Best-effort watch id from event data; default 0 if undecodable.
      const eventIface = new ethers.Interface([
        "event SponsoredWatchCreated(uint256 indexed watchId, address indexed targetContract, bytes32 watchSpecHash, uint256 startsAt, uint256 endsAt)",
      ]);
      let watchId = 0;
      for (const log of receipt.logs) {
        try {
          const parsed = eventIface.parseLog({
            topics: (log.topics ?? []) as string[],
            data: log.data ?? "0x",
          });
          if (parsed?.name === "SponsoredWatchCreated") {
            watchId = Number(parsed.args[0]);
            break;
          }
        } catch {
          // not our event
        }
      }
      return {
        watchId,
        txHash: receipt.hash,
        explorerUrl: explorerUrlFor(receipt.hash, network),
      };
    },

    async publishSponsoredReport(watchId, reportContentHash, sourceEventRoot, reportUri) {
      const tx = await registryContract.publishSponsoredReport(
        watchId,
        hashString(reportContentHash),
        hashString(sourceEventRoot),
        reportUri,
      );
      const receipt = await waitReceipt(tx);
      return {
        txHash: receipt.hash,
        explorerUrl: explorerUrlFor(receipt.hash, network),
      };
    },

    async recordPayout(payoutPeriodHash, recipient, amount, reasonHash) {
      const tx = await registryContract.recordPayout(
        hashString(payoutPeriodHash),
        recipient,
        ethers.parseEther(String(amount)),
        hashString(reasonHash),
      );
      const receipt = await waitReceipt(tx);
      return {
        txHash: receipt.hash,
        explorerUrl: explorerUrlFor(receipt.hash, network),
      };
    },

    async sendTransfer(to, amountEth) {
      if (!treasuryWallet) {
        throw new Error(
          "Treasury spending key is not configured — set TREASURY_WALLET_PRIVATE_KEY for direct ethers transfers (test-only path)",
        );
      }
      const tx = await treasuryWallet.sendTransaction({
        to,
        value: ethers.parseEther(String(amountEth)),
      });
      const receipt = await tx.wait();
      if (!receipt || typeof receipt.hash !== "string") {
        throw new Error("sendTransfer transaction failed");
      }
      return {
        txHash: receipt.hash,
        explorerUrl: explorerUrlFor(receipt.hash, network),
      };
    },
  };
}

/**
 * Create the production Web3 client.
 *
 * Priority:
 * 1. KeeperHub API (required for production/demo material writes)
 * 2. Direct ethers — only when ALLOW_DIRECT_ETHERS_WRITES=true and not production
 * 3. null — no write path configured
 */
export function createWeb3Client(env: ServerEnv): Web3Client | null {
  if (isKeeperHubWriteConfigured(env)) {
    return createKeeperHubBackedWeb3Client(env);
  }

  if (isDirectEthersAllowed(env)) {
    if (!env.rpcUrl || !env.chronicleRegistryAddress || !env.paraWalletPrivateKey) {
      return null;
    }
    console.warn(
      "[web3] ALLOW_DIRECT_ETHERS_WRITES is enabled — using direct ethers (local tests only). Production must use KeeperHub.",
    );
    return createDirectEthersWeb3Client(env);
  }

  // Hard-disable: missing KeeperHub and direct ethers not allowed.
  if (env.paraWalletPrivateKey && env.nodeEnv !== "test") {
    console.warn(
      "[web3] Direct ethers writes are disabled. Configure KEEPERHUB_API_KEY + KEEPERHUB_API_BASE_URL for material on-chain writes, or set ALLOW_DIRECT_ETHERS_WRITES=true for local tests only.",
    );
  }

  return null;
}
