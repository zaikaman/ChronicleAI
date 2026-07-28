/**
 * Prepare workflows/keeperhub-ready from workflows/keeperhub templates.
 *
 * Replaces import placeholders with values from apps/api/.env (or env overrides):
 *   YOUR_TELEGRAM_INGEST_CHAT_ID  → TELEGRAM_INGEST_CHAT_ID (fallback TELEGRAM_CHAT_ID)
 *   0x0000…0001                   → DESK_WALLET_ADDRESS
 *   YOUR_CHRONICLE_REGISTRY_ADDRESS / YOUR_DESK_WALLET_ADDRESS → env values
 *   Registry write contractAddress → CHRONICLE_REGISTRY_ADDRESS when set
 *
 * Usage: node scripts/prepare-keeperhub-ready.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "workflows", "keeperhub");
const outDir = path.join(root, "workflows", "keeperhub-ready");
const envPath = path.join(root, "apps", "api", ".env");

const ZERO_DESK = "0x0000000000000000000000000000000000000001";

function loadEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function isAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

const fileEnv = loadEnvFile(envPath);
const deskWallet =
  process.env.DESK_WALLET_ADDRESS?.trim() ||
  fileEnv.DESK_WALLET_ADDRESS?.trim() ||
  "";
const telegramChat =
  process.env.TELEGRAM_INGEST_CHAT_ID?.trim() ||
  fileEnv.TELEGRAM_INGEST_CHAT_ID?.trim() ||
  process.env.TELEGRAM_CHAT_ID?.trim() ||
  fileEnv.TELEGRAM_CHAT_ID?.trim() ||
  "";
const registry =
  process.env.CHRONICLE_REGISTRY_ADDRESS?.trim() ||
  fileEnv.CHRONICLE_REGISTRY_ADDRESS?.trim() ||
  "";

const errors = [];
if (!isAddress(deskWallet)) {
  errors.push(
    `DESK_WALLET_ADDRESS missing or invalid (got ${JSON.stringify(deskWallet || null)})`,
  );
}
if (!telegramChat) {
  errors.push("TELEGRAM_INGEST_CHAT_ID (or TELEGRAM_CHAT_ID) is required");
}
if (registry && !isAddress(registry)) {
  errors.push(
    `CHRONICLE_REGISTRY_ADDRESS invalid (got ${JSON.stringify(registry)})`,
  );
}
if (errors.length) {
  console.error("Cannot prepare keeperhub-ready:\n- " + errors.join("\n- "));
  process.exit(1);
}

/** Registry write workflows — always pin contractAddress to CHRONICLE_REGISTRY_ADDRESS. */
const REGISTRY_WRITE_FILES = new Set([
  "chronicle-publish-alert.workflow.json",
  "chronicle-publish-digest.workflow.json",
  "chronicle-create-sponsored-watch.workflow.json",
  "chronicle-publish-sponsored-report.workflow.json",
  "chronicle-publish-premium-receipt.workflow.json",
  "chronicle-record-payout.workflow.json",
  "chronicle-publish-trade-ticket.workflow.json",
  "chronicle-record-capital-move.workflow.json",
]);

function substitutePlaceholders(text, fileName) {
  let out = text;
  out = out.split("YOUR_TELEGRAM_INGEST_CHAT_ID").join(telegramChat);
  out = out.split("YOUR_DESK_WALLET_ADDRESS").join(deskWallet);
  out = out.split(ZERO_DESK).join(deskWallet);
  if (registry) {
    out = out.split("YOUR_CHRONICLE_REGISTRY_ADDRESS").join(registry);
  }

  // Normalize descriptions that still tell operators to replace placeholders.
  out = out.replace(
    /AFTER IMPORT:\s*replace desk user 0x0000…0001 with DESK_WALLET_ADDRESS and chatId with TELEGRAM_INGEST_CHAT_ID\.?\s*/gi,
    "Desk user + chatId prefilled from DESK_WALLET_ADDRESS / TELEGRAM_INGEST_CHAT_ID. ",
  );
  out = out.replace(
    /Replace YOUR_TELEGRAM_INGEST_CHAT_ID\.?/gi,
    "chatId prefilled to TELEGRAM_INGEST_CHAT_ID.",
  );
  out = out.replace(
    /Replace 0x[0-9a-fA-F]{40} and -?\d+\./g,
    "deskAddress + chatId prefilled from env.",
  );
  out = out.replace(
    /Set chatId to TELEGRAM_INGEST_CHAT_ID\.?/gi,
    "chatId prefilled to TELEGRAM_INGEST_CHAT_ID.",
  );
  out = out.replace(
    /AFTER IMPORT:\s*set chatId to TELEGRAM_INGEST_CHAT_ID\.?\s*/gi,
    "chatId prefilled to TELEGRAM_INGEST_CHAT_ID. ",
  );

  if (registry && REGISTRY_WRITE_FILES.has(fileName)) {
    const json = JSON.parse(out);
    for (const node of json.nodes || []) {
      const cfg = node?.data?.config;
      if (cfg?.actionType === "web3/write-contract" && cfg.contractAddress) {
        cfg.contractAddress = registry;
      }
    }
    out = JSON.stringify(json, null, 2) + "\n";
  }

  return out;
}

function remainingPlaceholders(text) {
  const found = new Set();
  for (const m of text.matchAll(/YOUR_[A-Z0-9_]+/g)) found.add(m[0]);
  if (text.includes(ZERO_DESK)) found.add(ZERO_DESK);
  if (text.includes("YOUR_TELEGRAM_INGEST_CHAT_ID")) {
    found.add("YOUR_TELEGRAM_INGEST_CHAT_ID");
  }
  return [...found];
}

fs.mkdirSync(outDir, { recursive: true });

// Copy README (docs only — leave YOUR_HOST examples for operators)
const readmeSrc = path.join(srcDir, "README.md");
if (fs.existsSync(readmeSrc)) {
  fs.copyFileSync(readmeSrc, path.join(outDir, "README.md"));
}

const files = fs
  .readdirSync(srcDir)
  .filter((f) => f.endsWith(".workflow.json"))
  .sort();

let written = 0;
const leftover = [];

for (const file of files) {
  // Strip UTF-8 BOM if present (breaks JSON.parse / KH import).
  const raw = fs
    .readFileSync(path.join(srcDir, file), "utf8")
    .replace(/^\uFEFF/, "");
  const prepared = substitutePlaceholders(raw, file);
  const left = remainingPlaceholders(prepared);
  if (left.length) leftover.push({ file, left });
  fs.writeFileSync(path.join(outDir, file), prepared, "utf8");
  written++;
}

console.log(`Prepared ${written} workflow(s) → ${path.relative(root, outDir)}`);
console.log(`  DESK_WALLET_ADDRESS        = ${deskWallet}`);
console.log(`  TELEGRAM_INGEST_CHAT_ID    = ${telegramChat}`);
console.log(
  `  CHRONICLE_REGISTRY_ADDRESS = ${registry || "(unchanged in non-registry files)"}`,
);

if (leftover.length) {
  console.error("\nRemaining placeholders:");
  for (const row of leftover) {
    console.error(`  ${row.file}: ${row.left.join(", ")}`);
  }
  process.exit(1);
}

console.log("All placeholders replaced.");
