import { loadServerEnv } from "@chronicleai/config";
import { ParaRestClient, ParaRestError } from "@getpara/rest-sdk";
import { parseEther } from "viem";

async function tryTransfer(
  client: ParaRestClient,
  walletId: string,
  label: string,
  body: Parameters<ParaRestClient["transfer"]>[1],
): Promise<void> {
  console.log(`\nTRY ${label}`);
  try {
    const result = await client.transfer(walletId, body, {
      signal: AbortSignal.timeout(60_000),
    });
    console.log("OK", JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof ParaRestError) {
      console.log(`ERR status=${error.status} code=${error.code ?? "n/a"}`);
      console.log(`ERR body=${JSON.stringify(error.body)}`);
      console.log(`ERR message=${error.message}`);
      return;
    }
    console.log("ERR", error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  const env = loadServerEnv();
  if (!env.paraApiKey || !env.paraWalletId) {
    throw new Error("Need PARA_API_KEY and PARA_WALLET_ID");
  }

  const client = new ParaRestClient({
    apiKey: env.paraApiKey,
    env: env.paraEnvironment,
  });

  const walletId = env.paraWalletId;
  const address = "0xf7aede9453bfb56edbf14b2d05543676d3fcaf11";
  const chainId = 84_532;
  const value = parseEther("0.000001").toString();

  console.log(`walletId=${walletId}`);
  console.log(`chainId=${chainId}`);
  console.log(`valueWei=${value}`);

  // Inspect wallet
  try {
    const w = await client.getWallet(walletId);
    console.log("wallet", JSON.stringify(w, null, 2));
  } catch (error) {
    console.log("getWallet failed", error);
  }

  await tryTransfer(client, walletId, "native type2 broadcast", {
    to: address,
    value,
    chainId,
    kind: "NATIVE",
    broadcast: true,
    type: 2,
  });

  await tryTransfer(client, walletId, "native type0 broadcast", {
    to: address,
    value,
    chainId,
    kind: "NATIVE",
    broadcast: true,
    type: 0,
  });

  await tryTransfer(client, walletId, "native no-type broadcast", {
    to: address,
    value,
    chainId,
    kind: "NATIVE",
    broadcast: true,
  });

  await tryTransfer(client, walletId, "sign-only type2", {
    to: address,
    value,
    chainId,
    kind: "NATIVE",
    broadcast: false,
    type: 2,
  });

  // Value as ether string instead of wei?
  await tryTransfer(client, walletId, "value as 0.000001 ether string type2", {
    to: address,
    value: "0.000001",
    chainId,
    kind: "NATIVE",
    broadcast: true,
    type: 2,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
