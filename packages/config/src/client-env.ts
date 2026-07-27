// Typed client-side environment configuration
// Reads VITE_* prefixed variables only - never access server-only process.env
// This file is only imported by Vite-bundled code (the web app)

export interface ClientEnv {
  apiBaseUrl: string;
  supabaseUrl: string | undefined;
  supabaseAnonKey: string | undefined;
}

// Vite exposes env vars via import.meta.env at build time
declare global {
  interface ImportMetaEnv {
    VITE_API_BASE_URL: string;
    VITE_OPERATOR_TOKEN?: string;
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_ANON_KEY?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export function loadClientEnv(): ClientEnv {
  let apiBaseUrl = "http://localhost:4000";
  let supabaseUrl: string | undefined;
  let supabaseAnonKey: string | undefined;

  try {
    apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? apiBaseUrl;
    supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  } catch {
    // import.meta.env is only available in Vite builds
  }

  return {
    apiBaseUrl,
    supabaseUrl,
    supabaseAnonKey,
  };
}
