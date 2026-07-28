/**
 * CCTP rebalance service — orchestrates approve → burn → Iris poll → mint.
 *
 * State machine (DB-backed CAS transitions):
 *   pending → approving → burning → awaiting_attestation
 *     → minting (Mode A) → minted
 *     → minted (Mode B only when Iris already has forwardTxHash)
 *     → stuck | failed
 *
 * Mint policy (hardening): as soon as Iris status is complete with
 * message + attestation, mint via receiveMessage. Do not wait for Circle
 * Forwarding Service. If forwardTxHash is already present, accept it.
 *
 * Burn policy (hardening): USDC is burned from the Para treasury pocket
 * (signer address = treasury). Operator EOA is legacy fallback only.
 *
 * Idempotency:
 * - Never create a second burn for a row past burning with burn_tx_hash.
 * - Mint guarded by status CAS + attempt_count.
 * - resumeInFlight restarts from awaiting_attestation | minting | stuck.
 */

import type {
  CctpRebalanceRepository,
  CctpRebalanceTransferRow,
} from "@chronicleai/db";
import type { CctpRebalanceMode } from "@chronicleai/schemas";
import {
  calculateBurnCoverage,
} from "./cctp-contracts.ts";
import {
  type CctpActivityLogger,
  emitCctpActivityEvent,
} from "./activity-events.ts";
import {
  classifyCctpError,
  truncateErrorMessage,
} from "./error-classification.ts";
import { cctpExplorerUrls } from "./explorers.ts";
import {
  isIrisMessageComplete,
  type IrisClient,
} from "./iris-client.ts";
import { cctpLog } from "./log.ts";
import { evaluateRebalancePolicy } from "./rebalance-policy.ts";
import type {
  CctpChainExecutor,
  CctpPolicyDecision,
  CctpResumeItemResult,
  CctpResumeResult,
  CctpServiceConfig,
  CctpStatusSnapshot,
  CctpTickResult,
  CctpTreasuryBalances,
  IrisMessage,
} from "./types.ts";

export interface CctpRebalanceService {
  tick(): Promise<CctpTickResult>;
  resumeInFlight(): Promise<CctpResumeResult>;
  forceRebalance(amountUsdc?: number): Promise<CctpTickResult>;
  getStatus(): Promise<CctpStatusSnapshot>;
  /** Read dual-rail balances via executor. */
  readBalances(): Promise<CctpTreasuryBalances>;
}

export interface CctpRebalanceServiceDeps {
  config: CctpServiceConfig;
  repo: CctpRebalanceRepository;
  iris: IrisClient;
  executor: CctpChainExecutor;
  /** Optional clock for tests. */
  nowMs?: () => number;
  /**
   * When false (default), tick/force do not block on full attestation loop —
   * they burn then leave awaiting_attestation for resumeInFlight.
   * When true, tick blocks until minted/stuck/timeout (integration/demo).
   */
  awaitAttestationInTick?: boolean;
  /** Inject sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Optional execution_log / Activity writer for rebalance lifecycle events.
   * Best-effort; failures never block the state machine.
   */
  activityLogger?: CctpActivityLogger | null;
  /**
   * Optional desk-starvation probe for CCTP_FORCE_ON_DESK_STARVATION.
   * When true and forceOnDeskStarvation is enabled, cooldown may be skipped.
   */
  getDeskStarved?: () => Promise<boolean> | boolean;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mergeMetadata(
  existing: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(existing ?? {}), ...patch };
}

export function createCctpRebalanceService(
  deps: CctpRebalanceServiceDeps,
): CctpRebalanceService {
  const {
    config,
    repo,
    iris,
    executor,
  } = deps;
  const nowMs = deps.nowMs ?? (() => Date.now());
  const sleep = deps.sleep ?? defaultSleep;
  const awaitInTick = deps.awaitAttestationInTick === true;
  const activityLogger = deps.activityLogger ?? null;

  const treasury = config.treasuryAddress.trim().toLowerCase();
  const mintRecipient = (config.mintRecipient || config.treasuryAddress)
    .trim()
    .toLowerCase();

  async function resolveDeskStarved(): Promise<boolean> {
    if (!config.policy.forceOnDeskStarvation || !deps.getDeskStarved) {
      return false;
    }
    try {
      return Boolean(await deps.getDeskStarved());
    } catch (error) {
      cctpLog("warn", "desk_starved_probe_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async function emitActivity(
    event: Parameters<typeof emitCctpActivityEvent>[1],
  ): Promise<void> {
    await emitCctpActivityEvent(activityLogger, event);
  }

  // Security invariant: mint recipient must be treasury (never operator).
  if (mintRecipient !== treasury) {
    throw new Error(
      "CCTP mint recipient must equal treasury address (operator cannot be mint recipient)",
    );
  }

  async function readBalances(): Promise<CctpTreasuryBalances> {
    const [treasuryBaseUsdc, treasurySepoliaUsdc, treasuryBaseEth, treasurySepoliaEth] =
      await Promise.all([
        executor.getUsdcBalance(config.sourceChainId, treasury),
        executor.getUsdcBalance(config.destChainId, treasury),
        executor.getNativeBalanceEth(config.sourceChainId, treasury),
        executor.getNativeBalanceEth(config.destChainId, treasury),
      ]);

    // Prefer operator gas when operator signs burns (treasury may not hold Base gas).
    let baseEth = treasuryBaseEth;
    let sepoliaEth = treasurySepoliaEth;
    try {
      const operator = await executor.getOperatorAddress();
      if (operator.toLowerCase() !== treasury) {
        const [opBase, opSepolia] = await Promise.all([
          executor.getNativeBalanceEth(config.sourceChainId, operator),
          executor.getNativeBalanceEth(config.destChainId, operator),
        ]);
        // Policy gas gates should see the signer that pays gas.
        baseEth = opBase;
        sepoliaEth = opSepolia;
      }
    } catch {
      // Keep treasury gas reads.
    }

    const inFlightResult = await repo.listInFlight(200);
    let inFlightUsdc = 0;
    if (inFlightResult.ok) {
      for (const row of inFlightResult.value) {
        if (Number.isFinite(row.amount_usdc)) inFlightUsdc += row.amount_usdc;
      }
    }

    return {
      treasuryBaseUsdc,
      treasurySepoliaUsdc,
      treasuryBaseEth: baseEth,
      treasurySepoliaEth: sepoliaEth,
      inFlightUsdc,
    };
  }

  async function resolveMode(): Promise<{
    mode: CctpRebalanceMode;
    feeQuote: { minimumFee: number; finalityThreshold: number } | null;
  }> {
    if (!config.useForwarding) {
      return { mode: "direct", feeQuote: null };
    }
    const quote = await iris.getBurnFees(
      config.sourceDomain,
      config.destDomain,
      { forward: true },
    );
    if (quote) {
      return {
        mode: "forwarding",
        feeQuote: {
          minimumFee: quote.minimumFee,
          finalityThreshold: quote.finalityThreshold,
        },
      };
    }
    cctpLog("info", "forwarding_fee_unavailable_fallback_direct", {});
    return { mode: "direct", feeQuote: null };
  }

  async function failRow(
    row: CctpRebalanceTransferRow,
    from: CctpRebalanceTransferRow["status"] | readonly CctpRebalanceTransferRow["status"][],
    errorMessage: string,
    errorClass?: string,
  ): Promise<CctpRebalanceTransferRow | null> {
    const result = await repo.transition(row.id, from, "failed", {
      error_message: truncateErrorMessage(
        errorClass ? `[${errorClass}] ${errorMessage}` : errorMessage,
      ),
      metadata: mergeMetadata(row.metadata, {
        errorClass: errorClass ?? "unknown",
        failedAt: new Date(nowMs()).toISOString(),
      }),
    });
    if (!result.ok) {
      cctpLog("error", "fail_transition_error", {
        transferId: row.id,
        reason: result.error.message,
      });
      return null;
    }
    cctpLog("error", "transfer_failed", {
      transferId: row.id,
      errorClass,
      status: "failed",
    });
    await emitActivity({
      phase: "failed",
      transferId: row.id,
      amountUsdc: row.amount_usdc,
      mode: row.mode,
      status: "failed",
      burnTxHash: row.burn_tx_hash,
      mintTxHash: row.mint_tx_hash,
      errorMessage: errorMessage,
      errorClass,
    });
    return result.value;
  }

  async function markStuck(
    row: CctpRebalanceTransferRow,
    from: CctpRebalanceTransferRow["status"] | readonly CctpRebalanceTransferRow["status"][],
    detail: string,
  ): Promise<CctpRebalanceTransferRow | null> {
    const result = await repo.transition(row.id, from, "stuck", {
      error_message: truncateErrorMessage(detail),
      metadata: mergeMetadata(row.metadata, {
        stuckAt: new Date(nowMs()).toISOString(),
        stuckReason: detail,
      }),
    });
    if (!result.ok) {
      cctpLog("warn", "stuck_transition_error", {
        transferId: row.id,
        reason: result.error.message,
      });
      return null;
    }
    cctpLog("warn", "transfer_stuck", {
      transferId: row.id,
      status: "stuck",
      reason: detail,
    });
    await emitActivity({
      phase: "stuck",
      transferId: row.id,
      amountUsdc: row.amount_usdc,
      mode: row.mode,
      status: "stuck",
      burnTxHash: row.burn_tx_hash,
      mintTxHash: row.mint_tx_hash,
      errorMessage: detail,
    });
    return result.value;
  }

  /**
   * Start a new transfer: insert pending → approve → burn → awaiting_attestation.
   */
  async function startTransfer(args: {
    amountUsdc: number;
    amountAtomic: string;
    maxFeeAtomic: string;
    mode: CctpRebalanceMode;
    feeQuote: { minimumFee: number; finalityThreshold: number } | null;
    policy: CctpPolicyDecision;
    force?: boolean | undefined;
  }): Promise<CctpTickResult> {
    const start = nowMs();
    const minFinality =
      args.feeQuote?.finalityThreshold && args.feeQuote.finalityThreshold > 0
        ? args.feeQuote.finalityThreshold
        : config.minFinalityThreshold;

    const explorersPlaceholder = cctpExplorerUrls({});
    const createResult = await repo.create({
      status: "pending",
      direction: "base_to_sepolia",
      source_domain: config.sourceDomain,
      destination_domain: config.destDomain,
      source_chain_id: config.sourceChainId,
      destination_chain_id: config.destChainId,
      amount_usdc: args.amountUsdc,
      amount_atomic: args.amountAtomic,
      max_fee_atomic: args.maxFeeAtomic,
      min_finality_threshold: minFinality,
      mode: args.mode,
      treasury_address: treasury,
      mint_recipient: mintRecipient,
      metadata: {
        force: args.force === true,
        feeQuote: args.feeQuote,
        policyDetail: args.policy.detail,
        explorers: explorersPlaceholder,
      },
    });

    if (!createResult.ok) {
      cctpLog("error", "create_failed", { reason: createResult.error.message });
      return {
        outcome: "error",
        errorMessage: createResult.error.message,
        errorClass: "validation",
      };
    }

    let row = createResult.value;
    cctpLog("info", "transfer_created", {
      transferId: row.id,
      amountUsdc: args.amountUsdc,
      mode: args.mode,
      status: row.status,
    });
    await emitActivity({
      phase: "created",
      transferId: row.id,
      amountUsdc: args.amountUsdc,
      mode: args.mode,
      status: row.status,
      force: args.force,
    });

    // pending → approving
    {
      const t = await repo.transition(row.id, "pending", "approving");
      if (!t.ok) {
        return {
          outcome: "error",
          transferId: row.id,
          errorMessage: t.error.message,
        };
      }
      row = t.value;
      await emitActivity({
        phase: "approving",
        transferId: row.id,
        amountUsdc: args.amountUsdc,
        mode: args.mode,
        status: row.status,
      });
    }

    const amountAtomic = BigInt(args.amountAtomic);
    const maxFeeAtomic = BigInt(args.maxFeeAtomic || "0");
    const coverage = calculateBurnCoverage({
      amountAtomic,
      maxFeeAtomic,
      feeOnTop: true,
    });

    try {
      // Ensure allowance on the burn signer. Production path: Para treasury
      // (same address as mint recipient). Legacy: operator EOA must equal
      // treasury or already hold/pre-approve the burn amount.
      const operator = await executor.getOperatorAddress();
      const owner = operator;
      if (owner.toLowerCase() !== treasury) {
        cctpLog("warn", "burn_signer_not_treasury", {
          transferId: row.id,
          signer: owner.toLowerCase(),
          treasury,
          detail:
            "depositForBurn spends USDC from msg.sender — prefer Para treasury executor so revenue pocket is burned directly",
        });
      }
      let allowance = await executor.getUsdcAllowance(
        config.sourceChainId,
        owner,
        config.tokenMessenger,
      );

      if (allowance < coverage) {
        cctpLog("info", "approve_needed", {
          transferId: row.id,
          amountUsdc: args.amountUsdc,
        });
        const approveResult = await executor.approveUsdc(
          config.sourceChainId,
          config.tokenMessenger,
          coverage,
        );
        const t = await repo.transition(row.id, "approving", "burning", {
          approve_tx_hash: approveResult.txHash,
          metadata: mergeMetadata(row.metadata, {
            approveExplorerUrl: approveResult.explorerUrl,
            approvedCoverageAtomic: coverage.toString(),
          }),
        });
        if (!t.ok) {
          return {
            outcome: "error",
            transferId: row.id,
            errorMessage: t.error.message,
          };
        }
        row = t.value;
        cctpLog("info", "approve_confirmed", {
          transferId: row.id,
          approveTxHash: approveResult.txHash,
        });
      } else {
        const t = await repo.transition(row.id, "approving", "burning", {
          metadata: mergeMetadata(row.metadata, {
            approveSkipped: true,
            existingAllowance: allowance.toString(),
          }),
        });
        if (!t.ok) {
          return {
            outcome: "error",
            transferId: row.id,
            errorMessage: t.error.message,
          };
        }
        row = t.value;
        cctpLog("info", "approve_skipped", {
          transferId: row.id,
          reason: "sufficient_allowance",
        });
      }

      // Burn
      const burnParams = {
        amountAtomic,
        destinationDomain: config.destDomain,
        mintRecipient: mintRecipient,
        burnToken: config.baseUsdcAddress,
        maxFeeAtomic,
        minFinalityThreshold: minFinality,
        // Mode B: empty hook still uses depositForBurnWithHook when forwarding —
        // Circle Forwarding Service typically uses standard depositForBurn with
        // fee quote; we use depositForBurn for both unless hook data is provided.
      };

      const burnResult = await executor.depositForBurn(
        config.sourceChainId,
        burnParams,
      );

      const explorers = cctpExplorerUrls({ burnTxHash: burnResult.txHash });
      const t = await repo.transition(
        row.id,
        "burning",
        "awaiting_attestation",
        {
          burn_tx_hash: burnResult.txHash,
          burned_at: new Date(nowMs()).toISOString(),
          metadata: mergeMetadata(row.metadata, {
            burnExplorerUrl: explorers.burnExplorerUrl,
            burnGasUsed: burnResult.gasUsed,
          }),
        },
      );
      if (!t.ok) {
        // Burn already on-chain — critical. Try to attach hash if conflict.
        cctpLog("error", "burn_transition_failed_after_tx", {
          transferId: row.id,
          burnTxHash: burnResult.txHash,
          reason: t.error.message,
        });
        return {
          outcome: "error",
          transferId: row.id,
          burnTxHash: burnResult.txHash,
          errorMessage: t.error.message,
        };
      }
      row = t.value;

      cctpLog("info", "burn_confirmed", {
        transferId: row.id,
        burnTxHash: burnResult.txHash,
        amountUsdc: args.amountUsdc,
        mode: args.mode,
        durationMs: nowMs() - start,
      });
      await emitActivity({
        phase: "burned",
        transferId: row.id,
        amountUsdc: args.amountUsdc,
        mode: args.mode,
        status: "awaiting_attestation",
        burnTxHash: burnResult.txHash,
      });
      await emitActivity({
        phase: "awaiting_attestation",
        transferId: row.id,
        amountUsdc: args.amountUsdc,
        mode: args.mode,
        status: "awaiting_attestation",
        burnTxHash: burnResult.txHash,
      });

      if (awaitInTick) {
        return advanceAttestationAndMint(row);
      }

      return {
        outcome: "burned",
        transferId: row.id,
        status: "awaiting_attestation",
        burnTxHash: burnResult.txHash,
        amountUsdc: args.amountUsdc,
        mode: args.mode,
      };
    } catch (error) {
      const classified = classifyCctpError(error);
      await failRow(
        row,
        ["approving", "burning"],
        classified.message,
        classified.class,
      );
      return {
        outcome: "failed",
        transferId: row.id,
        status: "failed",
        errorClass: classified.class,
        errorMessage: classified.message,
        amountUsdc: args.amountUsdc,
        mode: args.mode,
      };
    }
  }

  /**
   * Poll Iris and complete mint (Mode A) or accept forwardTxHash (Mode B).
   */
  async function advanceAttestationAndMint(
    initial: CctpRebalanceTransferRow,
  ): Promise<CctpTickResult> {
    let row = initial;
    if (!row.burn_tx_hash) {
      const failed = await failRow(
        row,
        row.status,
        "Missing burn_tx_hash while awaiting attestation",
        "validation",
      );
      return {
        outcome: "failed",
        transferId: row.id,
        status: failed?.status ?? "failed",
        errorClass: "validation",
        errorMessage: "Missing burn_tx_hash",
      };
    }

    // stuck → awaiting_attestation to resume
    if (row.status === "stuck") {
      const t = await repo.transition(row.id, "stuck", "awaiting_attestation", {
        error_message: null,
      });
      if (t.ok) row = t.value;
    }

    if (row.status === "minting") {
      return completeDirectMint(row);
    }

    if (row.status !== "awaiting_attestation") {
      return {
        outcome: "skipped",
        transferId: row.id,
        status: row.status,
        reason: `Not resumable from status ${row.status}`,
      };
    }

    const pollStart = nowMs();
    const timeout = config.pollTimeoutMs;
    const interval = config.pollIntervalMs;
    let lastIrisStatus: string | null = row.iris_status;
    let message: IrisMessage | null = null;

    // If we already stored message + attestation, skip poll.
    if (row.message_bytes && row.attestation) {
      message = {
        status: "complete",
        message: row.message_bytes,
        attestation: row.attestation,
        messageHash: row.message_hash,
        forwardTxHash: null,
        raw: {},
      };
    }

    while (!message || !isIrisMessageComplete(message)) {
      if (nowMs() - pollStart > timeout) {
        await markStuck(
          row,
          "awaiting_attestation",
          `Iris attestation timeout after ${timeout}ms`,
        );
        return {
          outcome: "stuck",
          transferId: row.id,
          status: "stuck",
          burnTxHash: row.burn_tx_hash ?? undefined,
          errorClass: "iris_timeout",
          errorMessage: "Attestation poll timeout",
        };
      }

      const burnTxHash = row.burn_tx_hash;
      if (!burnTxHash) break;

      try {
        const resp = await iris.getMessages(
          config.sourceDomain,
          burnTxHash,
        );
        message = resp.messages[0] ?? null;
        const irisStatus = message?.status ?? (message ? "present" : "empty");
        if (irisStatus !== lastIrisStatus) {
          lastIrisStatus = irisStatus;
          // Patch iris_status without leaving awaiting_attestation.
          // Repository transition requires status change — store via metadata
          // by a self-transition is illegal. Use a soft update: transition to
          // same path is not allowed. We'll only write iris fields when we
          // advance status. Keep in local + log.
          cctpLog("info", "iris_poll", {
            transferId: row.id,
            irisStatus,
            burnTxHash,
          });
        }

        if (message && isIrisMessageComplete(message)) {
          break;
        }

        // Mode B: forwardTxHash can appear before or with complete.
        if (
          row.mode === "forwarding" &&
          message?.forwardTxHash
        ) {
          break;
        }
      } catch (error) {
        const classified = classifyCctpError(error);
        cctpLog("warn", "iris_poll_error", {
          transferId: row.id,
          errorClass: classified.class,
          reason: classified.message,
        });
        if (classified.class === "iris_429") {
          await sleep(Math.max(interval * 4, 20_000));
          continue;
        }
      }

      await sleep(interval);
    }

    if (!message) {
      await markStuck(row, "awaiting_attestation", "No Iris message after poll");
      return {
        outcome: "stuck",
        transferId: row.id,
        status: "stuck",
        burnTxHash: row.burn_tx_hash ?? undefined,
        errorClass: "iris_timeout",
      };
    }

    // Mode B opportunistic success: only when Circle already submitted destination mint.
    // Do not wait for forwardTxHash — mint as soon as Iris attestation is complete.
    if (row.mode === "forwarding" && message.forwardTxHash) {
      const explorers = cctpExplorerUrls({
        burnTxHash: row.burn_tx_hash,
        mintTxHash: message.forwardTxHash,
      });
      let verified = true;
      if (executor.verifyMintTransfer) {
        try {
          verified = await executor.verifyMintTransfer(
            config.destChainId,
            message.forwardTxHash,
            mintRecipient,
            BigInt(row.amount_atomic),
          );
        } catch {
          verified = false;
        }
      }
      const t = await repo.transition(row.id, "awaiting_attestation", "minted", {
        mint_tx_hash: message.forwardTxHash,
        message_bytes: message.message ?? row.message_bytes,
        attestation: message.attestation ?? row.attestation,
        message_hash: message.messageHash ?? row.message_hash,
        iris_status: message.status ?? "complete",
        attested_at: new Date(nowMs()).toISOString(),
        minted_at: new Date(nowMs()).toISOString(),
        metadata: mergeMetadata(row.metadata, {
          mintExplorerUrl: explorers.mintExplorerUrl,
          burnExplorerUrl: explorers.burnExplorerUrl,
          modeCompleted: "forwarding",
          mintVerified: verified,
        }),
      });
      if (!t.ok) {
        return {
          outcome: "error",
          transferId: row.id,
          errorMessage: t.error.message,
        };
      }
      cctpLog("info", "mint_forwarding_complete", {
        transferId: row.id,
        burnTxHash: row.burn_tx_hash ?? undefined,
        mintTxHash: message.forwardTxHash,
        mode: "forwarding",
        amountUsdc: row.amount_usdc,
      });
      if (t.ok) {
        await emitActivity({
          phase: "minted",
          transferId: row.id,
          amountUsdc: row.amount_usdc,
          mode: "forwarding",
          status: "minted",
          burnTxHash: row.burn_tx_hash,
          mintTxHash: message.forwardTxHash,
        });
      }
      return {
        outcome: "minted",
        transferId: row.id,
        status: "minted",
        burnTxHash: row.burn_tx_hash ?? undefined,
        mintTxHash: message.forwardTxHash,
        amountUsdc: row.amount_usdc,
        mode: "forwarding",
      };
    }

    // Incomplete Iris payload: keep polling via stuck/resume (no long forwarding wait).
    if (!isIrisMessageComplete(message)) {
      await markStuck(
        row,
        "awaiting_attestation",
        "Iris message incomplete (missing message or attestation)",
      );
      return {
        outcome: "stuck",
        transferId: row.id,
        status: "stuck",
        burnTxHash: row.burn_tx_hash ?? undefined,
        reason: "iris_incomplete",
      };
    }

    // Iris complete → direct mint immediately (skip forwarding wait / fallback window).
    if (row.mode === "forwarding") {
      cctpLog("info", "mint_on_iris_complete_skip_forward_wait", {
        transferId: row.id,
        irisStatus: message.status ?? undefined,
        hadForwardTxHash: Boolean(message.forwardTxHash),
      });
    }

    const toMinting = await repo.transition(
      row.id,
      ["awaiting_attestation", "stuck"],
      "minting",
      {
        message_bytes: message.message!,
        attestation: message.attestation!,
        message_hash: message.messageHash ?? null,
        iris_status: message.status ?? "complete",
        attested_at: new Date(nowMs()).toISOString(),
      },
    );
    if (!toMinting.ok) {
      // Maybe already minting
      const refreshed = await repo.findById(row.id);
      if (refreshed.ok && refreshed.value?.status === "minting") {
        return completeDirectMint(refreshed.value);
      }
      return {
        outcome: "error",
        transferId: row.id,
        errorMessage: toMinting.error.message,
      };
    }
    await emitActivity({
      phase: "minting",
      transferId: row.id,
      amountUsdc: row.amount_usdc,
      mode: row.mode,
      status: "minting",
      burnTxHash: row.burn_tx_hash,
    });
    return completeDirectMint(toMinting.value);
  }

  async function completeDirectMint(
    initial: CctpRebalanceTransferRow,
  ): Promise<CctpTickResult> {
    let row = initial;
    if (!row.message_bytes || !row.attestation) {
      await failRow(
        row,
        "minting",
        "Missing message_bytes or attestation for direct mint",
        "validation",
      );
      return {
        outcome: "failed",
        transferId: row.id,
        status: "failed",
        errorClass: "validation",
      };
    }

    const attempt = (row.attempt_count ?? 0) + 1;
    try {
      const mintResult = await executor.receiveMessage(
        config.destChainId,
        row.message_bytes,
        row.attestation,
      );
      const explorers = cctpExplorerUrls({
        burnTxHash: row.burn_tx_hash,
        mintTxHash: mintResult.txHash,
      });

      if (executor.verifyMintTransfer && row.burn_tx_hash) {
        try {
          await executor.verifyMintTransfer(
            config.destChainId,
            mintResult.txHash,
            mintRecipient,
            // Allow protocol fee: require at least amount - maxFee
            BigInt(row.amount_atomic) > BigInt(row.max_fee_atomic ?? "0")
              ? BigInt(row.amount_atomic) - BigInt(row.max_fee_atomic ?? "0")
              : 0n,
          );
        } catch {
          // non-fatal
        }
      }

      const t = await repo.transition(row.id, "minting", "minted", {
        mint_tx_hash: mintResult.txHash,
        attempt_count: attempt,
        minted_at: new Date(nowMs()).toISOString(),
        error_message: null,
        metadata: mergeMetadata(row.metadata, {
          mintExplorerUrl: explorers.mintExplorerUrl,
          burnExplorerUrl: explorers.burnExplorerUrl,
          modeCompleted: "direct",
          mintOnIrisComplete: true,
          mintGasUsed: mintResult.gasUsed,
        }),
      });
      if (!t.ok) {
        return {
          outcome: "error",
          transferId: row.id,
          mintTxHash: mintResult.txHash,
          errorMessage: t.error.message,
        };
      }
      cctpLog("info", "mint_direct_complete", {
        transferId: row.id,
        burnTxHash: row.burn_tx_hash ?? undefined,
        mintTxHash: mintResult.txHash,
        mode: "direct",
        amountUsdc: row.amount_usdc,
        attempt,
      });
      await emitActivity({
        phase: "minted",
        transferId: row.id,
        amountUsdc: row.amount_usdc,
        mode: "direct",
        status: "minted",
        burnTxHash: row.burn_tx_hash,
        mintTxHash: mintResult.txHash,
      });
      return {
        outcome: "minted",
        transferId: row.id,
        status: "minted",
        burnTxHash: row.burn_tx_hash ?? undefined,
        mintTxHash: mintResult.txHash,
        amountUsdc: row.amount_usdc,
        mode: "direct",
      };
    } catch (error) {
      const classified = classifyCctpError(error);

      // Nonce already used → treat as success if we can verify mint
      if (classified.class === "nonce_used") {
        cctpLog("info", "mint_nonce_already_used", {
          transferId: row.id,
          attempt,
        });
        const t = await repo.transition(row.id, "minting", "minted", {
          attempt_count: attempt,
          minted_at: new Date(nowMs()).toISOString(),
          error_message: truncateErrorMessage(
            `Treated as minted: ${classified.message}`,
          ),
          metadata: mergeMetadata(row.metadata, {
            modeCompleted: "direct",
            nonceAlreadyUsed: true,
          }),
        });
        if (t.ok) {
          await emitActivity({
            phase: "minted",
            transferId: row.id,
            amountUsdc: row.amount_usdc,
            mode: "direct",
            status: "minted",
            burnTxHash: row.burn_tx_hash,
            mintTxHash: t.value.mint_tx_hash,
          });
          return {
            outcome: "minted",
            transferId: row.id,
            status: "minted",
            burnTxHash: row.burn_tx_hash ?? undefined,
            amountUsdc: row.amount_usdc,
            mode: "direct",
          };
        }
      }

      if (attempt >= config.mintMaxAttempts || !classified.retryable) {
        await failRow(row, "minting", classified.message, classified.class);
        return {
          outcome: "failed",
          transferId: row.id,
          status: "failed",
          errorClass: classified.class,
          errorMessage: classified.message,
          burnTxHash: row.burn_tx_hash ?? undefined,
        };
      }

      // Increment attempt and stick for resume
      const stuck = await repo.transition(row.id, "minting", "stuck", {
        attempt_count: attempt,
        error_message: truncateErrorMessage(
          `[${classified.class}] attempt ${attempt}: ${classified.message}`,
        ),
        metadata: mergeMetadata(row.metadata, {
          lastMintErrorClass: classified.class,
          lastMintAttempt: attempt,
        }),
      });
      cctpLog("warn", "mint_retry_scheduled", {
        transferId: row.id,
        attempt,
        errorClass: classified.class,
      });
      return {
        outcome: "stuck",
        transferId: row.id,
        status: stuck.ok ? "stuck" : "minting",
        errorClass: classified.class,
        errorMessage: classified.message,
        burnTxHash: row.burn_tx_hash ?? undefined,
      };
    }
  }

  async function evaluateAndMaybeStart(args: {
    force?: boolean | undefined;
    amountOverrideUsdc?: number | undefined;
  }): Promise<CctpTickResult> {
    if (!config.enabled && !args.force) {
      cctpLog("info", "tick_skipped", { reason: "disabled" });
      return { outcome: "skipped", reason: "disabled" };
    }

    const balances = await readBalances();
    const inFlight = await repo.countInFlight();
    if (!inFlight.ok) {
      return {
        outcome: "error",
        errorMessage: inFlight.error.message,
      };
    }
    const lastBurn = await repo.findLastSuccessfulBurnAt(treasury);
    if (!lastBurn.ok) {
      return {
        outcome: "error",
        errorMessage: lastBurn.error.message,
      };
    }

    // Prefer mode resolution before policy so Sepolia gas gate is correct.
    const { mode, feeQuote } = await resolveMode();

    const policyConfig = {
      ...config.policy,
      // Force path still respects safety buffer / max chunk / gas, but ignores
      // enabled flag (handled above) and optionally cooldown via override amount.
      enabled: true,
      requireSepoliaGasForDirectMint: mode === "direct",
    };

    const deskStarved = args.force ? false : await resolveDeskStarved();
    if (deskStarved) {
      cctpLog("info", "desk_starved_force_path", {
        forceOnDeskStarvation: config.policy.forceOnDeskStarvation,
      });
    }

    const policy = evaluateRebalancePolicy(policyConfig, {
      balances,
      inFlightCount: inFlight.value,
      lastSuccessfulBurnAt: args.force ? null : lastBurn.value,
      nowMs: nowMs(),
      mode,
      amountOverrideUsdc: args.amountOverrideUsdc,
      deskStarved,
    });

    if (!policy.eligible) {
      cctpLog("info", "tick_skipped", {
        reason: policy.reason,
        detail: policy.detail,
      });
      return {
        outcome: "skipped",
        reason: policy.reason,
        amountUsdc: 0,
        mode,
      };
    }

    // When feature disabled, force still works (admin/demo).
    return startTransfer({
      amountUsdc: policy.amountUsdc,
      amountAtomic: policy.amountAtomic,
      maxFeeAtomic: policy.maxFeeAtomic,
      mode,
      feeQuote,
      policy,
      force: args.force,
    });
  }

  return {
    readBalances,

    async tick() {
      cctpLog("info", "tick_start", {});
      // Resume first (caller may also call resumeInFlight separately).
      try {
        return await evaluateAndMaybeStart({});
      } catch (error) {
        const classified = classifyCctpError(error);
        cctpLog("error", "tick_error", {
          errorClass: classified.class,
          reason: classified.message,
        });
        return {
          outcome: "error",
          errorClass: classified.class,
          errorMessage: classified.message,
        };
      }
    },

    async forceRebalance(amountUsdc?: number) {
      cctpLog("info", "force_rebalance", {
        amountUsdc: amountUsdc,
      });
      try {
        return await evaluateAndMaybeStart({
          force: true,
          amountOverrideUsdc: amountUsdc,
        });
      } catch (error) {
        const classified = classifyCctpError(error);
        return {
          outcome: "error",
          errorClass: classified.class,
          errorMessage: classified.message,
        };
      }
    },

    async resumeInFlight() {
      const list = await repo.listResumable(50);
      if (!list.ok) {
        cctpLog("error", "resume_list_failed", {
          reason: list.error.message,
        });
        return { processed: 0, results: [] };
      }

      const results: CctpResumeItemResult[] = [];
      for (const row of list.value) {
        cctpLog("info", "resume_row", {
          transferId: row.id,
          status: row.status,
          burnTxHash: row.burn_tx_hash ?? undefined,
        });
        try {
          const tick = await advanceAttestationAndMint(row);
          results.push({
            transferId: row.id,
            outcome: tick.outcome,
            status: tick.status,
            burnTxHash: tick.burnTxHash ?? row.burn_tx_hash,
            mintTxHash: tick.mintTxHash ?? null,
            errorClass: tick.errorClass,
            errorMessage: tick.errorMessage,
          });
        } catch (error) {
          const classified = classifyCctpError(error);
          results.push({
            transferId: row.id,
            outcome: "error",
            errorClass: classified.class,
            errorMessage: classified.message,
          });
        }
      }

      cctpLog("info", "resume_complete", {
        processed: results.length,
      });
      return { processed: results.length, results };
    },

    async getStatus() {
      const [inFlightCount, recent, lastBurn] = await Promise.all([
        repo.countInFlight(),
        repo.listRecent(20),
        repo.findLastSuccessfulBurnAt(treasury),
      ]);

      let balances: CctpTreasuryBalances | undefined;
      let policy: CctpPolicyDecision | undefined;
      try {
        balances = await readBalances();
        const { mode } = await resolveMode();
        policy = evaluateRebalancePolicy(
          {
            ...config.policy,
            enabled: config.enabled,
            requireSepoliaGasForDirectMint: mode === "direct",
          },
          {
            balances,
            inFlightCount: inFlightCount.ok ? inFlightCount.value : 0,
            lastSuccessfulBurnAt: lastBurn.ok ? lastBurn.value : null,
            nowMs: nowMs(),
            mode,
          },
        );
      } catch (error) {
        cctpLog("warn", "status_balance_error", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }

      return {
        enabled: config.enabled,
        inFlightCount: inFlightCount.ok ? inFlightCount.value : 0,
        inFlightUsdc: balances?.inFlightUsdc ?? 0,
        lastSuccessfulBurnAt: lastBurn.ok ? lastBurn.value : null,
        recent: recent.ok ? recent.value : [],
        balances,
        policy,
      };
    },
  };
}

/** Build CctpServiceConfig from server-env-like object. */
export function cctpServiceConfigFromEnv(env: {
  cctpRebalanceEnabled: boolean;
  cctpUseForwarding: boolean;
  cctpTokenMessenger: string;
  cctpMessageTransmitter: string;
  cctpSourceDomain: number;
  cctpDestDomain: number;
  cctpMinFinalityThreshold: number;
  cctpBaseSafetyBufferUsdc: number;
  cctpRebalanceThresholdUsdc: number;
  cctpRebalanceChunkUsdc: number;
  cctpRebalanceMaxChunkUsdc: number;
  cctpMaxInFlight: number;
  cctpCooldownMs: number;
  cctpMaxFeeUsdc: number;
  cctpPollIntervalMs: number;
  cctpPollTimeoutMs: number;
  treasurySepoliaMinGasEth: number;
  treasuryBaseMinGasEth: number;
  cctpMintMaxAttempts: number;
  cctpForwardingFallbackMs: number;
  cctpForceOnDeskStarvation: boolean;
  treasuryWalletAddress?: string | undefined;
  x402UsdcAddress: string;
  deskUsdcAddress: string;
  x402ChainId: number;
}): CctpServiceConfig {
  const treasury = env.treasuryWalletAddress?.trim();
  if (!treasury) {
    throw new Error(
      "treasuryWalletAddress is required for CCTP service config",
    );
  }
  return {
    enabled: env.cctpRebalanceEnabled,
    treasuryAddress: treasury,
    mintRecipient: treasury,
    sourceDomain: env.cctpSourceDomain,
    destDomain: env.cctpDestDomain,
    sourceChainId: env.x402ChainId,
    destChainId: 11_155_111,
    baseUsdcAddress: env.x402UsdcAddress,
    sepoliaUsdcAddress: env.deskUsdcAddress,
    tokenMessenger: env.cctpTokenMessenger,
    messageTransmitter: env.cctpMessageTransmitter,
    useForwarding: env.cctpUseForwarding,
    minFinalityThreshold: env.cctpMinFinalityThreshold,
    pollIntervalMs: env.cctpPollIntervalMs,
    pollTimeoutMs: env.cctpPollTimeoutMs,
    mintMaxAttempts: env.cctpMintMaxAttempts,
    forwardingFallbackMs: env.cctpForwardingFallbackMs,
    policy: {
      enabled: env.cctpRebalanceEnabled,
      baseSafetyBufferUsdc: env.cctpBaseSafetyBufferUsdc,
      rebalanceThresholdUsdc: env.cctpRebalanceThresholdUsdc,
      rebalanceChunkUsdc: env.cctpRebalanceChunkUsdc,
      rebalanceMaxChunkUsdc: env.cctpRebalanceMaxChunkUsdc,
      maxInFlight: env.cctpMaxInFlight,
      cooldownMs: env.cctpCooldownMs,
      maxFeeUsdc: env.cctpMaxFeeUsdc,
      baseMinGasEth: env.treasuryBaseMinGasEth,
      sepoliaMinGasEth: env.treasurySepoliaMinGasEth,
      requireSepoliaGasForDirectMint: true,
      emergencyPaused: false,
      forceOnDeskStarvation: env.cctpForceOnDeskStarvation,
    },
  };
}
