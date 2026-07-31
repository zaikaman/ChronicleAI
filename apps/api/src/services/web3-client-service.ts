// Web3 write facade for Chronicle Registry + treasury transfers.
//
// Production priority:
// 1. KeeperHub workflows for every registry and treasury write, optionally
//    backed by Para MPC custody/signing
// 3. KeeperHub only (registry + transfers via org wallet)
// 4. Direct viem EOA — ALLOW_DIRECT_ETHERS_WRITES=true and never in production
//
// Para uses @getpara/rest-sdk (API-key programmatic wallets) for real MPC
// signing. No PARA_WALLET_PRIVATE_KEY is used in production.

import type { ServerEnv } from "@chronicleai/config";
import { createParaRestViemAccount } from "@getpara/rest-sdk/viem";
import { ParaRestClient } from "@getpara/rest-sdk";
import {
  type Address,
  type Hash,
  type Hex,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseUnits,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { chainFromId } from "../lib/viem-chain.ts";
import {
  createKeeperHubWriteClient,
  isKeeperHubWriteConfigured,
  type KeeperHubMcpWriteOptions,
  toBytes32Hash,
  toUint64Seconds,
} from "./keeperhub-write-client.ts";
import { createProviderConfigs, type LLMProviderMap } from "./llm-provider-client.ts";
import {
  PRIVATE_ROUTING_CHAIN_ID,
  type PrivateRoutingPolicy,
  selectTreasuryTransferPath,
  type TreasuryTransferPath,
} from "./routing-metadata.ts";
import {
  normalizeGasValue,
  type OnChainWriteReceipt,
  type SponsoredWatchWriteReceipt,
} from "./on-chain-write-receipt.ts";
import {
  createParaTreasuryClientFromEnv,
  isParaTreasuryConfigured,
  mapNetworkToChainId,
  networkLabelForChainId,
  type ParaTreasuryClient,
} from "./para-treasury-client.ts";
import { decodeSponsoredWatchIdFromLogs } from "./sponsored-watch-id.ts";
import { resolveTreasuryWallet } from "./treasury-wallet.ts";

/**
 * TRUSTED_CLIENT_OK: viem used for ABI encoding and Para REST viem account.
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

  /**
   * IDEA: publishAlert(contentHash, sourceEventHash, contentUri)
   */
  publishAlert(
    contentHash: string,
    sourceEventHash: string,
    contentUri: string,
  ): Promise<OnChainWriteReceipt>;

  /**
   * IDEA: publishDigest(contentHash, sourceEventRoot, contentUri)
   */
  publishDigest(
    contentHash: string,
    sourceEventRoot: string,
    contentUri: string,
  ): Promise<OnChainWriteReceipt>;

  /**
   * IDEA: createSponsoredWatch(..., uint64 startsAt, endsAt)
   */
  createSponsoredWatch(
    targetContract: string,
    watchSpecHash: string,
    startsAt: number,
    endsAt: number,
  ): Promise<SponsoredWatchWriteReceipt>;

  /**
   * IDEA: publishSponsoredReport(watchId, reportHash, sourceEventRoot, contentUri)
   */
  publishSponsoredReport(
    watchId: number,
    reportHash: string,
    sourceEventRoot: string,
    contentUri: string,
  ): Promise<OnChainWriteReceipt>;

  /**
   * IDEA reportType PremiumReceipt — optional premium intelligence receipt.
   */
  publishPremiumReceipt(
    contentHash: string,
    sourceEventHash: string,
    contentUri: string,
  ): Promise<OnChainWriteReceipt>;

  recordPayout(
    payoutPeriodHash: string,
    recipient: string,
    amount: number,
    reasonHash: string,
  ): Promise<OnChainWriteReceipt>;

  /**
   * Desk trade ticket: publishTradeTicket(ticketHash, signalHash, intentHash, contentUri).
   * contentUri should be the public `/desk/tickets/:id` page.
   */
  publishTradeTicket(
    ticketHash: string,
    signalHash: string,
    intentHash: string,
    contentUri: string,
  ): Promise<OnChainWriteReceipt>;

  /**
   * Desk capital audit: recordCapitalMove(moveId, from, to, amount, reasonHash).
   * amountUsdc is human USDC units (6 decimals on-chain).
   */
  recordCapitalMove(
    moveId: string,
    from: string,
    to: string,
    amountUsdc: number,
    reasonHash: string,
  ): Promise<OnChainWriteReceipt>;

  /**
   * Send USDC from the treasury wallet (human USDC units, e.g. 12.5).
   * Production: Para MPC ERC-20 transfer when configured, else KeeperHub transfer.
   */
  sendTransfer(to: string, amountUsdc: number): Promise<OnChainWriteReceipt>;

  /** Send an affiliate payout on the x402 payment rail (Base Sepolia by default). */
  sendAffiliateTransfer?(to: string, amountUsdc: number): Promise<OnChainWriteReceipt>;
}

/** Full ABI used by Para / direct-EOA paths (includes view helpers). */
const VIEM_REGISTRY_ABI = parseAbi([
  "function publishAlert(bytes32 contentHash, bytes32 sourceEventHash, string contentUri)",
  "function publishDigest(bytes32 contentHash, bytes32 sourceEventRoot, string contentUri)",
  "function createSponsoredWatch(address targetContract, bytes32 watchSpecHash, uint64 startsAt, uint64 endsAt) returns (uint256 watchId)",
  "function publishSponsoredReport(uint256 watchId, bytes32 reportHash, bytes32 sourceEventRoot, string contentUri)",
  "function publishPremiumReceipt(bytes32 contentHash, bytes32 sourceEventHash, string contentUri)",
  "function recordPayout(bytes32 payoutPeriodHash, address recipient, uint256 amount, bytes32 reasonHash)",
  "function publishTradeTicket(bytes32 ticketHash, bytes32 signalHash, bytes32 intentHash, string contentUri)",
  "function recordCapitalMove(bytes32 moveId, address from, address to, uint256 amount, bytes32 reasonHash)",
  "function owner() view returns (address)",
]);

const ERC20_TRANSFER_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

function asBytes32(value: string): Hex {
  return toBytes32Hash(value) as Hex;
}

function receiptWithGas(
  receipt: {
    transactionHash: Hash;
    gasUsed?: bigint;
    logs: Array<{ topics: readonly Hex[]; data: Hex }>;
  },
  network?: string,
  extra?: Partial<OnChainWriteReceipt>,
): OnChainWriteReceipt {
  const gasUsed = normalizeGasValue(receipt.gasUsed);
  return {
    txHash: receipt.transactionHash,
    explorerUrl: explorerUrlFor(receipt.transactionHash, network),
    ...(gasUsed ? { gasUsed } : {}),
    ...extra,
  };
}

function explorerUrlFor(txHash: string, network?: string): string {
  const n = (network ?? "sepolia").toLowerCase();
  if (n === "base" || n === "8453") {
    return `https://basescan.org/tx/${txHash}`;
  }
  if (n === "base-sepolia" || n === "84532") {
    return `https://sepolia.basescan.org/tx/${txHash}`;
  }
  if (n === "ethereum" || n === "mainnet" || n === "1") {
    return `https://etherscan.io/tx/${txHash}`;
  }
  // Default product home: Ethereum Sepolia
  return `https://sepolia.etherscan.io/tx/${txHash}`;
}

function isDirectEthersAllowed(env: ServerEnv): boolean {
  // Never allow direct EOA sends in production, even if the flag is set.
  if (env.nodeEnv === "production") {
    return false;
  }
  return env.allowDirectEthersWrites === true;
}

/**
 * Hybrid: KeeperHub workflows for registry writes and treasury transfers;
 * Para MPC is available only as the custody/signing provider behind this
 * KeeperHub-backed client.
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
    ...(env.keeperhubWorkflowPublishPremiumReceipt
      ? { publishPremiumReceipt: env.keeperhubWorkflowPublishPremiumReceipt }
      : {}),
    ...(env.keeperhubWorkflowRecordPayout
      ? { recordPayout: env.keeperhubWorkflowRecordPayout }
      : {}),
    ...(env.keeperhubWorkflowPublishTradeTicket
      ? { publishTradeTicket: env.keeperhubWorkflowPublishTradeTicket }
      : {}),
    ...(env.keeperhubWorkflowRecordCapitalMove
      ? { recordCapitalMove: env.keeperhubWorkflowRecordCapitalMove }
      : {}),
    ...(env.keeperhubWorkflowTransfer ? { transfer: env.keeperhubWorkflowTransfer } : {}),
  };
}

function routingPoliciesFromEnv(env: ServerEnv): {
  routingPolicy: PrivateRoutingPolicy;
  transferRoutingPolicy: PrivateRoutingPolicy;
} {
  const provider = env.routingProviderLabel?.trim() || "flashbots_protect";
  return {
    routingPolicy: {
      enabled: env.registryUsePrivateMempool !== false,
      strict: env.deskPrivateMempoolStrict !== false,
      provider,
      chainId: PRIVATE_ROUTING_CHAIN_ID,
    },
    transferRoutingPolicy: {
      enabled: false,
      strict: false,
      provider,
      chainId: PRIVATE_ROUTING_CHAIN_ID,
    },
  };
}

/** LLM map for LangChain MCP publication agent (Loop 1/2). */
function llmProvidersFromEnv(env: ServerEnv): LLMProviderMap {
  return createProviderConfigs(env);
}

/** KeeperHub MCP options for all material writes (preferred path). */
function keeperHubMcpOptionsFromEnv(env: ServerEnv): KeeperHubMcpWriteOptions {
  return {
    enabled: env.keeperhubMcpEnabled !== false,
    ...(env.keeperhubMcpUrl?.trim()
      ? { mcpUrl: env.keeperhubMcpUrl.trim() }
      : {}),
    llmProviders: llmProvidersFromEnv(env),
    langchainAgent: env.keeperhubMcpLangchainAgent !== false,
    restFallback: env.keeperhubMcpRestFallback !== false,
  };
}

/** True when KH transfer workflow + USDC address are ready for the public path. */
export function isKeeperHubTransferConfigured(env: ServerEnv): boolean {
  const workflow = env.keeperhubWorkflowTransfer?.trim();
  const usdc = env.deskUsdcAddress?.trim();
  return Boolean(
    workflow &&
      usdc &&
      /^0x[0-9a-fA-F]{40}$/.test(usdc) &&
      isKeeperHubWriteConfigured(env),
  );
}

/**
 * Resolve treasury transfer path for hybrid / capital-manager policy.
 * Exported for unit tests and capital-manager logging.
 */
export function resolveTreasuryTransferPath(
  env: ServerEnv,
  amountUsdc: number,
  options?: { paraAvailable?: boolean },
): TreasuryTransferPath {
  return selectTreasuryTransferPath({
    amountUsdc,
    thresholdUsdc: env.treasuryPrivateTransferThresholdUsdc,
    keeperHubTransferConfigured: isKeeperHubTransferConfigured(env),
    paraAvailable: options?.paraAvailable !== false,
  });
}

function createHybridParaKeeperHubWeb3Client(
  env: ServerEnv,
  paraClient: ParaTreasuryClient,
  options?: { execLogRepo?: import("@chronicleai/db").ExecutionLogRepository | null },
): Web3Client {
  const routing = routingPoliciesFromEnv(env);
  const mcp = keeperHubMcpOptionsFromEnv(env);
  if (mcp.enabled) {
    console.info(
      "[web3] Material writes prefer KeeperHub MCP " +
        "(list_workflows → execute_workflow → get_execution); " +
        `REST fallback=${mcp.restFallback !== false}; ` +
        `LangChain alert/digest=${mcp.langchainAgent !== false}`,
    );
  }
  const kh = createKeeperHubWriteClient({
    apiBaseUrl: env.keeperhubApiBaseUrl as string,
    apiKey: env.keeperhubApiKey as string,
    network: env.keeperhubNetwork,
    registryAddress: env.chronicleRegistryAddress as string,
    usdcAddress: env.deskUsdcAddress,
    workflowIds: keeperHubWorkflowIdsFromEnv(env),
    execLogRepo: options?.execLogRepo ?? null,
    routingPolicy: routing.routingPolicy,
    transferRoutingPolicy: routing.transferRoutingPolicy,
    mcp,
  });
  const affiliateKh = createKeeperHubWriteClient({
    apiBaseUrl: env.keeperhubApiBaseUrl as string,
    apiKey: env.keeperhubApiKey as string,
    network: networkLabelForChainId(env.x402ChainId),
    registryAddress: env.chronicleRegistryAddress as string,
    usdcAddress: env.x402UsdcAddress,
    workflowIds: { transfer: env.keeperhubWorkflowTransfer },
    execLogRepo: options?.execLogRepo ?? null,
    transferRoutingPolicy: routing.transferRoutingPolicy,
    mcp,
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

    publishAlert: (contentHash, sourceEventHash, contentUri) =>
      kh.publishAlert(contentHash, sourceEventHash, contentUri),
    publishDigest: (contentHash, sourceEventRoot, contentUri) =>
      kh.publishDigest(contentHash, sourceEventRoot, contentUri),
    createSponsoredWatch: (targetContract, watchSpecHash, startsAt, endsAt) =>
      kh.createSponsoredWatch(targetContract, watchSpecHash, startsAt, endsAt),
    publishSponsoredReport: (watchId, reportHash, sourceEventRoot, contentUri) =>
      kh.publishSponsoredReport(watchId, reportHash, sourceEventRoot, contentUri),
    publishPremiumReceipt: (contentHash, sourceEventHash, contentUri) =>
      kh.publishPremiumReceipt(contentHash, sourceEventHash, contentUri),
    recordPayout: (payoutPeriodHash, recipient, amount, reasonHash) =>
      kh.recordPayout(payoutPeriodHash, recipient, amount, reasonHash),
    publishTradeTicket: (ticketHash, signalHash, intentHash, contentUri) =>
      kh.publishTradeTicket(ticketHash, signalHash, intentHash, contentUri),
    recordCapitalMove: (moveId, from, to, amountUsdc, reasonHash) =>
      kh.recordCapitalMove(moveId, from, to, amountUsdc, reasonHash),

    /** Every demo-visible treasury transfer must execute through KeeperHub. */
    async sendTransfer(to, amountUsdc) {
      if (!(amountUsdc > 0) || !Number.isFinite(amountUsdc)) {
        throw new Error(`Invalid USDC transfer amount: ${amountUsdc}`);
      }
      console.info(
        `[web3] Treasury transfer ${amountUsdc} USDC → public KeeperHub workflow path`,
      );
      return kh.sendTransfer(to, amountUsdc);
    },

    sendAffiliateTransfer: (to, amountUsdc) => affiliateKh.sendTransfer(to, amountUsdc),
  };
}

/**
 * Full Para production client — registry + treasury via Para REST viem account.
 * Used when PARA_API_KEY is set but KeeperHub is not.
 */
function createParaWeb3Client(
  env: ServerEnv,
  paraClient: ParaTreasuryClient,
  affiliateParaClient: ParaTreasuryClient | null,
): Web3Client {
  if (!env.rpcUrl || !env.chronicleRegistryAddress) {
    throw new Error(
      "Para-only web3 client requires RPC_URL and CHRONICLE_REGISTRY_ADDRESS for registry writes",
    );
  }

  const restClient = new ParaRestClient({
    apiKey: env.paraApiKey as string,
    env: env.paraEnvironment,
  });

  const chainId = mapNetworkToChainId(env.keeperhubNetwork, 11_155_111);
  const chain = chainFromId(chainId);
  const rpcUrl = env.rpcUrl;
  const registryAddress = env.chronicleRegistryAddress as Address;
  const network = env.keeperhubNetwork;

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  let signerAddressPromise: Promise<string> | undefined;

  async function getWalletClient() {
    const wallet = await paraClient.ensureWallet();
    const account = createParaRestViemAccount({
      client: restClient,
      walletId: wallet.walletId,
      address: wallet.address as Address,
    });
    return {
      account,
      walletClient: createWalletClient({
        account,
        chain,
        transport: http(rpcUrl),
      }),
    };
  }

  async function writeRegistry(
    // Dynamic registry method dispatch — args validated by ABI at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    functionName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: readonly any[],
  ) {
    const { account, walletClient } = await getWalletClient();
    const hash = await walletClient.writeContract({
      address: registryAddress,
      abi: VIEM_REGISTRY_ABI,
      functionName: functionName as "publishAlert",
      args: args as never,
      account,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(`Transaction failed or reverted: ${hash}`);
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

    async publishAlert(contentHash, sourceEventHash, contentUri) {
      const receipt = await writeRegistry("publishAlert", [
        asBytes32(contentHash),
        asBytes32(sourceEventHash),
        contentUri,
      ]);
      return receiptWithGas(receipt, network);
    },

    async publishDigest(contentHash, sourceEventRoot, contentUri) {
      const receipt = await writeRegistry("publishDigest", [
        asBytes32(contentHash),
        asBytes32(sourceEventRoot),
        contentUri,
      ]);
      return receiptWithGas(receipt, network);
    },

    async createSponsoredWatch(targetContract, watchSpecHash, startsAt, endsAt) {
      const receipt = await writeRegistry("createSponsoredWatch", [
        getAddress(targetContract) as Address,
        asBytes32(watchSpecHash),
        toUint64Seconds(startsAt),
        toUint64Seconds(endsAt),
      ]);
      const watchId = decodeSponsoredWatchIdFromLogs(
        receipt.logs,
        "Para createSponsoredWatch",
      );
      return {
        ...receiptWithGas(receipt, network),
        watchId,
      };
    },

    async publishSponsoredReport(watchId, reportHash, sourceEventRoot, contentUri) {
      const receipt = await writeRegistry("publishSponsoredReport", [
        BigInt(watchId),
        asBytes32(reportHash),
        asBytes32(sourceEventRoot),
        contentUri,
      ]);
      return receiptWithGas(receipt, network);
    },

    async publishPremiumReceipt(contentHash, sourceEventHash, contentUri) {
      const receipt = await writeRegistry("publishPremiumReceipt", [
        asBytes32(contentHash),
        asBytes32(sourceEventHash),
        contentUri,
      ]);
      return receiptWithGas(receipt, network);
    },

    async recordPayout(payoutPeriodHash, recipient, amount, reasonHash) {
      const receipt = await writeRegistry("recordPayout", [
        asBytes32(payoutPeriodHash),
        getAddress(recipient) as Address,
        parseUnits(String(amount), 6),
        asBytes32(reasonHash),
      ]);
      return receiptWithGas(receipt, network);
    },

    async publishTradeTicket(ticketHash, signalHash, intentHash, contentUri) {
      const receipt = await writeRegistry("publishTradeTicket", [
        asBytes32(ticketHash),
        asBytes32(signalHash),
        asBytes32(intentHash),
        contentUri,
      ]);
      return receiptWithGas(receipt, network);
    },

    async recordCapitalMove(moveId, from, to, amountUsdc, reasonHash) {
      const receipt = await writeRegistry("recordCapitalMove", [
        asBytes32(moveId),
        getAddress(from) as Address,
        getAddress(to) as Address,
        parseUnits(String(amountUsdc), 6),
        asBytes32(reasonHash),
      ]);
      return receiptWithGas(receipt, network);
    },

    sendTransfer: (to, amountUsdc) => paraClient.sendTransfer(to, amountUsdc),
    ...(affiliateParaClient
      ? {
          sendAffiliateTransfer: (to: string, amountUsdc: number) =>
            affiliateParaClient.sendTransfer(to, amountUsdc),
        }
      : {}),
  };
}

function createKeeperHubBackedWeb3Client(
  env: ServerEnv,
  options?: { execLogRepo?: import("@chronicleai/db").ExecutionLogRepository | null },
): Web3Client {
  const routing = routingPoliciesFromEnv(env);
  const mcp = keeperHubMcpOptionsFromEnv(env);
  if (mcp.enabled) {
    console.info(
      "[web3] Material writes prefer KeeperHub MCP " +
        "(list_workflows → execute_workflow → get_execution); " +
        `REST fallback=${mcp.restFallback !== false}; ` +
        `LangChain alert/digest=${mcp.langchainAgent !== false}`,
    );
  }
  const kh = createKeeperHubWriteClient({
    apiBaseUrl: env.keeperhubApiBaseUrl as string,
    apiKey: env.keeperhubApiKey as string,
    network: env.keeperhubNetwork,
    registryAddress: env.chronicleRegistryAddress as string,
    usdcAddress: env.deskUsdcAddress,
    workflowIds: keeperHubWorkflowIdsFromEnv(env),
    execLogRepo: options?.execLogRepo ?? null,
    routingPolicy: routing.routingPolicy,
    transferRoutingPolicy: routing.transferRoutingPolicy,
    mcp,
  });
  const affiliateKh = createKeeperHubWriteClient({
    apiBaseUrl: env.keeperhubApiBaseUrl as string,
    apiKey: env.keeperhubApiKey as string,
    network: networkLabelForChainId(env.x402ChainId),
    registryAddress: env.chronicleRegistryAddress as string,
    usdcAddress: env.x402UsdcAddress,
    workflowIds: { transfer: env.keeperhubWorkflowTransfer },
    execLogRepo: options?.execLogRepo ?? null,
    transferRoutingPolicy: routing.transferRoutingPolicy,
    mcp,
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

    publishAlert: (contentHash, sourceEventHash, contentUri) =>
      kh.publishAlert(contentHash, sourceEventHash, contentUri),
    publishDigest: (contentHash, sourceEventRoot, contentUri) =>
      kh.publishDigest(contentHash, sourceEventRoot, contentUri),
    createSponsoredWatch: (targetContract, watchSpecHash, startsAt, endsAt) =>
      kh.createSponsoredWatch(targetContract, watchSpecHash, startsAt, endsAt),
    publishSponsoredReport: (watchId, reportHash, sourceEventRoot, contentUri) =>
      kh.publishSponsoredReport(watchId, reportHash, sourceEventRoot, contentUri),
    publishPremiumReceipt: (contentHash, sourceEventHash, contentUri) =>
      kh.publishPremiumReceipt(contentHash, sourceEventHash, contentUri),
    recordPayout: (payoutPeriodHash, recipient, amount, reasonHash) =>
      kh.recordPayout(payoutPeriodHash, recipient, amount, reasonHash),
    publishTradeTicket: (ticketHash, signalHash, intentHash, contentUri) =>
      kh.publishTradeTicket(ticketHash, signalHash, intentHash, contentUri),
    recordCapitalMove: (moveId, from, to, amountUsdc, reasonHash) =>
      kh.recordCapitalMove(moveId, from, to, amountUsdc, reasonHash),
    sendTransfer: (to, amountUsdc) => kh.sendTransfer(to, amountUsdc),
    sendAffiliateTransfer: (to, amountUsdc) => affiliateKh.sendTransfer(to, amountUsdc),
  };
}

/**
 * Direct EOA client — LOCAL UNIT TESTS ONLY.
 * Gated by ALLOW_DIRECT_ETHERS_WRITES=true and never enabled in production.
 */
function createDirectEoaWeb3Client(env: ServerEnv): Web3Client {
  if (!env.rpcUrl || !env.chronicleRegistryAddress || !env.paraWalletPrivateKey) {
    throw new Error(
      "Direct EOA client requires RPC_URL, CHRONICLE_REGISTRY_ADDRESS, and PARA_WALLET_PRIVATE_KEY (test-only agent EOA)",
    );
  }

  const chainId = mapNetworkToChainId(env.keeperhubNetwork, 11_155_111);
  const chain = chainFromId(chainId);
  const rpcUrl = env.rpcUrl;
  const agentKey = (
    env.paraWalletPrivateKey.startsWith("0x")
      ? env.paraWalletPrivateKey
      : `0x${env.paraWalletPrivateKey}`
  ) as Hex;
  const agentAccount: PrivateKeyAccount = privateKeyToAccount(agentKey);
  const registryAddress = env.chronicleRegistryAddress as Address;

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const agentWallet = createWalletClient({
    account: agentAccount,
    chain,
    transport: http(rpcUrl),
  });

  const treasury = resolveTreasuryWallet(env, { keeperHubBacked: false });
  let treasuryAccount: PrivateKeyAccount | undefined;
  if (treasury.privateKey) {
    treasuryAccount = privateKeyToAccount(treasury.privateKey as Hex);
  }

  const network = env.keeperhubNetwork;

  async function writeRegistry(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    functionName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: readonly any[],
  ) {
    const hash = await agentWallet.writeContract({
      address: registryAddress,
      abi: VIEM_REGISTRY_ABI,
      functionName: functionName as "publishAlert",
      args: args as never,
      account: agentAccount,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(`Transaction failed or reverted: ${hash}`);
    }
    return receipt;
  }

  return {
    async getSignerAddress() {
      return agentAccount.address;
    },

    async getTreasuryAddress() {
      if (treasuryAccount) {
        return treasuryAccount.address;
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

    async publishAlert(contentHash, sourceEventHash, contentUri) {
      const receipt = await writeRegistry("publishAlert", [
        asBytes32(contentHash),
        asBytes32(sourceEventHash),
        contentUri,
      ]);
      return receiptWithGas(receipt, network);
    },

    async publishDigest(contentHash, sourceEventRoot, contentUri) {
      const receipt = await writeRegistry("publishDigest", [
        asBytes32(contentHash),
        asBytes32(sourceEventRoot),
        contentUri,
      ]);
      return receiptWithGas(receipt, network);
    },

    async createSponsoredWatch(targetContract, watchSpecHash, startsAt, endsAt) {
      const receipt = await writeRegistry("createSponsoredWatch", [
        getAddress(targetContract) as Address,
        asBytes32(watchSpecHash),
        toUint64Seconds(startsAt),
        toUint64Seconds(endsAt),
      ]);
      const watchId = decodeSponsoredWatchIdFromLogs(
        receipt.logs,
        "direct-eoa createSponsoredWatch",
      );
      return {
        ...receiptWithGas(receipt, network),
        watchId,
      };
    },

    async publishSponsoredReport(watchId, reportHash, sourceEventRoot, contentUri) {
      const receipt = await writeRegistry("publishSponsoredReport", [
        BigInt(watchId),
        asBytes32(reportHash),
        asBytes32(sourceEventRoot),
        contentUri,
      ]);
      return receiptWithGas(receipt, network);
    },

    async publishPremiumReceipt(contentHash, sourceEventHash, contentUri) {
      const receipt = await writeRegistry("publishPremiumReceipt", [
        asBytes32(contentHash),
        asBytes32(sourceEventHash),
        contentUri,
      ]);
      return receiptWithGas(receipt, network);
    },

    async recordPayout(payoutPeriodHash, recipient, amount, reasonHash) {
      const receipt = await writeRegistry("recordPayout", [
        asBytes32(payoutPeriodHash),
        getAddress(recipient) as Address,
        parseUnits(String(amount), 6),
        asBytes32(reasonHash),
      ]);
      return receiptWithGas(receipt, network);
    },

    async publishTradeTicket(ticketHash, signalHash, intentHash, contentUri) {
      const receipt = await writeRegistry("publishTradeTicket", [
        asBytes32(ticketHash),
        asBytes32(signalHash),
        asBytes32(intentHash),
        contentUri,
      ]);
      return receiptWithGas(receipt, network);
    },

    async recordCapitalMove(moveId, from, to, amountUsdc, reasonHash) {
      const receipt = await writeRegistry("recordCapitalMove", [
        asBytes32(moveId),
        getAddress(from) as Address,
        getAddress(to) as Address,
        parseUnits(String(amountUsdc), 6),
        asBytes32(reasonHash),
      ]);
      return receiptWithGas(receipt, network);
    },

    async sendTransfer(to, amountUsdc) {
      if (!treasuryAccount) {
        throw new Error(
          "Treasury spending key is not configured — set TREASURY_WALLET_PRIVATE_KEY for direct EOA USDC transfers (test-only path), or configure PARA_API_KEY for production Para MPC",
        );
      }
      if (!(amountUsdc > 0) || !Number.isFinite(amountUsdc)) {
        throw new Error(`Invalid USDC transfer amount: ${amountUsdc}`);
      }
      const usdcAddress = env.deskUsdcAddress?.trim();
      if (!usdcAddress || !isAddress(usdcAddress, { strict: false })) {
        throw new Error(
          "DESK_USDC_ADDRESS must be a valid ERC-20 address for treasury USDC transfers",
        );
      }
      const treasuryWallet = createWalletClient({
        account: treasuryAccount,
        chain,
        transport: http(rpcUrl),
      });
      const hash = await treasuryWallet.writeContract({
        address: getAddress(usdcAddress) as Address,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [getAddress(to) as Address, parseUnits(String(amountUsdc), 6)],
        account: treasuryAccount,
        chain,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        throw new Error("USDC sendTransfer transaction failed");
      }
      return {
        txHash: receipt.transactionHash,
        explorerUrl: explorerUrlFor(receipt.transactionHash, network),
      };
    },
  };
}

/**
 * Create the production Web3 client.
 *
 * Priority:
 * 1. Para MPC custody + KeeperHub workflows (PARA_API_KEY + KEEPERHUB_*)
 * 2. KeeperHub only
 * 3. Para MPC only (development/test compatibility only)
 * 4. Direct EOA — only when ALLOW_DIRECT_ETHERS_WRITES=true and not production
 * 5. null — no write path configured (dev/test only; production fail-hard)
 */
export function createWeb3Client(
  env: ServerEnv,
  options?: { execLogRepo?: import("@chronicleai/db").ExecutionLogRepository | null },
): Web3Client | null {
  const paraClient = createParaTreasuryClientFromEnv(env);
  const affiliateParaClient = paraClient
    ? createParaTreasuryClientFromEnv(env, "x402")
    : null;
  const keeperHub = isKeeperHubWriteConfigured(env);
  const isProduction = env.nodeEnv === "production";
  const logOpts = options?.execLogRepo !== undefined ? { execLogRepo: options.execLogRepo } : {};

  if (isProduction && !keeperHub) {
    throw new Error(
      "KeeperHub is required in production — configure KEEPERHUB_API_KEY, KEEPERHUB_API_BASE_URL, and CHRONICLE_REGISTRY_ADDRESS. Para MPC may only back KeeperHub workflows.",
    );
  }

  if (paraClient && keeperHub) {
    console.info(
      "[web3] Production path: Para MPC + KeeperHub hybrid " +
        `(treasury transfers: ≥${env.treasuryPrivateTransferThresholdUsdc} USDC → KH private when transfer workflow set; else Para)`,
    );
    return createHybridParaKeeperHubWeb3Client(env, paraClient, logOpts);
  }

  if (!isProduction && paraClient && env.rpcUrl && env.chronicleRegistryAddress) {
    console.info(
      "[web3] Development/test compatibility path: Para MPC registry writes and treasury transfers",
    );
    return createParaWeb3Client(env, paraClient, affiliateParaClient);
  }

  if (paraClient && !keeperHub) {
    const msg =
      "[web3] PARA_API_KEY is set but CHRONICLE_REGISTRY_ADDRESS/RPC_URL missing and KeeperHub is not configured — treasury-only Para client unavailable for full Web3Client";
    if (isProduction) {
      throw new Error(`${msg}. Configure KeeperHub for production.`);
    }
    console.warn(msg);
  }

  if (keeperHub) {
    return createKeeperHubBackedWeb3Client(env, logOpts);
  }

  if (isDirectEthersAllowed(env)) {
    if (!env.rpcUrl || !env.chronicleRegistryAddress || !env.paraWalletPrivateKey) {
      if (isProduction) {
        throw new Error(
          "Direct EOA path incomplete and disallowed in production — configure PARA_API_KEY and/or KeeperHub",
        );
      }
      return null;
    }
    console.warn(
      "[web3] ALLOW_DIRECT_ETHERS_WRITES is enabled — using direct EOA (local tests only). Production should use PARA_API_KEY and/or KeeperHub.",
    );
    return createDirectEoaWeb3Client(env);
  }

  if (env.paraWalletPrivateKey && env.nodeEnv !== "test") {
    console.warn(
      "[web3] Direct EOA writes are disabled. Configure PARA_API_KEY for Para MPC treasury (production) and/or KEEPERHUB_API_KEY + KEEPERHUB_API_BASE_URL for registry writes.",
    );
  }

  if (isParaTreasuryConfigured(env) && env.nodeEnv !== "test") {
    console.warn(
      "[web3] PARA_API_KEY present but incomplete write path. Add KEEPERHUB_*; Para is only a custody/signing provider behind KeeperHub workflows in production.",
    );
  }

  if (isProduction) {
    throw new Error(
      "Web3 client not configured in production — set KeeperHub (KEEPERHUB_API_KEY + KEEPERHUB_API_BASE_URL + CHRONICLE_REGISTRY_ADDRESS).",
    );
  }

  return null;
}
