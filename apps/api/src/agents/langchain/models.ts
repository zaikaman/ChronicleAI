/**
 * LangChain chat model factory for ChronicleAI providers.
 * Maps Gemini / OpenAI / Groq configs onto first-class ChatModel instances.
 *
 * Groq models are wrapped with a hard ≤8000 input-token cap so no call site
 * (structured agents, tool agents, raw invoke) can overshoot the provider limit.
 */

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LLMProvider } from "@chronicleai/schemas";
import { advanceAndGetGroqKeyIndex, getGroqApiKeys } from "@chronicleai/config";
import type { LLMProviderConfig, LLMProviderMap } from "../../services/llm-provider-client.ts";
import {
  capModelInputToGroqBudget,
  GROQ_EFFECTIVE_INPUT_BUDGET,
} from "./token-budget.ts";

export type ChronicleChatModel = BaseChatModel;

export interface CreateChatModelOptions {
  temperature?: number | undefined;
  modelOverride?: string | undefined;
  maxTokens?: number | undefined;
}

const GROQ_CAP_FLAG = Symbol.for("chronicleai.groqInputCap");

/**
 * Wrap a Groq chat model so every invoke/stream/batch/_generate path is capped
 * at GROQ_EFFECTIVE_INPUT_BUDGET estimated tokens. Re-applies on bind/withConfig
 * so response_format / tool bindings keep the guard.
 */
export function withGroqInputTokenCap(
  model: ChronicleChatModel,
): ChronicleChatModel {
  const anyModel = model as ChronicleChatModel & {
    [GROQ_CAP_FLAG]?: boolean;
    invoke: (...args: unknown[]) => unknown;
    stream?: (...args: unknown[]) => unknown;
    batch?: (...args: unknown[]) => unknown;
    _generate?: (...args: unknown[]) => unknown;
    bind?: (...args: unknown[]) => unknown;
    withConfig?: (...args: unknown[]) => unknown;
    bindTools?: (...args: unknown[]) => unknown;
  };

  if (anyModel[GROQ_CAP_FLAG]) return model;
  anyModel[GROQ_CAP_FLAG] = true;

  const originalInvoke = anyModel.invoke.bind(anyModel);
  anyModel.invoke = ((input: unknown, options?: unknown) =>
    originalInvoke(
      capModelInputToGroqBudget(input, GROQ_EFFECTIVE_INPUT_BUDGET),
      options,
    )) as typeof anyModel.invoke;

  if (typeof anyModel.stream === "function") {
    const originalStream = anyModel.stream.bind(anyModel);
    anyModel.stream = ((input: unknown, options?: unknown) =>
      originalStream(
        capModelInputToGroqBudget(input, GROQ_EFFECTIVE_INPUT_BUDGET),
        options,
      )) as typeof anyModel.stream;
  }

  if (typeof anyModel.batch === "function") {
    const originalBatch = anyModel.batch.bind(anyModel);
    anyModel.batch = ((inputs: unknown[], options?: unknown) =>
      originalBatch(
        (Array.isArray(inputs) ? inputs : []).map((item) =>
          capModelInputToGroqBudget(item, GROQ_EFFECTIVE_INPUT_BUDGET),
        ),
        options,
      )) as typeof anyModel.batch;
  }

  if (typeof anyModel._generate === "function") {
    const originalGenerate = anyModel._generate.bind(anyModel);
    anyModel._generate = ((messages: unknown, ...rest: unknown[]) =>
      originalGenerate(
        Array.isArray(messages)
          ? capModelInputToGroqBudget(messages, GROQ_EFFECTIVE_INPUT_BUDGET)
          : messages,
        ...rest,
      )) as typeof anyModel._generate;
  }

  for (const methodName of ["bind", "withConfig", "bindTools"] as const) {
    const original = anyModel[methodName];
    if (typeof original !== "function") continue;
    const bound = original.bind(anyModel) as (...args: unknown[]) => unknown;
    (anyModel as unknown as Record<string, unknown>)[methodName] = (...args: unknown[]) => {
      const result = bound(...args);
      if (result && typeof result === "object") {
        return withGroqInputTokenCap(result as ChronicleChatModel);
      }
      return result;
    };
  }

  return model;
}

/**
 * Google Generative AI SDK builds `${baseUrl}/${apiVersion}/models/...` with
 * apiVersion defaulting to `v1beta`. Env values often include `/v1beta`
 * already (e.g. https://v98store.com/v1beta), which produces a double path
 * and 404. Strip trailing API-version segments so the host alone is passed.
 */
export function normalizeGeminiBaseUrl(
  baseUrl: string | undefined,
): string | undefined {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return undefined;
  return trimmed
    .replace(/\/+$/, "")
    .replace(/\/v1beta$/i, "")
    .replace(/\/v1$/i, "");
}

/**
 * Build a LangChain chat model for a single Chronicle provider config.
 * Returns null when the API key is missing/blank.
 */
export function createChatModel(
  provider: LLMProvider,
  config: LLMProviderConfig,
  options: CreateChatModelOptions = {},
): ChronicleChatModel | null {
  if (!config.apiKey?.trim()) return null;

  const model = options.modelOverride?.trim() || config.model;
  const temperature =
    options.temperature !== undefined
      ? options.temperature
      : config.temperature !== undefined
        ? config.temperature
        : 0.3;
  const maxTokens = options.maxTokens ?? config.maxTokens;

  if (provider === "gemini") {
    const geminiBaseUrl = normalizeGeminiBaseUrl(config.baseUrl);
    return new ChatGoogleGenerativeAI({
      apiKey: config.apiKey,
      model,
      temperature,
      ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
      ...(geminiBaseUrl ? { baseUrl: geminiBaseUrl } : {}),
    });
  }

  if (provider === "openai") {
    return new ChatOpenAI({
      apiKey: config.apiKey,
      model,
      timeout: 300000,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(config.baseUrl
        ? { configuration: { baseURL: config.baseUrl, timeout: 300000 } }
        : {}),
    });
  }

  // Groq: OpenAI-compatible chat completions endpoint.
  // Hard-cap input tokens at the model boundary (≤8000) for every call path.
  const groqModel = new ChatOpenAI({
    apiKey: config.apiKey,
    model,
    temperature,
    maxRetries: 2,
    timeout: 120000,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    configuration: {
      baseURL: config.baseUrl || "https://api.groq.com/openai/v1",
      timeout: 120000,
    },
  });
  return withGroqInputTokenCap(groqModel);
}

/**
 * Ordered list of configured providers (preferred first, then fallback order).
 */
export function orderedProviders(
  providerConfigs: LLMProviderMap,
  fallbackOrder: readonly LLMProvider[],
  preferred?: LLMProvider | undefined,
): LLMProvider[] {
  const order: LLMProvider[] = [];
  if (preferred) order.push(preferred);
  for (const p of fallbackOrder) {
    if (!order.includes(p)) order.push(p);
  }
  return order.filter((p) => Boolean(providerConfigs[p]?.apiKey?.trim()));
}

/**
 * Build chat models for every configured provider in fallback order.
 * For Groq, generates chat model instances for every configured Groq API key
 * in round-robin sequence so that rate limits on any key trigger fallback to the next key.
 */
export function createChatModelsInOrder(
  providerConfigs: LLMProviderMap,
  fallbackOrder: readonly LLMProvider[],
  options: CreateChatModelOptions & {
    preferredProvider?: LLMProvider | undefined;
  } = {},
): Array<{ provider: LLMProvider; model: ChronicleChatModel; config: LLMProviderConfig }> {
  const { preferredProvider, ...modelOpts } = options;
  const out: Array<{
    provider: LLMProvider;
    model: ChronicleChatModel;
    config: LLMProviderConfig;
  }> = [];

  for (const provider of orderedProviders(
    providerConfigs,
    fallbackOrder,
    preferredProvider,
  )) {
    const config = providerConfigs[provider];
    if (!config) continue;

    if (provider === "groq") {
      const groqKeys = getGroqApiKeys(process.env);
      if (groqKeys.length > 0) {
        const startIndex = advanceAndGetGroqKeyIndex(groqKeys.length);
        for (let i = 0; i < groqKeys.length; i++) {
          const keyIndex = (startIndex + i) % groqKeys.length;
          const apiKey = groqKeys[keyIndex]!;
          if (!apiKey.trim()) continue;
          const keyConfig: LLMProviderConfig = { ...config, apiKey };
          const model = createChatModel("groq", keyConfig, modelOpts);
          if (model) out.push({ provider: "groq", model, config: keyConfig });
        }
      } else if (config.apiKey?.trim()) {
        const model = createChatModel("groq", config, modelOpts);
        if (model) out.push({ provider: "groq", model, config });
      }
    } else {
      const model = createChatModel(provider, config, modelOpts);
      if (model) out.push({ provider, model, config });
    }
  }
  return out;
}

/** Flatten LangChain message content to plain text. */
export function messageContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("")
      .trim();
  }
  if (content == null) return "";
  return String(content);
}
