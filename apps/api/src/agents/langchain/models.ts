/**
 * LangChain chat model factory for ChronicleAI providers.
 * Maps Gemini / OpenAI / Groq configs onto first-class ChatModel instances.
 */

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LLMProvider } from "@chronicleai/schemas";
import type { LLMProviderConfig, LLMProviderMap } from "../../services/llm-provider-client.ts";

export type ChronicleChatModel = BaseChatModel;

export interface CreateChatModelOptions {
  temperature?: number | undefined;
  modelOverride?: string | undefined;
  maxTokens?: number | undefined;
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
  return new ChatOpenAI({
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
    const model = createChatModel(provider, config, modelOpts);
    if (model) out.push({ provider, model, config });
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
