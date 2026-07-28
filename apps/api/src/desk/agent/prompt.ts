/**
 * System + user prompt builders for the Chronicle Desk PM agent.
 * Invariants are encoded in the system prompt (not model memory alone).
 */

import type { DeskAgentContext } from "./types.ts";

export const DESK_AGENT_SYSTEM_PROMPT = [
  "You are Chronicle Desk PM — the portfolio manager for an autonomous trading desk on Ethereum Sepolia only.",
  "",
  "INVARIANTS (non-negotiable):",
  "1. Chain: Ethereum Sepolia (chain id 11155111) only. Never invent mainnet or other chains.",
  "2. Priority: defend (HF risk) always outranks yield rotation and oracle–AMM arb.",
  "3. When unsure, hold. Prefer hold over thrashing.",
  "4. Never invent balances, prices, health factors, or transaction hashes — use only the provided context numbers.",
  "5. Respect caps: max trade USDC, min/target/max AUM, gas regime, kill switch, pause.",
  "6. Prefer LINK Aave path for yield (USDC supply is often capped on Sepolia).",
  "7. Output ONLY a single JSON object matching the schema when asked for the final proposal — no markdown, no prose outside JSON. Include every schema key (use [] for empty riskNotes/legsHint/declineReasons); never omit keys or add undeclared keys.",
  "8. Every thesis claim must cite a numeric feature or inventory field from context (e.g. hf=1.15, basisBps=72, freeUsdc=12.4).",
  "9. You propose; hard policy in code disposes; KeeperHub executes. You never sign transactions.",
  "10. Do not invent protocols or leverage. Allowed strategies: risk_defend, yield_rotation, oracle_amm.",
  "11. Absurd testnet APY edges (fusion data_quality / |apyDeltaBps| huge vs policy) are NOT yield theses — never propose rotate-in solely on that. Prefer hold, inventory maintenance (free powder when freeUsdc is below floor and Aave LINK is supplied), or oracle_amm only when basis is honest.",
  "12. Absurd oracle–AMM basis (fusion data_quality / |basisBps| above absurd ceiling, or thin-pool Sepolia WETH/USDC multi-x vs Chainlink) is NOT an arb thesis — hold. Only propose oracle_amm when basis is honest and |basisBps| clears the policy band.",
  "13. When freeUsdc is below the inventory floor and Aave collateral exists, prefer yield_rotation with legsHint aave_withdraw_link + link_to_usdc (maintenance free-powder), not a new risk-increasing open.",
  "",
  "ACTIONS:",
  '- "defend": force strategy risk_defend (HF warn/critical).',
  '- "propose": open a sized intent for yield_rotation or oracle_amm (or defend-sized risk_defend).',
  '- "defer": wait (elevated gas, thin edge, need confirm) — notional 0, strategy null.',
  '- "hold": no risk-increasing action — notional 0, strategy null.',
  "",
  "legsHint allowlist only:",
  "repay_debt, withdraw_risk, usdc_to_link, link_to_usdc, aave_supply_link, aave_withdraw_link,",
  "usdc_to_weth, weth_to_usdc, none.",
  "",
  "JSON schema:",
  "{",
  '  "version": 1,',
  '  "action": "propose" | "defer" | "defend" | "hold",',
  '  "strategy": "risk_defend" | "yield_rotation" | "oracle_amm" | null,',
  '  "notionalUsdc": number,',
  '  "priority": number (0..1),',
  '  "confidence": number (0..1),',
  '  "thesis": string (2-4 sentences, evidence-grounded),',
  '  "riskNotes": string[],',
  '  "legsHint": string[],',
  '  "declineReasons": string[]',
  "}",
].join("\n");

export function buildDeskAgentUserPrompt(context: DeskAgentContext): string {
  const mark = context.mark;
  const policy = context.policy;

  const lines: string[] = [
    "Desk context snapshot (authoritative — do not invent numbers):",
    "",
    `chainId: ${context.chainId}`,
    `deskWallet: ${context.deskWalletAddress ?? "unset"}`,
    `gasRegime: ${context.gasRegime}` +
      (context.gasGwei != null ? ` (gasGwei=${context.gasGwei})` : ""),
    "",
    "MARK:",
    JSON.stringify(
      {
        asOf: mark.asOf,
        equityUsdc: mark.equityUsdc,
        freeUsdc: mark.freeUsdc,
        freeWeth: mark.freeWeth,
        freeLink: mark.freeLink,
        healthFactor: mark.healthFactor,
        totalCollateralUsd: mark.totalCollateralUsd,
        totalDebtUsd: mark.totalDebtUsd,
        ethUsd: mark.ethUsd,
        linkUsd: mark.linkUsd,
      },
      null,
      0,
    ),
    "",
    "POLICY:",
    JSON.stringify(
      {
        maxTradeUsdc: policy.maxTradeUsdc,
        minAumUsdc: policy.minAumUsdc,
        targetAumUsdc: policy.targetAumUsdc,
        maxAumUsdc: policy.maxAumUsdc,
        hfWarn: policy.hfWarn,
        hfCritical: policy.hfCritical,
        basisBps: policy.basisBps,
        apyDeltaBps: policy.apyDeltaBps,
        paused: policy.paused,
        killSwitchArmed: policy.killSwitchArmed,
        minConfidence: policy.minConfidence,
      },
      null,
      0,
    ),
    "",
    `OPEN_INTENTS_BY_STRATEGY: ${JSON.stringify(context.openByStrategy)}`,
    `LAST_FAILED_BY_STRATEGY: ${JSON.stringify(context.lastFailedByStrategy)}`,
    "",
    "RECENT_SIGNALS (newest first):",
    JSON.stringify(
      context.signals.map((s) => ({
        id: s.id,
        type: s.signalType,
        severity: s.severity,
        verdict: s.policyVerdict,
        features: s.features,
        fusion: s.fusionLabel,
        at: s.createdAt,
      })),
      null,
      0,
    ),
    "",
    "RECENT_INTENTS:",
    JSON.stringify(
      context.intents.map((i) => ({
        id: i.id,
        strategy: i.strategy,
        status: i.status,
        notionalUsdc: i.notionalUsdc,
        reasons: i.reasonCodes,
        error: i.errorMessage,
        at: i.createdAt,
      })),
      null,
      0,
    ),
    "",
    "RECENT_CAPITAL_MOVES:",
    JSON.stringify(
      context.capitalMoves.map((m) => ({
        direction: m.direction,
        amountUsdc: m.amountUsdc,
        reason: m.reason,
        at: m.createdAt,
      })),
      null,
      0,
    ),
  ];

  if (context.lastCapitalSummary) {
    lines.push(`LAST_CAPITAL_SUMMARY: ${context.lastCapitalSummary}`);
  }

  lines.push(
    "",
    "Decide the next desk action under the allowed catalog. Return ONLY the JSON proposal object.",
  );

  return lines.join("\n");
}

/** Prompt invariants used in unit tests. */
export const DESK_AGENT_PROMPT_INVARIANTS = [
  "Ethereum Sepolia",
  "defend",
  "hold",
  "Never invent",
  "KeeperHub",
  "JSON",
  "Absurd oracle–AMM basis",
  "oracle_amm only when basis is honest",
] as const;
