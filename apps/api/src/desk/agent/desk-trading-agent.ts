/**
 * DeskTradingAgent — LangChain createAgent structured completion over a pre-fetched context.
 * On timeout/error/invalid JSON → safe hold (no risk-increasing intent).
 */

import {
  DESK_AGENT_LLM_FALLBACK_ORDER,
  DESK_AGENT_TEMPERATURE,
  DESK_AGENT_TIMEOUT_MS,
  DESK_MAX_TRADE_USDC,
} from "@chronicleai/config";
import type { LLMProvider } from "@chronicleai/schemas";
import {
  createChatModelsInOrder,
  deskProposalSchema,
  invokeStructuredAgent,
} from "../../agents/langchain/index.ts";
import type {
  LLMProviderConfig,
  LLMProviderMap,
} from "../../services/llm-provider-client.ts";
import {
  applyForceDefendOverride,
  applyForceMaintenanceOverride,
  applyMinConfidence,
} from "./map-proposal.ts";
import { holdProposal, parseProposal } from "./proposal-schema.ts";
import { buildDeskAgentUserPrompt, DESK_AGENT_SYSTEM_PROMPT } from "./prompt.ts";
import type { DeskAgentContext, DeskAgentRunResult } from "./types.ts";
import type { DeskAgentProposal } from "./types.ts";

export interface DeskTradingAgentConfig {
  /** Preferred provider; when unset, first keyed in DESK_AGENT_LLM_FALLBACK_ORDER. */
  preferredProvider?: LLMProvider | undefined;
  modelOverride?: string | undefined;
  timeoutMs?: number | undefined;
  temperature?: number | undefined;
  maxTradeUsdc?: number | undefined;
  minConfidence?: number | undefined;
  forceDefendOnCriticalHf?: boolean | undefined;
  /** Injected caller for tests (bypasses LangChain agent). */
  callLlm?: (
    provider: LLMProvider,
    config: LLMProviderConfig,
    prompt: string,
    signal: AbortSignal,
    systemInstruction: string,
  ) => Promise<string>;
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface DeskTradingAgent {
  /** Run single-shot agent; always returns a validated proposal (hold on failure). */
  run(context: DeskAgentContext): Promise<DeskAgentRunResult>;
}

function providerOrder(
  preferred: LLMProvider | undefined,
  providers: LLMProviderMap,
): LLMProvider[] {
  const order: LLMProvider[] = [];
  if (preferred) order.push(preferred);
  for (const p of DESK_AGENT_LLM_FALLBACK_ORDER) {
    if (!order.includes(p as LLMProvider)) order.push(p as LLMProvider);
  }
  return order.filter((p) => {
    const cfg = providers[p];
    return Boolean(cfg?.apiKey?.trim());
  });
}

function withModel(
  config: LLMProviderConfig,
  modelOverride: string | undefined,
  temperature: number,
): LLMProviderConfig {
  return {
    ...config,
    ...(modelOverride ? { model: modelOverride } : {}),
    temperature,
  };
}

/**
 * Freeable Aave LINK for force-maintenance: prefer mark.aaveLinkSupplied,
 * else estimate from debt-free collateral / LINK price.
 */
function resolveAaveLinkFromContext(context: DeskAgentContext): number {
  const marked = context.mark.aaveLinkSupplied;
  if (marked != null && Number.isFinite(marked) && marked > 0) {
    return marked;
  }
  const price =
    context.mark.linkUsd != null && context.mark.linkUsd > 0
      ? context.mark.linkUsd
      : null;
  const collat = context.mark.totalCollateralUsd ?? 0;
  const debt = context.mark.totalDebtUsd ?? 0;
  if (price != null && debt < 0.01 && collat > 0) {
    return collat / price;
  }
  return 0;
}

function forceMaintenanceOpts(context: DeskAgentContext) {
  return {
    freeUsdc: context.mark.freeUsdc ?? 0,
    minFreeUsdc: context.policy.minFreeUsdc ?? 10,
    aaveLinkSupplied: resolveAaveLinkFromContext(context),
    linkUsdPrice: context.mark.linkUsd,
    totalCollateralUsd: context.mark.totalCollateralUsd ?? undefined,
    totalDebtUsd: context.mark.totalDebtUsd ?? undefined,
    maintenanceNotionalUsdc: context.policy.maintenanceNotionalUsdc ?? 10,
    maxTradeUsdc: context.policy.maxTradeUsdc,
    paused: context.policy.paused,
    killSwitchArmed: context.policy.killSwitchArmed,
  };
}

function applyPostGates(
  proposal: DeskAgentProposal,
  context: DeskAgentContext,
  opts: { forceDefend: boolean; minConfidence: number },
): DeskAgentProposal {
  let next = applyMinConfidence(proposal, opts.minConfidence);
  next = applyForceDefendOverride(next, {
    healthFactor: context.mark.healthFactor,
    hfCritical: context.policy.hfCritical,
    paused: context.policy.paused,
    forceDefendEnabled: opts.forceDefend,
  });
  if (next.action !== "defend") {
    next = applyForceMaintenanceOverride(next, forceMaintenanceOpts(context));
  }
  return next;
}

export function createDeskTradingAgent(
  providerConfigs: LLMProviderMap,
  config: DeskTradingAgentConfig = {},
): DeskTradingAgent {
  const log = config.log ?? console;
  const timeoutMs = config.timeoutMs ?? DESK_AGENT_TIMEOUT_MS;
  const temperature = config.temperature ?? DESK_AGENT_TEMPERATURE;
  const maxTradeUsdc = config.maxTradeUsdc ?? DESK_MAX_TRADE_USDC;
  const minConfidence = config.minConfidence ?? 0.35;
  const forceDefend = config.forceDefendOnCriticalHf !== false;

  return {
    async run(context: DeskAgentContext): Promise<DeskAgentRunResult> {
      const started = Date.now();
      const signalCount = context.signals.length;
      const equity = context.mark.equityUsdc;
      log.info(
        `[desk-agent] start signals=${signalCount}` +
          (equity != null ? ` equity=${equity}` : ""),
      );

      // Pre-gates: paused / kill → hold without LLM spend
      if (context.policy.paused || context.policy.killSwitchArmed) {
        const reason = context.policy.paused ? "desk_paused" : "kill_switch_armed";
        let proposal = holdProposal(reason, { latencyMs: Date.now() - started });
        proposal = applyForceDefendOverride(proposal, {
          healthFactor: context.mark.healthFactor,
          hfCritical: context.policy.hfCritical,
          paused: context.policy.paused,
          forceDefendEnabled: forceDefend && !context.policy.killSwitchArmed,
        });
        if (proposal.action !== "defend") {
          proposal = applyForceMaintenanceOverride(
            proposal,
            forceMaintenanceOpts(context),
          );
        }
        if (context.policy.killSwitchArmed) {
          proposal = {
            ...proposal,
            action: "hold",
            strategy: null,
            notionalUsdc: 0,
            forceDefendOverride: false,
            forceMaintenanceOverride: false,
            declineReasons: [...new Set([...proposal.declineReasons, "kill_switch_armed"])],
          };
        }
        log.info(
          `[desk-agent] proposal action=${proposal.action} strategy=${proposal.strategy ?? "null"} ` +
            `notional=${proposal.notionalUsdc} confidence=${proposal.confidence} latencyMs=${Date.now() - started}`,
        );
        return {
          proposal,
          safeDefault: true,
          errorMessage: reason,
          latencyMs: Date.now() - started,
        };
      }

      const providers = providerOrder(config.preferredProvider, providerConfigs);
      if (providers.length === 0) {
        let proposal = holdProposal("no_llm_provider_configured", {
          latencyMs: Date.now() - started,
        });
        proposal = applyPostGates(proposal, context, { forceDefend, minConfidence });
        log.warn("[desk-agent] no LLM provider configured — hold");
        return {
          proposal,
          safeDefault: true,
          errorMessage: "no_llm_provider_configured",
          latencyMs: Date.now() - started,
        };
      }

      const systemInstruction = DESK_AGENT_SYSTEM_PROMPT;
      const userPrompt = buildDeskAgentUserPrompt(context);
      const errors: string[] = [];

      // Test injection path: raw string completion + parseProposal
      if (config.callLlm) {
        for (const provider of providers) {
          const baseCfg = providerConfigs[provider];
          if (!baseCfg?.apiKey?.trim()) continue;
          const cfg = withModel(baseCfg, config.modelOverride, temperature);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          const callStarted = Date.now();
          try {
            const raw = await config.callLlm(
              provider,
              cfg,
              userPrompt,
              controller.signal,
              systemInstruction,
            );
            const latencyMs = Date.now() - callStarted;
            const parsed = parseProposal(raw, {
              maxTradeUsdc,
              model: `${provider}:${cfg.model}`,
              toolCallCount: 0,
              latencyMs,
            });
            if (!parsed.ok) {
              errors.push(`${provider}:${parsed.error}`);
              continue;
            }
            const proposal = applyPostGates(parsed.proposal, context, {
              forceDefend,
              minConfidence,
            });
            log.info(
              `[desk-agent] proposal action=${proposal.action} strategy=${proposal.strategy ?? "null"} ` +
                `notional=${proposal.notionalUsdc} confidence=${proposal.confidence} latencyMs=${latencyMs}`,
            );
            return {
              proposal,
              safeDefault: false,
              provider,
              latencyMs: Date.now() - started,
              rawResponse: raw.slice(0, 2000),
            };
          } catch (error) {
            const msg =
              error instanceof Error
                ? error.name === "AbortError"
                  ? "timeout"
                  : error.message
                : String(error);
            errors.push(`${provider}:${msg}`);
            log.warn(`[desk-agent] provider=${provider} failed: ${msg}`);
          } finally {
            clearTimeout(timer);
          }
        }
      } else {
        // Production: LangChain createAgent with structured responseFormat
        const models = createChatModelsInOrder(
          providerConfigs,
          DESK_AGENT_LLM_FALLBACK_ORDER as readonly LLMProvider[],
          {
            preferredProvider: config.preferredProvider,
            temperature,
            modelOverride: config.modelOverride,
          },
        );

        for (const { provider, model, config: baseCfg } of models) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          const callStarted = Date.now();
          try {
            const result = await invokeStructuredAgent({
              model,
              systemPrompt: systemInstruction,
              userPrompt,
              responseFormat: deskProposalSchema,
              provider,
              signal: controller.signal,
              runLimit: 1,
            });
            const latencyMs = Date.now() - callStarted;
            const parsed = parseProposal(result.structured, {
              maxTradeUsdc,
              model: `${provider}:${baseCfg.model}`,
              toolCallCount: result.toolCallCount,
              latencyMs,
            });
            if (!parsed.ok) {
              errors.push(`${provider}:${parsed.error}`);
              continue;
            }
            const proposal = applyPostGates(parsed.proposal, context, {
              forceDefend,
              minConfidence,
            });
            log.info(
              `[desk-agent] proposal action=${proposal.action} strategy=${proposal.strategy ?? "null"} ` +
                `notional=${proposal.notionalUsdc} confidence=${proposal.confidence} latencyMs=${latencyMs}` +
                (proposal.forceDefendOverride ? " forceDefend=true" : "") +
                (proposal.forceMaintenanceOverride ? " forceMaint=true" : ""),
            );
            return {
              proposal,
              safeDefault: false,
              provider,
              latencyMs: Date.now() - started,
              rawResponse: result.rawText.slice(0, 2000),
            };
          } catch (error) {
            const msg =
              error instanceof Error
                ? error.name === "AbortError"
                  ? "timeout"
                  : error.message
                : String(error);
            errors.push(`${provider}:${msg}`);
            log.warn(`[desk-agent] provider=${provider} failed: ${msg}`);
          } finally {
            clearTimeout(timer);
          }
        }
      }

      // All providers failed → hold (+ optional force defend / maintenance)
      let proposal = holdProposal(
        errors.length > 0 ? `llm_failed:${errors[0]}` : "llm_failed",
        { latencyMs: Date.now() - started },
      );
      proposal = applyPostGates(proposal, context, { forceDefend, minConfidence });

      log.info(
        `[desk-agent] proposal action=${proposal.action} strategy=${proposal.strategy ?? "null"} ` +
          `notional=${proposal.notionalUsdc} confidence=${proposal.confidence} ` +
          `latencyMs=${Date.now() - started} safeDefault=true`,
      );

      return {
        proposal,
        safeDefault: true,
        errorMessage: errors.join("; ") || "llm_failed",
        latencyMs: Date.now() - started,
      };
    },
  };
}

