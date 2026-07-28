// Verify Para MPC treasury works with local .env
// Usage: pnpm exec tsx --env-file=.env scripts/verify-para-treasury.ts

import { loadServerEnv } from "@chronicleai/config";
import { ethers } from "ethers";
import { createParaTreasuryClientFromEnv } from "../src/services/para-treasury-client.ts";
import {
  resolveTreasuryWallet,
  resolveTreasuryWalletAsync,
} from "../src/services/treasury-wallet.ts";
import { createWeb3Client } from "../src/services/web3-client-service.ts";

const lines: string[] = [];
const ok = (m: string) => lines.push(`OK   ${m}`);
const fail = (m: string) => lines.push(`FAIL ${m}`);
const info = (m: string) => lines.push(`INFO ${m}`);

async function main(): Promise<void> {
  const env = loadServerEnv();

  if (env.paraApiKey?.trim()) ok("PARA_API_KEY is set");
  else fail("PARA_API_KEY missing");

  info(`PARA_ENVIRONMENT=${env.paraEnvironment}`);
  info(`PARA_WALLET_ID=${env.paraWalletId ?? "(empty)"}`);
  info(`identifier=${env.paraTreasuryUserIdentifier} (${env.paraTreasuryUserIdentifierType})`);
  info(`KEEPERHUB_NETWORK=${env.keeperhubNetwork}`);
  info(`RPC_URL=${env.rpcUrl ? "set" : "missing"}`);
  info(`KeeperHub write config=${env.keeperhubApiKey && env.keeperhubApiBaseUrl ? "set" : "missing"}`);

  const sync = resolveTreasuryWallet(env);
  if (sync.provider === "para-mpc" && sync.spendMode === "para") {
    ok("resolveTreasuryWallet → para-mpc");
  } else {
    fail(`resolveTreasuryWallet → provider=${sync.provider} spendMode=${sync.spendMode}`);
  }

  const para = createParaTreasuryClientFromEnv(env);
  if (!para) {
    fail("createParaTreasuryClientFromEnv returned null");
    printAndExit();
    return;
  }

  let address = "";
  try {
    const wallet = await para.ensureWallet();
    address = wallet.address;
    ok(`ensureWallet id=${wallet.walletId}`);
    ok(`ensureWallet address=${wallet.address}`);
    if (env.paraWalletId && env.paraWalletId !== wallet.walletId) {
      fail("env PARA_WALLET_ID does not match loaded wallet");
    } else if (env.paraWalletId) {
      ok("PARA_WALLET_ID matches loaded wallet");
    }
  } catch (error) {
    fail(`ensureWallet: ${error instanceof Error ? error.message : String(error)}`);
    printAndExit();
    return;
  }

  // Live Para balance API
  let paraBalance: number | undefined;
  try {
    paraBalance = await para.getNativeBalanceEth();
    info(`Para API balance ETH=${paraBalance}`);
    if (paraBalance > 0) ok("Para API reports balance > 0");
    else info("Para API reports 0 (may still fund via RPC check)");
  } catch (error) {
    fail(`Para getNativeBalanceEth: ${error instanceof Error ? error.message : String(error)}`);
  }

  // RPC truth (what the chain actually has)
  if (env.rpcUrl && address) {
    try {
      const provider = new ethers.JsonRpcProvider(env.rpcUrl);
      const wei = await provider.getBalance(address);
      const eth = Number(ethers.formatEther(wei));
      info(`RPC balance ETH=${eth}`);
      if (eth > 0) ok("RPC confirms treasury is funded");
      else fail("RPC balance is 0 — wrong network or tx not confirmed");
    } catch (error) {
      fail(`RPC getBalance: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    info("Skipping RPC balance (RPC_URL missing)");
  }

  try {
    const resolved = await resolveTreasuryWalletAsync(env);
    if (resolved.provider === "para-mpc" && resolved.address) {
      ok(`resolveTreasuryWalletAsync → ${resolved.address}`);
    } else {
      fail(`resolveTreasuryWalletAsync incomplete: ${JSON.stringify(resolved)}`);
    }
  } catch (error) {
    fail(`resolveTreasuryWalletAsync: ${error instanceof Error ? error.message : String(error)}`);
  }

  const web3 = createWeb3Client(env);
  if (!web3) {
    fail("createWeb3Client returned null");
  } else {
    ok("createWeb3Client created");
    info(`isParaTreasuryBacked=${web3.isParaTreasuryBacked()}`);
    info(`isKeeperHubBacked=${web3.isKeeperHubBacked()}`);
    try {
      const providerLabel = await web3.getTreasuryProvider();
      const treasuryAddr = await web3.getTreasuryAddress();
      if (providerLabel === "para-mpc") ok("web3 getTreasuryProvider → para-mpc");
      else fail(`web3 getTreasuryProvider → ${providerLabel}`);
      if (treasuryAddr?.toLowerCase() === address.toLowerCase()) {
        ok(`web3 treasury address matches Para (${treasuryAddr})`);
      } else {
        fail(`web3 treasury address mismatch: ${treasuryAddr} vs ${address}`);
      }
    } catch (error) {
      fail(`web3 treasury: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  printAndExit();
}

function printAndExit(): void {
  console.log(lines.join("\n"));
  const failed = lines.some((l) => l.startsWith("FAIL"));
  console.log(failed ? "\nRESULT: FAILED" : "\nRESULT: PASSED");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
