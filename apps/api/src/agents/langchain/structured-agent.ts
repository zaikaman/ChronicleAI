/**
 * Structured single-shot agents via LangChain `createAgent` + responseFormat.
 * Used for alert/digest/premium generation, desk proposals, classifiers, etc.
 */

import {
  createAgent,
  modelCallLimitMiddleware,
  type ReactAgent,
} from "langchain";
import type { InteropZodObject } from "@langchain/core/utils/types";
import type { LLMProvider } from "@chronicleai/schemas";
import type { ChronicleChatModel } from "./models.ts";
import { messageContentToText } from "./models.ts";

export interface StructuredAgentInvokeParams<TSchema extends InteropZodObject> {
  model: ChronicleChatModel;
  systemPrompt: string;
  userPrompt: string;
  responseFormat: TSchema;
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
 * Invoke a LangChain ReAct agent configured for structured output (no tools).
 * Throws on model/schema failure so callers can try the next provider.
 */
export async function invokeStructuredAgent<TSchema extends InteropZodObject>(
  params: StructuredAgentInvokeParams<TSchema>,
): Promise<StructuredAgentResult<Record<string, unknown>>> {
  const runLimit = params.runLimit ?? 1;

  const agent = createAgent({
    model: params.model,
    tools: [],
    systemPrompt: params.systemPrompt,
    responseFormat: params.responseFormat,
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
      params.signal ? { signal: params.signal } : undefined,
    ),
    params.signal,
  );

  const structured = (result as { structuredResponse?: Record<string, unknown> })
    .structuredResponse;
  if (!structured || typeof structured !== "object") {
    // Fallback: some providers return JSON in the final message only.
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
}): ReactAgent {
  return createAgent({
    model: params.model,
    tools: [],
    systemPrompt: params.systemPrompt,
    responseFormat: params.responseFormat,
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);
    const started = Date.now();
    try {
      const result = await invokeStructuredAgent({
        model,
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        responseFormat: params.responseFormat,
        signal: controller.signal,
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
      clearTimeout(timer);
    }
  }

  return { success: false, attempts };
}
