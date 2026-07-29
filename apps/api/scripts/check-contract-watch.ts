import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

const REGISTRY_ADDRESS = "0xD8Deb4475a7E23E194Bc93f8739858Fb20744111";

const ABI = [
  {
    inputs: [{ internalType: "uint256", name: "watchId", type: "uint256" }],
    name: "getWatch",
    outputs: [
      {
        components: [
          { internalType: "address", name: "targetContract", type: "address" },
          { internalType: "bytes32", name: "watchSpecHash", type: "bytes32" },
          { internalType: "uint64", name: "startsAt", type: "uint64" },
          { internalType: "uint64", name: "endsAt", type: "uint64" },
          { internalType: "uint256", name: "createdAt", type: "uint256" },
          { internalType: "string", name: "contentUri", type: "string" },
          { internalType: "bytes32", name: "reportHash", type: "bytes32" },
          { internalType: "bytes32", name: "sourceEventRoot", type: "bytes32" },
        ],
        internalType: "struct ChronicleRegistry.WatchCampaign",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nextWatchId",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function main() {
  const client = createPublicClient({
    chain: sepolia,
    transport: http("https://1rpc.io/sepolia"),
  });

  const nextWatchId = await client.readContract({
    address: REGISTRY_ADDRESS,
    abi: ABI,
    functionName: "nextWatchId",
  });

  console.log("nextWatchId on contract:", nextWatchId.toString());

  for (let id = 0n; id < nextWatchId; id++) {
    const watch = await client.readContract({
      address: REGISTRY_ADDRESS,
      abi: ABI,
      functionName: "getWatch",
      args: [id],
    });
    console.log(`\n--- Watch ID ${id} ---`);
    console.log({
      targetContract: watch.targetContract,
      startsAt: new Date(Number(watch.startsAt) * 1000).toISOString(),
      endsAt: new Date(Number(watch.endsAt) * 1000).toISOString(),
      contentUri: watch.contentUri,
      reportHash: watch.reportHash,
      sourceEventRoot: watch.sourceEventRoot,
    });
  }
}

main().catch(console.error);
