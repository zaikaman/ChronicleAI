import { describe, expect, it } from "vitest";
import {
  deriveAddressFromPrivateKey,
  resolveTreasuryWallet,
} from "../services/treasury-wallet.ts";

// Hardhat/Anvil account #0 — public test vector only
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ANVIL_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("deriveAddressFromPrivateKey", () => {
  it("derives the canonical address from a 0x-prefixed key", () => {
    expect(deriveAddressFromPrivateKey(ANVIL_KEY)).toBe(ANVIL_ADDRESS);
  });

  it("accepts a key without 0x prefix", () => {
    expect(deriveAddressFromPrivateKey(ANVIL_KEY.slice(2))).toBe(ANVIL_ADDRESS);
  });

  it("rejects a malformed key", () => {
    expect(() => deriveAddressFromPrivateKey("0xnotakey")).toThrow(
      /TREASURY_WALLET_PRIVATE_KEY must be a 32-byte hex/,
    );
  });
});

describe("resolveTreasuryWallet", () => {
  it("derives address from private key when only key is set", () => {
    const resolved = resolveTreasuryWallet({
      treasuryWalletPrivateKey: ANVIL_KEY,
      treasuryWalletAddress: undefined,
    });
    expect(resolved.address).toBe(ANVIL_ADDRESS);
    expect(resolved.privateKey).toBe(ANVIL_KEY);
  });

  it("accepts matching address + private key", () => {
    const resolved = resolveTreasuryWallet({
      treasuryWalletPrivateKey: ANVIL_KEY,
      treasuryWalletAddress: ANVIL_ADDRESS,
    });
    expect(resolved.address).toBe(ANVIL_ADDRESS);
    expect(resolved.privateKey).toBe(ANVIL_KEY);
  });

  it("rejects mismatched address and private key", () => {
    expect(() =>
      resolveTreasuryWallet({
        treasuryWalletPrivateKey: ANVIL_KEY,
        treasuryWalletAddress: "0x1234567890123456789012345678901234567890",
      }),
    ).toThrow(/does not match the address derived/);
  });

  it("allows address-only legacy config without a spending key", () => {
    const resolved = resolveTreasuryWallet({
      treasuryWalletPrivateKey: undefined,
      treasuryWalletAddress: ANVIL_ADDRESS,
    });
    expect(resolved.address).toBe(ANVIL_ADDRESS);
    expect(resolved.privateKey).toBeUndefined();
  });

  it("returns empty when neither is set", () => {
    const resolved = resolveTreasuryWallet({
      treasuryWalletPrivateKey: undefined,
      treasuryWalletAddress: undefined,
    });
    expect(resolved).toEqual({ address: undefined, privateKey: undefined });
  });
});
