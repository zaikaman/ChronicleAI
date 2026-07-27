// Deployment script for ChronicleRegistry contract
// Usage: npx hardhat run scripts/deploy.ts --network sepolia

import { ethers } from "hardhat";

async function main(): Promise<void> {
  console.log("Deploying ChronicleRegistry...");

  const signers = await ethers.getSigners();
  const deployer = signers[0];
  if (!deployer) {
    throw new Error("No deployer signer found");
  }
  console.log("Deployer address:", deployer.address);

  const ChronicleRegistry = await ethers.getContractFactory("ChronicleRegistry");
  const contract = await ChronicleRegistry.deploy();

  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("ChronicleRegistry deployed to:", address);

  // Verify on Etherscan/BaseScan
  console.log("\nVerification command:");
  console.log(`npx hardhat verify --network sepolia ${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
