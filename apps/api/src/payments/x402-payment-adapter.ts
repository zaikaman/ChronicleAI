// x402 Payment Adapter
// Implements the x402 (EVM USDC subscription) payment route.
// Settlement requires a real USDC transfer: either via a facilitator
// (POST /settle) or by submitting EIP-3009 transferWithAuthorization on-chain.
// Signature verification alone never unlocks premium.
//
// Chain ID and USDC verifyingContract are configurable (env-driven in production
// wiring). Defaults target Base Sepolia for the hackathon demo.

import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import type {
  ChallengeResult,
  PaymentAdapter,
  SettlementVerificationResult,
} from "./payment-adapter.ts";

/** Defaults: Base Sepolia + Circle official USDC (EIP-3009). */
export const DEFAULT_X402_CHAIN_ID = 84_532;
export const DEFAULT_X402_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
/** EIP-712 domain name/version for Circle USDC transferWithAuthorization. */
const USDC_EIP712_NAME = "USD Coin";
const USDC_EIP712_VERSION = "2";

const CHALLENGE_EXPIRY_MS = 600_000; // 10 minutes

const USDC_EIP3009_ABI = [
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
] as const;

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

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
  private readonly treasuryWalletAddress: string | undefined;
  private readonly allowTestMode: boolean;
  private readonly rpcUrl: string | undefined;
  private readonly settlementPrivateKey: string | undefined;
  /** EVM chain ID for EIP-712 domain + RPC network (env: X402_CHAIN_ID). */
  private readonly chainId: number;
  /** USDC contract address for EIP-712 verifyingContract (env: X402_USDC_ADDRESS). */
  private readonly usdcAddress: string;
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

  constructor(options?: {
    facilitatorUrl?: string | undefined;
    treasuryWalletAddress?: string | undefined;
    /**
     * When true, the adapter will accept plain-string settlement references
     * without EIP-712 signature verification or on-chain settlement.
     * Intended for local development and integration tests only. Defaults to false.
     */
    allowTestMode?: boolean | undefined;
    /** JSON-RPC URL for the configured chain (used for direct settlement + receipt checks). */
    rpcUrl?: string | undefined;
    /**
     * Private key that pays gas for direct `transferWithAuthorization` when no
     * facilitator is configured. Typically TREASURY_WALLET_PRIVATE_KEY.
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
    this.treasuryWalletAddress = options?.treasuryWalletAddress;
    this.allowTestMode = options?.allowTestMode ?? false;
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
      name: USDC_EIP712_NAME,
      version: USDC_EIP712_VERSION,
      chainId: this.chainId,
      verifyingContract: this.usdcAddress,
    };
  }

  async createChallenge(params: {
    premiumItemId: string;
    amount: number;
    currency: string;
    payerReference?: string | undefined;
  }): Promise<ChallengeResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHALLENGE_EXPIRY_MS).toISOString();

    const challengeReference = `x402_${randomUUID()}`;
    const nonce = ethers.keccak256(ethers.toUtf8Bytes(challengeReference));

    const domain = this.eip712Domain();

    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };

    if (
      !this.treasuryWalletAddress ||
      !ADDRESS_RE.test(this.treasuryWalletAddress)
    ) {
      throw new Error(
        "Treasury wallet address is not configured for x402 payments (TREASURY_WALLET_ADDRESS)",
      );
    }

    const treasuryTo = this.treasuryWalletAddress;
    // `from` is filled by the payer wallet at sign time when not pre-bound
    const message = {
      from:
        params.payerReference && ADDRESS_RE.test(params.payerReference)
          ? params.payerReference
          : "0x0000000000000000000000000000000000000000",
      to: treasuryTo,
      value: Math.round(params.amount * 1_000_000), // Scale USDC to 6 decimals
      validAfter: 0,
      validBefore: Math.floor(new Date(expiresAt).getTime() / 1000),
      nonce,
    };

    const challengeData: Record<string, unknown> = {
      route: "x402",
      premiumItemId: params.premiumItemId,
      expectedAmount: params.amount,
      expectedCurrency: params.currency,
      facilitatorUrl: this.facilitatorUrl ?? null,
      referralAddress: params.payerReference ?? null,
      challengeType: "permit",
      network: this.networkCaip2,
      asset: this.usdcAddress,
      domain,
      types,
      message,
    };

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

    // Fallback to local test mode when explicitly opted in via allowTestMode
    if (this.allowTestMode) {
      if (params.settlementReference.length < 5) {
        return {
          verified: false,
          amountSettled: 0,
          currency: params.currency,
          settlementReference: params.settlementReference,
          errorMessage: "Settlement reference is too short",
        };
      }

      const payerReference = `0x${params.settlementReference.slice(0, 40).padEnd(40, "0")}`;
      return {
        verified: true,
        amountSettled: params.amountRequested,
        currency: params.currency,
        settlementReference: params.settlementReference,
        payerReference,
      };
    }

    return {
      verified: false,
      amountSettled: 0,
      currency: params.currency,
      settlementReference: params.settlementReference,
      errorMessage:
        "Settlement requires a JSON serialized EIP-712 authorization payload or an on-chain transaction hash. For test/development, construct the X402PaymentAdapter with { allowTestMode: true }",
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

    const domain = this.eip712Domain();

    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };

    const valueAtomic = BigInt(value);
    const validAfterNum = Number(validAfter);
    const validBeforeNum = Number(validBefore);

    const message = {
      from,
      to,
      value: valueAtomic.toString(),
      validAfter: validAfterNum,
      validBefore: validBeforeNum,
      nonce,
    };

    // Recover signer using ethers
    let recoveredAddress: string;
    try {
      recoveredAddress = ethers.verifyTypedData(domain, types, message, signature);
    } catch (err) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage: `Cryptographic signature verification failed: ${err instanceof Error ? err.message : "invalid signature"}`,
      };
    }

    if (recoveredAddress.toLowerCase() !== from.toLowerCase()) {
      return {
        verified: false,
        amountSettled: 0,
        currency: params.currency,
        settlementReference: params.settlementReference,
        errorMessage:
          "Cryptographic signature verification failed: recovered address does not match from address",
      };
    }

    // Verify nonce matches expected challenge reference hash
    const expectedNonce = ethers.keccak256(ethers.toUtf8Bytes(params.challengeReference));
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

    // Test mode may skip the transfer rail after cryptographic checks
    if (this.allowTestMode && !this.hasSettlementRail()) {
      return {
        verified: true,
        amountSettled: params.amountRequested,
        currency: params.currency,
        settlementReference: params.settlementReference,
        payerReference: from,
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

    if (this.allowTestMode && !this.rpcUrl && !this.verifyTransactionReceipt) {
      // Test mode without RPC: accept well-formed tx hashes only when explicitly opted in
      return {
        verified: true,
        amountSettled: params.amountRequested,
        currency: params.currency,
        settlementReference: params.txHash,
        payerReference: `0x${params.txHash.slice(2, 42)}`,
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
    const paymentRequirements = {
      scheme: "exact",
      network: this.networkCaip2,
      amount: expectedAmountAtomic.toString(),
      maxAmountRequired: expectedAmountAtomic.toString(),
      asset: this.usdcAddress,
      payTo: this.treasuryWalletAddress,
      maxTimeoutSeconds: 120,
      extra: {
        name: USDC_EIP712_NAME,
        version: USDC_EIP712_VERSION,
      },
    };

    const paymentPayload = {
      x402Version: 2,
      scheme: "exact",
      network: this.networkCaip2,
      accepted: {
        scheme: "exact",
        network: this.networkCaip2,
        amount: expectedAmountAtomic.toString(),
        asset: this.usdcAddress,
        payTo: this.treasuryWalletAddress,
        maxTimeoutSeconds: 120,
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

    const settleUrls = this.buildFacilitatorSettleUrls(this.facilitatorUrl);
    let lastError = "Facilitator settle failed";

    for (const url of settleUrls) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ paymentPayload, paymentRequirements }),
        });

        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

        if (!response.ok) {
          lastError =
            typeof body.error === "string"
              ? body.error
              : typeof body.errorReason === "string"
                ? body.errorReason
                : `Facilitator HTTP ${response.status}`;
          // Try alternate path shapes before giving up
          continue;
        }

        const success = body.success === true || body.isValid === true;
        const transactionHash =
          (typeof body.transaction === "string" && body.transaction) ||
          (typeof body.txHash === "string" && body.txHash) ||
          (typeof body.transactionHash === "string" && body.transactionHash) ||
          undefined;

        if (!success) {
          lastError =
            typeof body.errorReason === "string"
              ? body.errorReason
              : typeof body.invalidReason === "string"
                ? body.invalidReason
                : "Facilitator rejected settlement";
          continue;
        }

        if (!transactionHash || !TX_HASH_RE.test(transactionHash)) {
          lastError = "Facilitator returned success without a valid transaction hash";
          continue;
        }

        return { success: true, transactionHash };
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Facilitator request failed";
      }
    }

    // Fall back to direct on-chain if we have gas key (facilitator unavailable)
    if (this.rpcUrl && this.settlementPrivateKey) {
      return this.settleOnChain(auth);
    }

    return { success: false, errorMessage: lastError };
  }

  private buildFacilitatorSettleUrls(baseUrl: string): string[] {
    const urls = new Set<string>();
    urls.add(`${baseUrl}/settle`);
    // CDP platform base may already end with /v2/x402; also try bare /settle variants
    if (!baseUrl.endsWith("/x402")) {
      urls.add(`${baseUrl}/v2/x402/settle`);
      urls.add(`${baseUrl}/x402/settle`);
    }
    // Legacy facilitators sometimes use /facilitator/settle
    urls.add(`${baseUrl}/facilitator/settle`);
    return [...urls];
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
      const provider = new ethers.JsonRpcProvider(this.rpcUrl, this.chainId);
      const wallet = new ethers.Wallet(this.settlementPrivateKey, provider);
      const usdc = new ethers.Contract(this.usdcAddress, USDC_EIP3009_ABI, wallet);
      const authorizationState = usdc.getFunction("authorizationState");
      const transferWithAuthorization = usdc.getFunction("transferWithAuthorization");

      // Skip if this nonce was already used (idempotent retry)
      try {
        const used = await authorizationState(auth.from, auth.nonce);
        if (used === true || used === 1n || used === 1) {
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

      const sig = ethers.Signature.from(auth.signature);
      const tx = await transferWithAuthorization(
        auth.from,
        auth.to,
        BigInt(auth.value),
        BigInt(auth.validAfter),
        BigInt(auth.validBefore),
        auth.nonce,
        sig.v,
        sig.r,
        sig.s,
      );

      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        return {
          success: false,
          errorMessage: "On-chain transferWithAuthorization transaction failed or was reverted",
          transactionHash: typeof tx.hash === "string" ? tx.hash : undefined,
        };
      }

      return {
        success: true,
        transactionHash: receipt.hash ?? tx.hash,
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
      const provider = new ethers.JsonRpcProvider(this.rpcUrl, this.chainId);
      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt) {
        return { confirmed: false, errorMessage: `Transaction not found: ${txHash}` };
      }
      if (receipt.status !== 1) {
        return { confirmed: false, errorMessage: `Transaction reverted: ${txHash}` };
      }

      const usdcInterface = new ethers.Interface(USDC_EIP3009_ABI);
      const usdcAddress = this.usdcAddress.toLowerCase();
      const expectedTo = expected.to.toLowerCase();
      const expectedFrom = expected.from?.toLowerCase();

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== usdcAddress) continue;
        try {
          const parsed = usdcInterface.parseLog({
            topics: [...log.topics],
            data: log.data,
          });
          if (!parsed || parsed.name !== "Transfer") continue;

          const transferFrom = String(parsed.args.from ?? parsed.args[0]).toLowerCase();
          const transferTo = String(parsed.args.to ?? parsed.args[1]).toLowerCase();
          const transferValue = BigInt(parsed.args.value ?? parsed.args[2]);

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
