import { loadServerEnv } from "@chronicleai/config";
import { ParaRestClient, ParaRestError } from "@getpara/rest-sdk";
import { createParaRestViemAccount } from "@getpara/rest-sdk/viem";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
} from "viem";
import { baseSepolia } from "viem/chains";

async function main(): Promise<void> {
  const env = loadServerEnv();
  if (!env.paraApiKey || !env.paraWalletId || !env.rpcUrl) {
    throw new Error("Need PARA_API_KEY, PARA_WALLET_ID, RPC_URL");
  }

  const client = new ParaRestClient({
    apiKey: env.paraApiKey,
    env: env.paraEnvironment,
  });
  const walletId = env.paraWalletId;
  const address = "0xf7aede9453bfb56edbf14b2d05543676d3fcaf11" as Address;
  const chainId = 84_532;
  const chain = baseSepolia;
  const publicClient = createPublicClient({
    chain,
    transport: http(env.rpcUrl),
  });

  // 1. signMessage (proves MPC signing works at all)
  try {
    const sig = await client.signMessage(walletId, { message: "chronicleai-para-smoke" });
    console.log("signMessage OK signature_len=", sig.signature?.length);
  } catch (error) {
    if (error instanceof ParaRestError) {
      console.log("signMessage ERR", error.status, JSON.stringify(error.body));
    } else {
      console.log("signMessage ERR", error);
    }
  }

  // 2. estimateFee
  try {
    const fee = await client.estimateFee(walletId, {
      to: address,
      value: parseEther("0.000001").toString(),
      chainId,
    });
    console.log("estimateFee OK", JSON.stringify(fee));
  } catch (error) {
    if (error instanceof ParaRestError) {
      console.log("estimateFee ERR", error.status, JSON.stringify(error.body));
    } else {
      console.log("estimateFee ERR", error);
    }
  }

  // 3. signTransaction via REST with full tx fields from provider
  const nonce = await publicClient.getTransactionCount({ address });
  const feeData = await publicClient.estimateFeesPerGas();
  console.log("rpc network chainId=", chain.id, "nonce=", nonce);
  console.log("feeData", {
    maxFeePerGas: feeData.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
  });

  const txBody = {
    to: address,
    chainId,
    type: 2 as const,
    value: parseEther("0.000001").toString(),
    data: "0x",
    nonce,
    gasLimit: "21000",
    maxFeePerGas: (feeData.maxFeePerGas ?? 1_000_000_000n).toString(),
    maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas ?? 100_000_000n).toString(),
  };

  try {
    const signed = await client.signTransaction(
      walletId,
      { transaction: txBody, broadcast: false },
      { signal: AbortSignal.timeout(60_000) },
    );
    console.log("signTransaction sign-only OK", JSON.stringify(signed).slice(0, 300));
  } catch (error) {
    if (error instanceof ParaRestError) {
      console.log("signTransaction sign-only ERR", error.status, JSON.stringify(error.body));
    } else {
      console.log("signTransaction sign-only ERR", error);
    }
  }

  try {
    const signed = await client.signTransaction(
      walletId,
      { transaction: txBody, broadcast: true },
      { signal: AbortSignal.timeout(60_000) },
    );
    console.log("signTransaction broadcast OK", JSON.stringify(signed));
  } catch (error) {
    if (error instanceof ParaRestError) {
      console.log("signTransaction broadcast ERR", error.status, JSON.stringify(error.body));
    } else {
      console.log("signTransaction broadcast ERR", error);
    }
  }

  // 4. viem account sendTransaction
  try {
    const account = createParaRestViemAccount({
      client,
      walletId,
      address,
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(env.rpcUrl),
    });
    console.log("viem account address", account.address);
    const hash = await walletClient.sendTransaction({
      to: address,
      value: parseEther("0.000001"),
      account,
      chain,
    });
    console.log("viem sendTransaction OK hash=", hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("viem mined status=", receipt.status, "hash=", receipt.transactionHash);
  } catch (error) {
    if (error instanceof ParaRestError) {
      console.log("viem send ERR", error.status, JSON.stringify(error.body));
    } else {
      console.log("viem send ERR", error instanceof Error ? error.message : error);
      if (error instanceof Error && error.stack) console.log(error.stack.split("\n").slice(0, 8).join("\n"));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
