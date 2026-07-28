// Web3 write facade for Chronicle Registry + treasury transfers.
//
// Production priority:
// 1. Para MPC treasury + KeeperHub registry (hybrid) — preferred for demo/prod
// 2. Para MPC only (registry + transfers via Para ethers REST signer)
// 3. KeeperHub only (registry + transfers via org wallet)
// 4. Direct ethers — ALLOW_DIRECT_ETHERS_WRITES=true and never in production
//
// Para uses @getpara/rest-sdk (API-key programmatic wallets) for real MPC
// signing. No PARA_WALLET_PRIVATE_KEY is used in production.

import type { ServerEnv } from "@chronicleai/config";
import { createParaRestEthersSigner } from "@getpara/rest-sdk/ethers";
import { ParaRestClient } from "@getpara/rest-sdk";
import { ethers } from "ethers";
import {
  createKeeperHubWriteClient,
  isKeeperHubWriteConfigured,
} from "./keeperhub-write-client.ts";
import type { OnChainWriteReceipt, SponsoredWatchWriteReceipt } from "./on-chain-write-receipt.ts";
import {
  createParaTreasuryClientFromEnv,
  isParaTreasuryConfigured,
  type ParaTreasuryClient,
} from "./para-treasury-client.ts";
import { resolveTreasuryWallet } from "./treasury-wallet.ts";

/**
 * TRUSTED_CLIENT_OK: ethers used for ABI encoding and Para REST ethers signer.
 * Production treasury spends go through Para MPC when PARA_API_KEY is set.
 */

export type TreasuryProviderLabel = "para-mpc" | "keeperhub" | "eoa" | "unconfigured";

export interface Web3Client {
  /**
   * Return the registry/agent signer address when known.
   * KeeperHub-only clients return a sentinel label.
   */
  getSignerAddress(): Promise<string>;

  /** Return the treasury address that funds revenue splits (if configured). */
  getTreasuryAddress(): Promise<string | undefined>;

  /**
   * Custody/provider label for the treasury.
   * Production with PARA_API_KEY: "para-mpc".
   */
  getTreasuryProvider(): Promise<TreasuryProviderLabel>;

  /** Whether this client routes registry writes through KeeperHub. */
  isKeeperHubBacked(): boolean;

  /** Whether treasury spends are signed by Para MPC. */
  isParaTreasuryBacked(): boolean;

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
   * Send native transfer from the treasury wallet.
   * Production: Para MPC transfer when configured, else KeeperHub transfer.
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
  // Never allow direct ethers EOA sends in production, even if the flag is set.
  if (env.nodeEnv === "production") {
    return false;
  }
  return env.allowDirectEthersWrites === true;
}

/**
 * Hybrid: KeeperHub for registry writes, Para MPC for treasury transfers.
 * This is the preferred production configuration for the hackathon demo.
 */
function keeperHubWorkflowIdsFromEnv(env: ServerEnv) {
  return {
    ...(env.keeperhubWorkflowPublishAlert
      ? { publishAlert: env.keeperhubWorkflowPublishAlert }
      : {}),
    ...(env.keeperhubWorkflowPublishDigest
      ? { publishDigest: env.keeperhubWorkflowPublishDigest }
      : {}),
    ...(env.keeperhubWorkflowCreateSponsoredWatch
      ? { createSponsoredWatch: env.keeperhubWorkflowCreateSponsoredWatch }
      : {}),
    ...(env.keeperhubWorkflowPublishSponsoredReport
      ? { publishSponsoredReport: env.keeperhubWorkflowPublishSponsoredReport }
      : {}),
    ...(env.keeperhubWorkflowRecordPayout
      ? { recordPayout: env.keeperhubWorkflowRecordPayout }
      : {}),
    ...(env.keeperhubWorkflowTransfer ? { transfer: env.keeperhubWorkflowTransfer } : {}),
  };
}

function createHybridParaKeeperHubWeb3Client(
  env: ServerEnv,
  paraClient: ParaTreasuryClient,
): Web3Client {
  const kh = createKeeperHubWriteClient({
    apiBaseUrl: env.keeperhubApiBaseUrl as string,
    apiKey: env.keeperhubApiKey as string,
    network: env.keeperhubNetwork,
    registryAddress: env.chronicleRegistryAddress as string,
    workflowIds: keeperHubWorkflowIdsFromEnv(env),
  });

  return {
    async getSignerAddress() {
      const wallet = await paraClient.ensureWallet();
      return wallet.address;
    },

    async getTreasuryAddress() {
      const wallet = await paraClient.ensureWallet();
      return wallet.address;
    },

    async getTreasuryProvider() {
      return "para-mpc";
    },

    isKeeperHubBacked() {
      return true;
    },

    isParaTreasuryBacked() {
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

    // Treasury spends: real Para MPC transfer (not KeeperHub org wallet).
    sendTransfer: (to, amountEth) => paraClient.sendTransfer(to, amountEth),
  };
}

/**
 * Full Para production client — registry + treasury via Para REST ethers signer.
 * Used when PARA_API_KEY is set but KeeperHub is not.
 */
function createParaWeb3Client(env: ServerEnv, paraClient: ParaTreasuryClient): Web3Client {
  if (!env.rpcUrl || !env.chronicleRegistryAddress) {
    throw new Error(
      "Para-only web3 client requires RPC_URL and CHRONICLE_REGISTRY_ADDRESS for registry writes",
    );
  }

  const restClient = new ParaRestClient({
    apiKey: env.paraApiKey as string,
    env: env.paraEnvironment,
  });

  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const network = env.keeperhubNetwork;

  let registryContractPromise: Promise<EthersContract> | undefined;
  let signerAddressPromise: Promise<string> | undefined;

  async function getSigner() {
    const wallet = await paraClient.ensureWallet();
    return createParaRestEthersSigner({
      client: restClient,
      walletId: wallet.walletId,
      address: wallet.address,
      provider,
    });
  }

  async function getRegistry(): Promise<EthersContract> {
    if (!registryContractPromise) {
      registryContractPromise = (async () => {
        const signer = await getSigner();
        return new ethers.Contract(
          env.chronicleRegistryAddress as string,
          REGISTRY_ABI,
          signer,
        ) as unknown as EthersContract;
      })();
    }
    return registryContractPromise;
  }

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
      if (!signerAddressPromise) {
        signerAddressPromise = paraClient.ensureWallet().then((w) => w.address);
      }
      return signerAddressPromise;
    },

    async getTreasuryAddress() {
      return this.getSignerAddress();
    },

    async getTreasuryProvider() {
      return "para-mpc";
    },

    isKeeperHubBacked() {
      return false;
    },

    isParaTreasuryBacked() {
      return true;
    },

    async publishAlert(alertHash, ipfsUri) {
      const registry = await getRegistry();
      const tx = await registry.publishAlert(hashString(alertHash), ipfsUri);
      const receipt = await waitReceipt(tx);
      return {
        txHash: receipt.hash,
        explorerUrl: explorerUrlFor(receipt.hash, network),
      };
    },

    async publishDigest(digestHash, sourceEventRoot, ipfsUri) {
      const registry = await getRegistry();
      const tx = await registry.publishDigest(
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
      const registry = await getRegistry();
      const tx = await registry.createSponsoredWatch(
        targetContract,
        hashString(watchSpecHash),
        startsAt,
        endsAt,
      );
      const receipt = await waitReceipt(tx);
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
      const registry = await getRegistry();
      const tx = await registry.publishSponsoredReport(
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
      const registry = await getRegistry();
      const tx = await registry.recordPayout(
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

    sendTransfer: (to, amountEth) => paraClient.sendTransfer(to, amountEth),
  };
}

function createKeeperHubBackedWeb3Client(env: ServerEnv): Web3Client {
  const kh = createKeeperHubWriteClient({
    apiBaseUrl: env.keeperhubApiBaseUrl as string,
    apiKey: env.keeperhubApiKey as string,
    network: env.keeperhubNetwork,
    registryAddress: env.chronicleRegistryAddress as string,
    workflowIds: keeperHubWorkflowIdsFromEnv(env),
  });

  const treasury = resolveTreasuryWallet(env, { keeperHubBacked: true });

  return {
    async getSignerAddress() {
      return "keeperhub-org-wallet";
    },

    async getTreasuryAddress() {
      return treasury.address;
    },

    async getTreasuryProvider() {
      return treasury.provider;
    },

    isKeeperHubBacked() {
      return true;
    },

    isParaTreasuryBacked() {
      return false;
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
      "Direct ethers client requires RPC_URL, CHRONICLE_REGISTRY_ADDRESS, and PARA_WALLET_PRIVATE_KEY (test-only agent EOA)",
    );
  }

  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const agentWallet = new ethers.Wallet(env.paraWalletPrivateKey, provider);
  const registryContract = new ethers.Contract(
    env.chronicleRegistryAddress,
    REGISTRY_ABI,
    agentWallet,
  ) as unknown as EthersContract;

  const treasury = resolveTreasuryWallet(env, { keeperHubBacked: false });
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
      return await agentWallet.getAddress();
    },

    async getTreasuryAddress() {
      if (treasuryWallet) {
        return await treasuryWallet.getAddress();
      }
      return treasury.address;
    },

    async getTreasuryProvider() {
      return treasury.provider;
    },

    isKeeperHubBacked() {
      return false;
    },

    isParaTreasuryBacked() {
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
          "Treasury spending key is not configured — set TREASURY_WALLET_PRIVATE_KEY for direct ethers transfers (test-only path), or configure PARA_API_KEY for production Para MPC",
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
 * 1. Para MPC + KeeperHub hybrid (PARA_API_KEY + KEEPERHUB_*)
 * 2. Para MPC only (PARA_API_KEY + RPC + registry)
 * 3. KeeperHub only
 * 4. Direct ethers — only when ALLOW_DIRECT_ETHERS_WRITES=true and not production
 * 5. null — no write path configured
 */
export function createWeb3Client(env: ServerEnv): Web3Client | null {
  const paraClient = createParaTreasuryClientFromEnv(env);
  const keeperHub = isKeeperHubWriteConfigured(env);

  if (paraClient && keeperHub) {
    console.info(
      "[web3] Production path: Para MPC treasury + KeeperHub registry writes",
    );
    return createHybridParaKeeperHubWeb3Client(env, paraClient);
  }

  if (paraClient && env.rpcUrl && env.chronicleRegistryAddress) {
    console.info(
      "[web3] Production path: Para MPC for registry writes and treasury transfers",
    );
    return createParaWeb3Client(env, paraClient);
  }

  if (paraClient && !keeperHub) {
    console.warn(
      "[web3] PARA_API_KEY is set but CHRONICLE_REGISTRY_ADDRESS/RPC_URL missing and KeeperHub is not configured — treasury-only Para client unavailable for full Web3Client",
    );
  }

  if (keeperHub) {
    return createKeeperHubBackedWeb3Client(env);
  }

  if (isDirectEthersAllowed(env)) {
    if (!env.rpcUrl || !env.chronicleRegistryAddress || !env.paraWalletPrivateKey) {
      return null;
    }
    console.warn(
      "[web3] ALLOW_DIRECT_ETHERS_WRITES is enabled — using direct ethers (local tests only). Production should use PARA_API_KEY and/or KeeperHub.",
    );
    return createDirectEthersWeb3Client(env);
  }

  if (env.paraWalletPrivateKey && env.nodeEnv !== "test") {
    console.warn(
      "[web3] Direct ethers writes are disabled. Configure PARA_API_KEY for Para MPC treasury (production) and/or KEEPERHUB_API_KEY + KEEPERHUB_API_BASE_URL for registry writes.",
    );
  }

  if (isParaTreasuryConfigured(env) && env.nodeEnv !== "test") {
    console.warn(
      "[web3] PARA_API_KEY present but incomplete write path. Add KEEPERHUB_* for hybrid, or RPC_URL + CHRONICLE_REGISTRY_ADDRESS for Para-only registry writes.",
    );
  }

  return null;
}
