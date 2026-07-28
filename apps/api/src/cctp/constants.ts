/**
 * Circle CCTP V2 testnet constants (Base Sepolia → Ethereum Sepolia).
 * Addresses re-verified against Circle contract tables; override via env in service config.
 */

import {
  BASE_SEPOLIA_USDC,
  CHAIN_ID_BASE_SEPOLIA,
  CHAIN_ID_SEPOLIA,
  SEPOLIA_DESK,
} from "@chronicleai/config";

/** CCTP domain IDs */
export const CCTP_DOMAIN_ETHEREUM_SEPOLIA = 0;
export const CCTP_DOMAIN_BASE_SEPOLIA = 6;

export const CCTP_SOURCE_CHAIN_ID = CHAIN_ID_BASE_SEPOLIA;
export const CCTP_DEST_CHAIN_ID = CHAIN_ID_SEPOLIA;

/** Circle official USDC (native) on each rail */
export const CCTP_BASE_USDC = BASE_SEPOLIA_USDC;
export const CCTP_SEPOLIA_USDC = SEPOLIA_DESK.usdc;

/**
 * CCTP V2 contracts — same addresses on Base Sepolia and Ethereum Sepolia testnets.
 * @see https://developers.circle.com/cctp/references/contract-addresses
 */
export const CCTP_TOKEN_MESSENGER_V2 =
  "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
export const CCTP_MESSAGE_TRANSMITTER_V2 =
  "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
export const CCTP_TOKEN_MINTER_V2 =
  "0xb43db544E2c27092c107639Ad201b3dEfAbcF192";

export const CCTP_IRIS_SANDBOX_URL = "https://iris-api-sandbox.circle.com";
export const CCTP_IRIS_MAINNET_URL = "https://iris-api.circle.com";

/** USDC decimals (Circle) */
export const CCTP_USDC_DECIMALS = 6;

/** bytes32(0) — any caller may submit receiveMessage */
export const CCTP_ANY_DESTINATION_CALLER =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Fast Transfer default finality threshold */
export const CCTP_FAST_FINALITY_THRESHOLD = 1_000;

/** Standard Transfer finality threshold */
export const CCTP_STANDARD_FINALITY_THRESHOLD = 2_000;
