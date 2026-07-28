/**
 * CCTP V2 ABI helpers: encode approve, depositForBurn, depositForBurnWithHook, receiveMessage.
 */

import {
  type Address,
  type Hex,
  encodeFunctionData,
  formatUnits,
  pad,
  parseAbi,
  parseUnits,
} from "viem";
import {
  CCTP_ANY_DESTINATION_CALLER,
  CCTP_USDC_DECIMALS,
} from "./constants.ts";
import type { DepositForBurnParams } from "./types.ts";

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const TOKEN_MESSENGER_V2_ABI = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (bytes32)",
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData) returns (bytes32)",
  "function getMinFeeAmount(uint256 amount) view returns (uint256)",
]);

export const MESSAGE_TRANSMITTER_V2_ABI = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
  "function usedNonces(bytes32 nonce) view returns (uint256)",
]);

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/i;
const HEX_RE = /^0x[0-9a-fA-F]*$/i;

/**
 * Encode an EVM address as left-padded bytes32 (mint recipient / destination caller).
 */
export function addressToBytes32(address: string): string {
  const trimmed = address.trim();
  if (!ADDRESS_RE.test(trimmed)) {
    throw new Error(`Invalid EVM address for bytes32 encoding: ${address}`);
  }
  // Lowercase avoids EIP-55 checksum failures on mixed-case inputs; on-chain only cares about 20 bytes.
  return pad(trimmed.toLowerCase() as Hex, { size: 32 });
}

/** Convert human USDC units to atomic (6 decimals) as bigint — no float remainder. */
export function usdcToAtomic(amountUsdc: number, decimals = CCTP_USDC_DECIMALS): bigint {
  if (!Number.isFinite(amountUsdc) || amountUsdc < 0) {
    throw new Error(`Invalid USDC amount: ${amountUsdc}`);
  }
  // Floor to avoid over-spending from float dust.
  const scaled = Math.floor(amountUsdc * 10 ** decimals + 1e-9);
  if (!Number.isSafeInteger(scaled)) {
    // Fall back to string parse for large values.
    return parseUnits(amountUsdc.toFixed(decimals), decimals);
  }
  return BigInt(scaled);
}

/** Convert atomic units to human USDC number (lossy for display only). */
export function atomicToUsdc(atomic: bigint | string, decimals = CCTP_USDC_DECIMALS): number {
  const value = typeof atomic === "bigint" ? atomic : BigInt(atomic);
  return Number(formatUnits(value, decimals));
}

/** Format atomic as decimal string for DB storage. */
export function atomicToString(atomic: bigint): string {
  return atomic.toString();
}

export function encodeApprove(spender: string, amountAtomic: bigint): string {
  if (!ADDRESS_RE.test(spender)) {
    throw new Error(`Invalid approve spender: ${spender}`);
  }
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender.toLowerCase() as Address, amountAtomic],
  });
}

export function encodeDepositForBurn(params: DepositForBurnParams): string {
  const mintRecipient = normalizeBytes32(
    params.mintRecipient.startsWith("0x") && params.mintRecipient.length === 66
      ? params.mintRecipient
      : addressToBytes32(params.mintRecipient),
  );
  const destinationCaller = normalizeBytes32(
    params.destinationCaller?.trim()
      ? params.destinationCaller.startsWith("0x") &&
        params.destinationCaller.length === 66
        ? params.destinationCaller
        : addressToBytes32(params.destinationCaller)
      : CCTP_ANY_DESTINATION_CALLER,
  );
  if (!ADDRESS_RE.test(params.burnToken)) {
    throw new Error(`Invalid burnToken: ${params.burnToken}`);
  }

  const commonArgs = [
    params.amountAtomic,
    params.destinationDomain,
    mintRecipient as Hex,
    params.burnToken.toLowerCase() as Address,
    destinationCaller as Hex,
    params.maxFeeAtomic,
    params.minFinalityThreshold,
  ] as const;

  if (params.hookData != null && params.hookData !== "") {
    const hook = params.hookData.startsWith("0x")
      ? params.hookData
      : `0x${params.hookData}`;
    if (!HEX_RE.test(hook)) {
      throw new Error("Invalid hookData hex");
    }
    return encodeFunctionData({
      abi: TOKEN_MESSENGER_V2_ABI,
      functionName: "depositForBurnWithHook",
      args: [...commonArgs, hook as Hex],
    });
  }

  return encodeFunctionData({
    abi: TOKEN_MESSENGER_V2_ABI,
    functionName: "depositForBurn",
    args: [...commonArgs],
  });
}

export function encodeReceiveMessage(message: string, attestation: string): string {
  const msg = ensureHexBytes(message, "message");
  const att = ensureHexBytes(attestation, "attestation");
  return encodeFunctionData({
    abi: MESSAGE_TRANSMITTER_V2_ABI,
    functionName: "receiveMessage",
    args: [msg as Hex, att as Hex],
  });
}

/**
 * Burn total that must be covered by Base USDC balance + allowance.
 * V2 maxFee is paid from the burn amount semantics; we treat
 * burnCoverage = amountAtomic (fee is taken from amount by protocol).
 * Preflight still requires balance >= amountAtomic + maxFeeAtomic when
 * fee is charged on top — configurable via calculateBurnCoverage.
 */
export function calculateBurnCoverage(args: {
  amountAtomic: bigint;
  maxFeeAtomic: bigint;
  /** When true, require amount + maxFee in balance (conservative). Default true. */
  feeOnTop?: boolean;
}): bigint {
  const feeOnTop = args.feeOnTop !== false;
  if (args.amountAtomic <= 0n) {
    throw new Error("amountAtomic must be positive");
  }
  if (args.maxFeeAtomic < 0n) {
    throw new Error("maxFeeAtomic must be non-negative");
  }
  return feeOnTop
    ? args.amountAtomic + args.maxFeeAtomic
    : args.amountAtomic;
}

function normalizeBytes32(value: string): string {
  const v = value.trim();
  if (!BYTES32_RE.test(v)) {
    throw new Error(`Invalid bytes32: ${value}`);
  }
  return v.toLowerCase();
}

function ensureHexBytes(value: string, label: string): string {
  const v = value.trim();
  if (!v) throw new Error(`${label} is empty`);
  const hex = v.startsWith("0x") ? v : `0x${v}`;
  if (!HEX_RE.test(hex) || hex.length < 4 || hex.length % 2 !== 0) {
    throw new Error(`Invalid ${label} hex bytes`);
  }
  return hex;
}
