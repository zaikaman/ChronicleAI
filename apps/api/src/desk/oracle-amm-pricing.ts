/**
 * Honest oracle vs AMM ETH/USD mid derivation for desk oracle_basis signals.
 *
 * Sepolia reality (2026-07 audit): Uniswap V3 WETH/USDC pools often mark ETH near
 * ~16k while Chainlink ETH/USD is ~1.8k. That is a real thin-pool misprice, not a
 * decimal bug — ingest still must scale amounts correctly and refuse absurd basis
 * rather than invent a synthetic mid.
 *
 * Quote method (desk-basis-poll): Uniswap V3 QuoterV2 `quoteExactInputSingle`.
 * Prefer geometric mean of WETH→USDC and reverse USDC→WETH when both are present.
 */

/** Plausible ETH/USD mid (testnet + mainnet-like). */
export const ETH_USD_PRICE_MIN = 50;
export const ETH_USD_PRICE_MAX = 500_000;

/**
 * Beyond this absolute basis, treat as data-quality failure (not a tradeable
 * dislocation). Matches strategy + signal-engine guards.
 */
export const DESK_BASIS_ABSURD_BPS = 2_000;

/** Default WETH (tokenIn) decimals for 1-WETH exact-input quotes. */
export const DEFAULT_AMM_TOKEN_IN_DECIMALS = 18;
/** Default USDC (tokenOut) decimals for WETH→USDC quotes. */
export const DEFAULT_AMM_TOKEN_OUT_DECIMALS = 6;

const WETH_SYMBOLS = new Set(["weth", "eth", "ether"]);
const STABLE_SYMBOLS = new Set(["usdc", "usdt", "dai", "usd"]);

/** Circle USDC + canonical WETH on Ethereum Sepolia (lowercased). */
const SEPOLIA_USDC = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
const SEPOLIA_WETH = "0xfff9976782d46cc05630d1f6ebab18b2324d6b14";

export function isPlausibleEthUsdPrice(price: number): boolean {
  return Number.isFinite(price) && price >= ETH_USD_PRICE_MIN && price <= ETH_USD_PRICE_MAX;
}

export function computeEthUsdBasisBps(oraclePrice: number, ammPrice: number): number {
  if (!Number.isFinite(oraclePrice) || oraclePrice <= 0) {
    throw new Error(`Invalid oracle price: ${oraclePrice}`);
  }
  if (!Number.isFinite(ammPrice) || ammPrice <= 0) {
    throw new Error(`Invalid AMM price: ${ammPrice}`);
  }
  return Math.round(((ammPrice - oraclePrice) / oraclePrice) * 10_000);
}

/**
 * Decode Chainlink-style answer into ETH/USD human units.
 * Prefer decimals scaling; if that yields an absurd mid, fall back to treating
 * the answer as already human (common template/miswire failure mode).
 */
export function decodeEthUsdOraclePrice(
  answer: bigint,
  decimals: number,
): number | undefined {
  const scaled = Number(answer) / 10 ** decimals;
  if (isPlausibleEthUsdPrice(scaled)) return scaled;

  const rawHuman = Number(answer);
  if (isPlausibleEthUsdPrice(rawHuman)) return rawHuman;

  if (Number.isFinite(scaled) && scaled > 0) return scaled;
  if (Number.isFinite(rawHuman) && rawHuman > 0) return rawHuman;
  return undefined;
}

export function coerceEthUsdOraclePrice(
  candidate: number,
  answer: bigint | null,
  decimals: number,
): number {
  if (isPlausibleEthUsdPrice(candidate)) return candidate;
  if (answer != null && answer > 0n) {
    const recovered = decodeEthUsdOraclePrice(answer, decimals);
    if (recovered != null) return recovered;
  }
  return candidate;
}

export type AmmQuoteDirection = "weth_to_stable" | "stable_to_weth" | "unknown";

/**
 * Infer whether amountIn is WETH (price = out/in) or a USD stable
 * (price = in/out after decimal scaling) so ETH/USD is always returned.
 */
export function resolveAmmQuoteDirection(input: {
  tokenIn?: string | null | undefined;
  tokenOut?: string | null | undefined;
  pair?: string | null | undefined;
  /** Explicit override from poll: "weth_to_stable" | "stable_to_weth". */
  quoteDirection?: string | null | undefined;
}): AmmQuoteDirection {
  const explicit = (input.quoteDirection ?? "").trim().toLowerCase();
  if (explicit === "weth_to_stable" || explicit === "eth_to_usd" || explicit === "weth_usdc") {
    return "weth_to_stable";
  }
  if (explicit === "stable_to_weth" || explicit === "usd_to_eth" || explicit === "usdc_weth") {
    return "stable_to_weth";
  }

  const inSym = classifyTokenRef(input.tokenIn);
  const outSym = classifyTokenRef(input.tokenOut);
  if (inSym === "weth" && outSym === "stable") return "weth_to_stable";
  if (inSym === "stable" && outSym === "weth") return "stable_to_weth";

  // pair labels like "ETH/USD" or "USDC/WETH" alone do not encode quote direction;
  // default remains WETH→stable (desk-basis-poll primary leg).
  return "unknown";
}

function classifyTokenRef(ref: string | null | undefined): "weth" | "stable" | "other" {
  if (ref == null) return "other";
  const raw = ref.trim();
  if (!raw) return "other";
  const lower = raw.toLowerCase();
  if (lower === SEPOLIA_WETH || lower === SEPOLIA_USDC) {
    return lower === SEPOLIA_WETH ? "weth" : "stable";
  }
  // Strip 0x addresses we don't recognize
  if (lower.startsWith("0x") && lower.length === 42) return "other";
  const sym = lower.replace(/[^a-z]/g, "");
  if (WETH_SYMBOLS.has(sym)) return "weth";
  if (STABLE_SYMBOLS.has(sym)) return "stable";
  return "other";
}

export interface AmmAmountQuote {
  amountIn: bigint;
  amountOut: bigint;
  tokenInDecimals: number;
  tokenOutDecimals: number;
  direction?: AmmQuoteDirection | undefined;
  tokenIn?: string | null | undefined;
  tokenOut?: string | null | undefined;
}

/**
 * Convert a single exact-input quote into ETH/USD human units.
 * - weth_to_stable: (out/10^outDec) / (in/10^inDec)
 * - stable_to_weth: invert to ETH/USD
 * - unknown: assume weth_to_stable (workflow default), then if the raw ratio is
 *   absurdly small and the inverse is plausible, invert.
 */
export function ammQuoteToEthUsd(quote: AmmAmountQuote): number | undefined {
  if (quote.amountIn <= 0n || quote.amountOut <= 0n) return undefined;
  const inDec = quote.tokenInDecimals;
  const outDec = quote.tokenOutDecimals;
  if (!Number.isFinite(inDec) || !Number.isFinite(outDec) || inDec < 0 || outDec < 0) {
    return undefined;
  }

  const inHuman = Number(quote.amountIn) / 10 ** inDec;
  const outHuman = Number(quote.amountOut) / 10 ** outDec;
  if (!(inHuman > 0) || !(outHuman > 0)) return undefined;

  const rawRatio = outHuman / inHuman;
  const inverted = inHuman / outHuman;

  const direction =
    quote.direction ??
    resolveAmmQuoteDirection({
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
    });

  if (direction === "weth_to_stable") {
    return rawRatio > 0 ? rawRatio : undefined;
  }
  if (direction === "stable_to_weth") {
    return inverted > 0 ? inverted : undefined;
  }

  // Unknown direction: prefer WETH→stable convention; recover via invert when
  // the raw ratio cannot be a plausible ETH/USD mid but the inverse can
  // (classic USDC-in / WETH-out without direction metadata).
  if (isPlausibleEthUsdPrice(rawRatio)) return rawRatio;
  if (isPlausibleEthUsdPrice(inverted) && !isPlausibleEthUsdPrice(rawRatio)) {
    return inverted;
  }
  // Prefer the larger of the two when both absurd (still positive) — keeps
  // basis diagnostics informative rather than collapsing to a sub-1e-10 mid.
  if (rawRatio > 0) return rawRatio;
  return undefined;
}

/**
 * Geometric mid of two positive prices (bid/ask or forward/reverse).
 * Falls back to whichever leg is present.
 */
export function geometricMeanPrice(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  const okA = a != null && Number.isFinite(a) && a > 0;
  const okB = b != null && Number.isFinite(b) && b > 0;
  if (okA && okB) return Math.sqrt(a! * b!);
  if (okA) return a;
  if (okB) return b;
  return undefined;
}

export interface ResolveAmmEthUsdInput {
  /** Pre-computed mid (may be mis-scaled); preferred only when plausible. */
  ammPrice?: number | null | undefined;
  amountIn?: bigint | null | undefined;
  amountOut?: bigint | null | undefined;
  tokenInDecimals?: number | null | undefined;
  tokenOutDecimals?: number | null | undefined;
  tokenIn?: string | null | undefined;
  tokenOut?: string | null | undefined;
  pair?: string | null | undefined;
  quoteDirection?: string | null | undefined;
  /** Reverse leg (typically USDC → WETH) for geometric mid. */
  reverseAmountIn?: bigint | null | undefined;
  reverseAmountOut?: bigint | null | undefined;
  reverseTokenInDecimals?: number | null | undefined;
  reverseTokenOutDecimals?: number | null | undefined;
  reverseTokenIn?: string | null | undefined;
  reverseTokenOut?: string | null | undefined;
}

export interface ResolveAmmEthUsdResult {
  ammPrice?: number | undefined;
  /** How the mid was derived. */
  quoteMethod:
    | "provided_plausible"
    | "forward_quote"
    | "reverse_quote"
    | "geometric_mid"
    | "provided_fallback"
    | "none";
  forwardPrice?: number | undefined;
  reversePrice?: number | undefined;
  /** True when final mid is outside ETH_USD_PRICE_MIN/MAX. */
  outOfBand: boolean;
}

/**
 * Resolve AMM ETH/USD mid from poll fields.
 *
 * Preference order:
 * 1. Geometric mid of forward + reverse quotes when both recover
 * 2. Single-leg quote from amounts
 * 3. Provided ammPrice only when plausible (or as last-resort fallback)
 */
export function resolveAmmEthUsdPrice(input: ResolveAmmEthUsdInput): ResolveAmmEthUsdResult {
  const inDec = input.tokenInDecimals ?? DEFAULT_AMM_TOKEN_IN_DECIMALS;
  const outDec = input.tokenOutDecimals ?? DEFAULT_AMM_TOKEN_OUT_DECIMALS;
  const direction = resolveAmmQuoteDirection({
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    pair: input.pair,
    quoteDirection: input.quoteDirection,
  });

  let forwardPrice: number | undefined;
  if (input.amountIn != null && input.amountOut != null && input.amountIn > 0n) {
    forwardPrice = ammQuoteToEthUsd({
      amountIn: input.amountIn,
      amountOut: input.amountOut,
      tokenInDecimals: inDec,
      tokenOutDecimals: outDec,
      direction: direction === "unknown" ? undefined : direction,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
    });
  }

  let reversePrice: number | undefined;
  if (
    input.reverseAmountIn != null &&
    input.reverseAmountOut != null &&
    input.reverseAmountIn > 0n
  ) {
    const revInDec = input.reverseTokenInDecimals ?? DEFAULT_AMM_TOKEN_OUT_DECIMALS;
    const revOutDec = input.reverseTokenOutDecimals ?? DEFAULT_AMM_TOKEN_IN_DECIMALS;
    reversePrice = ammQuoteToEthUsd({
      amountIn: input.reverseAmountIn,
      amountOut: input.reverseAmountOut,
      tokenInDecimals: revInDec,
      tokenOutDecimals: revOutDec,
      // Reverse of WETH→stable is stable→WETH unless explicitly labeled.
      direction:
        direction === "weth_to_stable"
          ? "stable_to_weth"
          : direction === "stable_to_weth"
            ? "weth_to_stable"
            : resolveAmmQuoteDirection({
                tokenIn: input.reverseTokenIn ?? "USDC",
                tokenOut: input.reverseTokenOut ?? "WETH",
              }),
      tokenIn: input.reverseTokenIn ?? "USDC",
      tokenOut: input.reverseTokenOut ?? "WETH",
    });
  }

  const midFromQuotes = geometricMeanPrice(forwardPrice, reversePrice);
  if (midFromQuotes != null && midFromQuotes > 0) {
    const method: ResolveAmmEthUsdResult["quoteMethod"] =
      forwardPrice != null && reversePrice != null
        ? "geometric_mid"
        : forwardPrice != null
          ? "forward_quote"
          : "reverse_quote";
    // Prefer amount-derived mid even when out of band (honest Sepolia thin pool).
    // Only override with provided price if amounts failed and provided is plausible.
    return {
      ammPrice: midFromQuotes,
      quoteMethod: method,
      forwardPrice,
      reversePrice,
      outOfBand: !isPlausibleEthUsdPrice(midFromQuotes),
    };
  }

  const provided = input.ammPrice;
  if (provided != null && Number.isFinite(provided) && provided > 0) {
    if (isPlausibleEthUsdPrice(provided)) {
      return {
        ammPrice: provided,
        quoteMethod: "provided_plausible",
        forwardPrice,
        reversePrice,
        outOfBand: false,
      };
    }
    return {
      ammPrice: provided,
      quoteMethod: "provided_fallback",
      forwardPrice,
      reversePrice,
      outOfBand: true,
    };
  }

  return {
    quoteMethod: "none",
    forwardPrice,
    reversePrice,
    outOfBand: true,
  };
}
