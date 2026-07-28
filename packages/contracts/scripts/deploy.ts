// Deployment script for ChronicleRegistry contract
// Usage: npx hardhat run scripts/deploy.ts --network sepolia
//
// After deploy:
//   1. Set CHRONICLE_REGISTRY_ADDRESS=<address> in apps/api/.env
//   2. Call setOperator(DESK_WALLET_ADDRESS, true) so KeeperHub desk can publish
//   3. Re-import / update keeperhub workflow contractAddress fields

import hre from "hardhat";
const { ethers } = hre;

async function main(): Promise<void> {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName =
    chainId === 11_155_111
      ? "Ethereum Sepolia"
      : chainId === 84_532
        ? "Base Sepolia"
        : `chain ${chainId}`;

  console.log(`Deploying ChronicleRegistry to ${networkName} (chainId=${chainId})...`);

  const signers = await ethers.getSigners();
  const deployer = signers[0];
  if (!deployer) {
    throw new Error("No deployer signer found (set PARA_WALLET_PRIVATE_KEY for Hardhat accounts)");
  }
  console.log("Deployer address:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "ETH");
  if (balance === 0n) {
    throw new Error(
      "Deployer has zero ETH. Fund with Sepolia ETH (Google Cloud faucet) before deploying.",
    );
  }

  const ChronicleRegistry = await ethers.getContractFactory("ChronicleRegistry");
  const contract = await ChronicleRegistry.deploy();

  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("ChronicleRegistry deployed to:", address);
  const explorerOrigin =
    chainId === 84_532
      ? "https://sepolia.basescan.org"
      : "https://sepolia.etherscan.io";
  console.log("Explorer:", `${explorerOrigin}/address/${address}`);
  if (chainId === 84_532) {
    console.warn(
      "WARNING: Base Sepolia is the payment rail only. Product registry should deploy with --network sepolia (Ethereum Sepolia).",
    );
  }

  // Optional: grant operator in the same script when DESK_WALLET_ADDRESS is set
  const deskOperator = process.env.DESK_WALLET_ADDRESS?.trim();
  if (deskOperator && /^0x[a-fA-F0-9]{40}$/.test(deskOperator)) {
    console.log(`Granting operator rights to desk wallet ${deskOperator}...`);
    const setOperator = contract.getFunction("setOperator");
    const tx = await setOperator(deskOperator, true);
    await tx.wait();
    console.log("Operator granted. tx:", tx.hash);
  } else {
    console.log(
      "\nNo DESK_WALLET_ADDRESS set — grant operator after deploy:\n" +
        `  cast send ${address} "setOperator(address,bool)" <DESK_WALLET> true --rpc-url $RPC_URL --private-key $PARA_WALLET_PRIVATE_KEY`,
    );
  }

  const verifyNetwork = chainId === 11_155_111 ? "sepolia" : "baseSepolia";
  console.log("\nVerification command:");
  console.log(`npx hardhat verify --network ${verifyNetwork} ${address}`);
  console.log("\nSet in apps/api/.env:");
  console.log(`CHRONICLE_REGISTRY_ADDRESS=${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
