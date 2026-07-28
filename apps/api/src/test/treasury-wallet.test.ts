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
  it("prefers Para MPC when PARA_API_KEY is set", () => {
    const resolved = resolveTreasuryWallet({
      treasuryWalletPrivateKey: ANVIL_KEY,
      treasuryWalletAddress: ANVIL_ADDRESS,
      paraApiKey: "sk_test_para",
      paraWalletId: "wallet_abc",
    });
    expect(resolved.provider).toBe("para-mpc");
    expect(resolved.spendMode).toBe("para");
    expect(resolved.privateKey).toBeUndefined();
    expect(resolved.address).toBe(ANVIL_ADDRESS);
    expect(resolved.paraWalletId).toBe("wallet_abc");
  });

  it("derives address from private key when only key is set (EOA test path)", () => {
    const resolved = resolveTreasuryWallet({
      treasuryWalletPrivateKey: ANVIL_KEY,
      treasuryWalletAddress: undefined,
      paraApiKey: undefined,
      paraWalletId: undefined,
    });
    expect(resolved.address).toBe(ANVIL_ADDRESS);
    expect(resolved.privateKey).toBe(ANVIL_KEY);
    expect(resolved.spendMode).toBe("eoa");
    expect(resolved.provider).toBe("eoa");
  });

  it("accepts matching address + private key", () => {
    const resolved = resolveTreasuryWallet({
      treasuryWalletPrivateKey: ANVIL_KEY,
      treasuryWalletAddress: ANVIL_ADDRESS,
      paraApiKey: undefined,
      paraWalletId: undefined,
    });
    expect(resolved.address).toBe(ANVIL_ADDRESS);
    expect(resolved.privateKey).toBe(ANVIL_KEY);
    expect(resolved.spendMode).toBe("eoa");
    expect(resolved.provider).toBe("eoa");
  });

  it("rejects mismatched address and private key", () => {
    expect(() =>
      resolveTreasuryWallet({
        treasuryWalletPrivateKey: ANVIL_KEY,
        treasuryWalletAddress: "0x1234567890123456789012345678901234567890",
        paraApiKey: undefined,
        paraWalletId: undefined,
      }),
    ).toThrow(/does not match the address derived/);
  });

  it("labels address-only as KeeperHub-backed by default", () => {
    const resolved = resolveTreasuryWallet({
      treasuryWalletPrivateKey: undefined,
      treasuryWalletAddress: ANVIL_ADDRESS,
      paraApiKey: undefined,
      paraWalletId: undefined,
    });
    expect(resolved.address).toBe(ANVIL_ADDRESS);
    expect(resolved.privateKey).toBeUndefined();
    expect(resolved.spendMode).toBe("keeperhub");
    expect(resolved.provider).toBe("keeperhub");
  });

  it("labels address-only as unconfigured when keeperHubBacked is false", () => {
    const resolved = resolveTreasuryWallet(
      {
        treasuryWalletPrivateKey: undefined,
        treasuryWalletAddress: ANVIL_ADDRESS,
        paraApiKey: undefined,
        paraWalletId: undefined,
      },
      { keeperHubBacked: false },
    );
    expect(resolved.address).toBe(ANVIL_ADDRESS);
    expect(resolved.spendMode).toBe("none");
    expect(resolved.provider).toBe("unconfigured");
  });

  it("returns empty when neither is set", () => {
    const resolved = resolveTreasuryWallet({
      treasuryWalletPrivateKey: undefined,
      treasuryWalletAddress: undefined,
      paraApiKey: undefined,
      paraWalletId: undefined,
    });
    expect(resolved).toEqual({
      address: undefined,
      privateKey: undefined,
      spendMode: "none",
      provider: "unconfigured",
    });
  });
});
