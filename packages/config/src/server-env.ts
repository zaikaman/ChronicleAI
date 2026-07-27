// Typed server-side environment configuration
// Reads from process.env and validates required keys

export interface ServerEnv {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  keeperhubWebhookSecret: string;
  operatorAuthSecret: string;
  geminiApiKey: string;
  geminiModel: string;
  openaiApiKey: string;
  openaiModel: string;
  groqApiKey: string;
  groqModel: string;
  x402FacilitatorUrl: string | undefined;
  mppSecret: string | undefined;
  treasuryWalletAddress: string | undefined;
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
    openaiApiKey: optionalEnv("OPENAI_API_KEY", "") as string,
    openaiModel: optionalEnv("OPENAI_MODEL", "gpt-4o-mini") as string,
    groqApiKey: optionalEnv("GROQ_API_KEY", "") as string,
    groqModel: optionalEnv("GROQ_MODEL", "llama-3.3-70b-versatile") as string,
    x402FacilitatorUrl: optionalEnv("X402_FACILITATOR_URL"),
    mppSecret: optionalEnv("MPP_SECRET"),
    treasuryWalletAddress: optionalEnv("TREASURY_WALLET_ADDRESS"),
    frontendOrigin: requireEnv("FRONTEND_ORIGIN"),
    port: Number(optionalEnv("PORT", "4000")),
    nodeEnv,
  };
}
