// Typed client-side environment configuration
// Reads VITE_* prefixed variables only - never access server-only process.env
// This file is only imported by Vite-bundled code (the web app)

/** Default matches server X402_CHAIN_ID default (Base Sepolia). */
const DEFAULT_X402_CHAIN_ID = 84_532;

export interface ClientEnv {
  apiBaseUrl: string;
  supabaseUrl: string | undefined;
  supabaseAnonKey: string | undefined;
  /**
   * Public EVM chain id for x402 wallet payments (must match server X402_CHAIN_ID).
   * Safe to expose — no secrets.
   */
  x402ChainId: number;
  /**
   * Optional public RPC URL used when adding the chain to a browser wallet.
   */
  x402RpcUrl: string | undefined;
  /**
   * Public WalletConnect Cloud project id for RainbowKit mobile / WC wallets.
   */
  walletConnectProjectId: string | undefined;
}

// Vite exposes env vars via import.meta.env at build time
declare global {
  interface ImportMetaEnv {
    VITE_API_BASE_URL: string;
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_ANON_KEY?: string;
    VITE_X402_CHAIN_ID?: string;
    VITE_X402_RPC_URL?: string;
    VITE_WALLETCONNECT_PROJECT_ID?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

export function loadClientEnv(): ClientEnv {
  let apiBaseUrl = "http://localhost:4000";
  let supabaseUrl: string | undefined;
  let supabaseAnonKey: string | undefined;
  let x402ChainId = DEFAULT_X402_CHAIN_ID;
  let x402RpcUrl: string | undefined;
  let walletConnectProjectId: string | undefined;

  try {
    apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? apiBaseUrl;
    supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    x402ChainId = parsePositiveInt(import.meta.env.VITE_X402_CHAIN_ID, DEFAULT_X402_CHAIN_ID);
    const rpc = import.meta.env.VITE_X402_RPC_URL;
    if (typeof rpc === "string" && rpc.trim()) {
      x402RpcUrl = rpc.trim();
    }
    const wc = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
    if (typeof wc === "string" && wc.trim()) {
      walletConnectProjectId = wc.trim();
    }
  } catch {
    // import.meta.env is only available in Vite builds
  }

  return {
    apiBaseUrl,
    supabaseUrl,
    supabaseAnonKey,
    x402ChainId,
    x402RpcUrl,
    walletConnectProjectId,
  };
}
