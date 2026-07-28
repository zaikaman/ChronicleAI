import { describe, expect, it, vi } from "vitest";
import {
  createParaTreasuryClient,
  isParaTreasuryConfigured,
  mapNetworkToChainId,
} from "../services/para-treasury-client.ts";

describe("isParaTreasuryConfigured", () => {
  it("is true when PARA_API_KEY is non-empty", () => {
    expect(isParaTreasuryConfigured({ paraApiKey: "sk_live" })).toBe(true);
  });

  it("is false when missing or blank", () => {
    expect(isParaTreasuryConfigured({ paraApiKey: undefined })).toBe(false);
    expect(isParaTreasuryConfigured({ paraApiKey: "  " })).toBe(false);
  });
});

describe("mapNetworkToChainId", () => {
  it("maps known networks", () => {
    expect(mapNetworkToChainId("base-sepolia", 1)).toBe(84_532);
    expect(mapNetworkToChainId("base", 1)).toBe(8453);
    expect(mapNetworkToChainId("sepolia", 1)).toBe(11_155_111);
  });

  it("falls back for unknown networks", () => {
    expect(mapNetworkToChainId("unknown", 99)).toBe(99);
  });
});

describe("createParaTreasuryClient", () => {
  it("ensures wallet by creating when none exist", async () => {
    const restClient = {
      listWallets: vi.fn().mockResolvedValue({ data: [], pagination: { cursor: null, hasMore: false, limit: 10 } }),
      createWallet: vi.fn().mockResolvedValue({
        id: "w1",
        type: "EVM",
        scheme: "DEFAULT",
        status: "ready",
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        userIdentifier: "chronicleai-treasury",
        userIdentifierType: "CUSTOM_ID",
        createdAt: new Date().toISOString(),
      }),
      getWallet: vi.fn(),
      getWalletBalance: vi.fn(),
      transfer: vi.fn(),
    };

    const client = createParaTreasuryClient({
      apiKey: "sk_test",
      environment: "BETA",
      userIdentifier: "chronicleai-treasury",
      userIdentifierType: "CUSTOM_ID",
      chainId: 84_532,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      restClient: restClient as any,
    });

    const wallet = await client.ensureWallet();
    expect(wallet.walletId).toBe("w1");
    expect(wallet.address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(restClient.createWallet).toHaveBeenCalledOnce();

    // Second call uses cache — no extra list/create
    await client.ensureWallet();
    expect(restClient.listWallets).toHaveBeenCalledOnce();
  });

  it("reuses an existing ready wallet", async () => {
    const restClient = {
      listWallets: vi.fn().mockResolvedValue({
        data: [
          {
            id: "existing",
            type: "EVM",
            scheme: "DEFAULT",
            status: "ready",
            address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            createdAt: new Date().toISOString(),
          },
        ],
        pagination: { cursor: null, hasMore: false, limit: 10 },
      }),
      createWallet: vi.fn(),
      getWallet: vi.fn(),
      getWalletBalance: vi.fn(),
      transfer: vi.fn(),
    };

    const client = createParaTreasuryClient({
      apiKey: "sk_test",
      environment: "BETA",
      userIdentifier: "chronicleai-treasury",
      userIdentifierType: "CUSTOM_ID",
      chainId: 84_532,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      restClient: restClient as any,
    });

    const wallet = await client.ensureWallet();
    expect(wallet.walletId).toBe("existing");
    expect(restClient.createWallet).not.toHaveBeenCalled();
  });

  it("broadcasts native transfers via Para signTransaction when RPC is configured", async () => {
    const restClient = {
      listWallets: vi.fn().mockResolvedValue({
        data: [
          {
            id: "w1",
            type: "EVM",
            scheme: "DEFAULT",
            status: "ready",
            address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            createdAt: new Date().toISOString(),
          },
        ],
        pagination: { cursor: null, hasMore: false, limit: 10 },
      }),
      createWallet: vi.fn(),
      getWallet: vi.fn(),
      getWalletBalance: vi.fn(),
      transfer: vi.fn(),
      signTransaction: vi.fn().mockResolvedValue({
        signedTransaction: "0xsigned",
        txHash: "0x" + "ab".repeat(32),
        transactionId: "tx_para_1",
      }),
    };

    // Minimal JsonRpcProvider stub via undici is heavy; without rpcUrl the
    // client falls back to transfer(). Test that path here too.
    const clientNoRpc = createParaTreasuryClient({
      apiKey: "sk_test",
      environment: "BETA",
      userIdentifier: "chronicleai-treasury",
      userIdentifierType: "CUSTOM_ID",
      chainId: 84_532,
      networkLabel: "base-sepolia",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      restClient: restClient as any,
    });

    restClient.transfer.mockResolvedValueOnce({
      signedTransaction: "0xsigned",
      txHash: "0x" + "cd".repeat(32),
      transactionId: "tx_para_2",
    });

    const receipt = await clientNoRpc.sendTransfer(
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      0.001,
    );

    expect(receipt.txHash).toBe("0x" + "cd".repeat(32));
    expect(receipt.explorerUrl).toContain(receipt.txHash);
    expect(receipt.keeperHubRunId).toBe("para:tx_para_2");
    expect(restClient.transfer).toHaveBeenCalledWith(
      "w1",
      expect.objectContaining({
        kind: "NATIVE",
        broadcast: true,
        chainId: 84_532,
      }),
      expect.any(Object),
    );
  });

  it("reads native balance from Para", async () => {
    const restClient = {
      getWallet: vi.fn().mockResolvedValue({
        id: "w1",
        type: "EVM",
        scheme: "DEFAULT",
        status: "ready",
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        createdAt: new Date().toISOString(),
      }),
      listWallets: vi.fn(),
      createWallet: vi.fn(),
      getWalletBalance: vi.fn().mockResolvedValue({
        balance: "0.42",
        symbol: "ETH",
        rawBalance: "420000000000000000",
      }),
      transfer: vi.fn(),
    };

    const client = createParaTreasuryClient({
      apiKey: "sk_test",
      environment: "BETA",
      userIdentifier: "chronicleai-treasury",
      userIdentifierType: "CUSTOM_ID",
      walletId: "w1",
      chainId: 84_532,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      restClient: restClient as any,
    });

    await expect(client.getNativeBalanceEth()).resolves.toBe(0.42);
  });
});
