// Dust self-transfer via Para MPC to prove production signing works.
// Usage: pnpm exec tsx --env-file=.env scripts/smoke-para-transfer.ts

import { loadServerEnv } from "@chronicleai/config";
import { createParaTreasuryClientFromEnv } from "../src/services/para-treasury-client.ts";
import { createWeb3Client } from "../src/services/web3-client-service.ts";

async function main(): Promise<void> {
  const env = loadServerEnv();
  const para = createParaTreasuryClientFromEnv(env);
  if (!para) {
    throw new Error("PARA_API_KEY not configured");
  }

  const wallet = await para.ensureWallet();
  const before = await para.getNativeBalanceEth();
  console.log(`wallet=${wallet.address}`);
  console.log(`before_eth=${before}`);

  if (before < 0.00001) {
    throw new Error("Balance too low for smoke transfer");
  }

  const web3 = createWeb3Client(env);
  if (!web3?.isParaTreasuryBacked()) {
    throw new Error("Web3 client is not Para-backed");
  }

  console.log("Sending self-transfer 0.000001 ETH via Para MPC...");
  const receipt = await web3.sendTransfer(wallet.address, 0.000001);
  console.log(`txHash=${receipt.txHash}`);
  console.log(`explorer=${receipt.explorerUrl ?? ""}`);
  console.log(`runRef=${receipt.keeperHubRunId ?? ""}`);

  const after = await para.getNativeBalanceEth();
  console.log(`after_eth=${after}`);
  console.log("SEND_TRANSFER_OK");
}

main().catch((error) => {
  console.error("SMOKE_FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
