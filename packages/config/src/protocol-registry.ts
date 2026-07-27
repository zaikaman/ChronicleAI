// Known on-chain protocols ChronicleAI can normalize from KeeperHub Event Tracker payloads.
// Addresses are checksummed mainnet / Base Sepolia deployments — not placeholders.

/** Primary testnet used by ChronicleAI (Base Sepolia). */
export const CHAIN_ID_BASE_SEPOLIA = 84_532;

export type ProtocolKind =
  | "uniswap_v3_pool"
  | "uniswap_v3_factory"
  | "aave_v3_pool"
  | "cow_settlement";

export interface TokenMeta {
  address: string;
  symbol: string;
  decimals: number;
  /** When true, amount is treated as USD 1:1 after decimal scaling. */
  isStableUsd: boolean;
}

export interface ProtocolContract {
  kind: ProtocolKind;
  protocol: string;
  chainId: number;
  address: string;
  /** Event names this contract is expected to emit for Chronicle monitoring. */
  eventNames: readonly string[];
  /** Optional pool token pair metadata (Uniswap V3 pools). */
  token0?: TokenMeta;
  token1?: TokenMeta;
}

/** Chainlink ETH/USD aggregator addresses (8-decimal answers). */
export const CHAINLINK_ETH_USD: Readonly<Record<number, string>> = {
  1: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  // Base Sepolia — Chainlink ETH/USD (also used as Aave WETH oracle on that market)
  [CHAIN_ID_BASE_SEPOLIA]: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
};

const USDC_MAINNET: TokenMeta = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
  decimals: 6,
  isStableUsd: true,
};

const WETH_MAINNET: TokenMeta = {
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  symbol: "WETH",
  decimals: 18,
  isStableUsd: false,
};

const USDT_MAINNET: TokenMeta = {
  address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  symbol: "USDT",
  decimals: 6,
  isStableUsd: true,
};

const DAI_MAINNET: TokenMeta = {
  address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  symbol: "DAI",
  decimals: 18,
  isStableUsd: true,
};

/**
 * Monitored contracts. Pool entries cover high-volume Uniswap V3 pairs;
 * factory covers new pool deployments; Aave/CoW cover liquidations and trades.
 */
export const PROTOCOL_CONTRACTS: readonly ProtocolContract[] = [
  // Uniswap V3 — Ethereum Mainnet
  {
    kind: "uniswap_v3_pool",
    protocol: "Uniswap V3",
    chainId: 1,
    address: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640", // USDC/WETH 0.05%
    eventNames: ["Swap"],
    token0: USDC_MAINNET,
    token1: WETH_MAINNET,
  },
  {
    kind: "uniswap_v3_pool",
    protocol: "Uniswap V3",
    chainId: 1,
    address: "0x11b815efB8f581194ae79006d24E0d814B7697F6", // WETH/USDT 0.05%
    eventNames: ["Swap"],
    token0: WETH_MAINNET,
    token1: USDT_MAINNET,
  },
  {
    kind: "uniswap_v3_pool",
    protocol: "Uniswap V3",
    chainId: 1,
    address: "0xC2e9F25Be6257c210d7Bef0Aa1100554BbaD5BF8", // DAI/WETH 0.30%
    eventNames: ["Swap"],
    token0: DAI_MAINNET,
    token1: WETH_MAINNET,
  },
  {
    kind: "uniswap_v3_factory",
    protocol: "Uniswap V3",
    chainId: 1,
    address: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    eventNames: ["PoolCreated"],
  },
  // Aave V3 Pool — Ethereum Mainnet
  {
    kind: "aave_v3_pool",
    protocol: "Aave V3",
    chainId: 1,
    address: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    eventNames: ["LiquidationCall"],
  },
  // CoW Protocol GPv2Settlement — Ethereum Mainnet
  {
    kind: "cow_settlement",
    protocol: "CoW Protocol",
    chainId: 1,
    address: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
    eventNames: ["Trade"],
  },
  // Uniswap V3 Factory — Base Sepolia
  {
    kind: "uniswap_v3_factory",
    protocol: "Uniswap V3",
    chainId: CHAIN_ID_BASE_SEPOLIA,
    address: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
    eventNames: ["PoolCreated"],
  },
  // Aave V3 Pool — Base Sepolia
  {
    kind: "aave_v3_pool",
    protocol: "Aave V3",
    chainId: CHAIN_ID_BASE_SEPOLIA,
    address: "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
    eventNames: ["LiquidationCall"],
  },
] as const;

/** Minimal event ABIs used by KeeperHub Event triggers and local decoding. */
export const PROTOCOL_EVENT_ABIS = {
  uniswapV3Swap: [
    {
      type: "event",
      name: "Swap",
      inputs: [
        { indexed: true, name: "sender", type: "address" },
        { indexed: true, name: "recipient", type: "address" },
        { indexed: false, name: "amount0", type: "int256" },
        { indexed: false, name: "amount1", type: "int256" },
        { indexed: false, name: "sqrtPriceX96", type: "uint160" },
        { indexed: false, name: "liquidity", type: "uint128" },
        { indexed: false, name: "tick", type: "int24" },
      ],
    },
  ],
  uniswapV3PoolCreated: [
    {
      type: "event",
      name: "PoolCreated",
      inputs: [
        { indexed: true, name: "token0", type: "address" },
        { indexed: true, name: "token1", type: "address" },
        { indexed: true, name: "fee", type: "uint24" },
        { indexed: false, name: "tickSpacing", type: "int24" },
        { indexed: false, name: "pool", type: "address" },
      ],
    },
  ],
  aaveV3LiquidationCall: [
    {
      type: "event",
      name: "LiquidationCall",
      inputs: [
        { indexed: true, name: "collateralAsset", type: "address" },
        { indexed: true, name: "debtAsset", type: "address" },
        { indexed: true, name: "user", type: "address" },
        { indexed: false, name: "debtToCover", type: "uint256" },
        { indexed: false, name: "liquidatedCollateralAmount", type: "uint256" },
        { indexed: false, name: "liquidator", type: "address" },
        { indexed: false, name: "receiveAToken", type: "bool" },
      ],
    },
  ],
  cowTrade: [
    {
      type: "event",
      name: "Trade",
      inputs: [
        { indexed: true, name: "owner", type: "address" },
        { indexed: false, name: "sellToken", type: "address" },
        { indexed: false, name: "buyToken", type: "address" },
        { indexed: false, name: "sellAmount", type: "uint256" },
        { indexed: false, name: "buyAmount", type: "uint256" },
        { indexed: false, name: "feeAmount", type: "uint256" },
        { indexed: false, name: "orderUid", type: "bytes" },
      ],
    },
  ],
} as const;

const byAddress = new Map<string, ProtocolContract>();
for (const entry of PROTOCOL_CONTRACTS) {
  byAddress.set(`${entry.chainId}:${entry.address.toLowerCase()}`, entry);
}

export function lookupProtocolContract(
  chainId: number,
  address: string | undefined | null,
): ProtocolContract | undefined {
  if (!address) return undefined;
  return byAddress.get(`${chainId}:${address.toLowerCase()}`);
}

export function listProtocolContracts(chainId?: number): ProtocolContract[] {
  if (chainId === undefined) return [...PROTOCOL_CONTRACTS];
  return PROTOCOL_CONTRACTS.filter((c) => c.chainId === chainId);
}
