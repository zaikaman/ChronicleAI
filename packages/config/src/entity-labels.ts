// Curated on-chain address label book for capital-flow enrichment.
// Prefer under-labeling over wrong names. Never invent labels at LLM time.
// Sources: public explorer labels, project docs, and well-known disclosure.
// EntityRole mirrors @chronicleai/schemas (kept local so config has no schemas dep).

export type EntityRole =
  | "exchange"
  | "protocol"
  | "treasury"
  | "router"
  | "unknown";

export interface LabeledEntity {
  /** Lowercase 0x address. */
  address: string;
  /** Empty = all EVM chains; otherwise only matching chainIds. */
  chainIds: number[];
  role: EntityRole;
  label: string;
  tags?: string[];
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * High-confidence mainnet CEX deposit / hot wallets (small curated set).
 * Sources: Etherscan public labels (as of 2026).
 */
const MAINNET_CEX: readonly LabeledEntity[] = [
  // Binance — Etherscan "Binance 14" / "Binance 7" / "Binance 8"
  {
    address: "0x28c6c06298d514db089934071355e5743bf21d60",
    chainIds: [1],
    role: "exchange",
    label: "Binance",
    tags: ["cex", "binance"],
  },
  {
    address: "0x21a31ee1afc51d94c2efccaa2092ad1028285549",
    chainIds: [1],
    role: "exchange",
    label: "Binance",
    tags: ["cex", "binance"],
  },
  {
    address: "0xdfd5293d8e347dfe59e90efd55b2956a1343963d",
    chainIds: [1],
    role: "exchange",
    label: "Binance",
    tags: ["cex", "binance"],
  },
  {
    address: "0xbe0eb53f46cd790cd13851d5eff43d12404d33e8",
    chainIds: [1],
    role: "exchange",
    label: "Binance",
    tags: ["cex", "binance"],
  },
  {
    address: "0xf977814e90da44bfa03b6295a0616a897441acec",
    chainIds: [1],
    role: "exchange",
    label: "Binance",
    tags: ["cex", "binance"],
  },
  // Coinbase — Etherscan "Coinbase 1–4"
  {
    address: "0x71660c4005ba85c37ccec55d0c4493e66fe775d3",
    chainIds: [1],
    role: "exchange",
    label: "Coinbase",
    tags: ["cex", "coinbase"],
  },
  {
    address: "0x503828976d22510aad0201ac7ec88293211d23da",
    chainIds: [1],
    role: "exchange",
    label: "Coinbase",
    tags: ["cex", "coinbase"],
  },
  {
    address: "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740",
    chainIds: [1],
    role: "exchange",
    label: "Coinbase",
    tags: ["cex", "coinbase"],
  },
  // Kraken — Etherscan "Kraken"
  {
    address: "0x2910543af39aba0cd09dbb2d50200b3e800a63d2",
    chainIds: [1],
    role: "exchange",
    label: "Kraken",
    tags: ["cex", "kraken"],
  },
  {
    address: "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13",
    chainIds: [1],
    role: "exchange",
    label: "Kraken",
    tags: ["cex", "kraken"],
  },
  // OKX — Etherscan "OKX"
  {
    address: "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b",
    chainIds: [1],
    role: "exchange",
    label: "OKX",
    tags: ["cex", "okx"],
  },
];

/**
 * Protocol + router + treasury labels (mainnet + Sepolia desk venues).
 * Sources: Uniswap/Aave/CoW/Circle public deployments.
 */
const PROTOCOL_AND_TREASURY: readonly LabeledEntity[] = [
  // Aave V3 Pool — mainnet
  {
    address: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
    chainIds: [1],
    role: "protocol",
    label: "Aave V3",
    tags: ["aave", "lending"],
  },
  // Aave V3 Pool — Sepolia
  {
    address: "0x6ae43d3271ff6888e7fc43fd7321a503ff738951",
    chainIds: [11_155_111],
    role: "protocol",
    label: "Aave V3",
    tags: ["aave", "lending"],
  },
  // Uniswap V3 SwapRouter02 — mainnet
  {
    address: "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
    chainIds: [1],
    role: "router",
    label: "Uniswap SwapRouter02",
    tags: ["uniswap", "router"],
  },
  // Uniswap Universal Router — mainnet
  {
    address: "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad",
    chainIds: [1],
    role: "router",
    label: "Uniswap Universal Router",
    tags: ["uniswap", "router"],
  },
  // Uniswap V3 SwapRouter02 — Sepolia
  {
    address: "0x3bfa4769fb09eefc5a80d6e87c3b9c650f7ae48e",
    chainIds: [11_155_111],
    role: "router",
    label: "Uniswap SwapRouter02",
    tags: ["uniswap", "router"],
  },
  // CoW Protocol GPv2Settlement — mainnet
  {
    address: "0x9008d19f58aabd9ed0d60971565aa8510560ab41",
    chainIds: [1],
    role: "router",
    label: "CoW Settlement",
    tags: ["cow", "router"],
  },
  // USDC (Circle FiatToken) — mainnet token contract
  {
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    chainIds: [1],
    role: "treasury",
    label: "USDC",
    tags: ["stablecoin", "usdc", "circle"],
  },
  // Circle USDC — Ethereum Sepolia
  {
    address: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
    chainIds: [11_155_111],
    role: "treasury",
    label: "USDC",
    tags: ["stablecoin", "usdc", "circle"],
  },
];

/** Full seed book (v1). */
export const LABELED_ENTITIES: readonly LabeledEntity[] = [
  ...MAINNET_CEX,
  ...PROTOCOL_AND_TREASURY,
];

const byAddress = new Map<string, LabeledEntity[]>();
for (const entity of LABELED_ENTITIES) {
  const key = normalizeAddress(entity.address);
  const list = byAddress.get(key) ?? [];
  list.push(entity);
  byAddress.set(key, list);
}

/**
 * Look up a curated label for an address on a chain.
 * Returns null when unknown — callers must not invent names.
 */
export function lookupEntity(
  address: string | undefined | null,
  chainId: number,
): LabeledEntity | null {
  if (!address) return null;
  const candidates = byAddress.get(normalizeAddress(address));
  if (!candidates?.length) return null;

  for (const entity of candidates) {
    if (entity.chainIds.length === 0 || entity.chainIds.includes(chainId)) {
      return entity;
    }
  }
  return null;
}

/** True when the address is labeled as a CEX/exchange on this chain. */
export function isExchangeAddress(
  address: string | undefined | null,
  chainId: number,
): boolean {
  const entity = lookupEntity(address, chainId);
  return entity?.role === "exchange";
}

/** All exchange addresses for a chain (for workflow filters / docs). */
export function listExchangeAddresses(chainId: number): string[] {
  return LABELED_ENTITIES.filter(
    (e) =>
      e.role === "exchange" &&
      (e.chainIds.length === 0 || e.chainIds.includes(chainId)),
  ).map((e) => e.address);
}
