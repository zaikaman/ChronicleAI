// Shared multi-provider LLM client: Gemini → OpenAI → Groq

import OpenAI from "openai";
import type { LLMProvider } from "@chronicleai/schemas";

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

export async function callGemini(
  config: LLMProviderConfig,
  prompt: string,
  signal: AbortSignal,
  systemInstruction: string,
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
        parts: [{ text: systemInstruction }],
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: config.temperature ?? 0.3,
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

export async function callOpenAI(
  config: LLMProviderConfig,
  prompt: string,
  signal: AbortSignal,
  systemInstruction: string,
): Promise<string> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || "https://api.openai.com/v1",
  });

  const response = await client.responses.create(
    {
      model: config.model,
      instructions: systemInstruction,
      input: prompt,
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    },
    { signal },
  );

  const text = response.output_text;
  if (!text) throw new Error("OpenAI returned empty response");
  return text;
}

export async function callGroq(
  config: LLMProviderConfig,
  prompt: string,
  signal: AbortSignal,
  systemInstruction: string,
): Promise<string> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || "https://api.groq.com/openai/v1",
  });

  const response = await client.responses.create(
    {
      model: config.model,
      instructions: systemInstruction,
      input: prompt,
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    },
    { signal },
  );

  const text = response.output_text;
  if (!text) throw new Error("Groq returned empty response");
  return text;
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
