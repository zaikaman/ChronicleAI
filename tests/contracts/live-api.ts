/**
 * Live HTTP contract tests hit a separately running API (default localhost:4000).
 * That process uses real env/DB credentials and can mutate data.
 *
 * They are disabled unless ALLOW_LIVE_API_TESTS=1 is set explicitly.
 *
 * Signature auth: live KeeperHub routes compare X-ChronicleAI-Signature to the
 * API process's KEEPERHUB_WEBHOOK_SECRET. Vitest does not load apps/api/.env by
 * default, so we hydrate the secret here when live tests are enabled.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LIVE_API_TESTS_ENABLED = process.env.ALLOW_LIVE_API_TESTS === "1";

export const LIVE_API_BASE =
  process.env.API_BASE_URL ?? process.env.TEST_API_URL ?? "http://localhost:4000";

const LIVE_ENV_KEYS = [
  "KEEPERHUB_WEBHOOK_SECRET",
  "TEST_KEEPERHUB_SECRET",
  "API_BASE_URL",
  "TEST_API_URL",
] as const;

function loadApiEnvForLiveTests(): void {
  if (!LIVE_API_TESTS_ENABLED) return;

  const dir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(dir, "../../apps/api/.env"),
    path.resolve(dir, "../../.env"),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!(LIVE_ENV_KEYS as readonly string[]).includes(key)) continue;
      let val = trimmed.slice(eq + 1).trim();
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

loadApiEnvForLiveTests();

/**
 * Header value accepted by a live API that was started with apps/api/.env.
 * Prefer explicit test override, then the real webhook secret.
 */
export const LIVE_KEEPERHUB_SIGNATURE =
  process.env.TEST_KEEPERHUB_SECRET?.trim() ||
  process.env.KEEPERHUB_WEBHOOK_SECRET?.trim() ||
  "";

if (LIVE_API_TESTS_ENABLED && !LIVE_KEEPERHUB_SIGNATURE) {
  console.warn(
    "[live-api] ALLOW_LIVE_API_TESTS=1 but KEEPERHUB_WEBHOOK_SECRET is unset — signed routes will 401",
  );
}
