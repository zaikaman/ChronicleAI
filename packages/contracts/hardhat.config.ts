import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  networks: {
    sepolia: {
      url: process.env.RPC_URL || "https://rpc.sepolia.org",
      accounts: process.env.PARA_WALLET_PRIVATE_KEY ? [process.env.PARA_WALLET_PRIVATE_KEY] : [],
    },
  },
};

export default config;
