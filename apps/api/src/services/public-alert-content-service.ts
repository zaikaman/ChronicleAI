// LLM-backed public alert content generator with Gemini -> OpenAI -> Groq fallback

import { ALERT_GENERATION_TIMEOUT_MS, LLM_FALLBACK_ORDER } from "@chronicleai/config";
import type { LLMGenerationAttemptRepository } from "@chronicleai/db";
import type { Confidence, EventType, LLMProvider } from "@chronicleai/schemas";

// ── Types ───────────────────────────────────────────────

export interface LLMProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string | undefined;
}

export interface LLMProviderMap {
  gemini: LLMProviderConfig;
  openai: LLMProviderConfig;
  groq: LLMProviderConfig;
}

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

// ── Prompt Template ────────────────────────────────────

function buildPrompt(input: AlertGenerationInput): string {
  const parts = [
    "You are ChronicleAI, an on-chain intelligence monitor. Generate a public alert for a significant blockchain event.",
    "",
    `Event Type: ${input.eventType}`,
    `Chain ID: ${input.chainId}`,
  ];

  if (input.protocol) parts.push(`Protocol: ${input.protocol}`);
  if (input.assetSymbols?.length) parts.push(`Assets: ${input.assetSymbols.join(", ")}`);
  if (input.magnitude) parts.push(`Magnitude: ${input.magnitude.value} ${input.magnitude.unit}`);
  if (input.transactionHash) parts.push(`Transaction: ${input.transactionHash}`);
  if (input.significanceScore)
    parts.push(`Significance Score: ${input.significanceScore.toFixed(2)}`);

  parts.push(
    "",
    "IMPORTANT RULES:",
    "- The alert is for the PUBLIC. Do NOT include premium-only analysis or deep financial advice.",
    "- Keep the summary concise (2-4 sentences) and plain-language.",
    "- Focus on WHAT happened, WHERE it happened, and WHY it matters to a general audience.",
    "- Provide a confidence level: 'high' for clear deterministic data, 'medium' for reasonable interpretation, 'low' for speculative signals.",
    "",
    "Respond in JSON format with these fields:",
    '{ "title": "Short alert headline", "summary": "Plain language explanation", "confidence": "high|medium|low" }',
  );

  return parts.join("\n");
}

function validateResponse(raw: string, input: AlertGenerationInput): GeneratedAlertContent | null {
  try {
    // Try to extract JSON from the response (it may be wrapped in markdown code blocks)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch?.[0] ?? raw;
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

// ── Provider Adapters ──────────────────────────────────

async function callGemini(
  config: LLMProviderConfig,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  let host = config.baseUrl || "https://generativelanguage.googleapis.com";
  if (host.endsWith("/")) host = host.slice(0, -1);
  const path = host.includes("/v1")
    ? `/models/${config.model}:generateContent?key=${config.apiKey}`
    : `/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
  const url = `${host}${path}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text:
              "You are ChronicleAI, an on-chain intelligence monitor. Generate concise public alerts for blockchain events.",
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        topP: 1,
      },
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");
  return text;
}

async function callOpenAI(
  config: LLMProviderConfig,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  let host = config.baseUrl || "https://api.openai.com/v1";
  if (host.endsWith("/")) host = host.slice(0, -1);
  const url = `${host}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content:
            "You are ChronicleAI, an on-chain intelligence monitor. Generate concise public alerts for blockchain events.",
        },
        { role: "user", content: prompt },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned empty response");
  return text;
}

async function callGroq(
  config: LLMProviderConfig,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  let host = config.baseUrl || "https://api.groq.com/openai/v1";
  if (host.endsWith("/")) host = host.slice(0, -1);
  const url = `${host}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content:
            "You are ChronicleAI, an on-chain intelligence monitor. Generate concise public alerts for blockchain events.",
        },
        { role: "user", content: prompt },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned empty response");
  return text;
}

// ── Factory ─────────────────────────────────────────────

export function createPublicAlertContentService(
  providerConfigs: LLMProviderMap,
  llmAttemptRepo: LLMGenerationAttemptRepository,
): PublicAlertContentService {
  const providerCallers: Record<
    LLMProvider,
    (config: LLMProviderConfig, prompt: string, signal: AbortSignal) => Promise<string>
  > = {
    gemini: callGemini,
    openai: callOpenAI,
    groq: callGroq,
  };

  return {
    async generateAlert(input) {
      const prompt = buildPrompt(input);
      const attempts: ProviderAttemptResult[] = [];

      for (const provider of LLM_FALLBACK_ORDER) {
        const config = providerConfigs[provider];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ALERT_GENERATION_TIMEOUT_MS);
        const startTime = Date.now();

        try {
          const raw = await providerCallers[provider](config, prompt, controller.signal);
          const latencyMs = Date.now() - startTime;
          clearTimeout(timeoutId);

          const content = validateResponse(raw, input);

          if (content) {
            attempts.push({
              provider,
              success: true,
              content,
              latencyMs,
            });

            // Record successful attempt
            await llmAttemptRepo.create({
              monitored_event_id: input.monitoredEventId,
              provider,
              attempt_order: LLM_FALLBACK_ORDER.indexOf(provider) + 1,
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

          // Invalid response
          attempts.push({
            provider,
            success: false,
            latencyMs,
            failureReason: "Invalid response format from provider",
          });

          await llmAttemptRepo.create({
            monitored_event_id: input.monitoredEventId,
            provider,
            attempt_order: LLM_FALLBACK_ORDER.indexOf(provider) + 1,
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
            attempt_order: LLM_FALLBACK_ORDER.indexOf(provider) + 1,
            status: "failed",
            latency_ms: latencyMs,
            failure_reason: failureReason,
          });
        }
      }

      // All providers failed
      return {
        success: false,
        attempts,
      };
    },
  };
}
