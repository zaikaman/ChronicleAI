// Shared multi-provider LLM client backed by LangChain chat models.
// Provider order remains Groq → OpenAI at call sites (Gemini removed for now).
// Groq calls are hard-capped at ≤8000 estimated input tokens before invoke.

import type { LLMProvider } from "@chronicleai/schemas";
import { advanceAndGetGroqKeyIndex, getGroqApiKeys } from "@chronicleai/config";
import {
  createChatModel,
  messageContentToText,
} from "../agents/langchain/models.ts";
import {
  fitSystemAndUserToTokenBudget,
  GROQ_EFFECTIVE_INPUT_BUDGET,
} from "../agents/langchain/token-budget.ts";

import type { ServerEnv } from "@chronicleai/config";

export interface LLMProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string | undefined;
  /** Use process-level GROQ_API_KEY rotation when true (the default). */
  rotateGroqKeys?: boolean | undefined;
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

/**
 * Creates standard LLMProviderMap from ServerEnv.
 * Groq apiKey uses a dynamic getter to rotate keys in round-robin sequence on each request.
 */
export function createProviderConfigs(env: ServerEnv): LLMProviderMap {
  return {
    gemini: { apiKey: env.geminiApiKey, model: env.geminiModel, baseUrl: env.geminiBaseUrl },
    openai: { apiKey: env.openaiApiKey, model: env.openaiModel, baseUrl: env.openaiBaseUrl },
    groq: {
      get apiKey() {
        return env.groqApiKey;
      },
      model: env.groqModel,
      baseUrl: env.groqBaseUrl,
    },
  };
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
  // Belt-and-suspenders: cap system+user before invoke. Groq models are also
  // wrapped at createChatModel, but call sites that pass huge prompts still
  // benefit from an explicit fit here (cleaner truncation notice placement).
  const fitted =
    provider === "groq"
      ? fitSystemAndUserToTokenBudget(
          systemInstruction,
          prompt,
          GROQ_EFFECTIVE_INPUT_BUDGET,
        )
      : { systemPrompt: systemInstruction, userPrompt: prompt };
  const systemContent = fitted.systemPrompt;
  const userContent = fitted.userPrompt;

  if (provider === "groq") {
    const groqKeys =
      config.rotateGroqKeys === false ? [] : getGroqApiKeys(process.env);
    const keysToTry = groqKeys.length > 0 ? groqKeys : (config.apiKey ? [config.apiKey] : []);
    const startIndex = advanceAndGetGroqKeyIndex(keysToTry.length);
    let lastError: unknown;
    for (let i = 0; i < keysToTry.length; i++) {
      const keyIndex = (startIndex + i) % keysToTry.length;
      const apiKey = keysToTry[keyIndex]!;
      if (!apiKey.trim()) continue;
      const model = createChatModel("groq", { ...config, apiKey });
      if (!model) continue;
      try {
        const response = await model.invoke(
          [
            { role: "system", content: systemContent },
            { role: "user", content: userContent },
          ],
          { signal },
        );
        const text = messageContentToText(response.content);
        if (!text) throw new Error("groq returned empty response");
        return text;
      } catch (err) {
        lastError = err;
        if (signal?.aborted) throw err;
      }
    }
    throw lastError ?? new Error("groq API key not configured");
  }

  const model = createChatModel(provider, config);
  if (!model) {
    throw new Error(`${provider} API key not configured`);
  }

  const response = await model.invoke(
    [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
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
