// Deployment script for ChronicleRegistry contract
// Usage: npx hardhat run scripts/deploy.ts --network base-sepolia

import { ethers } from "hardhat";

async function main(): Promise<void> {
  console.log("Deploying ChronicleRegistry...");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", deployer.address);

  const ChronicleRegistry = await ethers.getContractFactory("ChronicleRegistry");
  const contract = await ChronicleRegistry.deploy();

  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("ChronicleRegistry deployed to:", address);

  // Verify on Etherscan/BaseScan
  console.log(`\nVerification command:`);
  console.log(`npx hardhat verify --network base-sepolia ${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
