/**
 * Desk intent service: persist intents and drive the status state machine.
 *
 * proposed → approved → executing → filled | failed
 * proposed → deferred | cancelled
 * approved → cancelled
 * executing → filled | failed
 */

import type {
  DeskIntentRepository,
  DeskIntentRow,
} from "@chronicleai/db";
import type { DeskIntentStatus, DeskStrategy } from "@chronicleai/schemas";
import { DESK_OPEN_INTENT_STATUSES } from "@chronicleai/schemas";
import type { DeskIntentDraft, DeskLeg, DeskPolicySnapshot } from "./types.ts";

const OPEN_SET = new Set<string>(DESK_OPEN_INTENT_STATUSES);

/** Allowed transitions: from → set of to. */
const TRANSITIONS: Record<DeskIntentStatus, ReadonlySet<DeskIntentStatus>> = {
  proposed: new Set(["approved", "executing", "deferred", "cancelled", "failed"]),
  approved: new Set(["executing", "cancelled", "failed"]),
  executing: new Set(["filled", "failed"]),
  filled: new Set(),
  failed: new Set(),
  deferred: new Set(["proposed", "cancelled"]),
  cancelled: new Set(),
};

export interface IntentService {
  propose(draft: DeskIntentDraft): Promise<DeskIntentRow>;
  findById(id: string): Promise<DeskIntentRow | null>;
  listRecent(limit?: number): Promise<DeskIntentRow[]>;
  listPage(params?: {
    page?: number;
    limit?: number;
  }): Promise<import("@chronicleai/db").PaginatedResult<DeskIntentRow>>;
  listOpen(limit?: number): Promise<DeskIntentRow[]>;
  findOpenByStrategy(strategy: DeskStrategy): Promise<DeskIntentRow | null>;
  /**
   * Transition intent status. Throws on illegal transition.
   */
  transition(
    id: string,
    to: DeskIntentStatus,
    patch?: {
      keeperHubRunId?: string | null | undefined;
      errorMessage?: string | null | undefined;
      legs?: DeskLeg[] | undefined;
      reasonCodes?: string[] | undefined;
      policySnapshot?: DeskPolicySnapshot | undefined;
      notionalUsdc?: number | undefined;
    },
  ): Promise<DeskIntentRow>;
  approve(id: string): Promise<DeskIntentRow>;
  markExecuting(id: string, keeperHubRunId?: string | undefined): Promise<DeskIntentRow>;
  markFilled(id: string, keeperHubRunId?: string | undefined): Promise<DeskIntentRow>;
  markFailed(id: string, errorMessage: string, keeperHubRunId?: string | undefined): Promise<DeskIntentRow>;
  markDeferred(id: string, reason?: string | undefined): Promise<DeskIntentRow>;
  cancel(id: string, reason?: string | undefined): Promise<DeskIntentRow>;
  /** Whether an open intent exists for strategy (single-flight). */
  hasOpenForStrategy(strategy: DeskStrategy): Promise<boolean>;
  hasAnyOpen(): Promise<boolean>;
  isTerminal(status: DeskIntentStatus): boolean;
  isOpen(status: DeskIntentStatus): boolean;
  canTransition(from: DeskIntentStatus, to: DeskIntentStatus): boolean;
}

export function createIntentService(intents: DeskIntentRepository): IntentService {
  function canTransition(from: DeskIntentStatus, to: DeskIntentStatus): boolean {
    if (from === to) return true;
    return TRANSITIONS[from]?.has(to) ?? false;
  }

  function isOpen(status: DeskIntentStatus): boolean {
    return OPEN_SET.has(status);
  }

  function isTerminal(status: DeskIntentStatus): boolean {
    return status === "filled" || status === "failed" || status === "cancelled";
  }

  async function transition(
    id: string,
    to: DeskIntentStatus,
    patch?: {
      keeperHubRunId?: string | null | undefined;
      errorMessage?: string | null | undefined;
      legs?: DeskLeg[] | undefined;
      reasonCodes?: string[] | undefined;
      policySnapshot?: DeskPolicySnapshot | undefined;
      notionalUsdc?: number | undefined;
    },
  ): Promise<DeskIntentRow> {
    const found = await intents.findById(id);
    if (!found.ok) throw found.error;
    if (!found.value) {
      throw new Error(`Desk intent not found: ${id}`);
    }
    const current = found.value;
    const from = current.status as DeskIntentStatus;
    if (!canTransition(from, to)) {
      throw new Error(
        `Illegal desk intent transition ${from} → ${to} for intent ${id}`,
      );
    }

    const update: Parameters<DeskIntentRepository["update"]>[1] = {
      status: to,
    };
    if (patch?.keeperHubRunId !== undefined) {
      update.keeper_hub_run_id = patch.keeperHubRunId;
    }
    if (patch?.errorMessage !== undefined) {
      update.error_message = patch.errorMessage;
    }
    if (patch?.legs !== undefined) {
      update.legs = patch.legs;
    }
    if (patch?.reasonCodes !== undefined) {
      update.reason_codes = patch.reasonCodes;
    }
    if (patch?.policySnapshot !== undefined) {
      update.policy_snapshot = patch.policySnapshot;
    }
    if (patch?.notionalUsdc !== undefined) {
      update.notional_usdc = patch.notionalUsdc;
    }

    const updated = await intents.update(id, update);
    if (!updated.ok) throw updated.error;
    return updated.value;
  }

  return {
    canTransition,
    isOpen,
    isTerminal,

    async propose(draft) {
      // Single-flight: refuse if open intent already exists for strategy
      const open = await intents.findOpenByStrategy(draft.strategy);
      if (!open.ok) throw open.error;
      if (open.value) {
        throw new Error(
          `Open desk intent already exists for strategy ${draft.strategy}: ${open.value.id}`,
        );
      }

      const created = await intents.create({
        signal_id: draft.signalId ?? null,
        strategy: draft.strategy,
        status: draft.status ?? "proposed",
        notional_usdc: draft.notionalUsdc,
        legs: draft.legs,
        reason_codes: draft.reasonCodes,
        policy_snapshot: draft.policySnapshot,
      });
      if (!created.ok) throw created.error;
      return created.value;
    },

    async findById(id) {
      const result = await intents.findById(id);
      if (!result.ok) throw result.error;
      return result.value;
    },

    async listRecent(limit = 50) {
      const result = await intents.listRecent(limit);
      if (!result.ok) throw result.error;
      return result.value;
    },

    async listPage(params) {
      const result = await intents.listPage(params);
      if (!result.ok) throw result.error;
      return result.value;
    },

    async listOpen(limit = 50) {
      const result = await intents.listOpen(limit);
      if (!result.ok) throw result.error;
      return result.value;
    },

    async findOpenByStrategy(strategy) {
      const result = await intents.findOpenByStrategy(strategy);
      if (!result.ok) throw result.error;
      return result.value;
    },

    transition,

    approve(id) {
      return transition(id, "approved");
    },

    markExecuting(id, keeperHubRunId) {
      return transition(id, "executing", {
        keeperHubRunId: keeperHubRunId ?? null,
        errorMessage: null,
      });
    },

    markFilled(id, keeperHubRunId) {
      return transition(id, "filled", {
        keeperHubRunId: keeperHubRunId ?? null,
        errorMessage: null,
      });
    },

    markFailed(id, errorMessage, keeperHubRunId) {
      return transition(id, "failed", {
        errorMessage,
        keeperHubRunId: keeperHubRunId ?? null,
      });
    },

    markDeferred(id, reason) {
      return transition(id, "deferred", {
        errorMessage: reason ?? "deferred_by_policy",
      });
    },

    cancel(id, reason) {
      return transition(id, "cancelled", {
        errorMessage: reason ?? "cancelled",
      });
    },

    async hasOpenForStrategy(strategy) {
      const open = await intents.findOpenByStrategy(strategy);
      if (!open.ok) throw open.error;
      return open.value != null;
    },

    async hasAnyOpen() {
      const open = await intents.listOpen(1);
      if (!open.ok) throw open.error;
      return open.value.length > 0;
    },
  };
}
