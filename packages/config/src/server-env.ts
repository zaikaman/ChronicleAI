// Typed server-side environment configuration
// Reads from process.env and validates required keys

export interface ServerEnv {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  keeperhubWebhookSecret: string;
  geminiApiKey: string;
  geminiModel: string;
  geminiBaseUrl: string | undefined;
  openaiApiKey: string;
  openaiModel: string;
  openaiBaseUrl: string | undefined;
  groqApiKey: string;
  groqModel: string;
  groqBaseUrl: string | undefined;
  x402FacilitatorUrl: string | undefined;
  /**
   * EVM chain ID for x402 EIP-712 domain + settlement (default Base Sepolia = 84532).
   * Set to 8453 for Base mainnet when deploying production multi-chain payments.
   */
  x402ChainId: number;
  /**
   * USDC (EIP-3009) contract address used as verifyingContract / asset for x402.
   * Default is Circle official USDC on Base Sepolia.
   * Base mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
   */
  x402UsdcAddress: string;
  mppSecret: string | undefined;
  /**
   * HMAC secret for premium access receipts (min 16 chars).
   * Falls back to keeperhubWebhookSecret when unset.
   */
  premiumAccessSecret: string | undefined;
  /**
   * Optional public treasury address for x402 `to`.
   * Prefer deriving this from TREASURY_WALLET_PRIVATE_KEY (see apps/api treasury-wallet).
   * If both are set, they must match.
   */
  treasuryWalletAddress: string | undefined;
  /**
   * Private key for the treasury wallet that receives premium payments and
   * signs outbound revenue-routing transfers. Required for real payouts.
   * Distinct from CREATOR_RECOVERY_WALLET (payout destination) and
   * PARA_WALLET_PRIVATE_KEY (registry / agent ops).
   */
  treasuryWalletPrivateKey: string | undefined;
  /** Creator recovery payout recipient (required for revenue routing). */
  creatorRecoveryWallet: string | undefined;
  /**
   * Converts currency-unit payout amounts to native ETH for transfers.
   * Defaults to 1e-6 when unset (1_000 units → 0.001 ETH).
   */
  revenueEthPerCurrencyUnit: number;
  chronicleRegistryAddress: string | undefined;
  rpcUrl: string | undefined;
  /**
   * Para / agent key for registry writes — ONLY used when
   * ALLOW_DIRECT_ETHERS_WRITES=true (local unit tests). Production writes go
   * through KeeperHub (KEEPERHUB_API_KEY).
   */
  paraWalletPrivateKey: string | undefined;
  /**
   * When true (and NODE_ENV is not production), allow direct ethers
   * sendTransaction for local unit tests. Default false — KeeperHub only.
   */
  allowDirectEthersWrites: boolean;
  /** KeeperHub REST base URL (e.g. https://app.keeperhub.com). */
  keeperhubApiBaseUrl: string | undefined;
  /** Organization API key (kh_…). Required for material production writes. */
  keeperhubApiKey: string | undefined;
  /** KeeperHub network slug / chain id for writes (default base-sepolia). */
  keeperhubNetwork: string;
  /** Optional pre-imported workflow IDs for write actions. */
  keeperhubWorkflowPublishAlert: string | undefined;
  keeperhubWorkflowPublishDigest: string | undefined;
  keeperhubWorkflowCreateSponsoredWatch: string | undefined;
  keeperhubWorkflowPublishSponsoredReport: string | undefined;
  keeperhubWorkflowRecordPayout: string | undefined;
  keeperhubWorkflowTransfer: string | undefined;
  smtpHost: string | undefined;
  smtpPort: number | undefined;
  smtpUser: string | undefined;
  smtpPass: string | undefined;
  smtpFromAddress: string | undefined;
  /**
   * Discord incoming webhook URL for community alert/bulletin broadcasts.
   * Must be https://discord.com|discordapp.com/api/webhooks/...
   */
  discordWebhookUrl: string | undefined;
  /** Telegram Bot API token from @BotFather. */
  telegramBotToken: string | undefined;
  /** Telegram chat/channel ID that receives alert broadcasts. */
  telegramChatId: string | undefined;
  frontendOrigin: string;
  port: number;
  nodeEnv: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

/** Base Sepolia — default hackathon / demo target for x402. */
const DEFAULT_X402_CHAIN_ID = 84_532;
/** Circle official USDC on Base Sepolia (EIP-3009). */
const DEFAULT_X402_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${name}: expected a positive integer chain ID, got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

function parseEvmAddressEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const address = raw.trim();
  if (!EVM_ADDRESS_RE.test(address)) {
    throw new Error(
      `Invalid ${name}: expected a 0x-prefixed 40-hex EVM address, got ${JSON.stringify(raw)}`,
    );
  }
  return address;
}

export function loadServerEnv(): ServerEnv {
  const nodeEnv = optionalEnv("NODE_ENV", "development") as string;

  return {
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    keeperhubWebhookSecret: requireEnv("KEEPERHUB_WEBHOOK_SECRET"),
    geminiApiKey: optionalEnv("GEMINI_API_KEY", "") as string,
    geminiModel: optionalEnv("GEMINI_MODEL", "gemini-2.0-flash") as string,
    geminiBaseUrl: optionalEnv("GEMINI_BASE_URL"),
    openaiApiKey: optionalEnv("OPENAI_API_KEY", "") as string,
    openaiModel: optionalEnv("OPENAI_MODEL", "gpt-4o-mini") as string,
    openaiBaseUrl: optionalEnv("OPENAI_BASE_URL"),
    groqApiKey: optionalEnv("GROQ_API_KEY", "") as string,
    groqModel: optionalEnv("GROQ_MODEL", "llama-3.3-70b-versatile") as string,
    groqBaseUrl: optionalEnv("GROQ_BASE_URL"),
    x402FacilitatorUrl: optionalEnv("X402_FACILITATOR_URL"),
    x402ChainId: parsePositiveIntEnv("X402_CHAIN_ID", DEFAULT_X402_CHAIN_ID),
    x402UsdcAddress: parseEvmAddressEnv("X402_USDC_ADDRESS", DEFAULT_X402_USDC_ADDRESS),
    mppSecret: optionalEnv("MPP_SECRET"),
    premiumAccessSecret: optionalEnv("PREMIUM_ACCESS_SECRET"),
    treasuryWalletAddress: optionalEnv("TREASURY_WALLET_ADDRESS"),
    treasuryWalletPrivateKey: optionalEnv("TREASURY_WALLET_PRIVATE_KEY"),
    creatorRecoveryWallet: optionalEnv("CREATOR_RECOVERY_WALLET"),
    revenueEthPerCurrencyUnit: Number(
      optionalEnv("REVENUE_ETH_PER_CURRENCY_UNIT", "0.000001"),
    ),
    chronicleRegistryAddress: optionalEnv("CHRONICLE_REGISTRY_ADDRESS"),
    rpcUrl: optionalEnv("RPC_URL"),
    paraWalletPrivateKey: optionalEnv("PARA_WALLET_PRIVATE_KEY"),
    allowDirectEthersWrites:
      optionalEnv("ALLOW_DIRECT_ETHERS_WRITES", "false")?.toLowerCase() === "true",
    keeperhubApiBaseUrl: optionalEnv("KEEPERHUB_API_BASE_URL"),
    keeperhubApiKey: optionalEnv("KEEPERHUB_API_KEY"),
    keeperhubNetwork: optionalEnv("KEEPERHUB_NETWORK", "base-sepolia") as string,
    keeperhubWorkflowPublishAlert: optionalEnv("KEEPERHUB_WORKFLOW_PUBLISH_ALERT"),
    keeperhubWorkflowPublishDigest: optionalEnv("KEEPERHUB_WORKFLOW_PUBLISH_DIGEST"),
    keeperhubWorkflowCreateSponsoredWatch: optionalEnv(
      "KEEPERHUB_WORKFLOW_CREATE_SPONSORED_WATCH",
    ),
    keeperhubWorkflowPublishSponsoredReport: optionalEnv(
      "KEEPERHUB_WORKFLOW_PUBLISH_SPONSORED_REPORT",
    ),
    keeperhubWorkflowRecordPayout: optionalEnv("KEEPERHUB_WORKFLOW_RECORD_PAYOUT"),
    keeperhubWorkflowTransfer: optionalEnv("KEEPERHUB_WORKFLOW_TRANSFER"),
    smtpHost: optionalEnv("SMTP_HOST"),
    smtpPort: optionalEnv("SMTP_PORT") ? Number(optionalEnv("SMTP_PORT")) : undefined,
    smtpUser: optionalEnv("SMTP_USER"),
    smtpPass: optionalEnv("SMTP_PASS"),
    smtpFromAddress: optionalEnv("SMTP_FROM_ADDRESS"),
    discordWebhookUrl: optionalEnv("DISCORD_WEBHOOK_URL"),
    telegramBotToken: optionalEnv("TELEGRAM_BOT_TOKEN"),
    telegramChatId: optionalEnv("TELEGRAM_CHAT_ID"),
    frontendOrigin: requireEnv("FRONTEND_ORIGIN"),
    port: Number(optionalEnv("PORT", "4000")),
    nodeEnv,
  };
}
