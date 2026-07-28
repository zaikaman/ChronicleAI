import { loadServerEnv } from "@chronicleai/config";
import { ParaRestClient, ParaRestError, createParaRestEthersSigner } from "@getpara/rest-sdk";
import { createParaRestEthersSigner as createSigner } from "@getpara/rest-sdk/ethers";
import { ethers } from "ethers";

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
  const address = "0xf7aede9453bfb56edbf14b2d05543676d3fcaf11";
  const chainId = 84_532;
  const provider = new ethers.JsonRpcProvider(env.rpcUrl);

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
      value: ethers.parseEther("0.000001").toString(),
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
  const nonce = await provider.getTransactionCount(address);
  const feeData = await provider.getFeeData();
  const network = await provider.getNetwork();
  console.log("rpc network chainId=", network.chainId.toString(), "nonce=", nonce);
  console.log("feeData", {
    gasPrice: feeData.gasPrice?.toString(),
    maxFeePerGas: feeData.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
  });

  const txBody = {
    to: address,
    chainId,
    type: 2 as const,
    value: ethers.parseEther("0.000001").toString(),
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

  // 4. ethers adapter sendTransaction
  try {
    const signer = createSigner({
      client,
      walletId,
      address,
      provider,
    });
    console.log("ethers signer address", await signer.getAddress());
    const tx = await signer.sendTransaction({
      to: address,
      value: ethers.parseEther("0.000001"),
    });
    console.log("ethers sendTransaction OK hash=", tx.hash);
    const receipt = await tx.wait();
    console.log("ethers mined status=", receipt?.status, "hash=", receipt?.hash);
  } catch (error) {
    if (error instanceof ParaRestError) {
      console.log("ethers send ERR", error.status, JSON.stringify(error.body));
    } else {
      console.log("ethers send ERR", error instanceof Error ? error.message : error);
      if (error instanceof Error && error.stack) console.log(error.stack.split("\n").slice(0, 8).join("\n"));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
