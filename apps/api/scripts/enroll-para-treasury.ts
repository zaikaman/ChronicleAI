// One-shot: ensure Para MPC treasury wallet and print PARA_WALLET_ID.
// Usage (from apps/api): pnpm exec tsx --env-file=.env scripts/enroll-para-treasury.ts

import { loadServerEnv } from "@chronicleai/config";
import { createParaTreasuryClientFromEnv } from "../src/services/para-treasury-client.ts";

async function main(): Promise<void> {
  const env = loadServerEnv();
  const client = createParaTreasuryClientFromEnv(env);
  if (!client) {
    console.error("FAIL: PARA_API_KEY is not set (or empty).");
    process.exit(1);
  }

  console.log("Enrolling / loading Para treasury wallet...");
  console.log(`  environment: ${env.paraEnvironment}`);
  console.log(`  identifier:  ${env.paraTreasuryUserIdentifier}`);
  console.log(`  id type:     ${env.paraTreasuryUserIdentifierType}`);

  const wallet = await client.ensureWallet();

  console.log("");
  console.log("Paste into apps/api/.env:");
  console.log(`PARA_WALLET_ID=${wallet.walletId}`);
  console.log("");
  console.log(`Address (fund this on your chain): ${wallet.address}`);

  try {
    const bal = await client.getNativeBalanceEth();
    console.log(`On-chain/Para balance (ETH): ${bal}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Balance fetch skipped: ${message}`);
  }
}

main().catch((error) => {
  console.error("Para enroll failed:", error instanceof Error ? error.message : error);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
