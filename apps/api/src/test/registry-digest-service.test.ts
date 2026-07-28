// Unit tests for Chronicle Registry digest service

import { describe, expect, it } from "vitest";
import { createChronicleRegistryService } from "../services/chronicle-registry-service.ts";
import type { Web3Client } from "../services/web3-client-service.ts";

function createMockWeb3Client(overrides?: Partial<Web3Client>): Web3Client {
  return {
    async getSignerAddress() {
      return "0xmock";
    },
    async getTreasuryAddress() {
      return "0xtreasury";
    },
    async getTreasuryProvider() {
      return "keeperhub" as const;
    },
    isKeeperHubBacked() {
      return true;
    },
    isParaTreasuryBacked() {
      return false;
    },
    async publishAlert(_contentHash: string, _sourceEventHash: string, _contentUri: string) {
      return {
        txHash: "0xalert-tx-hash",
        keeperHubRunId: "exec_alert_1",
        explorerUrl: "https://sepolia.basescan.org/tx/0xalert-tx-hash",
      };
    },
    async publishDigest(_contentHash: string, _sourceEventRoot: string, _contentUri: string) {
      return {
        txHash: "0xdigest-tx-hash",
        keeperHubRunId: "exec_digest_1",
        explorerUrl: "https://sepolia.basescan.org/tx/0xdigest-tx-hash",
      };
    },
    async createSponsoredWatch() {
      return { watchId: 1, txHash: "0xwatch-tx-hash", keeperHubRunId: "exec_watch_1" };
    },
    async publishSponsoredReport() {
      return { txHash: "0xreport-tx-hash", keeperHubRunId: "exec_report_1" };
    },
    async publishPremiumReceipt() {
      return { txHash: "0xpremium-tx-hash", keeperHubRunId: "exec_premium_1" };
    },
    async recordPayout(
      _payoutPeriodHash: string,
      _recipient: string,
      _amount: number,
      _reasonHash: string,
    ) {
      return { txHash: "0xpayout-tx-hash", keeperHubRunId: "exec_payout_1" };
    },
    async sendTransfer() {
      return { txHash: "0xtransfer-tx-hash", keeperHubRunId: "exec_transfer_1" };
    },
    ...overrides,
  };
}

const DIGEST_URI = "https://chronicle.example/digests/digest-123";
const ALERT_URI = "https://chronicle.example/alerts/alert-123";

describe("ChronicleRegistryService (digest)", () => {
  it("publishes a digest with HTTPS content URI and returns KeeperHub metadata", async () => {
    let capturedUri: string | undefined;
    const web3Client = createMockWeb3Client({
      async publishDigest(_digestHash, _root, ipfsUri) {
        capturedUri = ipfsUri;
        return {
          txHash: "0xdigest-tx-hash",
          keeperHubRunId: "exec_digest_1",
          explorerUrl: "https://sepolia.basescan.org/tx/0xdigest-tx-hash",
        };
      },
    });
    const service = createChronicleRegistryService(web3Client);

    const result = await service.publishDigest("digest-123", "event-root-hash", DIGEST_URI);

    expect(result.success).toBe(true);
    expect(result.txHash).toBe("0xdigest-tx-hash");
    expect(result.keeperHubRunId).toBe("exec_digest_1");
    expect(result.explorerUrl).toContain("0xdigest-tx-hash");
    expect(result.contentUri).toBe(DIGEST_URI);
    expect(capturedUri).toBe(DIGEST_URI);
  });

  it("publishes an alert with HTTPS content URI and sourceEventHash on-chain", async () => {
    let capturedUri: string | undefined;
    let capturedSource: string | undefined;
    const web3Client = createMockWeb3Client({
      async publishAlert(_contentHash, sourceEventHash, contentUri) {
        capturedSource = sourceEventHash;
        capturedUri = contentUri;
        return {
          txHash: "0xalert-tx-hash",
          keeperHubRunId: "exec_alert_1",
          explorerUrl: "https://sepolia.basescan.org/tx/0xalert-tx-hash",
        };
      },
    });
    const service = createChronicleRegistryService(web3Client);

    const result = await service.publishAlert("alert-123", "event-hash", ALERT_URI);

    expect(result.success).toBe(true);
    expect(result.txHash).toBe("0xalert-tx-hash");
    expect(result.keeperHubRunId).toBe("exec_alert_1");
    expect(result.contentUri).toBe(ALERT_URI);
    expect(capturedUri).toBe(ALERT_URI);
    expect(capturedSource).toBe("event-hash");
  });

  it("rejects non-https content URIs (e.g. chronicleai:// placeholders)", async () => {
    const web3Client = createMockWeb3Client();
    const service = createChronicleRegistryService(web3Client);

    const result = await service.publishAlert(
      "alert-123",
      "event-hash",
      "chronicleai://alerts/alert-123",
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/absolute http\(s\) URL/i);
  });

  it("returns failure when web3 client is null", async () => {
    const service = createChronicleRegistryService(null);

    const result = await service.publishDigest("digest-123", "event-root-hash", DIGEST_URI);

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

    const result = await service.publishDigest("digest-123", "event-root-hash", DIGEST_URI);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("Transaction reverted");
  });
});
