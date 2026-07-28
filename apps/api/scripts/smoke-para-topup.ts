// One-shot smoke: Para treasury USDC → desk on Ethereum Sepolia
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Address,
  createPublicClient,
  formatEther,
  formatUnits,
  getContract,
  http,
  parseAbi,
} from "viem";
import { sepolia } from "viem/chains";
import { createParaTreasuryClient } from "../src/services/para-treasury-client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
const envText = readFileSync(envPath, "utf8");
for (const line of envText.split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  const v = line.slice(i + 1).trim();
  if (!(k in process.env)) process.env[k] = v;
}

const deskRaw = process.env.DESK_WALLET_ADDRESS?.trim();
if (!deskRaw || !/^0x[a-fA-F0-9]{40}$/.test(deskRaw)) {
  throw new Error("DESK_WALLET_ADDRESS missing or invalid");
}
const desk: Address = deskRaw as Address;

const amount = Number(process.env.SMOKE_TOPUP_USDC ?? "1");
const usdcAddress = (
  process.env.X402_USDC_ADDRESS ?? "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
) as Address;
const rpcUrl =
  process.env.RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

const client = createParaTreasuryClient({
  apiKey: process.env.PARA_API_KEY!,
  environment:
    (process.env.PARA_ENVIRONMENT as "BETA" | "PROD" | "SANDBOX") || "BETA",
  userIdentifier:
    process.env.PARA_TREASURY_USER_IDENTIFIER || "chronicleai-treasury",
  userIdentifierType:
    process.env.PARA_TREASURY_USER_IDENTIFIER_TYPE || "CUSTOM_ID",
  walletId: process.env.PARA_WALLET_ID,
  chainId: 11_155_111,
  networkLabel: "sepolia",
  usdcAddress,
  rpcUrl,
});

const wallet = await client.ensureWallet();
console.log("para wallet", wallet.address);
console.log("desk", desk);

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(rpcUrl),
});
const erc20 = getContract({
  address: usdcAddress,
  abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
  client: publicClient,
});

async function snapshot(label: string) {
  const [tEth, tUsdc, dEth, dUsdc] = await Promise.all([
    publicClient.getBalance({ address: wallet.address as Address }),
    erc20.read.balanceOf([wallet.address as Address]),
    publicClient.getBalance({ address: desk }),
    erc20.read.balanceOf([desk]),
  ]);
  console.log(label, {
    treasuryEth: formatEther(tEth),
    treasuryUsdc: formatUnits(tUsdc, 6),
    deskEth: formatEther(dEth),
    deskUsdc: formatUnits(dUsdc, 6),
  });
}

await snapshot("before");
console.log(`sending ${amount} USDC treasury → desk…`);
const receipt = await client.sendTransfer(desk, amount);
console.log("receipt", JSON.stringify(receipt, null, 2));

// Wait for indexing
for (let i = 0; i < 8; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const deskBal = await erc20.read.balanceOf([desk]);
  if (deskBal > 0n) {
    await snapshot("after");
    console.log("TOPUP_SMOKE_OK=true");
    process.exit(0);
  }
}
await snapshot("after");
console.log("TOPUP_SMOKE_OK=partial (tx sent; desk balance still 0 — check explorer)");
process.exit(0);
