// Unit tests for Chronicle Registry digest service

import { describe, expect, it } from "vitest";
import { createChronicleRegistryService } from "../services/chronicle-registry-service.ts";
import type { Web3Client } from "../services/web3-client-service.ts";

function createMockWeb3Client(overrides?: Partial<Web3Client>): Web3Client {
  return {
    async getSignerAddress() {
      return "0xmock";
    },
    async publishAlert(alertHash: string, ipfsUri: string) {
      return "0xalert-tx-hash";
    },
    async publishDigest(digestHash: string, sourceEventRoot: string, ipfsUri: string) {
      return "0xdigest-tx-hash";
    },
    async createSponsoredWatch() {
      return { watchId: 1, txHash: "0xwatch-tx-hash" };
    },
    async publishSponsoredReport() {
      return "0xreport-tx-hash";
    },
    async recordPayout(
      _payoutPeriodHash: string,
      _recipient: string,
      _amount: number,
      _reasonHash: string,
    ) {
      return "0xpayout-tx-hash";
    },
    async sendTransfer() {
      return "0xtransfer-tx-hash";
    },
    ...overrides,
  };
}

describe("ChronicleRegistryService (digest)", () => {
  it("publishes a digest with web3 client configured", async () => {
    const web3Client = createMockWeb3Client();
    const service = createChronicleRegistryService(web3Client);

    const result = await service.publishDigest("digest-123", "event-root-hash");

    expect(result.success).toBe(true);
    expect(result.txHash).toBe("0xdigest-tx-hash");
  });

  it("publishes an alert with web3 client configured", async () => {
    const web3Client = createMockWeb3Client();
    const service = createChronicleRegistryService(web3Client);

    const result = await service.publishAlert("alert-123", "event-hash");

    expect(result.success).toBe(true);
    expect(result.txHash).toBe("0xalert-tx-hash");
  });

  it("returns failure when web3 client is null", async () => {
    const service = createChronicleRegistryService(null);

    const result = await service.publishDigest("digest-123", "event-root-hash");

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("not configured");
    expect(result.txHash).toBeUndefined();
  });

  it("handles publish failure gracefully", async () => {
    const web3Client = createMockWeb3Client({
      async publishDigest() {
        throw new Error("Transaction reverted");
      },
    });
    const service = createChronicleRegistryService(web3Client);

    const result = await service.publishDigest("digest-123", "event-root-hash");

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("Transaction reverted");
  });
});
