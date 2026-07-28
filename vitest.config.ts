import fs from "node:fs";
import path from "node:path";

/** Env keys that must never point at a real database during unit/contract tests. */
const FORCED_TEST_DB_ENV: Record<string, string> = {
  SUPABASE_URL: "http://127.0.0.1:9",
  SUPABASE_SERVICE_ROLE_KEY: "vitest-isolated-service-role-key",
  CHRONICLE_TEST_DB_ISOLATION: "1",
};

try {
  const envPath = path.resolve(import.meta.dirname ?? __dirname, ".env");
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, "utf-8");
    for (const line of envFile.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index !== -1) {
        const key = trimmed.slice(0, index).trim();
        // Never load real Supabase credentials into the test process
        if (key in FORCED_TEST_DB_ENV) continue;
        let val = trimmed.slice(index + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {
  console.warn("Failed to load root .env file in vitest.config.ts:", e);
}

// Always force isolated DB credentials after any .env merge (also overrides shell env).
for (const [key, value] of Object.entries(FORCED_TEST_DB_ENV)) {
  process.env[key] = value;
}

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/src/**/*.test.ts", "packages/**/src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["./tests/setup-db-isolation.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["apps/**/src/**", "packages/**/src/**"],
      exclude: ["**/*.test.ts", "**/node_modules/**", "**/dist/**"],
    },
    passWithNoTests: true,
  },
});
