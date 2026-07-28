/**
 * Strict proposal validation for DeskAgentProposal.
 * Invalid / partial input → safe hold (no risk-increasing intent).
 */

import {
  DESK_AGENT_ACTIONS,
  DESK_AGENT_LEGS_HINTS,
  DESK_STRATEGIES,
  type DeskAgentAction,
  type DeskAgentLegsHint,
  type DeskAgentProposal,
  type DeskStrategy,
} from "@chronicleai/schemas";
import {
  DESK_AGENT_THESIS_MAX_CHARS,
  DESK_MAX_TRADE_USDC,
} from "@chronicleai/config";
import { extractJsonObject } from "../../services/llm-provider-client.ts";

const ACTION_SET = new Set<string>(DESK_AGENT_ACTIONS);
const STRATEGY_SET = new Set<string>(DESK_STRATEGIES);
const LEGS_SET = new Set<string>(DESK_AGENT_LEGS_HINTS);

export interface ParseProposalOptions {
  /** Hard cap for notional (default DESK_MAX_TRADE_USDC). */
  maxTradeUsdc?: number | undefined;
  thesisMaxChars?: number | undefined;
  model?: string | undefined;
  toolCallCount?: number | undefined;
  latencyMs?: number | undefined;
}

function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex -- intentional control-char strip
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((s) => stripControlChars(s))
    .filter((s) => s.length > 0);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Safe default when LLM fails, times out, or returns invalid JSON. */
export function holdProposal(
  reason: string,
  extras?: Partial<Pick<DeskAgentProposal, "model" | "toolCallCount" | "latencyMs">>,
): DeskAgentProposal {
  return {
    version: 1,
    action: "hold",
    strategy: null,
    notionalUsdc: 0,
    priority: 0,
    confidence: 0,
    thesis: "Agent held: safe default after validation or LLM failure.",
    riskNotes: [],
    legsHint: ["none"],
    declineReasons: [reason],
    ...(extras?.model !== undefined ? { model: extras.model } : {}),
    ...(extras?.toolCallCount !== undefined ? { toolCallCount: extras.toolCallCount } : {}),
    ...(extras?.latencyMs !== undefined ? { latencyMs: extras.latencyMs } : {}),
  };
}

/**
 * Parse and normalize a proposal from raw LLM text or an object.
 * Never throws — returns hold on failure.
 */
export function parseProposal(
  raw: string | unknown,
  options: ParseProposalOptions = {},
): { ok: true; proposal: DeskAgentProposal } | { ok: false; proposal: DeskAgentProposal; error: string } {
  const maxTrade = options.maxTradeUsdc ?? DESK_MAX_TRADE_USDC;
  const thesisMax = options.thesisMaxChars ?? DESK_AGENT_THESIS_MAX_CHARS;
  const audit = {
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.toolCallCount !== undefined ? { toolCallCount: options.toolCallCount } : {}),
    ...(options.latencyMs !== undefined ? { latencyMs: options.latencyMs } : {}),
  };

  let obj: unknown = raw;
  if (typeof raw === "string") {
    const extracted = extractJsonObject(raw);
    if (!extracted) {
      const p = holdProposal("invalid_json_no_object", audit);
      return { ok: false, proposal: p, error: "No JSON object in model response" };
    }
    try {
      obj = JSON.parse(extracted);
    } catch {
      const p = holdProposal("invalid_json_parse", audit);
      return { ok: false, proposal: p, error: "JSON parse failed" };
    }
  }

  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    const p = holdProposal("invalid_json_type", audit);
    return { ok: false, proposal: p, error: "Proposal root must be an object" };
  }

  const rec = obj as Record<string, unknown>;

  const actionRaw = typeof rec.action === "string" ? rec.action.trim().toLowerCase() : "";
  if (!ACTION_SET.has(actionRaw)) {
    const p = holdProposal("invalid_action", audit);
    return { ok: false, proposal: p, error: `Invalid action: ${actionRaw || "(missing)"}` };
  }
  const action = actionRaw as DeskAgentAction;

  let strategy: DeskStrategy | null = null;
  if (rec.strategy === null || rec.strategy === undefined || rec.strategy === "") {
    strategy = null;
  } else if (typeof rec.strategy === "string" && STRATEGY_SET.has(rec.strategy)) {
    strategy = rec.strategy as DeskStrategy;
  } else {
    const p = holdProposal("invalid_strategy", audit);
    return { ok: false, proposal: p, error: `Invalid strategy: ${String(rec.strategy)}` };
  }

  let notionalUsdc = asFiniteNumber(rec.notionalUsdc);
  if (notionalUsdc === null || notionalUsdc < 0) {
    const p = holdProposal("invalid_notional", audit);
    return { ok: false, proposal: p, error: "notionalUsdc must be a finite number ≥ 0" };
  }
  // Clamp oversize to max trade (policy may shrink further); do not reject solely for oversize.
  if (notionalUsdc > maxTrade) {
    notionalUsdc = maxTrade;
  }

  const priority = clamp01(asFiniteNumber(rec.priority) ?? 0);
  const confidence = clamp01(asFiniteNumber(rec.confidence) ?? 0);

  let thesis =
    typeof rec.thesis === "string" ? stripControlChars(rec.thesis) : "";
  if (thesis.length > thesisMax) {
    thesis = thesis.slice(0, thesisMax);
  }
  if (!thesis) {
    thesis =
      action === "hold" || action === "defer"
        ? "No actionable edge under current desk state and policy."
        : "Agent proposal without detailed thesis.";
  }

  const riskNotes = asStringArray(rec.riskNotes).slice(0, 12);
  const declineReasons = asStringArray(rec.declineReasons).slice(0, 12);

  const legsRaw = Array.isArray(rec.legsHint) ? rec.legsHint : [];
  const legsHint: DeskAgentLegsHint[] = [];
  const stripped: string[] = [];
  for (const item of legsRaw) {
    if (typeof item !== "string") continue;
    const h = item.trim().toLowerCase();
    if (LEGS_SET.has(h)) {
      legsHint.push(h as DeskAgentLegsHint);
    } else if (h) {
      stripped.push(h);
    }
  }
  if (legsHint.length === 0) {
    legsHint.push("none");
  }
  if (stripped.length > 0) {
    riskNotes.push(`stripped_unknown_legsHint:${stripped.slice(0, 4).join(",")}`);
  }

  // Normalize action constraints
  if (action === "hold" || action === "defer") {
    strategy = null;
    notionalUsdc = 0;
    if (!legsHint.includes("none")) {
      legsHint.length = 0;
      legsHint.push("none");
    }
  }
  if (action === "defend") {
    strategy = "risk_defend";
  }
  if (action === "propose") {
    if (!strategy || notionalUsdc <= 0) {
      const p = holdProposal("propose_requires_strategy_and_notional", audit);
      return {
        ok: false,
        proposal: p,
        error: "action=propose requires non-null strategy and notionalUsdc > 0",
      };
    }
  }

  const proposal: DeskAgentProposal = {
    version: 1,
    action,
    strategy,
    notionalUsdc,
    priority,
    confidence,
    thesis,
    riskNotes,
    legsHint,
    declineReasons,
    ...audit,
  };

  return { ok: true, proposal };
}

/** Type guard for stored policy_snapshot.agent blobs. */
export function isDeskAgentProposal(value: unknown): value is DeskAgentProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    r.version === 1 &&
    typeof r.action === "string" &&
    ACTION_SET.has(r.action) &&
    typeof r.thesis === "string" &&
    typeof r.notionalUsdc === "number"
  );
}
