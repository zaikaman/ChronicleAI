// x402 Payment Adapter
// Implements the x402 (EVM USDC subscription) payment route.
// Settlement requires a real USDC transfer: either via a facilitator
// (POST /settle) or by submitting EIP-3009 transferWithAuthorization on-chain.
// Signature verification alone never unlocks premium.
//
// Chain ID and USDC verifyingContract are configurable (env-driven in production
// wiring). Defaults target Base Sepolia (CDP facilitator payment rail).
// Desk / registry remain on Ethereum Sepolia with a separate DESK_USDC_ADDRESS.

import { randomUUID } from "node:crypto";
import {
  type Address,
  type Hash,
  type Hex,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  getAddress,
  getContract,
  http,
  keccak256,
  parseAbi,
  parseSignature,
  recoverTypedDataAddress,
  stringToBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainFromId } from "../lib/viem-chain.ts";
import { x402Log } from "../lib/logger.ts";
import {
  buildFacilitatorAuthHeaders,
  isCdpFacilitatorUrl,
  type CdpCredentials,
} from "./cdp-auth.ts";
import type {
  ChallengeResult,
  PaymentAdapter,
  SettlementVerificationResult,
} from "./payment-adapter.ts";

/** Defaults: Base Sepolia + Circle official USDC (EIP-3009) for x402 / CDP. */
export const DEFAULT_X402_CHAIN_ID = 84_532;
export const DEFAULT_X402_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
/**
 * EIP-712 domain name/version for Circle USDC `transferWithAuthorization`.
 * CRITICAL: must match the on-chain token's EIP-712 domain (usually `name()` / `version()`).
 * Circle Base Sepolia and Ethereum Sepolia USDC use name **"USDC"** (not "USD Coin").
 * Base mainnet Circle USDC uses **"USD Coin"**.
 * Wrong name → local verify still passes (same wrong domain) but on-chain settle reverts
 * ("unable to estimate gas" / invalid_payload from CDP facilitator).
 */
export const DEFAULT_X402_USDC_EIP712_VERSION = "2";

/** Resolve default EIP-712 domain name for a chain's canonical Circle USDC. */
export function defaultUsdcEip712Name(chainId: number): string {
  if (chainId === 84_532) return "USDC"; // Base Sepolia Circle USDC (payment rail)
  if (chainId === 11_155_111) return "USDC"; // Ethereum Sepolia Circle USDC (desk rail)
  if (chainId === 8_453) return "USD Coin"; // Base mainnet
  // Sensible default for other Circle FiatToken deployments
  return "USD Coin";
}

const CHALLENGE_EXPIRY_MS = 600_000; // 10 minutes

const USDC_EIP3009_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const TRANSFER_WITH_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
/** EIP-712 placeholder when the payer wallet is not known at challenge time. */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface X402AuthorizationPayload {
  signature: string;
  from: string;
  to: string;
  value: string | number | bigint;
  validAfter: string | number;
  validBefore: string | number;
  nonce: string;
}

export interface X402SettlementRailResult {
  success: boolean;
  transactionHash?: string | undefined;
  errorMessage?: string | undefined;
}

export interface X402ReceiptVerificationResult {
  confirmed: boolean;
  from?: string | undefined;
  to?: string | undefined;
  value?: bigint | undefined;
  errorMessage?: string | undefined;
}

/**
 * x402 payment adapter.
 *
 * Production settlement always requires a real transfer rail:
 * 1. Cryptographic EIP-712 authorization validation (signer, amount, nonce, treasury `to`)
 * 2. On-chain submission via facilitator (`X402_FACILITATOR_URL`) OR direct
 *    `transferWithAuthorization` (RPC + settlement private key for gas)
 * 3. Successful receipt / facilitator transaction hash before marking verified
 *
 * Opt-in `allowTestMode` bypasses the transfer rail for local unit tests only.
 */
export class X402PaymentAdapter implements PaymentAdapter {
  readonly route = "x402" as const;

  private readonly facilitatorUrl: string | undefined;
  /** CDP Secret API Key credentials for authenticated facilitator settle (Bearer JWT). */
  private readonly cdpCredentials: CdpCredentials | undefined;
  /**
   * Static address or live resolver (production Para MPC warm-up updates the
   * address after ensureWallet completes).
   */
  private readonly treasuryWalletAddressResolver:
    | string
    | undefined
    | (() => string | undefined);
  private readonly rpcUrl: string | undefined;
  private readonly settlementPrivateKey: string | undefined;
  /** EVM chain ID for EIP-712 domain + RPC network (env: X402_CHAIN_ID). */
  private readonly chainId: number;
  /** USDC contract address for EIP-712 verifyingContract (env: X402_USDC_ADDRESS). */
  private readonly usdcAddress: string;
  /** EIP-712 domain name (must match on-chain USDC; env: X402_USDC_EIP712_NAME). */
  private readonly usdcEip712Name: string;
  /** EIP-712 domain version (env: X402_USDC_EIP712_VERSION). */
  private readonly usdcEip712Version: string;
  private readonly networkCaip2: string;
  private readonly settleAuthorization:
    | ((auth: X402AuthorizationPayload, expectedAmountAtomic: bigint) => Promise<X402SettlementRailResult>)
    | undefined;
  private readonly verifyTransactionReceipt:
    | ((
        txHash: string,
        expected: { to: string; minValue: bigint; from?: string | undefined },
      ) => Promise<X402ReceiptVerificationResult>)
    | undefined;

  /** Resolved treasury receive address (supports live Para resolver). */
  private get treasuryWalletAddress(): string | undefined {
    const resolved = this.treasuryWalletAddressResolver;
    if (typeof resolved === "function") {
      return resolved();
    }
    return resolved;
  }

  constructor(options?: {
    facilitatorUrl?: string | undefined;
    /**
     * Coinbase CDP Secret API Key credentials. Required when facilitatorUrl
     * points at api.cdp.coinbase.com (Bearer JWT on /settle).
     */
    cdpApiKeyId?: string | undefined;
    cdpApiKeySecret?: string | undefined;
    /**
     * Treasury receive address for x402 `to`. Accepts a static string or a
     * getter so production can point at a Para MPC wallet once enrolled.
     */
    treasuryWalletAddress?: string | undefined | (() => string | undefined);
    /** JSON-RPC URL for the configured chain (used for direct settlement + receipt checks). */
    rpcUrl?: string | undefined;
    /**
     * Private key that pays gas for direct `transferWithAuthorization` when no
     * facilitator is configured. Not the Para MPC spend key.
     */
    settlementPrivateKey?: string | undefined;
    /**
     * EVM chain ID for the x402 EIP-712 domain. Defaults to Base Sepolia (84532).
     * Production mainnet deployments should pass the target chain (e.g. 8453 for Base).
     */
    chainId?: number | undefined;
    /**
     * USDC (EIP-3009) contract used as verifyingContract / asset.
     * Defaults to Circle official USDC on Base Sepolia.
     */
    usdcAddress?: string | undefined;
    /**
     * EIP-712 domain `name` for USDC TransferWithAuthorization.
     * Defaults per chain (Base/Eth Sepolia → "USDC", Base mainnet → "USD Coin").
     * Must match the on-chain token domain or facilitator settle reverts.
     */
    usdcEip712Name?: string | undefined;
    /**
     * EIP-712 domain `version` for USDC TransferWithAuthorization. Default "2".
     */
    usdcEip712Version?: string | undefined;
    /**
     * Injectable settlement rail for unit tests. When omitted, the adapter uses
     * the facilitator (if configured) or direct on-chain submission.
     */
    settleAuthorization?:
      | ((auth: X402AuthorizationPayload, expectedAmountAtomic: bigint) => Promise<X402SettlementRailResult>)
      | undefined;
    /**
     * Injectable receipt verifier for unit tests. When omitted, the adapter
     * inspects the on-chain transaction receipt via RPC.
     */
    verifyTransactionReceipt?:
      | ((
          txHash: string,
          expected: { to: string; minValue: bigint; from?: string | undefined },
        ) => Promise<X402ReceiptVerificationResult>)
      | undefined;
  }) {
    this.facilitatorUrl = options?.facilitatorUrl?.replace(/\/$/, "") || undefined;
    const cdpId = options?.cdpApiKeyId?.trim();
    const cdpSecret = options?.cdpApiKeySecret?.trim();
    this.cdpCredentials =
      cdpId && cdpSecret ? { apiKeyId: cdpId, apiKeySecret: cdpSecret } : undefined;
    if (isCdpFacilitatorUrl(this.facilitatorUrl) && !this.cdpCredentials) {
      console.warn(
        "[x402] X402_FACILITATOR_URL points at Coinbase CDP but CDP_API_KEY_ID / CDP_API_KEY_SECRET are unset — settle will return 401",
      );
    }
    this.treasuryWalletAddressResolver = options?.treasuryWalletAddress;
    this.rpcUrl = options?.rpcUrl;
    this.settlementPrivateKey = options?.settlementPrivateKey;
    this.settleAuthorization = options?.settleAuthorization;
    this.verifyTransactionReceipt = options?.verifyTransactionReceipt;

    const chainId = options?.chainId ?? DEFAULT_X402_CHAIN_ID;
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new Error(`Invalid x402 chainId: expected a positive integer, got ${String(chainId)}`);
    }
    this.chainId = chainId;

    const usdcAddress = (options?.usdcAddress ?? DEFAULT_X402_USDC_ADDRESS).trim();
    if (!ADDRESS_RE.test(usdcAddress)) {
      throw new Error(
        `Invalid x402 USDC address: expected a 0x-prefixed 40-hex address, got ${JSON.stringify(usdcAddress)}`,
      );
    }
    this.usdcAddress = usdcAddress;
    const eip712Name = (options?.usdcEip712Name ?? defaultUsdcEip712Name(this.chainId)).trim();
    if (!eip712Name) {
      throw new Error("Invalid x402 USDC EIP-712 name: expected a non-empty string");
    }
    this.usdcEip712Name = eip712Name;
    this.usdcEip712Version = (
      options?.usdcEip712Version ?? DEFAULT_X402_USDC_EIP712_VERSION
    ).trim() || DEFAULT_X402_USDC_EIP712_VERSION;
    this.networkCaip2 = `eip155:${this.chainId}`;
  }

  /** EIP-712 domain for TransferWithAuthorization on the configured chain/USDC. */
  private eip712Domain(): {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  } {
    return {
      name: this.usdcEip712Name,
      version: this.usdcEip712Version,
      chainId: this.chainId,
      verifyingContract: this.usdcAddress,
    };
  }

  async createChallenge(params: {
    premiumItemId: string;
    amount: number;
    currency: string;
    payerReference?: string | undefined;
    /** Affiliate wallet from intent metadata — never the payer. */
    referralAddress?: string | null | undefined;
    /**
     * Optional recurring-agreement metadata for monthly newsletter (and similar)
     * x402 subscription intents. Embedded in challengeData so clients and
     * settlement handlers can distinguish one-shot vs period renewals.
     */
    agreement?:
      | {
          type: "recurring_newsletter";
          billingPeriodDays: number;
          subscriptionId?: string | undefined;
          periodKind: "initial" | "renewal";
          referralAddress?: string | null | undefined;
        }
      | undefined;
  }): Promise<ChallengeResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHALLENGE_EXPIRY_MS).toISOString();

    const challengeReference = `x402_${randomUUID()}`;
    const nonce = keccak256(stringToBytes(challengeReference));

    const domain = this.eip712Domain();

    const types = TRANSFER_WITH_AUTH_TYPES;

    if (
      !this.treasuryWalletAddress ||
      !ADDRESS_RE.test(this.treasuryWalletAddress)
    ) {
      throw new Error(
        "Treasury wallet address is not configured for x402 payments (TREASURY_WALLET_ADDRESS)",
      );
    }

    const treasuryTo = this.treasuryWalletAddress;
    // When the payer is not pre-bound, `from` is the zero-address placeholder.
    // Clients overwrite `from` with the connected wallet at sign time (see
    // PaymentChallengePanel). Settlement MUST reject zero-address `from`,
    // require recovered signer === `from`, and confirm Transfer to treasury.
    const boundFrom =
      params.payerReference && ADDRESS_RE.test(params.payerReference)
        ? params.payerReference
        : ZERO_ADDRESS;
    const message = {
      from: boundFrom,
      to: treasuryTo,
      value: Math.round(params.amount * 1_000_000), // Scale USDC to 6 decimals
      validAfter: 0,
      validBefore: Math.floor(new Date(expiresAt).getTime() / 1000),
      nonce,
    };

    // Affiliate referral is intent metadata only — never fall back to the payer.
    const referralCandidates = [
      params.agreement?.referralAddress,
      params.referralAddress,
    ];
    const referralFromIntent =
      referralCandidates.find(
        (addr): addr is string =>
          typeof addr === "string" && ADDRESS_RE.test(addr.trim()),
      ) ?? null;
    const referralAddress = referralFromIntent
      ? referralFromIntent.trim().toLowerCase()
      : null;

    // Persist numeric fields as decimal strings so JSON transport + viem
    // agree on uint256 encoding (no float / scientific notation).
    const messageForClient = {
      from: message.from,
      to: message.to,
      value: String(message.value),
      validAfter: String(message.validAfter),
      validBefore: String(message.validBefore),
      nonce: message.nonce,
    };

    const challengeData: Record<string, unknown> = {
      route: "x402",
      premiumItemId: params.premiumItemId,
      expectedAmount: params.amount,
      expectedCurrency: params.currency,
      facilitatorUrl: this.facilitatorUrl ?? null,
      referralAddress,
      challengeType: "permit",
      network: this.networkCaip2,
      asset: this.usdcAddress,
      domain,
      types,
      message: messageForClient,
    };

    // P2-10: one info line per settlement id; challenge details at debug.
    x402Log.debug("challenge created", {
      challengeReference,
      network: this.networkCaip2,
      asset: this.usdcAddress,
      chainId: domain.chainId,
      value: messageForClient.value,
    });

    if (params.agreement) {
      challengeData.agreementType = params.agreement.type;
      challengeData.billingPeriodDays = params.agreement.billingPeriodDays;
      challengeData.periodKind = params.agreement.periodKind;
      challengeData.subscriptionId = params.agreement.subscriptionId ?? null;
      challengeData.product = "monthly_newsletter";
    }

    return {
      challengeReference,
      paymentRoute: "x402",
      amountRequested: params.amount,
      currency: params.currency,
      expiresAt,
      challengeData,
    };
  }

  async verifySettlement(params: {
    challengeReference: string;
    settlementReference: string;
    amountRequested: number;
    currency: string;
    paymentRoute: string;
  }): Promise<SettlementVerificationResult> {
    if (params.paymentRoute !== "x402") {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Invalid payment route for x402 adapter",
      };
    }

    if (!params.settlementReference) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Invalid settlement reference",
      };
    }

    const expectedValueAtomic = BigInt(Math.round(params.amountRequested * 1_000_000));

    // Path A: client already submitted on-chain — verify the transaction receipt.
    if (TX_HASH_RE.test(params.settlementReference.trim())) {
      return this.verifyByTransactionHash({
        txHash: params.settlementReference.trim(),
        amountRequested: params.amountRequested,
        currency: params.currency,
        expectedValueAtomic,
      });
    }

    // Path B: EIP-712 authorization JSON — validate, submit transfer, confirm receipt.
    try {
      if (params.settlementReference.trim().startsWith("{")) {
        return await this.verifyAndSettleAuthorization({
          settlementReference: params.settlementReference,
          challengeReference: params.challengeReference,
          amountRequested: params.amountRequested,
          currency: params.currency,
          expectedValueAtomic,
        });
      }
    } catch (err) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: `Failed to settle x402 payment: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }

    return {
      verified: false,
      amountSettled: 0,
      currency: params.currency,
      settlementReference: params.settlementReference,
      errorMessage:
        "Settlement requires a JSON serialized EIP-712 authorization payload or an on-chain transaction hash",
    };
  }

  private async verifyAndSettleAuthorization(params: {
    settlementReference: string;
    challengeReference: string;
    amountRequested: number;
    currency: string;
    expectedValueAtomic: bigint;
  }): Promise<SettlementVerificationResult> {
    const payload = JSON.parse(params.settlementReference) as Record<string, unknown>;

    // Accept either flat EIP-712 fields or nested x402 payload.authorization shape
    const auth = this.normalizeAuthorizationPayload(payload);
    if (!auth) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Missing required EIP-712 parameters in settlement reference JSON",
      };
    }

    const { signature, from, to, value, validAfter, validBefore, nonce } = auth;

    if (!this.treasuryWalletAddress || !ADDRESS_RE.test(this.treasuryWalletAddress)) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Treasury wallet address is not configured for x402 settlement",
      };
    }

    // Enforce payment destination is the configured treasury
    if (to.toLowerCase() !== this.treasuryWalletAddress.toLowerCase()) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: `Authorization recipient does not match treasury (to=${to})`,
      };
    }

    if (!ADDRESS_RE.test(from)) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Invalid payer (from) address in authorization",
      };
    }

    // Zero-address `from` is only a challenge-time placeholder — never accept
    // settlement authorizations that leave the payer unbound.
    if (from.toLowerCase() === ZERO_ADDRESS) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage:
          "Invalid payer (from) address: zero address is not allowed at settlement; client must set from to the signing wallet",
      };
    }

    const valueAtomic = BigInt(value);
    const validAfterNum = Number(validAfter);
    const validBeforeNum = Number(validBefore);

    // Normalize addresses + use bigint for uint fields (matches viem signTypedData).
    let fromChecksum: string;
    let toChecksum: string;
    try {
      fromChecksum = getAddress(from);
      toChecksum = getAddress(to);
    } catch {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Invalid from/to address in authorization",
      };
    }

    const message = {
      from: fromChecksum as Address,
      to: toChecksum as Address,
      value: valueAtomic,
      validAfter: BigInt(validAfterNum),
      validBefore: BigInt(validBeforeNum),
      nonce: nonce as Hex,
    };

    // Verify against the configured on-chain domain only. Try the common Circle
    // alternate name purely for diagnostics (stale client challenges signed as "USD Coin").
    const primaryDomain = this.eip712Domain();
    let recoveredAddress: string | null = null;
    let recoveredPrimary: string | null = null;
    let matchedStaleAlternate: string | null = null;

    try {
      recoveredPrimary = await recoverTypedDataAddress({
        domain: {
          name: primaryDomain.name,
          version: primaryDomain.version,
          chainId: primaryDomain.chainId,
          verifyingContract: primaryDomain.verifyingContract as Address,
        },
        types: TRANSFER_WITH_AUTH_TYPES,
        primaryType: "TransferWithAuthorization",
        message,
        signature: signature as Hex,
      });
      if (recoveredPrimary.toLowerCase() === fromChecksum.toLowerCase()) {
        recoveredAddress = recoveredPrimary;
      }
    } catch (err) {
      console.warn("[x402] EIP-712 primary domain recover threw", {
        domain: primaryDomain,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (!recoveredAddress) {
      for (const altName of ["USDC", "USD Coin"] as const) {
        if (altName === primaryDomain.name) continue;
        try {
          const altRecovered = await recoverTypedDataAddress({
            domain: {
              name: altName,
              version: primaryDomain.version,
              chainId: primaryDomain.chainId,
              verifyingContract: primaryDomain.verifyingContract as Address,
            },
            types: TRANSFER_WITH_AUTH_TYPES,
            primaryType: "TransferWithAuthorization",
            message,
            signature: signature as Hex,
          });
          if (altRecovered.toLowerCase() === fromChecksum.toLowerCase()) {
            matchedStaleAlternate = altName;
            break;
          }
        } catch {
          // ignore
        }
      }

      console.warn("[x402] EIP-712 recover mismatch", {
        from: fromChecksum,
        to: toChecksum,
        value: valueAtomic.toString(),
        validAfter: validAfterNum,
        validBefore: validBeforeNum,
        nonce,
        expectedDomain: primaryDomain,
        recoveredPrimary,
        matchedStaleAlternate,
      });

      if (matchedStaleAlternate) {
        return {
          verified: false,
          amountSettled: 0,
          currency: params.currency,
          settlementReference: params.settlementReference,
          errorMessage:
            `Signature was created with EIP-712 domain name ${JSON.stringify(matchedStaleAlternate)}, ` +
            `but this server expects ${JSON.stringify(primaryDomain.name)} (on-chain USDC domain). ` +
            "Close the payment panel and start a new challenge so the wallet re-signs with the correct domain.",
        };
      }

      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage:
          "Cryptographic signature verification failed: recovered address does not match from address. " +
          "Create a fresh payment challenge and sign again " +
          `(expected EIP-712 name=${JSON.stringify(this.usdcEip712Name)} version=${JSON.stringify(this.usdcEip712Version)} chainId=${this.chainId}).` +
          (recoveredPrimary
            ? ` Recovered ${recoveredPrimary} for claimed from ${fromChecksum}.`
            : ""),
      };
    }

    // Verify nonce matches expected challenge reference hash
    const expectedNonce = keccak256(stringToBytes(params.challengeReference));
    if (nonce.toLowerCase() !== expectedNonce.toLowerCase()) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Nonce mismatch: challengeReference hash does not match provided nonce",
      };
    }

    // Verify amount
    if (valueAtomic < params.expectedValueAtomic) {
      return {
        verified: false,
        amountSettled: Number(valueAtomic) / 1_000_000,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Insufficient payment value in signature",
      };
    }

    // Enforce validity window
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec < validAfterNum) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Authorization is not yet valid (validAfter)",
      };
    }
    if (nowSec >= validBeforeNum) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: "Authorization has expired (validBefore)",
      };
    }

    // Submit the real transfer (facilitator or on-chain)
    const settleResult = await this.submitAuthorization(
      {
        signature,
        from,
        to,
        value: valueAtomic.toString(),
        validAfter: validAfterNum,
        validBefore: validBeforeNum,
        nonce,
      },
      params.expectedValueAtomic,
    );

    if (!settleResult.success || !settleResult.transactionHash) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage:
          settleResult.errorMessage ??
          "Failed to settle authorization on-chain (no transaction hash returned)",
      };
    }

    // Confirm the transfer landed at treasury for the expected amount
    const receiptCheck = await this.confirmTransaction(
      settleResult.transactionHash,
      {
        to: this.treasuryWalletAddress,
        minValue: params.expectedValueAtomic,
        from,
      },
    );

    if (!receiptCheck.confirmed) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: settleResult.transactionHash,
        errorMessage:
          receiptCheck.errorMessage ??
          "On-chain receipt did not confirm USDC transfer to treasury",
      };
    }

    return {
      verified: true,
      amountSettled: params.amountRequested,
      currency: params.currency,
      settlementReference: settleResult.transactionHash,
      payerReference: from,
    };
  }

  private async verifyByTransactionHash(params: {
    txHash: string;
    amountRequested: number;
    currency: string;
    expectedValueAtomic: bigint;
  }): Promise<SettlementVerificationResult> {
    if (!this.treasuryWalletAddress || !ADDRESS_RE.test(this.treasuryWalletAddress)) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.txHash,
        errorMessage: "Treasury wallet address is not configured for x402 settlement",
      };
    }

    const receiptCheck = await this.confirmTransaction(params.txHash, {
      to: this.treasuryWalletAddress,
      minValue: params.expectedValueAtomic,
    });

    if (!receiptCheck.confirmed) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.txHash,
        errorMessage:
          receiptCheck.errorMessage ??
          "Transaction receipt did not confirm a matching USDC transfer to treasury",
      };
    }

    return {
      verified: true,
      amountSettled: params.amountRequested,
      currency: params.currency,
      settlementReference: params.txHash,
      payerReference: receiptCheck.from,
    };
  }

  private hasSettlementRail(): boolean {
    return Boolean(
      this.settleAuthorization ||
        this.facilitatorUrl ||
        (this.rpcUrl && this.settlementPrivateKey),
    );
  }

  private async submitAuthorization(
    auth: X402AuthorizationPayload,
    expectedAmountAtomic: bigint,
  ): Promise<X402SettlementRailResult> {
    if (this.settleAuthorization) {
      return this.settleAuthorization(auth, expectedAmountAtomic);
    }

    if (this.facilitatorUrl) {
      return this.settleViaFacilitator(auth, expectedAmountAtomic);
    }

    if (this.rpcUrl && this.settlementPrivateKey) {
      return this.settleOnChain(auth);
    }

    return {
      success: false,
      errorMessage:
        "x402 settlement rail is not configured. Set X402_FACILITATOR_URL or provide RPC_URL + TREASURY_WALLET_PRIVATE_KEY for direct transferWithAuthorization",
    };
  }

  private async settleViaFacilitator(
    auth: X402AuthorizationPayload,
    expectedAmountAtomic: bigint,
  ): Promise<X402SettlementRailResult> {
    if (!this.facilitatorUrl || !this.treasuryWalletAddress) {
      return { success: false, errorMessage: "Facilitator URL or treasury is not configured" };
    }

    const valueStr = BigInt(auth.value).toString();
    // CDP OpenAPI: top-level x402Version + paymentPayload + paymentRequirements.
    // v2 paymentPayload puts scheme/network on nested `accepted` (not top-level).
    const paymentRequirements = {
      scheme: "exact",
      network: this.networkCaip2,
      amount: expectedAmountAtomic.toString(),
      maxAmountRequired: expectedAmountAtomic.toString(),
      asset: this.usdcAddress,
      payTo: this.treasuryWalletAddress,
      maxTimeoutSeconds: 120,
      extra: {
        name: this.usdcEip712Name,
        version: this.usdcEip712Version,
      },
    };

    const paymentPayload = {
      x402Version: 2 as const,
      accepted: {
        scheme: "exact",
        network: this.networkCaip2,
        amount: expectedAmountAtomic.toString(),
        asset: this.usdcAddress,
        payTo: this.treasuryWalletAddress,
        maxTimeoutSeconds: 120,
        extra: {
          name: this.usdcEip712Name,
          version: this.usdcEip712Version,
        },
      },
      payload: {
        signature: auth.signature,
        authorization: {
          from: auth.from,
          to: auth.to,
          value: valueStr,
          validAfter: String(auth.validAfter),
          validBefore: String(auth.validBefore),
          nonce: auth.nonce,
        },
      },
    };

    const settleBody = {
      x402Version: 2 as const,
      paymentPayload,
      paymentRequirements,
    };

    const settleUrls = this.buildFacilitatorSettleUrls(this.facilitatorUrl);
    x402Log.debug("facilitator settle start", {
      network: this.networkCaip2,
      asset: this.usdcAddress,
      amountAtomic: expectedAmountAtomic.toString(),
      from: auth.from,
      hasCdpCredentials: Boolean(this.cdpCredentials),
      candidateCount: settleUrls.length,
    });

    /** Prefer actionable API errors over path-not-found noise from alternate URLs. */
    let bestError = "Facilitator settle failed";
    let bestErrorRank = -1;

    for (const url of settleUrls) {
      try {
        const headers = await buildFacilitatorAuthHeaders(url, this.cdpCredentials, "POST");
        const hasAuth = Boolean(headers.Authorization);
        x402Log.debug("facilitator settle attempt", {
          url,
          hasAuthorizationHeader: hasAuth,
        });

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(settleBody),
        });

        const rawText = await response.text();
        let body: Record<string, unknown> = {};
        if (rawText) {
          try {
            body = JSON.parse(rawText) as Record<string, unknown>;
          } catch {
            body = { raw: rawText.slice(0, 500) };
          }
        }

        x402Log.debug("facilitator settle response", {
          url,
          status: response.status,
          bodyPreview: rawText.slice(0, 200),
        });

        if (!response.ok) {
          const detail = this.formatFacilitatorError(response.status, body, url);
          const rank = this.rankFacilitatorError(response.status);
          if (rank >= bestErrorRank) {
            bestErrorRank = rank;
            bestError = detail;
          }
          // Auth failures on the primary URL are definitive — do not hide behind 404s.
          if (response.status === 401 || response.status === 403) {
            break;
          }
          continue;
        }

        const success =
          body.success === true ||
          body.isValid === true ||
          body.success === "true" ||
          // Some facilitators return a tx hash without an explicit success flag
          (typeof body.transaction === "string" && TX_HASH_RE.test(body.transaction));

        const transactionHash =
          (typeof body.transaction === "string" && body.transaction) ||
          (typeof body.txHash === "string" && body.txHash) ||
          (typeof body.transactionHash === "string" && body.transactionHash) ||
          (typeof (body as { settlement?: { transaction?: string } }).settlement?.transaction ===
            "string" &&
            (body as { settlement: { transaction: string } }).settlement.transaction) ||
          undefined;

        if (!success) {
          bestError =
            typeof body.errorReason === "string"
              ? body.errorReason
              : typeof body.invalidReason === "string"
                ? body.invalidReason
                : typeof body.error === "string"
                  ? body.error
                  : "Facilitator rejected settlement";
          bestErrorRank = Math.max(bestErrorRank, 50);
          x402Log.warn("facilitator rejected settlement", {
            url,
            error: bestError,
          });
          continue;
        }

        if (!transactionHash || !TX_HASH_RE.test(transactionHash)) {
          bestError = "Facilitator returned success without a valid transaction hash";
          bestErrorRank = Math.max(bestErrorRank, 50);
          x402Log.warn("facilitator success without tx hash", { url });
          continue;
        }

        // P2-10: single info line per successful settlement.
        x402Log.info("settlement ok", { transactionHash, via: "facilitator" });
        return { success: true, transactionHash };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Facilitator request failed";
        x402Log.error("facilitator settle request error", { url, error: msg });
        if (bestErrorRank < 10) {
          bestErrorRank = 10;
          bestError = msg;
        }
      }
    }

    x402Log.error("facilitator settle exhausted candidates", {
      bestError,
      candidateCount: settleUrls.length,
    });

    // Fall back to direct on-chain if we have gas key (facilitator unavailable)
    if (this.rpcUrl && this.settlementPrivateKey) {
      x402Log.info("settlement fallback", { via: "on_chain" });
      return this.settleOnChain(auth);
    }

    return { success: false, errorMessage: bestError };
  }

  /** Higher rank = more useful diagnostic (prefer 4xx body over generic 404 path misses). */
  private rankFacilitatorError(status: number): number {
    if (status === 401 || status === 403) return 100;
    if (status === 400 || status === 422) return 90;
    if (status === 402) return 80;
    if (status === 404) return 20;
    if (status >= 500) return 40;
    return 30;
  }

  private formatFacilitatorError(
    status: number,
    body: Record<string, unknown>,
    url: string,
  ): string {
    const errorMessage =
      typeof body.errorMessage === "string" ? body.errorMessage : undefined;
    const detail =
      typeof body.error === "string"
        ? body.error
        : typeof body.errorReason === "string"
          ? body.errorReason
          : typeof body.message === "string"
            ? body.message
            : typeof body.raw === "string"
              ? body.raw.slice(0, 200)
              : `Facilitator HTTP ${status}`;

    const combined = errorMessage && errorMessage !== detail ? `${detail}: ${errorMessage}` : detail;

    if (status === 401 || status === 403) {
      return `${combined} (check CDP_API_KEY_ID / CDP_API_KEY_SECRET for CDP facilitator) [${url}]`;
    }
    if (status === 404) {
      return `Facilitator HTTP 404 at ${url} — check X402_FACILITATOR_URL (expected …/platform/v2/x402, settle posts to …/settle)`;
    }
    // CDP maps on-chain reverts (bad EIP-712 domain, low balance, bad sig) to this text
    if (/unable to estimate gas|invalid_payload/i.test(combined)) {
      return (
        `${combined} — usually invalid EIP-712 domain/signature or insufficient USDC. ` +
        `Domain in use: name=${JSON.stringify(this.usdcEip712Name)} version=${JSON.stringify(this.usdcEip712Version)} ` +
        `asset=${this.usdcAddress} chainId=${this.chainId}. Circle Sepolia USDC must use name "USDC" (not "USD Coin"). [${url}]`
      );
    }
    return `${combined} [${url}]`;
  }

  /**
   * Resolve settle endpoint candidates from the configured facilitator base.
   * CDP canonical: https://api.cdp.coinbase.com/platform/v2/x402 → …/settle
   * Public testnet: https://x402.org/facilitator → …/settle
   *
   * If the env value already ends with /settle, use it as-is (no double suffix).
   * For CDP hosts we do NOT try legacy /facilitator/settle (those 404 and used to
   * overwrite a more useful primary error in the client message).
   */
  private buildFacilitatorSettleUrls(baseUrl: string): string[] {
    const normalized = baseUrl.replace(/\/$/, "");
    const urls: string[] = [];

    // Env already points at the settle endpoint
    if (normalized.endsWith("/settle")) {
      urls.push(normalized);
      return urls;
    }

    const isCdp = isCdpFacilitatorUrl(normalized);

    if (isCdp) {
      // Prefer the documented CDP path first
      if (normalized.endsWith("/v2/x402") || normalized.endsWith("/x402")) {
        urls.push(`${normalized}/settle`);
      } else if (normalized.endsWith("/platform")) {
        urls.push(`${normalized}/v2/x402/settle`);
      } else if (normalized.includes("api.cdp.coinbase.com")) {
        // Host only or unexpected base — still try canonical
        urls.push(`${normalized}/platform/v2/x402/settle`);
        urls.push(`${normalized}/v2/x402/settle`);
        urls.push(`${normalized}/settle`);
      } else {
        urls.push(`${normalized}/settle`);
      }
      return urls;
    }

    // Non-CDP facilitators (x402.org, self-hosted)
    urls.push(`${normalized}/settle`);
    if (!normalized.endsWith("/x402") && !normalized.endsWith("/facilitator")) {
      urls.push(`${normalized}/v2/x402/settle`);
      urls.push(`${normalized}/x402/settle`);
      urls.push(`${normalized}/facilitator/settle`);
    } else if (normalized.endsWith("/facilitator") === false) {
      urls.push(`${normalized}/facilitator/settle`);
    }
    return [...new Set(urls)];
  }

  private async settleOnChain(
    auth: X402AuthorizationPayload,
  ): Promise<X402SettlementRailResult> {
    if (!this.rpcUrl || !this.settlementPrivateKey) {
      return {
        success: false,
        errorMessage: "RPC_URL and TREASURY_WALLET_PRIVATE_KEY are required for direct on-chain settlement",
      };
    }

    try {
      const chain = chainFromId(this.chainId);
      const pk = (
        this.settlementPrivateKey.startsWith("0x")
          ? this.settlementPrivateKey
          : `0x${this.settlementPrivateKey}`
      ) as Hex;
      const account = privateKeyToAccount(pk);
      const publicClient = createPublicClient({
        chain,
        transport: http(this.rpcUrl),
      });
      const walletClient = createWalletClient({
        account,
        chain,
        transport: http(this.rpcUrl),
      });
      const usdc = getContract({
        address: this.usdcAddress as Address,
        abi: USDC_EIP3009_ABI,
        client: { public: publicClient, wallet: walletClient },
      });

      // Skip if this nonce was already used (idempotent retry)
      try {
        const used = await usdc.read.authorizationState([
          auth.from as Address,
          auth.nonce as Hex,
        ]);
        if (used === true) {
          // Authorization already consumed — caller must supply the original tx hash
          // or we cannot invent one. Fail closed with a clear message.
          return {
            success: false,
            errorMessage:
              "Authorization nonce already used on-chain; resubmit the confirmed transaction hash as settlementReference",
          };
        }
      } catch {
        // Some USDC deployments return bool, others uint8; continue to submit
      }

      const sig = parseSignature(auth.signature as Hex);
      const v = sig.v !== undefined ? Number(sig.v) : sig.yParity + 27;
      const hash = await usdc.write.transferWithAuthorization(
        [
          auth.from as Address,
          auth.to as Address,
          BigInt(auth.value),
          BigInt(auth.validAfter),
          BigInt(auth.validBefore),
          auth.nonce as Hex,
          v,
          sig.r,
          sig.s,
        ],
        { account, chain },
      );

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        return {
          success: false,
          errorMessage: "On-chain transferWithAuthorization transaction failed or was reverted",
          transactionHash: hash,
        };
      }

      return {
        success: true,
        transactionHash: receipt.transactionHash,
      };
    } catch (err) {
      return {
        success: false,
        errorMessage: `On-chain transferWithAuthorization failed: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }
  }

  private async confirmTransaction(
    txHash: string,
    expected: { to: string; minValue: bigint; from?: string | undefined },
  ): Promise<X402ReceiptVerificationResult> {
    if (this.verifyTransactionReceipt) {
      return this.verifyTransactionReceipt(txHash, expected);
    }

    if (!this.rpcUrl) {
      // Facilitator already confirmed settlement with a tx hash; when RPC is
      // unavailable we still require a well-formed hash but cannot re-check logs.
      // Fail closed in production unless a facilitator was the settlement path
      // and returned this hash — the hash alone is not enough without RPC.
      return {
        confirmed: false,
        errorMessage:
          "RPC_URL is required to confirm on-chain USDC transfer receipts for x402 settlements",
      };
    }

    try {
      const publicClient = createPublicClient({
        chain: chainFromId(this.chainId),
        transport: http(this.rpcUrl),
      });
      let receipt: Awaited<
        ReturnType<typeof publicClient.getTransactionReceipt>
      >;
      try {
        receipt = await publicClient.getTransactionReceipt({
          hash: txHash as Hash,
        });
      } catch {
        return { confirmed: false, errorMessage: `Transaction not found: ${txHash}` };
      }
      if (receipt.status !== "success") {
        return { confirmed: false, errorMessage: `Transaction reverted: ${txHash}` };
      }

      const usdcAddress = this.usdcAddress.toLowerCase();
      const expectedTo = expected.to.toLowerCase();
      const expectedFrom = expected.from?.toLowerCase();

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== usdcAddress) continue;
        try {
          const parsed = decodeEventLog({
            abi: USDC_EIP3009_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (parsed.eventName !== "Transfer") continue;

          const args = parsed.args as {
            from?: Address;
            to?: Address;
            value?: bigint;
          };
          const transferFrom = String(args.from).toLowerCase();
          const transferTo = String(args.to).toLowerCase();
          const transferValue = BigInt(args.value ?? 0n);

          if (transferTo !== expectedTo) continue;
          if (expectedFrom && transferFrom !== expectedFrom) continue;
          if (transferValue < expected.minValue) {
            return {
              confirmed: false,
              from: transferFrom,
              to: transferTo,
              value: transferValue,
              errorMessage: `On-chain transfer amount ${transferValue} is below required ${expected.minValue}`,
            };
          }

          return {
            confirmed: true,
            from: transferFrom,
            to: transferTo,
            value: transferValue,
          };
        } catch {
          // Not a Transfer log we can parse
        }
      }

      return {
        confirmed: false,
        errorMessage:
          "No matching USDC Transfer event to treasury found in transaction receipt",
      };
    } catch (err) {
      return {
        confirmed: false,
        errorMessage: `Failed to verify transaction receipt: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }
  }

  private normalizeAuthorizationPayload(
    payload: Record<string, unknown>,
  ): X402AuthorizationPayload | null {
    // Flat shape used by our client: { signature, from, to, value, ... }
    if (typeof payload.signature === "string" && typeof payload.from === "string") {
      if (
        typeof payload.to !== "string" ||
        payload.value === undefined ||
        payload.validAfter === undefined ||
        payload.validBefore === undefined ||
        typeof payload.nonce !== "string"
      ) {
        return null;
      }
      return {
        signature: payload.signature,
        from: payload.from,
        to: payload.to,
        value: payload.value as string | number | bigint,
        validAfter: payload.validAfter as string | number,
        validBefore: payload.validBefore as string | number,
        nonce: payload.nonce,
      };
    }

    // Nested x402 PAYMENT-SIGNATURE shape: { payload: { signature, authorization } }
    const nested = payload.payload as Record<string, unknown> | undefined;
    const authorization = nested?.authorization as Record<string, unknown> | undefined;
    if (
      nested &&
      typeof nested.signature === "string" &&
      authorization &&
      typeof authorization.from === "string" &&
      typeof authorization.to === "string" &&
      authorization.value !== undefined &&
      authorization.validAfter !== undefined &&
      authorization.validBefore !== undefined &&
      typeof authorization.nonce === "string"
    ) {
      return {
        signature: nested.signature,
        from: authorization.from,
        to: authorization.to,
        value: authorization.value as string | number | bigint,
        validAfter: authorization.validAfter as string | number,
        validBefore: authorization.validBefore as string | number,
        nonce: authorization.nonce,
      };
    }

    return null;
  }
}
