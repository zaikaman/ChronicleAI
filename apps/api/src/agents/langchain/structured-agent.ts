/**
 * Structured single-shot agents via LangChain `createAgent` + responseFormat.
 * Used for alert/digest/premium generation, desk proposals, classifiers, etc.
 *
 * Gemini/OpenAI use {@link providerStrategy} (native JSON-schema / responseSchema).
 * Groq uses JSON Object Mode + Zod validation: most Groq models (Qwen, Llama, etc.)
 * reject `response_format: json_schema` (only GPT-OSS supports it). Tool strategy is
 * avoided for Gemini because `tool_choice: "any"` can emit free-text without
 * `structuredResponse`.
 */

import {
  createAgent,
  modelCallLimitMiddleware,
  providerStrategy,
  type ReactAgent,
} from "langchain";
import type { InteropZodObject } from "@langchain/core/utils/types";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import type { LLMProvider } from "@chronicleai/schemas";
import type { ChronicleChatModel } from "./models.ts";
import { messageContentToText } from "./models.ts";

export interface StructuredAgentInvokeParams<TSchema extends InteropZodObject> {
  model: ChronicleChatModel;
  systemPrompt: string;
  userPrompt: string;
  responseFormat: TSchema;
  /**
   * When `groq`, uses JSON Object Mode + client-side Zod parse instead of
   * native `json_schema` (unsupported on Qwen/Llama and most Groq models).
   */
  provider?: LLMProvider | undefined;
  /** Abort signal (timeouts). */
  signal?: AbortSignal | undefined;
  /** Hard cap on model rounds — structured agents should be 1. */
  runLimit?: number | undefined;
}

export interface StructuredAgentResult<T> {
  structured: T;
  rawText: string;
  /** Tool call count from the agent run (usually 0 for structured single-shot). */
  toolCallCount: number;
}

/**
 * Race a promise against an AbortSignal so hung provider SDKs cannot stall loops.
 */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(Object.assign(new Error("timeout"), { name: "AbortError" }));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(Object.assign(new Error("timeout"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Native JSON-schema strategy so providers bind responseSchema / json_schema
 * instead of inventing a synthetic extract tool the model may ignore.
 */
function nativeResponseFormat<TSchema extends InteropZodObject>(schema: TSchema) {
  return providerStrategy(schema);
}

/** Pull the first JSON object from model text (handles markdown fences). */
function extractJsonObject(raw: string): string | null {
  const match = raw.match(/\{[\s\S]*\}/);
  return match?.[0] ?? null;
}

type ZodLikeSchema = {
  safeParse: (data: unknown) =>
    | { success: true; data: unknown }
    | { success: false; error: { message: string } };
};

/**
 * Groq path: `response_format: { type: "json_object" }` + Zod validation.
 * Works for Qwen, Llama 3.3, and any Groq model that lacks `json_schema` support.
 */
async function invokeGroqJsonObjectStructuredAgent<TSchema extends InteropZodObject>(
  params: StructuredAgentInvokeParams<TSchema>,
): Promise<StructuredAgentResult<Record<string, unknown>>> {
  const modelWithConfig = params.model as ChronicleChatModel & {
    withConfig?: (config: Record<string, unknown>) => ChronicleChatModel;
    bind?: (kwargs: Record<string, unknown>) => ChronicleChatModel;
  };
  const bound =
    typeof modelWithConfig.bind === "function"
      ? modelWithConfig.bind({
          response_format: { type: "json_object" },
        })
      : typeof modelWithConfig.withConfig === "function"
        ? modelWithConfig.withConfig({
            response_format: { type: "json_object" },
          })
        : params.model;

  let schemaHint = "";
  try {
    schemaHint = JSON.stringify(toJsonSchema(params.responseFormat), null, 2);
  } catch {
    schemaHint = "";
  }

  const systemPrompt = schemaHint
    ? `${params.systemPrompt}\n\nCRITICAL: Respond with a single raw JSON object only (no markdown fences, no preamble, no prose) matching this JSON Schema:\n${schemaHint}`
    : `${params.systemPrompt}\n\nCRITICAL: Respond with a single raw JSON object only (no markdown fences, no preamble, no prose).`;

  const inputMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: params.userPrompt },
  ];

  let lastError: unknown;
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      let response: unknown;
      try {
        response = await raceAbort(
          bound.invoke(
            inputMessages,
            params.signal ? { signal: params.signal } : undefined,
          ),
          params.signal,
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (
          errorMsg.includes("400") ||
          errorMsg.includes("Failed to validate JSON") ||
          errorMsg.includes("response_format") ||
          errorMsg.includes("failed_generation")
        ) {
          // Fallback: invoke Groq without response_format if Groq server-side JSON mode rejects generation
          response = await raceAbort(
            params.model.invoke(
              inputMessages,
              params.signal ? { signal: params.signal } : undefined,
            ),
            params.signal,
          );
        } else {
          throw error;
        }
      }

      const rawText = messageContentToText(
        (response as { content?: unknown }).content,
      );
      if (!rawText.trim()) {
        throw new Error("Groq structured agent returned empty response");
      }

      const jsonStr = extractJsonObject(rawText) ?? rawText;
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        throw new Error(
          `Groq returned non-JSON structured response: ${rawText.slice(0, 200)}`,
        );
      }

      const schema = params.responseFormat as unknown as ZodLikeSchema;
      if (typeof schema.safeParse === "function") {
        const validated = schema.safeParse(parsed);
        if (!validated.success) {
          throw new Error(
            `Groq JSON failed schema validation: ${validated.error.message}`,
          );
        }
        const data = validated.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("Groq structured response was not a JSON object");
        }
        return {
          structured: data as Record<string, unknown>,
          rawText,
          toolCallCount: 0,
        };
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Groq structured response was not a JSON object");
      }
      return {
        structured: parsed as Record<string, unknown>,
        rawText,
        toolCallCount: 0,
      };
    } catch (err) {
      lastError = err;
      if (params.signal?.aborted) throw err;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Invoke a LangChain ReAct agent configured for structured output (no tools).
 * Throws on model/schema failure so callers can try the next provider.
 */
export async function invokeStructuredAgent<TSchema extends InteropZodObject>(
  params: StructuredAgentInvokeParams<TSchema>,
): Promise<StructuredAgentResult<Record<string, unknown>>> {
  if (params.provider === "groq") {
    return invokeGroqJsonObjectStructuredAgent(params);
  }

  const effectiveSignal = params.provider === "openai" ? undefined : params.signal;
  const runLimit = params.runLimit ?? 1;

  const agent = createAgent({
    model: params.model,
    tools: [],
    systemPrompt: params.systemPrompt,
    responseFormat: nativeResponseFormat(params.responseFormat),
    middleware: [
      modelCallLimitMiddleware({
        runLimit,
        exitBehavior: "error",
      }),
    ],
  });

  const result = await raceAbort(
    agent.invoke(
      {
        messages: [{ role: "user", content: params.userPrompt }],
      },
      effectiveSignal ? { signal: effectiveSignal } : undefined,
    ),
    effectiveSignal,
  );

  const structured = (result as { structuredResponse?: Record<string, unknown> })
    .structuredResponse;
  if (!structured || typeof structured !== "object") {
    const messages = (result as { messages?: Array<{ content?: unknown }> }).messages ?? [];
    const last = messages[messages.length - 1];
    const rawText = messageContentToText(last?.content);
    throw new Error(
      rawText
        ? `Structured agent returned no structuredResponse (last message: ${rawText.slice(0, 200)})`
        : "Structured agent returned no structuredResponse",
    );
  }

  const messages = (result as { messages?: Array<{ content?: unknown; tool_calls?: unknown[] }> })
    .messages ?? [];
  const last = messages[messages.length - 1];
  const rawText =
    messageContentToText(last?.content) || JSON.stringify(structured);
  let toolCallCount = 0;
  for (const m of messages) {
    if (Array.isArray((m as { tool_calls?: unknown[] }).tool_calls)) {
      toolCallCount += ((m as { tool_calls?: unknown[] }).tool_calls ?? []).length;
    }
  }

  return {
    structured,
    rawText,
    toolCallCount,
  };
}

/**
 * Create a reusable structured agent instance bound to one model.
 * Prefer {@link invokeStructuredAgent} for one-off provider attempts.
 */
export function createStructuredAgent<TSchema extends InteropZodObject>(params: {
  model: ChronicleChatModel;
  systemPrompt: string;
  responseFormat: TSchema;
  runLimit?: number | undefined;
  /** When groq, callers should prefer {@link invokeStructuredAgent} (json_object path). */
  provider?: LLMProvider | undefined;
}): ReactAgent {
  if (params.provider === "groq") {
    throw new Error(
      "createStructuredAgent does not support groq; use invokeStructuredAgent (JSON Object Mode)",
    );
  }
  return createAgent({
    model: params.model,
    tools: [],
    systemPrompt: params.systemPrompt,
    responseFormat: nativeResponseFormat(params.responseFormat),
    middleware: [
      modelCallLimitMiddleware({
        runLimit: params.runLimit ?? 1,
        exitBehavior: "error",
      }),
    ],
  }) as ReactAgent;
}

export interface ProviderStructuredAttempt {
  provider: LLMProvider;
  success: boolean;
  latencyMs: number;
  failureReason?: string;
  structured?: Record<string, unknown>;
  rawText?: string;
  toolCallCount?: number;
}

/**
 * Try each provider model in order with a structured agent until one succeeds.
 * Does not throw — returns the first success or all failed attempts.
 */
export async function invokeStructuredAgentWithFallback<TSchema extends InteropZodObject>(params: {
  models: Array<{ provider: LLMProvider; model: ChronicleChatModel }>;
  systemPrompt: string;
  userPrompt: string;
  responseFormat: TSchema;
  timeoutMs: number;
  /** Optional post-validate; return null to treat as invalid and try next. */
  validate?: (structured: Record<string, unknown>, rawText: string) => unknown | null;
}): Promise<{
  success: true;
  provider: LLMProvider;
  value: unknown;
  structured: Record<string, unknown>;
  rawText: string;
  toolCallCount: number;
  latencyMs: number;
  attempts: ProviderStructuredAttempt[];
} | {
  success: false;
  attempts: ProviderStructuredAttempt[];
}> {
  const attempts: ProviderStructuredAttempt[] = [];

  for (const { provider, model } of params.models) {
    const controller = provider === "openai" ? undefined : new AbortController();
    const timer =
      provider === "openai" || !controller
        ? undefined
        : setTimeout(() => controller.abort(), params.timeoutMs);
    const started = Date.now();
    try {
      const result = await invokeStructuredAgent({
        model,
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        responseFormat: params.responseFormat,
        provider,
        signal: controller?.signal,
      });
      const latencyMs = Date.now() - started;

      if (params.validate) {
        const value = params.validate(result.structured, result.rawText);
        if (value == null) {
          attempts.push({
            provider,
            success: false,
            latencyMs,
            failureReason: "Invalid structured response",
            structured: result.structured,
            rawText: result.rawText,
            toolCallCount: result.toolCallCount,
          });
          continue;
        }
        attempts.push({
          provider,
          success: true,
          latencyMs,
          structured: result.structured,
          rawText: result.rawText,
          toolCallCount: result.toolCallCount,
        });
        return {
          success: true,
          provider,
          value,
          structured: result.structured,
          rawText: result.rawText,
          toolCallCount: result.toolCallCount,
          latencyMs,
          attempts,
        };
      }

      attempts.push({
        provider,
        success: true,
        latencyMs,
        structured: result.structured,
        rawText: result.rawText,
        toolCallCount: result.toolCallCount,
      });
      return {
        success: true,
        provider,
        value: result.structured,
        structured: result.structured,
        rawText: result.rawText,
        toolCallCount: result.toolCallCount,
        latencyMs,
        attempts,
      };
    } catch (error) {
      const latencyMs = Date.now() - started;
      const failureReason =
        error instanceof Error
          ? error.name === "AbortError"
            ? "timeout"
            : error.message
          : String(error);
      attempts.push({
        provider,
        success: false,
        latencyMs,
        failureReason,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return { success: false, attempts };
}
