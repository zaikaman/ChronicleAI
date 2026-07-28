// Shared multi-provider LLM client backed by LangChain chat models.
// Provider order remains Gemini → Groq → OpenAI at call sites.

import type { LLMProvider } from "@chronicleai/schemas";
import {
  createChatModel,
  messageContentToText,
} from "../agents/langchain/models.ts";

export interface LLMProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string | undefined;
  /** Optional max tokens when a provider supports it. */
  maxTokens?: number | undefined;
  /** Sampling temperature (provider default when unset). */
  temperature?: number | undefined;
}

export interface LLMProviderMap {
  gemini: LLMProviderConfig;
  openai: LLMProviderConfig;
  groq: LLMProviderConfig;
}

export type LLMCaller = (
  config: LLMProviderConfig,
  prompt: string,
  signal: AbortSignal,
  systemInstruction: string,
) => Promise<string>;

async function callViaLangChain(
  provider: LLMProvider,
  config: LLMProviderConfig,
  prompt: string,
  signal: AbortSignal,
  systemInstruction: string,
): Promise<string> {
  const model = createChatModel(provider, config);
  if (!model) {
    throw new Error(`${provider} API key not configured`);
  }

  const response = await model.invoke(
    [
      { role: "system", content: systemInstruction },
      { role: "user", content: prompt },
    ],
    { signal },
  );

  const text = messageContentToText(response.content);
  if (!text) throw new Error(`${provider} returned empty response`);
  return text;
}

export async function callGemini(
  config: LLMProviderConfig,
  prompt: string,
  signal: AbortSignal,
  systemInstruction: string,
): Promise<string> {
  return callViaLangChain("gemini", config, prompt, signal, systemInstruction);
}

export async function callOpenAI(
  config: LLMProviderConfig,
  prompt: string,
  signal: AbortSignal,
  systemInstruction: string,
): Promise<string> {
  return callViaLangChain("openai", config, prompt, signal, systemInstruction);
}

export async function callGroq(
  config: LLMProviderConfig,
  prompt: string,
  signal: AbortSignal,
  systemInstruction: string,
): Promise<string> {
  return callViaLangChain("groq", config, prompt, signal, systemInstruction);
}

export const LLM_PROVIDER_CALLERS: Record<LLMProvider, LLMCaller> = {
  gemini: callGemini,
  openai: callOpenAI,
  groq: callGroq,
};

/** Extract the first JSON object from a model response (handles markdown fences). */
export function extractJsonObject(raw: string): string | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  return jsonMatch?.[0] ?? null;
}
