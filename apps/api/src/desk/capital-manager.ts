/**
 * Loop 7 capital manager: top-up (Para treasury → desk) and sweep (KH desk → treasury).
 * Decisions are pure policy; execution uses real Para / KeeperHub clients only.
 */

import type {
  DeskCapitalMoveRepository,
  DeskCapitalMoveRow,
  ExecutionLogRepository,
} from "@chronicleai/db";
import { evaluateDeskCctpStarvation } from "../cctp/desk-starvation.ts";
import { capitalLog } from "../lib/logger.ts";
import type { ChronicleRegistryService } from "../services/chronicle-registry-service.ts";
import { softAppendExecutionLog } from "../services/keeperhub-execution-log.ts";
import type { ParaTreasuryClient } from "../services/para-treasury-client.ts";
import type { TreasuryTransferPath } from "../services/routing-metadata.ts";
import type { Web3Client } from "../services/web3-client-service.ts";
import {
  computeUnwindableInventoryUsdc,
  evaluateFreeInventoryShortfall,
  evaluateSweepEligibility,
  evaluateTopupEligibility,
} from "./policy-engine.ts";
import type { ExecutionBridge } from "./execution-bridge.ts";
import {
  AAVE_MAX_UINT256,
  buildOracleArbInput,
  buildRotateInput,
  toBaseUnits,
} from "./workflow-inputs.ts";
import type {
  CapitalDecision,
  CapitalTickInput,
  DeskLeg,
  DeskPolicyConfig,
} from "./types.ts";

export interface CapitalManagerTickResult {
  decision: CapitalDecision;
  move?: DeskCapitalMoveRow | undefined;
  txHash?: string | undefined;
  explorerUrl?: string | undefined;
  keeperHubRunId?: string | undefined;
  registryTxHash?: string | undefined;
  errorMessage?: string | undefined;
}

export interface CapitalManager {
  /** Pure decision for the current book (no side effects). */
  decide(input: CapitalTickInput): CapitalDecision;
  /** Evaluate + execute top-up and/or sweep as needed. */
  tick(input: CapitalTickInput): Promise<CapitalManagerTickResult>;
  executeTopup(amountUsdc: number, reason: string, meta?: {
    treasuryUsdcAfter?: number;
    deskEquityAfter?: number;
  }): Promise<CapitalManagerTickResult>;
  executeSweep(amountUsdc: number, reason: string, emergency?: boolean, meta?: {
    treasuryUsdcAfter?: number;
    deskEquityAfter?: number;
  }): Promise<CapitalManagerTickResult>;
}

export interface CapitalManagerDeps {
  config: DeskPolicyConfig;
  deskWalletAddress: string;
  treasuryAddress: string;
  capitalMoves: DeskCapitalMoveRepository;
  /**
   * Para MPC treasury client (small top-ups when web3 hybrid is absent, or
   * when the KeeperHub-backed public transfer path is unavailable).
   */
  paraTreasury?: ParaTreasuryClient | null;
  /**
   * Preferred treasury transfer surface. Hybrid web3 uses the public KeeperHub
   * transfer workflow when configured. Use when available.
   */
  web3?: Web3Client | null;
  /** KH bridge for desk → treasury sweep / emergency (always private + strict). */
  executionBridge?: ExecutionBridge | null;
  /** Optional on-chain capital move audit. */
  registry?: ChronicleRegistryService | null;
  /** Capital move outcome trail on Activity. */
  execLogRepo?: ExecutionLogRepository | null;
  /** Kill-switch arm flag (hydrated from desk_control_state; routes set this). */
  isKillSwitchArmed?: () => boolean;
  /**
   * USDC notional at/above which top-ups must not use Para alone when a
   * KeeperHub-backed web3 transfer path exists.
   * Env: TREASURY_PRIVATE_TRANSFER_THRESHOLD_USDC (default 50).
   */
  treasuryPrivateTransferThresholdUsdc?: number;
}

export function createCapitalManager(deps: CapitalManagerDeps): CapitalManager {
  const {
    config,
    deskWalletAddress,
    treasuryAddress,
    capitalMoves,
    paraTreasury,
    web3,
    executionBridge,
    registry,
  } = deps;

  const desk = deskWalletAddress.trim().toLowerCase();
  const treasury = treasuryAddress.trim().toLowerCase();

  function hasFreeableInventory(input: CapitalTickInput): boolean {
    const inv = computeUnwindableInventoryUsdc({
      freeLinkOnDesk: input.freeLinkOnDesk,
      linkUsdPrice: input.linkUsdPrice,
      aaveTotalCollateralUsd: input.aaveTotalCollateralUsd,
      aaveTotalDebtUsd: input.aaveTotalDebtUsd,
      aaveLinkSupplied: input.aaveLinkSupplied,
    });
    return inv.source !== "none" && inv.unwindableUsdc > 0.5;
  }

  function decide(input: CapitalTickInput): CapitalDecision {
    const kill =
      input.killSwitchArmed || (deps.isKillSwitchArmed?.() ?? false);
    const deskPaused = input.deskPaused || config.paused;
    const freeable = hasFreeableInventory(input);

    // Emergency / kill first — full free USDC, no powder reserve.
    if (kill) {
      const sweep = evaluateSweepEligibility({
        deskEquityUsdc: input.deskEquityUsdc,
        freeUsdcOnDesk: input.freeUsdcOnDesk,
        targetAumUsdc: config.targetAumUsdc,
        maxAumUsdc: config.maxAumUsdc,
        profitSweepUsdc: config.profitSweepUsdc,
        killSwitchArmed: true,
        emergency: true,
        minFreeUsdc: config.minFreeUsdc,
      });
      if (sweep.eligible) {
        return {
          action: "emergency_return",
          amountUsdc: sweep.amountUsdc,
          reason: sweep.reason,
          direction: "emergency_return",
        };
      }
      return {
        action: "none",
        amountUsdc: 0,
        reason: "kill_switch_no_free_usdc",
      };
    }

    // Sweep excess before top-up / free-inventory — powder-safe.
    const sweep = evaluateSweepEligibility({
      deskEquityUsdc: input.deskEquityUsdc,
      freeUsdcOnDesk: input.freeUsdcOnDesk,
      targetAumUsdc: config.targetAumUsdc,
      maxAumUsdc: config.maxAumUsdc,
      profitSweepUsdc: config.profitSweepUsdc,
      killSwitchArmed: false,
      minFreeUsdc: config.minFreeUsdc,
      hasFreeableInventory: freeable,
      suppressMaxAumSweep: input.suppressMaxAumSweep === true,
      lastFreePowderFillAtMs: input.lastFreePowderFillAtMs,
      postMaintenanceSweepCooldownMs: config.postMaintenanceSweepCooldownMs,
      nowMs: input.nowMs,
    });
    if (sweep.eligible) {
      return {
        action: "sweep",
        amountUsdc: sweep.amountUsdc,
        reason: sweep.reason,
        direction: "sweep",
      };
    }

    // A1: free-USDC inventory shortfall (prefer on-desk unwind when funded)
    const shortfall = evaluateFreeInventoryShortfall({
      freeUsdcOnDesk: input.freeUsdcOnDesk,
      minFreeUsdc: config.minFreeUsdc,
      inventoryTopupUsdc: config.inventoryTopupUsdc,
      preferUnwindForFreeUsdc: config.preferUnwindForFreeUsdc,
      deskEquityUsdc: input.deskEquityUsdc,
      minAumUsdc: config.minAumUsdc,
      targetAumUsdc: config.targetAumUsdc,
      maxAumUsdc: config.maxAumUsdc,
      deskPaused,
      killSwitchArmed: false,
      freeLinkOnDesk: input.freeLinkOnDesk,
      linkUsdPrice: input.linkUsdPrice,
      aaveTotalCollateralUsd: input.aaveTotalCollateralUsd,
      aaveTotalDebtUsd: input.aaveTotalDebtUsd,
      aaveLinkSupplied: input.aaveLinkSupplied,
    });

    if (shortfall.kind === "free_inventory") {
      return {
        action: "free_inventory",
        amountUsdc: shortfall.amountUsdc,
        reason: shortfall.reason,
        inventorySource: shortfall.source,
      };
    }

    const chunkUsdc = input.topupChunkUsdc ?? config.topupChunkUsdc;
    const forceInventoryTopup = shortfall.kind === "topup_inventory";
    const topupChunk = forceInventoryTopup
      ? (shortfall.amountUsdc > 0 ? shortfall.amountUsdc : config.inventoryTopupUsdc)
      : chunkUsdc;

    const topup = evaluateTopupEligibility({
      treasuryUsdc: input.treasuryUsdc,
      usdcOperatingReserve: input.usdcOperatingReserve,
      chunkUsdc: topupChunk,
      deskEquityUsdc: input.deskEquityUsdc,
      targetAumUsdc: config.targetAumUsdc,
      minAumUsdc: config.minAumUsdc,
      maxAumUsdc: config.maxAumUsdc,
      lastTopupAtMs: input.lastTopupAtMs,
      topupCooldownMs: config.topupCooldownMs,
      deskPaused,
      killSwitchArmed: false,
      nowMs: input.nowMs,
      forceInventoryTopup,
    });

    if (topup.eligible) {
      return {
        action: "topup",
        amountUsdc: topup.amountUsdc,
        reason: forceInventoryTopup
          ? shortfall.kind === "topup_inventory"
            ? shortfall.reason
            : topup.reason
          : topup.reason,
        direction: "topup",
      };
    }

    // Desk needs capital but Sepolia treasury cannot fund it while Base is flush
    // → never spend Base USDC; surface awaiting CCTP rebalance.
    if (
      topup.reason === "treasury_usdc_below_reserve_plus_chunk" &&
      input.treasuryBaseUsdc != null &&
      Number.isFinite(input.treasuryBaseUsdc)
    ) {
      const starvation = evaluateDeskCctpStarvation({
        deskEquityUsdc: input.deskEquityUsdc,
        minAumUsdc: config.minAumUsdc,
        targetAumUsdc: config.targetAumUsdc,
        treasurySepoliaUsdc: input.treasuryUsdc,
        usdcOperatingReserve: input.usdcOperatingReserve,
        topupChunkUsdc: topupChunk,
        treasuryBaseUsdc: input.treasuryBaseUsdc,
        baseSafetyBufferUsdc: input.cctpBaseSafetyBufferUsdc ?? 5,
        rebalanceThresholdUsdc: input.cctpRebalanceThresholdUsdc ?? 10,
      });
      if (starvation.starved) {
        // P2-10: recurring skip noise → debug; actionable events stay info.
        capitalLog.debug("awaiting CCTP rebalance", { detail: starvation.detail });
        return {
          action: "none",
          amountUsdc: 0,
          reason: "awaiting_cctp_rebalance",
        };
      }
    }

    // Structured skip for free-USDC shortfall when no top-up path either.
    if (
      shortfall.kind === "skip" &&
      shortfall.reason !== "free_usdc_at_or_above_min" &&
      shortfall.reason !== "desk_paused" &&
      shortfall.reason !== "free_usdc_shortfall_defer_to_equity_topup" &&
      shortfall.reason !== "free_usdc_shortfall_under_min_aum_prefer_topup"
    ) {
      capitalLog.debug("free-USDC shortfall skip", {
        reason: shortfall.reason,
        free: input.freeUsdcOnDesk,
        min: config.minFreeUsdc,
      });
      return {
        action: "none",
        amountUsdc: 0,
        reason: shortfall.reason,
      };
    }

    if (shortfall.kind === "topup_inventory") {
      // Top-up was not eligible — surface the more specific inventory reason.
      capitalLog.debug("free-USDC shortfall no unwind; top-up blocked", {
        reason: topup.reason,
      });
      return {
        action: "none",
        amountUsdc: 0,
        reason: topup.reason || shortfall.reason,
      };
    }

    // Prefer readable powder / thrash skip reasons over generic top-up "at target".
    const powderSkipReasons = new Set([
      "free_usdc_reserved_for_powder",
      "equity_above_max_but_free_usdc_reserved",
      "equity_above_max_requires_strategy_unwind",
      "equity_above_max_no_free_usdc",
      "post_maintenance_sweep_cooldown",
      "desk_powder_thrash_detected",
    ]);
    const reason = powderSkipReasons.has(sweep.reason)
      ? sweep.reason
      : topup.reason || sweep.reason || "no_capital_action";

    if (powderSkipReasons.has(reason)) {
      capitalLog.debug("sweep skipped", {
        reason,
        free: input.freeUsdcOnDesk,
        minFree: config.minFreeUsdc,
        equity: input.deskEquityUsdc,
        maxAum: config.maxAumUsdc,
      });
    }

    return {
      action: "none",
      amountUsdc: 0,
      reason,
    };
  }

  function roundLink(n: number): string {
    const f = 1e8;
    return (Math.round(n * f) / f).toFixed(8);
  }

  async function executeFreeInventory(
    amountUsdc: number,
    reason: string,
    input: CapitalTickInput,
    inventorySource?: CapitalDecision["inventorySource"],
  ): Promise<CapitalManagerTickResult> {
    const decision: CapitalDecision = {
      action: "free_inventory",
      amountUsdc,
      reason,
      inventorySource,
    };

    if (amountUsdc <= 0) {
      return {
        decision: { action: "none", amountUsdc: 0, reason: "zero_free_inventory" },
        errorMessage: "Free-inventory amount must be positive",
      };
    }

    if (!executionBridge) {
      return {
        decision,
        errorMessage:
          "Execution bridge not configured for free_inventory (set KEEPERHUB_API_KEY + KEEPERHUB_WORKFLOW_DESK_ROTATE / ORACLE_ARB)",
      };
    }

    if (!desk || !/^0x[a-fA-F0-9]{40}$/i.test(desk)) {
      return {
        decision,
        errorMessage: "DESK_WALLET_ADDRESS is not configured",
      };
    }

    const inventory = computeUnwindableInventoryUsdc({
      freeLinkOnDesk: input.freeLinkOnDesk,
      linkUsdPrice: input.linkUsdPrice,
      aaveTotalCollateralUsd: input.aaveTotalCollateralUsd,
      aaveTotalDebtUsd: input.aaveTotalDebtUsd,
      aaveLinkSupplied: input.aaveLinkSupplied,
    });

    const linkPrice =
      input.linkUsdPrice != null &&
      Number.isFinite(input.linkUsdPrice) &&
      input.linkUsdPrice > 0
        ? input.linkUsdPrice
        : null;

    // Prefer free-wallet LINK → USDC whenever it covers the chunk.
    // Aave withdraw requires the KH workflow signer to *be* DESK_WALLET (aToken
    // holder). Free LINK only needs Uniswap and is preferred for mixed books.
    const freeLinkCovers =
      inventory.freeLinkUsd > 1e-9 &&
      inventory.freeLinkUsd + 1e-9 >= Math.min(amountUsdc, inventory.freeLinkUsd);
    const preferFreeLink =
      freeLinkCovers && inventorySource !== "aave_link";

    const preferAave =
      !preferFreeLink &&
      inventory.aaveFreeableUsd > 1e-9 &&
      inventorySource !== "free_link";

    try {
      // Free LINK → USDC via oracle_arb (preferred when free LINK covers need).
      if (preferFreeLink && linkPrice != null) {
        if (!executionBridge.isConfigured("oracle_arb")) {
          return {
            decision,
            errorMessage:
              "KEEPERHUB_WORKFLOW_DESK_ORACLE_ARB not configured for free_link inventory swap",
          };
        }

        const freeUsd = Math.min(amountUsdc, inventory.freeLinkUsd);
        const freeLink = Math.max(0, input.freeLinkOnDesk ?? 0);
        // Haircut 1bp so float sizing never exceeds on-desk balance.
        const linkHuman = Math.min(
          freeLink * 0.9999,
          freeUsd / linkPrice,
        );
        if (linkHuman <= 0) {
          return {
            decision,
            errorMessage: "insufficient_collateral_to_free",
          };
        }

        const legs: DeskLeg[] = [
          {
            protocol: "uniswap",
            action: "swap-exact-input",
            tokenIn: "LINK",
            tokenOut: "USDC",
            amountIn: roundLink(linkHuman),
            note: "free_inventory_link_to_usdc",
          },
        ];

        const arbInput = buildOracleArbInput({
          legs,
          deskAddress: desk,
          amountOutMinimumBase: "0",
        });

        const receipt = await executionBridge.execute(
          "oracle_arb",
          {
            ...arbInput,
            reason,
            capitalAction: "free_inventory",
            inventorySource: "free_link",
            amountIn: toBaseUnits(roundLink(linkHuman), 18),
          },
          {
            wait: true,
            idempotencyKey: `desk-free-inv-link-${amountUsdc}-${Date.now()}`,
          },
        );

        if (!receipt.txHash) {
          return {
            decision,
            keeperHubRunId: receipt.keeperHubRunId,
            errorMessage:
              "swap_failed: free_inventory swap completed without tx hash (refusing to log fake fill)",
          };
        }

        capitalLog.info("free_inventory free-link swap", {
          amountUsdc: freeUsd,
          tx: receipt.txHash,
          run: receipt.keeperHubRunId,
        });

        return {
          decision: {
            ...decision,
            amountUsdc: freeUsd,
            inventorySource: "free_link",
          },
          txHash: receipt.txHash,
          explorerUrl: receipt.explorerUrl,
          keeperHubRunId: receipt.keeperHubRunId,
        };
      }

      if (preferAave && inventory.aaveFreeableUsd > 1e-9) {
        if (!executionBridge.isConfigured("rotate")) {
          return {
            decision,
            errorMessage:
              "KEEPERHUB_WORKFLOW_DESK_ROTATE not configured for free_inventory unwind",
          };
        }
        if (linkPrice == null) {
          return {
            decision,
            errorMessage: "link_price_unavailable",
          };
        }

        const freeUsd = Math.min(amountUsdc, inventory.aaveFreeableUsd);
        let linkHuman: number;
        if (
          input.aaveLinkSupplied != null &&
          Number.isFinite(input.aaveLinkSupplied) &&
          input.aaveLinkSupplied > 0
        ) {
          const linkFromUsd = freeUsd / linkPrice;
          // Haircut 1bp so float sizing never exceeds live aToken balance.
          linkHuman = Math.min(input.aaveLinkSupplied * 0.9999, linkFromUsd);
        } else {
          linkHuman = (freeUsd / linkPrice) * 0.9999;
        }

        if (linkHuman <= 0) {
          // Fall through to free-link fallback below when Aave sizing fails.
        } else {
          const legs: DeskLeg[] = [
            {
              protocol: "aave-v3",
              action: "withdraw",
              asset: "LINK",
              amount: roundLink(linkHuman),
              note: "free_inventory_withdraw_link",
            },
            {
              protocol: "uniswap",
              action: "swap-exact-input",
              tokenIn: "LINK",
              tokenOut: "USDC",
              amountIn: roundLink(linkHuman),
              note: "free_inventory_link_to_usdc",
            },
          ];

          // buildRotateInput keys off rotate_out_withdraw_link note for out path.
          legs[0]!.note = "rotate_out_withdraw_link";

          const rotateInput = buildRotateInput({
            legs,
            deskAddress: desk,
            freeUsdc: input.freeUsdcOnDesk,
            maxTradeUsdc: Math.max(amountUsdc, config.maxTradeUsdc),
            linkBalanceHuman: linkHuman,
          });

          // When unwinding essentially all freeable Aave LINK, use max-uint
          // withdraw so Aave settles the exact aToken balance (avoids dust
          // under/over from mark price). Swap amount stays the sized base.
          if (
            input.aaveLinkSupplied != null &&
            input.aaveLinkSupplied > 0 &&
            linkHuman >= input.aaveLinkSupplied * 0.99
          ) {
            rotateInput.amountLink = AAVE_MAX_UINT256;
          }

          try {
            const receipt = await executionBridge.execute(
              "rotate",
              {
                ...rotateInput,
                reason,
                capitalAction: "free_inventory",
                inventorySource: inventorySource ?? "aave_link",
              },
              {
                wait: true,
                idempotencyKey: `desk-free-inv-aave-${amountUsdc}-${Date.now()}`,
              },
            );

            if (!receipt.txHash) {
              throw new Error(
                "free_inventory rotate completed without tx hash (refusing to log fake fill)",
              );
            }

            capitalLog.info("free_inventory aave unwind", {
              amountUsdc: freeUsd,
              tx: receipt.txHash,
              run: receipt.keeperHubRunId,
            });

            return {
              decision: {
                ...decision,
                amountUsdc: freeUsd,
                inventorySource: inventorySource ?? "aave_link",
              },
              txHash: receipt.txHash,
              explorerUrl: receipt.explorerUrl,
              keeperHubRunId: receipt.keeperHubRunId,
            };
          } catch (aaveError) {
            const aaveMsg =
              aaveError instanceof Error ? aaveError.message : String(aaveError);
            capitalLog.warn("free_inventory aave unwind failed — trying free_link", {
              error: aaveMsg,
            });
            // Fall through to free-link fallback when available.
            if (!(inventory.freeLinkUsd > 1e-9 && linkPrice != null)) {
              return {
                decision,
                errorMessage: aaveMsg.includes("swap")
                  ? `swap_failed: ${aaveMsg}`
                  : aaveMsg,
              };
            }
          }
        }
      }

      // Free LINK → USDC fallback (also used when Aave path failed).
      if (inventory.freeLinkUsd > 1e-9 && linkPrice != null) {
        if (!executionBridge.isConfigured("oracle_arb")) {
          return {
            decision,
            errorMessage:
              "KEEPERHUB_WORKFLOW_DESK_ORACLE_ARB not configured for free_link inventory swap",
          };
        }

        const freeUsd = Math.min(amountUsdc, inventory.freeLinkUsd);
        const freeLink = Math.max(0, input.freeLinkOnDesk ?? 0);
        const linkHuman = Math.min(freeLink * 0.9999, freeUsd / linkPrice);
        if (linkHuman <= 0) {
          return {
            decision,
            errorMessage: "insufficient_collateral_to_free",
          };
        }

        const legs: DeskLeg[] = [
          {
            protocol: "uniswap",
            action: "swap-exact-input",
            tokenIn: "LINK",
            tokenOut: "USDC",
            amountIn: roundLink(linkHuman),
            note: "free_inventory_link_to_usdc",
          },
        ];

        const arbInput = buildOracleArbInput({
          legs,
          deskAddress: desk,
          amountOutMinimumBase: "0",
        });

        const receipt = await executionBridge.execute(
          "oracle_arb",
          {
            ...arbInput,
            reason,
            capitalAction: "free_inventory",
            inventorySource: "free_link",
            amountIn: toBaseUnits(roundLink(linkHuman), 18),
          },
          {
            wait: true,
            idempotencyKey: `desk-free-inv-link-${amountUsdc}-${Date.now()}`,
          },
        );

        if (!receipt.txHash) {
          return {
            decision,
            keeperHubRunId: receipt.keeperHubRunId,
            errorMessage:
              "swap_failed: free_inventory swap completed without tx hash (refusing to log fake fill)",
          };
        }

        capitalLog.info("free_inventory free-link swap", {
          amountUsdc: freeUsd,
          tx: receipt.txHash,
          run: receipt.keeperHubRunId,
        });

        return {
          decision: {
            ...decision,
            amountUsdc: freeUsd,
            inventorySource: "free_link",
          },
          txHash: receipt.txHash,
          explorerUrl: receipt.explorerUrl,
          keeperHubRunId: receipt.keeperHubRunId,
        };
      }

      return {
        decision,
        errorMessage: "insufficient_collateral_to_free",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Free inventory failed";
      capitalLog.warn("free_inventory failed", { error: message });
      return {
        decision,
        errorMessage: message.includes("swap") ? `swap_failed: ${message}` : message,
      };
    }
  }

  async function recordMove(input: {
    direction: "topup" | "sweep" | "emergency_return";
    amountUsdc: number;
    from: string;
    to: string;
    txHash?: string | undefined;
    explorerUrl?: string | undefined;
    reason: string;
    treasuryUsdcAfter?: number | undefined;
    deskEquityAfter?: number | undefined;
  }): Promise<DeskCapitalMoveRow> {
    const created = await capitalMoves.create({
      direction: input.direction,
      amount_usdc: input.amountUsdc,
      from_address: input.from,
      to_address: input.to,
      tx_hash: input.txHash ?? null,
      explorer_url: input.explorerUrl ?? null,
      reason: input.reason,
      treasury_usdc_after: input.treasuryUsdcAfter ?? null,
      desk_equity_after: input.deskEquityAfter ?? null,
    });
    if (!created.ok) throw created.error;
    return created.value;
  }

  async function logCapitalOutcome(opts: {
    status: "started" | "succeeded" | "failed";
    message: string;
    direction: string;
    amountUsdc: number;
    reason: string;
    entityId?: string | null;
    details?: Record<string, unknown>;
    startedAt?: string;
  }): Promise<void> {
    const startedAt = opts.startedAt ?? new Date().toISOString();
    await softAppendExecutionLog(deps.execLogRepo, {
      action_type: "desk_workflow",
      entity_type: "desk_capital_move",
      entity_id: opts.entityId ?? null,
      status: opts.status,
      message: opts.message,
      details: {
        method: opts.direction,
        direction: opts.direction,
        amountUsdc: opts.amountUsdc,
        reason: opts.reason,
        ...(opts.details ?? {}),
      },
      started_at: startedAt,
      completed_at: opts.status === "started" ? null : new Date().toISOString(),
    });
  }

  /**
   * Always attempt on-chain recordCapitalMove after a successful topup/sweep
   * when registry is configured. Persist registry_tx_hash on the capital move row.
   */
  async function maybeRecordOnChain(move: DeskCapitalMoveRow): Promise<string | undefined> {
    if (!registry) {
      await logCapitalOutcome({
        status: "failed",
        message: "Capital move registry audit skipped: registry not configured",
        direction: move.direction,
        amountUsdc: move.amount_usdc,
        reason: move.reason ?? move.direction,
        entityId: move.id,
        details: {
          phase: "registry_audit",
          reason: "registry_not_configured",
        },
      });
      return undefined;
    }
    const reasonHash = move.reason ?? move.direction;
    const result = await registry.recordCapitalMove(
      move.id,
      move.from_address,
      move.to_address,
      move.amount_usdc,
      reasonHash,
    );
    if (!result.success) {
      capitalLog.warn("recordCapitalMove failed", {
        error: result.errorMessage ?? null,
        moveId: move.id,
      });
      await logCapitalOutcome({
        status: "failed",
        message: `Capital move registry audit failed: ${result.errorMessage ?? "unknown"}`,
        direction: move.direction,
        amountUsdc: move.amount_usdc,
        reason: move.reason ?? move.direction,
        entityId: move.id,
        details: {
          phase: "registry_audit",
          error_message: result.errorMessage ?? null,
          keeper_hub_run_id: result.keeperHubRunId ?? null,
        },
      });
      return undefined;
    }

    // Persist audit proof on the capital move (transfer tx_hash remains the funding tx).
    if (result.txHash || result.keeperHubRunId || result.explorerUrl) {
      const updated = await capitalMoves.update(move.id, {
        registry_tx_hash: result.txHash ?? null,
        keeper_hub_run_id: result.keeperHubRunId ?? null,
        registry_explorer_url: result.explorerUrl ?? null,
      });
      if (!updated.ok) {
        console.error(
          `[desk.capital] failed to persist registry audit on move ${move.id}: ${updated.error.message}`,
        );
      }
    }

    if (result.txHash) {
      await logCapitalOutcome({
        status: "succeeded",
        message: `Capital move registry audit recorded (${move.direction})`,
        direction: move.direction,
        amountUsdc: move.amount_usdc,
        reason: move.reason ?? move.direction,
        entityId: move.id,
        details: {
          phase: "registry_audit",
          tx_hash: result.txHash,
          registry_tx_hash: result.txHash,
          transfer_tx_hash: move.tx_hash,
          keeper_hub_run_id: result.keeperHubRunId ?? null,
          explorer_url: result.explorerUrl ?? null,
          executedViaKeeperHub: Boolean(result.keeperHubRunId),
        },
      });
    }
    return result.txHash;
  }

  async function executeTopup(
    amountUsdc: number,
    reason: string,
    meta?: { treasuryUsdcAfter?: number; deskEquityAfter?: number },
  ): Promise<CapitalManagerTickResult> {
    const startedAt = new Date().toISOString();
    if (amountUsdc <= 0) {
      return {
        decision: { action: "none", amountUsdc: 0, reason: "zero_topup" },
        errorMessage: "Top-up amount must be positive",
      };
    }
    if (!desk || !/^0x[a-fA-F0-9]{40}$/i.test(desk)) {
      return {
        decision: { action: "topup", amountUsdc, reason, direction: "topup" },
        errorMessage: "DESK_WALLET_ADDRESS is not configured",
      };
    }

    await logCapitalOutcome({
      status: "started",
      message: `Desk capital top-up started (${amountUsdc} USDC)`,
      direction: "topup",
      amountUsdc,
      reason,
      startedAt,
    });

    try {
      let txHash: string | undefined;
      let explorerUrl: string | undefined;
      let keeperHubRunId: string | undefined;
      let transferPath: TreasuryTransferPath | "web3" | "para" | undefined;

      // Every demo-visible top-up uses the KeeperHub-backed Web3 facade when it
      // is available; Para is only a fallback for non-KeeperHub dev/test clients.
      if (web3 && (web3.isKeeperHubBacked() || !paraTreasury)) {
        transferPath = web3.isKeeperHubBacked() ? "keeperhub" : "web3";
        const receipt = await web3.sendTransfer(desk, amountUsdc);
        txHash = receipt.txHash;
        explorerUrl = receipt.explorerUrl;
        keeperHubRunId = receipt.keeperHubRunId;
      } else if (paraTreasury) {
        transferPath = "para";
        const receipt = await paraTreasury.sendTransfer(desk, amountUsdc);
        txHash = receipt.txHash;
        explorerUrl = receipt.explorerUrl;
        keeperHubRunId = receipt.keeperHubRunId;
      } else {
        const errorMessage =
          "No treasury transfer client configured (Para MPC or Web3/KeeperHub transfer)";
        await logCapitalOutcome({
          status: "failed",
          message: errorMessage,
          direction: "topup",
          amountUsdc,
          reason,
          startedAt,
          details: { reason: "no_transfer_client" },
        });
        return {
          decision: { action: "topup", amountUsdc, reason, direction: "topup" },
          errorMessage,
        };
      }

      if (!txHash) {
        const errorMessage =
          "Top-up transfer completed without tx hash (refusing to log fake fill)";
        await logCapitalOutcome({
          status: "failed",
          message: errorMessage,
          direction: "topup",
          amountUsdc,
          reason,
          startedAt,
          details: {
            reason: "no_tx_hash",
            keeper_hub_run_id: keeperHubRunId ?? null,
            transfer_path: transferPath ?? null,
          },
        });
        return {
          decision: { action: "topup", amountUsdc, reason, direction: "topup" },
          errorMessage,
        };
      }

      const move = await recordMove({
        direction: "topup",
        amountUsdc,
        from: treasury || "treasury",
        to: desk,
        txHash,
        explorerUrl,
        reason,
        treasuryUsdcAfter: meta?.treasuryUsdcAfter,
        deskEquityAfter: meta?.deskEquityAfter,
      });

      const registryTxHash = await maybeRecordOnChain(move);

      await logCapitalOutcome({
        status: "succeeded",
        message: `Desk capital top-up succeeded (${amountUsdc} USDC)`,
        direction: "topup",
        amountUsdc,
        reason,
        entityId: move.id,
        startedAt,
        details: {
          tx_hash: txHash,
          explorer_url: explorerUrl ?? null,
          keeper_hub_run_id: keeperHubRunId ?? null,
          registry_tx_hash: registryTxHash ?? null,
          executedViaKeeperHub: Boolean(keeperHubRunId),
          transfer_path: transferPath ?? null,
        },
      });

      return {
        decision: { action: "topup", amountUsdc, reason, direction: "topup" },
        move,
        txHash,
        explorerUrl,
        keeperHubRunId,
        registryTxHash,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Top-up failed";
      await logCapitalOutcome({
        status: "failed",
        message: errorMessage,
        direction: "topup",
        amountUsdc,
        reason,
        startedAt,
        details: { error_message: errorMessage },
      });
      return {
        decision: { action: "topup", amountUsdc, reason, direction: "topup" },
        errorMessage,
      };
    }
  }

  async function executeSweep(
    amountUsdc: number,
    reason: string,
    emergency = false,
    meta?: { treasuryUsdcAfter?: number; deskEquityAfter?: number },
  ): Promise<CapitalManagerTickResult> {
    const direction = emergency ? "emergency_return" : "sweep";
    const action = emergency ? "emergency_return" : "sweep";
    const startedAt = new Date().toISOString();

    if (amountUsdc <= 0) {
      return {
        decision: { action: "none", amountUsdc: 0, reason: "zero_sweep" },
        errorMessage: "Sweep amount must be positive",
      };
    }

    if (!executionBridge) {
      const errorMessage =
        "Execution bridge not configured for desk sweep (set KEEPERHUB_API_KEY + KEEPERHUB_WORKFLOW_DESK_SWEEP)";
      await logCapitalOutcome({
        status: "failed",
        message: errorMessage,
        direction,
        amountUsdc,
        reason,
        startedAt,
        details: { reason: "bridge_not_configured" },
      });
      return {
        decision: { action, amountUsdc, reason, direction },
        errorMessage,
      };
    }

    await logCapitalOutcome({
      status: "started",
      message: `Desk capital ${direction} started (${amountUsdc} USDC)`,
      direction,
      amountUsdc,
      reason,
      startedAt,
    });

    try {
      const receipt = await executionBridge.execute(
        emergency ? "kill_switch" : "sweep",
        {
          amountUsdc,
          amount: String(amountUsdc),
          treasuryAddress: treasury,
          deskAddress: desk,
          reason,
          direction,
        },
        {
          wait: true,
          idempotencyKey: `desk-${direction}-${amountUsdc}-${Date.now()}`,
        },
      );

      if (!receipt.txHash) {
        const errorMessage =
          "Sweep workflow completed without tx hash (refusing to log fake fill)";
        await logCapitalOutcome({
          status: "failed",
          message: errorMessage,
          direction,
          amountUsdc,
          reason,
          startedAt,
          details: {
            reason: "no_tx_hash",
            keeper_hub_run_id: receipt.keeperHubRunId,
            executedViaKeeperHub: true,
          },
        });
        return {
          decision: { action, amountUsdc, reason, direction },
          keeperHubRunId: receipt.keeperHubRunId,
          errorMessage,
        };
      }

      const move = await recordMove({
        direction,
        amountUsdc,
        from: desk,
        to: treasury || "treasury",
        txHash: receipt.txHash,
        explorerUrl: receipt.explorerUrl,
        reason,
        treasuryUsdcAfter: meta?.treasuryUsdcAfter,
        deskEquityAfter: meta?.deskEquityAfter,
      });

      const registryTxHash = await maybeRecordOnChain(move);

      await logCapitalOutcome({
        status: "succeeded",
        message: `Desk capital ${direction} succeeded (${amountUsdc} USDC)`,
        direction,
        amountUsdc,
        reason,
        entityId: move.id,
        startedAt,
        details: {
          tx_hash: receipt.txHash,
          explorer_url: receipt.explorerUrl ?? null,
          keeper_hub_run_id: receipt.keeperHubRunId,
          registry_tx_hash: registryTxHash ?? null,
          executedViaKeeperHub: true,
        },
      });

      return {
        decision: { action, amountUsdc, reason, direction },
        move,
        txHash: receipt.txHash,
        explorerUrl: receipt.explorerUrl,
        keeperHubRunId: receipt.keeperHubRunId,
        registryTxHash,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Sweep failed";
      await logCapitalOutcome({
        status: "failed",
        message: errorMessage,
        direction,
        amountUsdc,
        reason,
        startedAt,
        details: { error_message: errorMessage },
      });
      return {
        decision: { action, amountUsdc, reason, direction },
        errorMessage,
      };
    }
  }

  return {
    decide,
    executeTopup,
    executeSweep,

    async tick(input) {
      const decision = decide(input);

      if (decision.action === "none") {
        // Surface powder-reserve / thrash skips on Activity so operators see why
        // no sweep ran under an over-max-AUM book.
        const skipReasons = new Set([
          "free_usdc_reserved_for_powder",
          "equity_above_max_but_free_usdc_reserved",
          "equity_above_max_requires_strategy_unwind",
          "equity_above_max_no_free_usdc",
          "post_maintenance_sweep_cooldown",
          "desk_powder_thrash_detected",
        ]);
        if (skipReasons.has(decision.reason)) {
          await logCapitalOutcome({
            status: "succeeded",
            message: `Desk capital sweep skipped: ${decision.reason}`,
            direction: "sweep_skip",
            amountUsdc: 0,
            reason: decision.reason,
            details: {
              phase: "sweep_eligibility",
              freeUsdcOnDesk: input.freeUsdcOnDesk,
              minFreeUsdc: config.minFreeUsdc,
              deskEquityUsdc: input.deskEquityUsdc,
              maxAumUsdc: config.maxAumUsdc,
              skipped: true,
            },
          });
        }
        return { decision };
      }

      if (decision.action === "free_inventory") {
        return executeFreeInventory(
          decision.amountUsdc,
          decision.reason,
          input,
          decision.inventorySource,
        );
      }

      if (decision.action === "topup") {
        return executeTopup(decision.amountUsdc, decision.reason, {
          treasuryUsdcAfter: input.treasuryUsdc - decision.amountUsdc,
          deskEquityAfter: input.deskEquityUsdc + decision.amountUsdc,
        });
      }

      if (decision.action === "sweep") {
        return executeSweep(decision.amountUsdc, decision.reason, false, {
          treasuryUsdcAfter: input.treasuryUsdc + decision.amountUsdc,
          deskEquityAfter: input.deskEquityUsdc - decision.amountUsdc,
        });
      }

      // emergency_return
      return executeSweep(decision.amountUsdc, decision.reason, true, {
        treasuryUsdcAfter: input.treasuryUsdc + decision.amountUsdc,
        deskEquityAfter: Math.max(0, input.deskEquityUsdc - decision.amountUsdc),
      });
    },
  };
}
