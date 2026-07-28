// Known on-chain protocols ChronicleAI can normalize from KeeperHub Event Tracker payloads.
// Addresses are checksummed mainnet / Ethereum Sepolia deployments — not placeholders.

/** Primary ops / desk / registry testnet (Ethereum Sepolia). */
export const CHAIN_ID_SEPOLIA = 11_155_111;

/** x402 payment rail testnet (Base Sepolia — CDP facilitator). */
export const CHAIN_ID_BASE_SEPOLIA = 84_532;

/** Circle official USDC on Base Sepolia (EIP-3009) — x402 payment asset. */
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export type ProtocolKind =
  | "uniswap_v3_pool"
  | "uniswap_v3_factory"
  | "aave_v3_pool"
  | "cow_settlement"
  | "uniswap_v3_router"
  | "uniswap_v3_quoter"
  | "chainlink_feed"
  | "morpho_blue"
  | "token";

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

/** Desk-grade Sepolia infrastructure addresses (KeeperHub protocol plugins). */
export const SEPOLIA_DESK = {
  chainId: CHAIN_ID_SEPOLIA,
  aaveV3Pool: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
  uniswapV3Factory: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c",
  uniswapV3SwapRouter02: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
  uniswapV3QuoterV2: "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3",
  uniswapV3PositionManager: "0x1238536071E1c677A632429e3655c799b22cDA52",
  chainlinkEthUsd: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  /**
   * Chainlink LINK/USD aggregator on Sepolia (8-decimal answers).
   * Verified via description() === "LINK / USD".
   */
  chainlinkLinkUsd: "0xc59E3633BAAC79493d908e63626716e204A45EdF",
  weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  /** Circle official USDC on Ethereum Sepolia (EIP-3009). */
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  /**
   * Aave V3 Sepolia LINK reserve underlying (NOT Chainlink's official
   * Sepolia LINK at 0x779877A7…). Using the wrong token makes
   * PoolDataProvider.getUserReserveData revert with empty data.
   * Source: aave-address-book AaveV3SepoliaAssets.LINK_UNDERLYING.
   */
  link: "0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5",
  /**
   * Aave V3 Sepolia aToken for LINK (aEthLINK). Desk holds this after supply;
   * Pool.withdraw burns it. Used for exact freeable sizing (not USD/price estimate).
   * Source: PoolDataProvider.getReserveTokensAddresses(LINK) on Sepolia.
   */
  aaveV3ALink: "0x3FfAf50D4F4E96eB78F2407c090b72e86eCAED24",
  morphoBlue: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  /** Lido wstETH on Sepolia (KH lido.ts). */
  lidoWstEth: "0xB82381A3fBD3FaFA77B3a7bE693342618240067b",
  lidoStEth: "0x3e3FE7dBc6B4C189E7128855dD526361c49b40Af",
} as const;

/** Chainlink ETH/USD aggregator addresses (8-decimal answers). */
export const CHAINLINK_ETH_USD: Readonly<Record<number, string>> = {
  1: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  // Ethereum Sepolia — primary desk oracle
  [CHAIN_ID_SEPOLIA]: SEPOLIA_DESK.chainlinkEthUsd,
  // Base Sepolia — retained for historical feeds only
  [CHAIN_ID_BASE_SEPOLIA]: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
};

/** Chainlink LINK/USD aggregator addresses (8-decimal answers). */
export const CHAINLINK_LINK_USD: Readonly<Record<number, string>> = {
  // Ethereum mainnet
  1: "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c",
  // Ethereum Sepolia — free-inventory / yield rotation sizing
  [CHAIN_ID_SEPOLIA]: SEPOLIA_DESK.chainlinkLinkUsd,
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

const USDC_SEPOLIA: TokenMeta = {
  address: SEPOLIA_DESK.usdc,
  symbol: "USDC",
  decimals: 6,
  isStableUsd: true,
};

const WETH_SEPOLIA: TokenMeta = {
  address: SEPOLIA_DESK.weth,
  symbol: "WETH",
  decimals: 18,
  isStableUsd: false,
};

const LINK_SEPOLIA: TokenMeta = {
  address: SEPOLIA_DESK.link,
  symbol: "LINK",
  decimals: 18,
  isStableUsd: false,
};

/**
 * Monitored contracts. Mainnet entries remain for optional newspaper context.
 * Desk execution uses Sepolia venues only (see SEPOLIA_DESK + listDeskContracts).
 */
export const PROTOCOL_CONTRACTS: readonly ProtocolContract[] = [
  // ── Ethereum Sepolia — desk + monitor primary set ──
  {
    kind: "aave_v3_pool",
    protocol: "Aave V3",
    chainId: CHAIN_ID_SEPOLIA,
    address: SEPOLIA_DESK.aaveV3Pool,
    eventNames: ["LiquidationCall", "Supply", "Withdraw"],
  },
  {
    kind: "uniswap_v3_factory",
    protocol: "Uniswap V3",
    chainId: CHAIN_ID_SEPOLIA,
    address: SEPOLIA_DESK.uniswapV3Factory,
    eventNames: ["PoolCreated"],
  },
  {
    kind: "uniswap_v3_router",
    protocol: "Uniswap V3",
    chainId: CHAIN_ID_SEPOLIA,
    address: SEPOLIA_DESK.uniswapV3SwapRouter02,
    eventNames: [],
  },
  {
    kind: "uniswap_v3_quoter",
    protocol: "Uniswap V3",
    chainId: CHAIN_ID_SEPOLIA,
    address: SEPOLIA_DESK.uniswapV3QuoterV2,
    eventNames: [],
  },
  {
    kind: "chainlink_feed",
    protocol: "Chainlink",
    chainId: CHAIN_ID_SEPOLIA,
    address: SEPOLIA_DESK.chainlinkEthUsd,
    eventNames: [],
  },
  {
    kind: "chainlink_feed",
    protocol: "Chainlink LINK/USD",
    chainId: CHAIN_ID_SEPOLIA,
    address: SEPOLIA_DESK.chainlinkLinkUsd,
    eventNames: [],
  },
  {
    kind: "morpho_blue",
    protocol: "Morpho Blue",
    chainId: CHAIN_ID_SEPOLIA,
    address: SEPOLIA_DESK.morphoBlue,
    eventNames: [],
  },
  {
    kind: "token",
    protocol: "Circle",
    chainId: CHAIN_ID_SEPOLIA,
    address: SEPOLIA_DESK.usdc,
    eventNames: ["Transfer", "Mint", "Burn"],
    token0: USDC_SEPOLIA,
  },
  {
    kind: "token",
    protocol: "WETH",
    chainId: CHAIN_ID_SEPOLIA,
    address: SEPOLIA_DESK.weth,
    eventNames: ["Transfer"],
    token0: WETH_SEPOLIA,
  },
  {
    kind: "token",
    protocol: "LINK (Aave Sepolia)",
    chainId: CHAIN_ID_SEPOLIA,
    address: SEPOLIA_DESK.link,
    eventNames: ["Transfer"],
    token0: LINK_SEPOLIA,
  },

  // ── Uniswap V3 — Ethereum Mainnet (optional newspaper context only) ──
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
    eventNames: ["LiquidationCall", "Supply", "Withdraw"],
  },
  // CoW Protocol GPv2Settlement — Ethereum Mainnet
  {
    kind: "cow_settlement",
    protocol: "CoW Protocol",
    chainId: 1,
    address: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
    eventNames: ["Trade"],
  },
  // Circle USDC (FiatToken) — Ethereum Mainnet
  {
    kind: "token",
    protocol: "Circle",
    chainId: 1,
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    eventNames: ["Transfer", "Mint", "Burn"],
    token0: USDC_MAINNET,
  },
  // Uniswap V3 SwapRouter02 — Ethereum Mainnet
  {
    kind: "uniswap_v3_router",
    protocol: "Uniswap V3",
    chainId: 1,
    address: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    eventNames: [],
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
  erc20Transfer: [
    {
      type: "event",
      name: "Transfer",
      inputs: [
        { indexed: true, name: "from", type: "address" },
        { indexed: true, name: "to", type: "address" },
        { indexed: false, name: "value", type: "uint256" },
      ],
    },
  ],
  usdcMintBurn: [
    {
      type: "event",
      name: "Mint",
      inputs: [
        { indexed: true, name: "minter", type: "address" },
        { indexed: true, name: "to", type: "address" },
        { indexed: false, name: "amount", type: "uint256" },
      ],
    },
    {
      type: "event",
      name: "Burn",
      inputs: [
        { indexed: true, name: "burner", type: "address" },
        { indexed: false, name: "amount", type: "uint256" },
      ],
    },
  ],
  aaveV3SupplyWithdraw: [
    {
      type: "event",
      name: "Supply",
      inputs: [
        { indexed: true, name: "reserve", type: "address" },
        { indexed: false, name: "user", type: "address" },
        { indexed: true, name: "onBehalfOf", type: "address" },
        { indexed: false, name: "amount", type: "uint256" },
        { indexed: true, name: "referralCode", type: "uint16" },
      ],
    },
    {
      type: "event",
      name: "Withdraw",
      inputs: [
        { indexed: true, name: "reserve", type: "address" },
        { indexed: true, name: "user", type: "address" },
        { indexed: true, name: "to", type: "address" },
        { indexed: false, name: "amount", type: "uint256" },
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

/** Sepolia desk venues only — execution policy must ignore non-Sepolia signals. */
export function listDeskContracts(): ProtocolContract[] {
  return PROTOCOL_CONTRACTS.filter((c) => c.chainId === CHAIN_ID_SEPOLIA);
}

export function isExecutableDeskChain(chainId: number): boolean {
  return chainId === CHAIN_ID_SEPOLIA;
}
