/**
 * Multi-turn tool-calling agents via LangChain `createAgent`.
 * Used for the affiliate payout agent and other ReAct loops.
 */

import {
  createAgent,
  modelCallLimitMiddleware,
  modelFallbackMiddleware,
} from "langchain";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseMessage } from "@langchain/core/messages";
import type { LLMProvider } from "@chronicleai/schemas";
import type { ChronicleChatModel } from "./models.ts";
import { messageContentToText } from "./models.ts";

export interface ToolAgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ToolAgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  id?: string;
}

export interface InvokeToolAgentParams {
  /** Primary model (first in fallback chain). */
  model: ChronicleChatModel;
  /** Optional fallback models tried via modelFallbackMiddleware. */
  fallbackModels?: ChronicleChatModel[] | undefined;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  messages: ToolAgentMessage[];
  /** Max model rounds (each tool-use cycle counts). */
  runLimit?: number | undefined;
  signal?: AbortSignal | undefined;
  /** Optional provider labels aligned with model + fallbackModels for telemetry. */
  providerLabels?: LLMProvider[] | undefined;
}

export interface ToolAgentResult {
  reply: string;
  toolCalls: ToolAgentToolCall[];
  messages: BaseMessage[];
  /** Best-effort provider label when labels were supplied. */
  provider?: LLMProvider | undefined;
}

/**
 * Run a LangChain ReAct tool agent to completion.
 */
export async function invokeToolAgent(
  params: InvokeToolAgentParams,
): Promise<ToolAgentResult> {
  const runLimit = params.runLimit ?? 5;
  const callLimit = modelCallLimitMiddleware({
    runLimit,
    exitBehavior: "end",
  });

  const agent =
    params.fallbackModels && params.fallbackModels.length > 0
      ? createAgent({
          model: params.model,
          tools: params.tools,
          systemPrompt: params.systemPrompt,
          middleware: [
            modelFallbackMiddleware(...params.fallbackModels),
            callLimit,
          ],
        })
      : createAgent({
          model: params.model,
          tools: params.tools,
          systemPrompt: params.systemPrompt,
          middleware: [callLimit],
        });

  const inputMessages = params.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const invokePromise = agent.invoke(
    { messages: inputMessages },
    params.signal ? { signal: params.signal } : undefined,
  );

  let result: Awaited<typeof invokePromise>;
  if (params.signal) {
    if (params.signal.aborted) {
      throw Object.assign(new Error("timeout"), { name: "AbortError" });
    }
    result = await new Promise((resolve, reject) => {
      const onAbort = () => {
        reject(Object.assign(new Error("timeout"), { name: "AbortError" }));
      };
      params.signal!.addEventListener("abort", onAbort, { once: true });
      invokePromise.then(
        (value) => {
          params.signal!.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          params.signal!.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  } else {
    result = await invokePromise;
  }

  const messages = (result as { messages?: BaseMessage[] }).messages ?? [];
  const toolCalls = extractToolCallsFromMessages(messages);
  const reply = extractFinalAssistantText(messages);

  return {
    reply,
    toolCalls,
    messages,
    ...(params.providerLabels?.[0] !== undefined
      ? { provider: params.providerLabels[0] }
      : {}),
  };
}

function extractFinalAssistantText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    const type = (m as { getType?: () => string; _getType?: () => string; type?: string })
      .getType?.() ??
      (m as { _getType?: () => string })._getType?.() ??
      (m as { type?: string }).type;
    if (type === "ai" || type === "assistant") {
      const text = messageContentToText((m as { content?: unknown }).content);
      if (text.trim()) return text.trim();
    }
  }
  // Last non-empty content as fallback
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messageContentToText((messages[i] as { content?: unknown }).content);
    if (text.trim()) return text.trim();
  }
  return "";
}

/**
 * Pair AI tool_calls with subsequent ToolMessage results.
 */
function extractToolCallsFromMessages(messages: BaseMessage[]): ToolAgentToolCall[] {
  const out: ToolAgentToolCall[] = [];
  const pendingById = new Map<
    string,
    { name: string; arguments: Record<string, unknown> }
  >();

  for (const m of messages) {
    const type =
      (m as { getType?: () => string }).getType?.() ??
      (m as { _getType?: () => string })._getType?.() ??
      (m as { type?: string }).type;

    if (type === "ai" || type === "assistant") {
      const calls =
        (m as { tool_calls?: Array<{ id?: string; name?: string; args?: unknown }> })
          .tool_calls ?? [];
      for (const tc of calls) {
        const name = tc.name ?? "unknown";
        const args =
          tc.args && typeof tc.args === "object" && !Array.isArray(tc.args)
            ? (tc.args as Record<string, unknown>)
            : {};
        const id = tc.id ?? `${name}:${out.length}`;
        pendingById.set(id, { name, arguments: args });
      }
      continue;
    }

    if (type === "tool") {
      const toolCallId = (m as { tool_call_id?: string }).tool_call_id;
      const nameFromMsg = (m as { name?: string }).name;
      const content = (m as { content?: unknown }).content;
      let result: unknown = content;
      if (typeof content === "string") {
        try {
          result = JSON.parse(content);
        } catch {
          result = content;
        }
      }

      if (toolCallId && pendingById.has(toolCallId)) {
        const pending = pendingById.get(toolCallId)!;
        out.push({
          name: pending.name,
          arguments: pending.arguments,
          result,
          id: toolCallId,
        });
        pendingById.delete(toolCallId);
      } else {
        out.push({
          name: nameFromMsg ?? "tool",
          arguments: {},
          result,
          ...(toolCallId ? { id: toolCallId } : {}),
        });
      }
    }
  }

  // Any tool calls without results still surface (name + args only)
  for (const [id, pending] of pendingById) {
    out.push({
      name: pending.name,
      arguments: pending.arguments,
      result: null,
      id,
    });
  }

  return out;
}
