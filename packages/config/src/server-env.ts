// Typed server-side environment configuration
// Reads from process.env and validates required keys

export interface ServerEnv {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  keeperhubWebhookSecret: string;
  operatorAuthSecret: string;
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
  mppSecret: string | undefined;
  treasuryWalletAddress: string | undefined;
  chronicleRegistryAddress: string | undefined;
  rpcUrl: string | undefined;
  paraWalletPrivateKey: string | undefined;
  webflowApiToken: string | undefined;
  webflowCollectionId: string | undefined;
  smtpHost: string | undefined;
  smtpPort: number | undefined;
  smtpUser: string | undefined;
  smtpPass: string | undefined;
  smtpFromAddress: string | undefined;
  smtpSubscriberList: string[] | undefined;
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

export function loadServerEnv(): ServerEnv {
  const nodeEnv = optionalEnv("NODE_ENV", "development") as string;

  return {
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    keeperhubWebhookSecret: requireEnv("KEEPERHUB_WEBHOOK_SECRET"),
    operatorAuthSecret: requireEnv("OPERATOR_AUTH_SECRET"),
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
    mppSecret: optionalEnv("MPP_SECRET") ?? optionalEnv("MPP_SECRET_KEY"),
    treasuryWalletAddress: optionalEnv("TREASURY_WALLET_ADDRESS"),
    chronicleRegistryAddress: optionalEnv("CHRONICLE_REGISTRY_ADDRESS"),
    rpcUrl: optionalEnv("RPC_URL"),
    paraWalletPrivateKey: optionalEnv("PARA_WALLET_PRIVATE_KEY"),
    webflowApiToken: optionalEnv("WEBFLOW_API_TOKEN"),
    webflowCollectionId: optionalEnv("WEBFLOW_COLLECTION_ID"),
    smtpHost: optionalEnv("SMTP_HOST"),
    smtpPort: optionalEnv("SMTP_PORT") ? Number(optionalEnv("SMTP_PORT")) : undefined,
    smtpUser: optionalEnv("SMTP_USER"),
    smtpPass: optionalEnv("SMTP_PASS"),
    smtpFromAddress: optionalEnv("SMTP_FROM_ADDRESS"),
    smtpSubscriberList: optionalEnv("SMTP_SUBSCRIBER_LIST")?.split(",").map((s) => s.trim()),
    frontendOrigin: requireEnv("FRONTEND_ORIGIN"),
    port: Number(optionalEnv("PORT", "4000")),
    nodeEnv,
  };
}
