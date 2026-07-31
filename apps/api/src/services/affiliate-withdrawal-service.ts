// Executes affiliate USDC withdrawals on-chain via KeeperHub (or Para/treasury path).
// Called only by the affiliate agent tools — not by scheduled revenue routing.

import type {
  AffiliateRepository,
  AffiliateWithdrawalRepository,
  AffiliateWithdrawalRow,
  ExecutionLogRepository,
  PayoutRecordRepository,
} from "@chronicleai/db";
import { normalizeAffiliateWallet } from "@chronicleai/db";
import type { ChronicleRegistryService } from "./chronicle-registry-service.ts";
import type { AffiliateDashboardService } from "./affiliate-dashboard-service.ts";
import type { Web3Client } from "./web3-client-service.ts";
import type { RevenueFxService } from "./revenue-fx-service.ts";
import type { AffiliateWithdrawalAuthorization } from "./affiliate-withdrawal-auth.ts";
import { verifyAffiliateWithdrawalAuthorization } from "./affiliate-withdrawal-auth.ts";

export interface AffiliateWithdrawalResult {
  ok: boolean;
  withdrawal?: AffiliateWithdrawalRow;
  errorMessage?: string;
  txHash?: string;
  explorerUrl?: string;
  keeperHubRunId?: string;
}

export interface AffiliateWithdrawalService {
  withdraw(params: {
    affiliateWallet: string;
    amountUsdc: number;
    authorization?: AffiliateWithdrawalAuthorization;
    agentMessage?: string;
  }): Promise<AffiliateWithdrawalResult>;
}

function simpleHash(input: string): string {
  // Stable non-crypto reason hash for registry metadata (32-byte hex via keccak would need ethers).
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `0x${hex.padStart(64, "0")}`;
}

function roundUsdc(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function createAffiliateWithdrawalService(deps: {
  affiliateRepo: AffiliateRepository;
  withdrawalRepo: AffiliateWithdrawalRepository;
  dashboardService: AffiliateDashboardService;
  payoutRepo: PayoutRecordRepository;
  execLogRepo: ExecutionLogRepository;
  registryService: ChronicleRegistryService;
  web3Client: Web3Client | null;
  /**
   * @deprecated Withdrawals are USDC 1:1 — FX unused. Optional for older call sites.
   */
  fxService?: RevenueFxService;
  /** Minimum withdrawal in USDC (human units). */
  minWithdrawalUsdc?: number;
  withdrawalChainId: number;
}): AffiliateWithdrawalService {
  const minWithdrawal = deps.minWithdrawalUsdc ?? 0.01;

  return {
    async withdraw(params) {
      if (!deps.web3Client) {
        return {
          ok: false,
          errorMessage:
            "On-chain transfer path not configured (KeeperHub / Para treasury required for affiliate withdrawals)",
        };
      }
      const web3Client = deps.web3Client;

      const wallet = normalizeAffiliateWallet(params.affiliateWallet);
      if (!wallet) {
        return { ok: false, errorMessage: "Invalid affiliate wallet address" };
      }

      const amount = roundUsdc(params.amountUsdc);
      if (!(amount >= minWithdrawal) || !Number.isFinite(amount)) {
        return {
          ok: false,
          errorMessage: `Withdrawal amount must be at least ${minWithdrawal} USDC`,
        };
      }

      if (!params.authorization) {
        return { ok: false, errorMessage: "Withdrawal requires a wallet signature" };
      }

      const authorization = await verifyAffiliateWithdrawalAuthorization({
        authorization: params.authorization,
        expectedWallet: wallet,
        expectedAmountUsdc: amount,
        chainId: deps.withdrawalChainId,
      });
      if (!authorization.ok) return { ok: false, errorMessage: authorization.error };
      if (!deps.withdrawalRepo.consumeAuthorizationNonce) {
        return { ok: false, errorMessage: "Withdrawal nonce storage is not configured" };
      }
      const nonceResult = await deps.withdrawalRepo.consumeAuthorizationNonce({
        nonce: authorization.nonce,
        affiliate_wallet: wallet,
        expires_at: new Date(params.authorization.expiry * 1000).toISOString(),
      });
      if (!nonceResult.ok) return { ok: false, errorMessage: nonceResult.error.message };
      if (!nonceResult.value) return { ok: false, errorMessage: "Withdrawal authorization nonce was already used" };

      const affiliate = await deps.affiliateRepo.findByWallet(wallet);
      if (!affiliate.ok || !affiliate.value) {
        return { ok: false, errorMessage: "Affiliate not registered. Register first." };
      }
      if (affiliate.value.status !== "approved") {
        return { ok: false, errorMessage: `Affiliate status is ${affiliate.value.status}` };
      }

      const available = await deps.dashboardService.getAvailableBalanceUsdc(wallet);
      if (amount > available + 1e-9) {
        return {
          ok: false,
          errorMessage: `Insufficient available balance: ${available.toFixed(6)} USDC (requested ${amount})`,
        };
      }

      const createResult = await deps.withdrawalRepo.create({
        affiliate_wallet: wallet,
        amount,
        currency: "USDC",
        status: "pending",
        agent_message: params.agentMessage ?? null,
      });
      if (!createResult.ok) {
        return { ok: false, errorMessage: createResult.error.message };
      }

      const withdrawal = createResult.value;
      await deps.withdrawalRepo.markProcessing(withdrawal.id);

      await deps.execLogRepo.append({
        action_type: "payout",
        entity_type: "affiliate_withdrawal",
        entity_id: withdrawal.id,
        status: "started",
        message: `Affiliate agent withdrawal started: ${amount} USDC → ${wallet}`,
        details: {
          affiliate_wallet: wallet,
          amount_usdc: amount,
          source: "affiliate_agent",
        },
      });

      // Payouts are USDC 1:1 with affiliate earnings (same units as x402 settlement).
      if (!(amount > 0) || !Number.isFinite(amount)) {
        const message = "Withdrawal amount must be a positive USDC amount";
        await deps.withdrawalRepo.markFailed(withdrawal.id, message);
        return { ok: false, withdrawal, errorMessage: message };
      }

      const periodHash = `affiliate_withdraw_${withdrawal.id}`;
      const payoutCreate = await deps.payoutRepo.create({
        payout_period_hash: periodHash,
        recipient: wallet,
        amount,
        reason_hash: simpleHash(`affiliate_agent_withdraw:${wallet}:${amount}:${withdrawal.id}`),
        status: "pending",
      });

      if (!payoutCreate.ok) {
        const message = payoutCreate.error.message;
        await deps.withdrawalRepo.markFailed(withdrawal.id, message);
        return { ok: false, withdrawal, errorMessage: message };
      }

      let transferReceipt: {
        txHash: string;
        keeperHubRunId?: string;
        explorerUrl?: string;
      };

      try {
        const transfer = web3Client.sendAffiliateTransfer ?? web3Client.sendTransfer;
        const receipt = await transfer(wallet, amount);
        transferReceipt = {
          txHash: receipt.txHash,
          ...(receipt.keeperHubRunId ? { keeperHubRunId: receipt.keeperHubRunId } : {}),
          ...(receipt.explorerUrl ? { explorerUrl: receipt.explorerUrl } : {}),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Transfer failed";
        await deps.withdrawalRepo.markFailed(withdrawal.id, message);
        if (typeof deps.payoutRepo.markFailed === "function") {
          await deps.payoutRepo.markFailed(payoutCreate.value.id);
        }
        await deps.execLogRepo.append({
          action_type: "payout",
          entity_type: "affiliate_withdrawal",
          entity_id: withdrawal.id,
          status: "failed",
          message: `Affiliate agent KeeperHub transfer failed: ${message}`,
          details: {
            amount_usdc: amount,
            asset: "USDC",
            executedViaKeeperHub: web3Client.isKeeperHubBacked(),
          },
        });
        return { ok: false, withdrawal, errorMessage: message };
      }

      const registryResult = await deps.registryService.recordPayout(
        periodHash,
        wallet,
        amount,
        transferReceipt.txHash,
      );

      if (!registryResult.success || !registryResult.txHash) {
        const message = registryResult.errorMessage ?? "Registry recordPayout failed";
        // Transfer already landed — still mark completed with transfer hash; note registry failure.
        const partial = await deps.withdrawalRepo.markCompleted(withdrawal.id, {
          payout_tx_hash: transferReceipt.txHash,
          registry_tx_hash: null,
          keeper_hub_run_id: transferReceipt.keeperHubRunId ?? null,
          explorer_url: transferReceipt.explorerUrl ?? null,
          payout_record_id: payoutCreate.value.id,
        });
        await deps.execLogRepo.append({
          action_type: "payout",
          entity_type: "affiliate_withdrawal",
          entity_id: withdrawal.id,
          status: "failed",
          message: `Transfer ok but registry record failed: ${message}`,
          details: {
            payout_tx_hash: transferReceipt.txHash,
            registry_error: message,
          },
        });
        return {
          ok: true,
          withdrawal: partial.ok ? partial.value : withdrawal,
          txHash: transferReceipt.txHash,
          ...(transferReceipt.explorerUrl !== undefined
            ? { explorerUrl: transferReceipt.explorerUrl }
            : {}),
          ...(transferReceipt.keeperHubRunId !== undefined
            ? { keeperHubRunId: transferReceipt.keeperHubRunId }
            : {}),
          errorMessage: `Transfer succeeded; registry write failed: ${message}`,
        };
      }

      await deps.payoutRepo.markTransferred(
        payoutCreate.value.id,
        transferReceipt.txHash,
        registryResult.txHash,
        {
          ...(registryResult.keeperHubRunId
            ? { keeperHubRunId: registryResult.keeperHubRunId }
            : {}),
          ...(registryResult.explorerUrl ? { explorerUrl: registryResult.explorerUrl } : {}),
          ...(transferReceipt.keeperHubRunId
            ? { transferKeeperHubRunId: transferReceipt.keeperHubRunId }
            : {}),
          ...(transferReceipt.explorerUrl
            ? { transferExplorerUrl: transferReceipt.explorerUrl }
            : {}),
        },
      );

      const completed = await deps.withdrawalRepo.markCompleted(withdrawal.id, {
        payout_tx_hash: transferReceipt.txHash,
        registry_tx_hash: registryResult.txHash,
        keeper_hub_run_id:
          transferReceipt.keeperHubRunId ?? registryResult.keeperHubRunId ?? null,
        explorer_url: transferReceipt.explorerUrl ?? registryResult.explorerUrl ?? null,
        payout_record_id: payoutCreate.value.id,
      });

      const viaKh =
        Boolean(transferReceipt.keeperHubRunId || registryResult.keeperHubRunId) ||
        web3Client.isKeeperHubBacked();

      await deps.execLogRepo.append({
        action_type: "payout",
        entity_type: "affiliate_withdrawal",
        entity_id: withdrawal.id,
        status: "succeeded",
        message: viaKh
          ? `Affiliate agent executed via KeeperHub: ${amount} USDC → ${wallet}`
          : `Affiliate agent withdrawal completed: ${amount} USDC → ${wallet}`,
        details: {
          amount_usdc: amount,
          asset: "USDC",
          payout_tx_hash: transferReceipt.txHash,
          registry_tx_hash: registryResult.txHash,
          keeper_hub_run_id: transferReceipt.keeperHubRunId ?? registryResult.keeperHubRunId,
          explorer_url: transferReceipt.explorerUrl ?? registryResult.explorerUrl,
          executedViaKeeperHub: viaKh,
          source: "affiliate_agent",
        },
      });

      const explorerUrl =
        transferReceipt.explorerUrl ?? registryResult.explorerUrl;
      const keeperHubRunId =
        transferReceipt.keeperHubRunId ?? registryResult.keeperHubRunId;

      return {
        ok: true,
        withdrawal: completed.ok ? completed.value : withdrawal,
        txHash: transferReceipt.txHash,
        ...(explorerUrl !== undefined ? { explorerUrl } : {}),
        ...(keeperHubRunId !== undefined ? { keeperHubRunId } : {}),
      };
    },
  };
}
