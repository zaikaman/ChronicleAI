// Funds the KeeperHub affiliate payout float from the canonical Base treasury.
// Affiliate earnings remain ledger credits; this service moves only the exact
// credited reward amount required by the KeeperHub execution wallet.

import type {
  AffiliateFundingTransferRepository,
  AffiliateFundingTransferRow,
} from "@chronicleai/db";
import type { ParaTreasuryClient } from "./para-treasury-client.ts";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export type AffiliateFundingStatus =
  | "completed"
  | "failed"
  | "pending"
  | "processing"
  | "skipped";

export interface AffiliateFundingResult {
  status: AffiliateFundingStatus;
  amount: number;
  earningId: string;
  fundingTransferId?: string;
  txHash?: string;
  explorerUrl?: string;
  errorMessage?: string;
}

export interface AffiliateFundingService {
  /** True when the x402 treasury and KeeperHub destination are configured. */
  isConfigured(): boolean;
  /** Create/claim/fund one immutable affiliate earning exactly once. */
  fundEarning(input: {
    earningId: string;
    amount: number;
    currency: string;
  }): Promise<AffiliateFundingResult>;
  /** Retry pending/failed funding rows after a process restart or transient error. */
  retryPending(limit?: number): Promise<{
    attempted: number;
    completed: number;
    failed: number;
  }>;
}

function resultForRow(
  row: AffiliateFundingTransferRow,
): AffiliateFundingResult {
  return {
    status: row.status,
    amount: row.amount,
    earningId: row.affiliate_earning_id,
    fundingTransferId: row.id,
    ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
    ...(row.explorer_url ? { explorerUrl: row.explorer_url } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
  };
}

export function createAffiliateFundingService(deps: {
  repository: AffiliateFundingTransferRepository;
  treasuryClient: ParaTreasuryClient | null;
  destinationWallet: string | undefined;
  chainId: number;
  tokenAddress: string;
}): AffiliateFundingService {
  const destinationWallet = deps.destinationWallet?.trim();
  const configured = Boolean(
    deps.treasuryClient &&
      destinationWallet &&
      EVM_ADDRESS_RE.test(destinationWallet) &&
      EVM_ADDRESS_RE.test(deps.tokenAddress) &&
      Number.isInteger(deps.chainId) &&
      deps.chainId > 0,
  );

  if (destinationWallet && !EVM_ADDRESS_RE.test(destinationWallet)) {
    throw new Error(
      "KEEPERHUB_AFFILIATE_FUNDING_WALLET_ADDRESS must be a valid EVM address",
    );
  }

  async function processRow(
    row: AffiliateFundingTransferRow,
  ): Promise<AffiliateFundingResult> {
    const claimed = await deps.repository.claim(row.id);
    if (!claimed.ok) {
      return {
        status: "failed",
        amount: row.amount,
        earningId: row.affiliate_earning_id,
        fundingTransferId: row.id,
        errorMessage: claimed.error.message,
      };
    }
    if (!claimed.value) {
      const current = await deps.repository.findByEarningId(row.affiliate_earning_id);
      if (current.ok && current.value) return resultForRow(current.value);
      return resultForRow(row);
    }

    try {
      const receipt = await deps.treasuryClient!.sendTransfer(
        claimed.value.destination_wallet,
        claimed.value.amount,
        `affiliate-funding-${claimed.value.affiliate_earning_id}`,
      );
      const completed = await deps.repository.markCompleted(claimed.value.id, {
        txHash: receipt.txHash,
        explorerUrl: receipt.explorerUrl,
      });
      if (!completed.ok) {
        // The Para idempotency key is stable for this earning. A retry will
        // recover the same transaction rather than intentionally creating a
        // second funding transfer.
        return {
          status: "failed",
          amount: claimed.value.amount,
          earningId: claimed.value.affiliate_earning_id,
          fundingTransferId: claimed.value.id,
          txHash: receipt.txHash,
          explorerUrl: receipt.explorerUrl,
          errorMessage: `Funding receipt persisted on-chain but DB update failed: ${completed.error.message}`,
        };
      }
      return resultForRow(completed.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await deps.repository.markFailed(claimed.value.id, message);
      return {
        status: "failed",
        amount: claimed.value.amount,
        earningId: claimed.value.affiliate_earning_id,
        fundingTransferId: claimed.value.id,
        errorMessage: failed.ok ? message : `${message}; ${failed.error.message}`,
      };
    }
  }

  async function fundEarning(input: {
    earningId: string;
    amount: number;
    currency: string;
  }): Promise<AffiliateFundingResult> {
    if (!(input.amount > 0) || !Number.isFinite(input.amount)) {
      return {
        status: "skipped",
        amount: input.amount,
        earningId: input.earningId,
        errorMessage: "Affiliate reward is zero or invalid",
      };
    }
    if (!configured) {
      return {
        status: "skipped",
        amount: input.amount,
        earningId: input.earningId,
        errorMessage:
          "Affiliate funding is not configured (Para treasury + KeeperHub destination required)",
      };
    }

    const created = await deps.repository.createForEarning({
      affiliate_earning_id: input.earningId,
      amount: input.amount,
      currency: input.currency,
      destination_wallet: destinationWallet!,
      chain_id: deps.chainId,
      token_address: deps.tokenAddress,
    });
    if (!created.ok) {
      return {
        status: "failed",
        amount: input.amount,
        earningId: input.earningId,
        errorMessage: created.error.message,
      };
    }
    if (created.value.status === "completed") return resultForRow(created.value);
    return processRow(created.value);
  }

  return {
    isConfigured: () => configured,
    fundEarning,
    async retryPending(limit = 50) {
      if (!configured) return { attempted: 0, completed: 0, failed: 0 };
      const rows = await deps.repository.listRetryable(limit);
      if (!rows.ok) {
        console.error("[affiliate-funding] failed to list retryable rows:", rows.error.message);
        return { attempted: 0, completed: 0, failed: 1 };
      }

      let completed = 0;
      let failed = 0;
      for (const row of rows.value) {
        const result = await processRow(row);
        if (result.status === "completed") completed += 1;
        if (result.status === "failed") failed += 1;
      }
      return { attempted: rows.value.length, completed, failed };
    },
  };
}
