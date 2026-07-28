import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the backend API's .env file
dotenv.config({ path: path.resolve(__dirname, "../../apps/api/.env") });

const deployerKey = process.env.PARA_WALLET_PRIVATE_KEY
  ? [process.env.PARA_WALLET_PRIVATE_KEY]
  : [];

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  networks: {
    /** Primary product home — Ethereum Sepolia. */
    sepolia: {
      url:
        process.env.RPC_URL ||
        process.env.SEPOLIA_RPC_URL ||
        "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11_155_111,
      accounts: deployerKey,
    },
    /** Legacy — retained for historical redeploys only. */
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      chainId: 84_532,
      accounts: deployerKey,
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || "",
      baseSepolia:
        process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84_532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
};

export default config;
