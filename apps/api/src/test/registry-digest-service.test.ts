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
        explorerUrl: "https://sepolia.etherscan.io/tx/0xalert-tx-hash",
      };
    },
    async publishDigest(_contentHash: string, _sourceEventRoot: string, _contentUri: string) {
      return {
        txHash: "0xdigest-tx-hash",
        keeperHubRunId: "exec_digest_1",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xdigest-tx-hash",
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
    async publishTradeTicket(
      _ticketHash: string,
      _signalHash: string,
      _intentHash: string,
      _contentUri: string,
    ) {
      return {
        txHash: "0xticket-tx-hash",
        keeperHubRunId: "exec_ticket_1",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xticket-tx-hash",
      };
    },
    async recordCapitalMove(
      _moveId: string,
      _from: string,
      _to: string,
      _amountUsdc: number,
      _reasonHash: string,
    ) {
      return {
        txHash: "0xcapital-tx-hash",
        keeperHubRunId: "exec_capital_1",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xcapital-tx-hash",
      };
    },
    async sendTransfer() {
      return { txHash: "0xtransfer-tx-hash", keeperHubRunId: "exec_transfer_1" };
    },
    ...overrides,
  };
}

const DIGEST_URI = "https://chronicle.example/digests/digest-123";
const ALERT_URI = "https://chronicle.example/alerts/alert-123";
const TICKET_URI = "https://chronicle.example/desk/tickets/ticket-123";

describe("ChronicleRegistryService (digest)", () => {
  it("publishes a digest with HTTPS content URI and returns KeeperHub metadata", async () => {
    let capturedUri: string | undefined;
    const web3Client = createMockWeb3Client({
      async publishDigest(_digestHash, _root, ipfsUri) {
        capturedUri = ipfsUri;
        return {
          txHash: "0xdigest-tx-hash",
          keeperHubRunId: "exec_digest_1",
          explorerUrl: "https://sepolia.etherscan.io/tx/0xdigest-tx-hash",
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
          explorerUrl: "https://sepolia.etherscan.io/tx/0xalert-tx-hash",
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

  it("publishes a trade ticket with HTTPS desk ticket URI", async () => {
    let capturedUri: string | undefined;
    const web3Client = createMockWeb3Client({
      async publishTradeTicket(_ticketHash, _signalHash, _intentHash, contentUri) {
        capturedUri = contentUri;
        return {
          txHash: "0xticket-tx-hash",
          keeperHubRunId: "exec_ticket_1",
          explorerUrl: "https://sepolia.etherscan.io/tx/0xticket-tx-hash",
        };
      },
    });
    const service = createChronicleRegistryService(web3Client);

    const result = await service.publishTradeTicket(
      "ticket-123",
      "signal-123",
      "intent-123",
      TICKET_URI,
    );

    expect(result.success).toBe(true);
    expect(result.txHash).toBe("0xticket-tx-hash");
    expect(result.keeperHubRunId).toBe("exec_ticket_1");
    expect(result.contentUri).toBe(TICKET_URI);
    expect(capturedUri).toBe(TICKET_URI);
  });

  it("records a capital move and returns KeeperHub metadata", async () => {
    const web3Client = createMockWeb3Client();
    const service = createChronicleRegistryService(web3Client);

    const result = await service.recordCapitalMove(
      "move-123",
      "0x" + "11".repeat(20),
      "0x" + "22".repeat(20),
      10,
      "desk_fund",
    );

    expect(result.success).toBe(true);
    expect(result.txHash).toBe("0xcapital-tx-hash");
    expect(result.keeperHubRunId).toBe("exec_capital_1");
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
