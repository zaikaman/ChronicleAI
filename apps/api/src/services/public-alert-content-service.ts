// LLM-backed public alert content generator with Gemini -> OpenAI -> Groq fallback

import {
  ALERT_GENERATION_TIMEOUT_MS,
  chainLabel,
  LLM_FALLBACK_ORDER,
} from "@chronicleai/config";
import type { LLMGenerationAttemptRepository } from "@chronicleai/db";
import type { Confidence, EventType, FlowContext, LLMProvider } from "@chronicleai/schemas";
import {
  directionPlainLanguage,
} from "../monitoring/flow-enrichment.ts";
import {
  alertContentSchema,
  createChatModelsInOrder,
  invokeStructuredAgent,
} from "../agents/langchain/index.ts";
import {
  extractJsonObject,
  type LLMProviderConfig,
  type LLMProviderMap,
} from "./llm-provider-client.ts";

export type { LLMProviderConfig, LLMProviderMap };

// ── Types ───────────────────────────────────────────────

export interface AlertGenerationInput {
  monitoredEventId: string;
  eventType: EventType;
  chainId: number;
  protocol?: string | null;
  assetSymbols?: string[] | null;
  magnitude?: { value: number; unit: string } | null;
  transactionHash?: string | null;
  significanceScore: number;
  source: string;
  sourceEventId?: string | null;
  capturedAt: string;
  /** Deterministic capital-flow roles / direction when known. */
  flowContext?: FlowContext | null;
  /** liquidation_cluster member count when applicable. */
  clusterCount?: number | null;
}

export interface GeneratedAlertContent {
  title: string;
  summary: string;
  confidence: Confidence;
  sourceReferences: string[];
}

export interface ProviderAttemptResult {
  provider: LLMProvider;
  success: boolean;
  content?: GeneratedAlertContent;
  latencyMs: number;
  failureReason?: string;
}

export interface PublicAlertContentService {
  /**
   * Generate alert content by attempting providers in order.
   * Returns the first successful result, or info about all failures.
   */
  generateAlert(input: AlertGenerationInput): Promise<{
    success: boolean;
    content?: GeneratedAlertContent;
    providerUsed?: LLMProvider;
    attempts: ProviderAttemptResult[];
  }>;
}

const ALERT_SYSTEM_INSTRUCTION =
  "You are ChronicleAI, an on-chain capital-flow intelligence desk. Generate concise public alerts. Lead with what moved where. Never invent entity names not provided in the structured data.";

// ── Prompt Template ────────────────────────────────────

function formatMagnitude(magnitude: { value: number; unit: string } | null | undefined): string {
  if (!magnitude) return "unknown";
  if (magnitude.unit === "USD") {
    const v = magnitude.value;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
    return `$${v.toFixed(2)}`;
  }
  return `${magnitude.value} ${magnitude.unit}`;
}

function buildPrompt(input: AlertGenerationInput): string {
  const networkName = chainLabel(input.chainId);
  const parts = [
    "You are ChronicleAI, an on-chain capital-flow intelligence desk. Generate a public alert for a significant blockchain event.",
    "",
    `Event Type: ${input.eventType}`,
    `Chain ID: ${input.chainId}`,
    `Network: ${networkName}`,
  ];

  if (input.protocol) parts.push(`Protocol / Venue: ${input.protocol}`);
  if (input.assetSymbols?.length) parts.push(`Assets: ${input.assetSymbols.join(", ")}`);
  if (input.magnitude) {
    parts.push(`Magnitude: ${input.magnitude.value} ${input.magnitude.unit}`);
    parts.push(`Magnitude (display): ${formatMagnitude(input.magnitude)}`);
  }
  if (input.transactionHash) parts.push(`Transaction: ${input.transactionHash}`);
  if (input.significanceScore) {
    parts.push(`Significance Score: ${input.significanceScore.toFixed(2)}`);
  }
  if (input.clusterCount != null) {
    parts.push(`Cluster count: ${input.clusterCount}`);
  }

  if (input.flowContext) {
    const fc = input.flowContext;
    parts.push("", "FLOW CONTEXT (deterministic — do not invent beyond this):");
    parts.push(`From role: ${fc.fromRole}${fc.fromLabel ? ` (${fc.fromLabel})` : ""}`);
    parts.push(`To role: ${fc.toRole}${fc.toLabel ? ` (${fc.toLabel})` : ""}`);
    parts.push(`Direction: ${fc.direction} (${directionPlainLanguage(fc.direction)})`);
    if (fc.venue) parts.push(`Venue: ${fc.venue}`);
    if (fc.subjectAddress) parts.push(`Subject address: ${fc.subjectAddress}`);
    if (fc.counterpartyAddress) parts.push(`Counterparty address: ${fc.counterpartyAddress}`);
  }

  parts.push(
    "",
    "IMPORTANT RULES:",
    "- The alert is for the PUBLIC. Do NOT include premium-only analysis or deep financial advice.",
    "- Lead with WHAT moved WHERE (roles/labels when known), not only USD size.",
    "- Name direction in plain language when known (e.g. de-risking into stables, USDC supply expanded).",
    "- One frame only: liquidity / directional risk / supply / venue stress / no strong read.",
    "- Keep the summary concise (2-4 sentences) and plain-language.",
    `- The event occurred on ${networkName} (chain ID ${input.chainId}). Name that network only — never invent a different chain.`,
    "- Never invent entity names (exchanges, protocols, treasuries). Use only labels provided in FLOW CONTEXT or Protocol/Venue.",
    "- If roles are unknown, say so plainly; do not guess celebrity wallets.",
    "- Confidence: 'high' for clear size+labels, 'medium' when roles unknown but size clear, 'low' when sparse.",
    "",
    "Title style examples (do not copy numbers — invent from THIS event only):",
    "- $12.4M USDC transferred to Binance (CEX inflow)",
    "- $2.1M ETH→USDC on Uniswap — de-risking flow",
    "- Aave: $800k USDC withdrawn",
    "- $50M USDC minted at treasury",
    "- Liquidation cluster: 5 Aave positions, $1.2M notional in 30m",
    "",
    "Respond in JSON format with these fields:",
    '{ "title": "Short alert headline", "summary": "Plain language explanation", "confidence": "high|medium|low" }',
  );

  return parts.join("\n");
}

function validateResponse(raw: string, input: AlertGenerationInput): GeneratedAlertContent | null {
  try {
    const jsonStr = extractJsonObject(raw) ?? raw;
    const parsed = JSON.parse(jsonStr);

    if (!parsed.title || !parsed.summary || !parsed.confidence) {
      return null;
    }

    const confidence = parsed.confidence as string;
    if (!["high", "medium", "low"].includes(confidence)) {
      return null;
    }

    return {
      title: String(parsed.title).slice(0, 200),
      summary: String(parsed.summary).slice(0, 1000),
      confidence: confidence as Confidence,
      sourceReferences: generateSourceReferences(input),
    };
  } catch {
    return null;
  }
}

function generateSourceReferences(input: AlertGenerationInput): string[] {
  const refs: string[] = [];
  if (input.transactionHash) refs.push(input.transactionHash);
  if (input.sourceEventId) refs.push(`${input.source}/${input.sourceEventId}`);
  if (!refs.length) refs.push(`${input.source}-${input.monitoredEventId}`);
  return refs;
}

// ── Factory ─────────────────────────────────────────────

export function createPublicAlertContentService(
  providerConfigs: LLMProviderMap,
  llmAttemptRepo: LLMGenerationAttemptRepository,
): PublicAlertContentService {
  return {
    async generateAlert(input) {
      const prompt = buildPrompt(input);
      const attempts: ProviderAttemptResult[] = [];
      const models = createChatModelsInOrder(providerConfigs, LLM_FALLBACK_ORDER);

      for (let i = 0; i < models.length; i++) {
        const { provider, model } = models[i]!;
        const attemptOrder = i + 1;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ALERT_GENERATION_TIMEOUT_MS);
        const startTime = Date.now();

        try {
          const result = await invokeStructuredAgent({
            model,
            systemPrompt: ALERT_SYSTEM_INSTRUCTION,
            userPrompt: prompt,
            responseFormat: alertContentSchema,
            provider,
            signal: controller?.signal,
            runLimit: 1,
          });
          const latencyMs = Date.now() - startTime;
          if (timeoutId) clearTimeout(timeoutId);

          const content =
            validateResponse(JSON.stringify(result.structured), input) ??
            validateResponse(result.rawText, input);

          if (content) {
            attempts.push({
              provider,
              success: true,
              content,
              latencyMs,
            });

            await llmAttemptRepo.create({
              monitored_event_id: input.monitoredEventId,
              provider,
              attempt_order: attemptOrder,
              status: "succeeded",
              latency_ms: latencyMs,
              response_metadata: { title: content.title },
            });

            return {
              success: true,
              content,
              providerUsed: provider,
              attempts,
            };
          }

          attempts.push({
            provider,
            success: false,
            latencyMs,
            failureReason: "Invalid response format from provider",
          });

          await llmAttemptRepo.create({
            monitored_event_id: input.monitoredEventId,
            provider,
            attempt_order: attemptOrder,
            status: "invalid_response",
            latency_ms: latencyMs,
            failure_reason:
              "Response did not contain valid JSON with title, summary, and confidence",
          });
        } catch (error) {
          clearTimeout(timeoutId);
          const latencyMs = Date.now() - startTime;
          const failureReason = error instanceof Error ? error.message : "Unknown provider error";

          attempts.push({
            provider,
            success: false,
            latencyMs,
            failureReason,
          });

          await llmAttemptRepo.create({
            monitored_event_id: input.monitoredEventId,
            provider,
            attempt_order: attemptOrder,
            status: "failed",
            latency_ms: latencyMs,
            failure_reason: failureReason,
          });
        }
      }

      return {
        success: false,
        attempts,
      };
    },
  };
}

/** Exported for unit tests — builds the LLM prompt without calling providers. */
export function buildAlertPromptForTest(input: AlertGenerationInput): string {
  return buildPrompt(input);
}
