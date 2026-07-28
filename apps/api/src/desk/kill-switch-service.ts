/**
 * Desk kill switch: arm / trip emergency flatten + residual USDC return to treasury.
 *
 * Triggers (plan §8.4):
 * - Heartbeat older than DESK_KILL_HEARTBEAT_MS
 * - Manual API/UI arm
 * - Optional: repeated critical failures (caller can arm)
 *
 * Actions:
 * 1. Pause new intents (deskPaused + armed flag)
 * 2. Best-effort Aave withdraw (workflow)
 * 3. Transfer residual USDC desk → treasury (workflow)
 * 4. Capital move + optional registry audit via capital manager path
 *
 * State is persisted to desk_control_state so arm/trip/pause survive API restarts.
 */

import type { DeskControlStateRepository } from "@chronicleai/db";
import type { ExecutionBridge } from "./execution-bridge.ts";
import type { HeartbeatService } from "./heartbeat-service.ts";
import type { CapitalManager, CapitalManagerTickResult } from "./capital-manager.ts";
import { buildKillSwitchInput } from "./workflow-inputs.ts";
import type { DeskWorkflowReceipt } from "./execution-bridge.ts";

export interface KillSwitchState {
  armed: boolean;
  armedAt: string | null;
  armedReason: string | null;
  lastTripAt: string | null;
  lastTripReason: string | null;
  lastKeeperHubRunId: string | null;
  lastTxHash: string | null;
}

export interface KillSwitchTripInput {
  reason: string;
  freeUsdcOnDesk: number;
  deskAddress: string;
  treasuryAddress: string;
  /** When true (default if free LINK / aave position likely), withdraw LINK max. */
  withdrawLink?: boolean | undefined;
  amountLinkBase?: string | undefined;
  /** Skip capital-manager bookkeeping when already recording elsewhere. */
  skipCapitalRecord?: boolean | undefined;
}

export interface KillSwitchTripResult {
  tripped: boolean;
  state: KillSwitchState;
  receipt?: DeskWorkflowReceipt | undefined;
  capital?: CapitalManagerTickResult | undefined;
  errorMessage?: string | undefined;
}

export interface KillSwitchService {
  /** Load state from the database (call once at boot). */
  hydrate(): Promise<KillSwitchState>;
  arm(reason: string): Promise<KillSwitchState>;
  disarm(reason?: string): Promise<KillSwitchState>;
  isArmed(): boolean;
  getState(): KillSwitchState;
  /**
   * If armed or heartbeat kill-eligible, trip kill workflow.
   * Does not auto-trip solely on stale without free USDC / explicit arm unless force.
   */
  evaluate(input: {
    freeUsdcOnDesk: number;
    deskAddress: string;
    treasuryAddress: string;
    force?: boolean;
    reason?: string;
    withdrawLink?: boolean;
  }): Promise<KillSwitchTripResult>;
  /** Immediate trip (manual or automated). */
  trip(input: KillSwitchTripInput): Promise<KillSwitchTripResult>;
}

export function createKillSwitchService(deps: {
  executionBridge?: ExecutionBridge | null;
  capitalManager?: CapitalManager | null;
  heartbeat?: HeartbeatService | null;
  /** Shared mutable pause flag with policy (optional). */
  setDeskPaused?: (paused: boolean) => void;
  getDeskPaused?: () => boolean;
  /**
   * Durable store for kill + pause. When omitted (tests without DB), state is
   * process-local only.
   */
  controlState?: DeskControlStateRepository | null;
}): KillSwitchService {
  let armed = false;
  let armedAt: string | null = null;
  let armedReason: string | null = null;
  let lastTripAt: string | null = null;
  let lastTripReason: string | null = null;
  let lastKeeperHubRunId: string | null = null;
  let lastTxHash: string | null = null;
  let hydrated = !deps.controlState;
  let hydratePromise: Promise<KillSwitchState> | null = null;

  function snapshot(): KillSwitchState {
    return {
      armed,
      armedAt,
      armedReason,
      lastTripAt,
      lastTripReason,
      lastKeeperHubRunId,
      lastTxHash,
    };
  }

  function applyRow(row: {
    kill_armed: boolean;
    kill_armed_at: string | null;
    kill_armed_reason: string | null;
    last_trip_at: string | null;
    last_trip_reason: string | null;
    last_keeper_hub_run_id: string | null;
    last_tx_hash: string | null;
    desk_paused: boolean;
  }): KillSwitchState {
    armed = row.kill_armed;
    armedAt = row.kill_armed_at;
    armedReason = row.kill_armed_reason;
    lastTripAt = row.last_trip_at;
    lastTripReason = row.last_trip_reason;
    lastKeeperHubRunId = row.last_keeper_hub_run_id;
    lastTxHash = row.last_tx_hash;
    // Pause tracks kill arm (and any explicit desk_paused from prior arm).
    deps.setDeskPaused?.(row.desk_paused || row.kill_armed);
    hydrated = true;
    return snapshot();
  }

  async function persist(): Promise<void> {
    if (!deps.controlState) return;
    const result = await deps.controlState.upsert({
      kill_armed: armed,
      kill_armed_at: armedAt,
      kill_armed_reason: armedReason,
      last_trip_at: lastTripAt,
      last_trip_reason: lastTripReason,
      last_keeper_hub_run_id: lastKeeperHubRunId,
      last_tx_hash: lastTxHash,
      desk_paused: deps.getDeskPaused?.() ?? armed,
    });
    if (!result.ok) {
      throw result.error;
    }
  }

  async function ensureHydrated(): Promise<void> {
    if (hydrated) return;
    await hydrate();
  }

  async function hydrate(): Promise<KillSwitchState> {
    if (!deps.controlState) {
      hydrated = true;
      return snapshot();
    }
    if (hydratePromise) return hydratePromise;

    hydratePromise = (async () => {
      const result = await deps.controlState!.get();
      if (!result.ok) {
        // Fail open to empty state but mark hydrated so the process can boot;
        // next arm/trip will still attempt a durable write.
        console.warn(
          `[desk-kill-switch] hydrate failed: ${result.error.message} — starting from empty state`,
        );
        hydrated = true;
        return snapshot();
      }
      return applyRow(result.value);
    })();

    try {
      return await hydratePromise;
    } finally {
      // Allow re-hydrate after failures on a later call if still not marked.
      if (!hydrated) hydratePromise = null;
    }
  }

  async function arm(reason: string): Promise<KillSwitchState> {
    await ensureHydrated();
    armed = true;
    armedAt = new Date().toISOString();
    armedReason = reason;
    deps.setDeskPaused?.(true);
    await persist();
    return snapshot();
  }

  async function disarm(_reason?: string): Promise<KillSwitchState> {
    await ensureHydrated();
    armed = false;
    armedAt = null;
    armedReason = null;
    deps.setDeskPaused?.(false);
    await persist();
    return snapshot();
  }

  async function trip(input: KillSwitchTripInput): Promise<KillSwitchTripResult> {
    await ensureHydrated();

    // Always arm + pause before executing
    if (!armed) {
      await arm(input.reason);
    } else {
      deps.setDeskPaused?.(true);
      await persist();
    }

    const free = Math.max(0, input.freeUsdcOnDesk);
    if (free <= 0 && !input.withdrawLink) {
      lastTripAt = new Date().toISOString();
      lastTripReason = input.reason;
      await persist();
      return {
        tripped: false,
        state: snapshot(),
        errorMessage: "kill_switch_no_free_usdc_and_no_withdraw",
      };
    }

    if (!deps.executionBridge) {
      return {
        tripped: false,
        state: snapshot(),
        errorMessage:
          "Kill switch requires execution bridge (KEEPERHUB_API_KEY + KEEPERHUB_WORKFLOW_DESK_KILL_SWITCH)",
      };
    }

    try {
      const wfInput = buildKillSwitchInput({
        amountUsdc: free > 0 ? free : 0,
        treasuryAddress: input.treasuryAddress,
        deskAddress: input.deskAddress,
        withdrawLink: input.withdrawLink === true,
        amountLinkBase: input.amountLinkBase,
        reason: input.reason,
      });

      // If no free USDC but withdraw requested, still run withdraw path with amount 0 transfer
      // transfer-token with 0 may fail — require positive USDC when only transferring.
      if (free <= 0 && input.withdrawLink) {
        // Keep amount as "0" — workflow may still withdraw; transfer step risks fail.
        // Prefer capital manager after positions re-mark; for now require amount > 0 for transfer.
        wfInput.amount = "0.000001"; // dust placeholder rejected — better fail explicit
        return {
          tripped: false,
          state: snapshot(),
          errorMessage:
            "Kill switch withdraw-only without free USDC is not supported in v1; top-up residual or re-mark after manual withdraw",
        };
      }

      const receipt = await deps.executionBridge.execute(
        "kill_switch",
        wfInput as unknown as Record<string, unknown>,
        {
          wait: true,
          idempotencyKey: `desk-kill-${input.reason.slice(0, 32)}-${Date.now()}`,
        },
      );

      lastTripAt = new Date().toISOString();
      lastTripReason = input.reason;
      lastKeeperHubRunId = receipt.keeperHubRunId;
      lastTxHash = receipt.txHash || null;
      await persist();

      if (!receipt.txHash) {
        return {
          tripped: false,
          state: snapshot(),
          receipt,
          errorMessage:
            "Kill-switch workflow completed without tx hash (refusing to log fake fill)",
        };
      }

      let capital: CapitalManagerTickResult | undefined;
      if (!input.skipCapitalRecord && deps.capitalManager) {
        // Bookkeeping only if capital manager can record without re-executing
        // Prefer record via executeSweep path which re-triggers — skip when already executed.
        capital = {
          decision: {
            action: "emergency_return",
            amountUsdc: free,
            reason: input.reason,
            direction: "emergency_return",
          },
          txHash: receipt.txHash,
          explorerUrl: receipt.explorerUrl,
          keeperHubRunId: receipt.keeperHubRunId,
        };
      }

      return {
        tripped: true,
        state: snapshot(),
        receipt,
        capital,
      };
    } catch (error) {
      return {
        tripped: false,
        state: snapshot(),
        errorMessage: error instanceof Error ? error.message : "Kill switch trip failed",
      };
    }
  }

  return {
    hydrate,
    arm,
    disarm,
    isArmed: () => armed,
    getState: snapshot,

    async evaluate(input) {
      await ensureHydrated();
      let shouldTrip = armed || input.force === true;
      let reason = input.reason ?? armedReason ?? "manual_kill";

      if (!shouldTrip && deps.heartbeat) {
        const status = await deps.heartbeat.getStatus();
        if (status.killEligible) {
          shouldTrip = true;
          reason = input.reason ?? "heartbeat_stale";
          if (!armed) await arm(reason);
        }
      }

      if (!shouldTrip) {
        return { tripped: false, state: snapshot() };
      }

      return trip({
        reason,
        freeUsdcOnDesk: input.freeUsdcOnDesk,
        deskAddress: input.deskAddress,
        treasuryAddress: input.treasuryAddress,
        withdrawLink: input.withdrawLink,
      });
    },

    trip,
  };
}
