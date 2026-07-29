/**
 * Hard input-token budget for Groq.
 *
 * Groq free/dev tiers commonly reject requests above ~8k input tokens.
 * Every Groq-bound path must go through these helpers (or the model wrapper
 * in models.ts) so nothing can inject more than GROQ_MAX_INPUT_TOKENS.
 */

/** Absolute hard cap on estimated input tokens sent to Groq. */
export const GROQ_MAX_INPUT_TOKENS = 8000;

/**
 * Safety margin for role markers, response_format overhead, and estimator drift.
 * Effective budget = 8000 - margin.
 */
export const GROQ_INPUT_SAFETY_MARGIN = 250;

/** Default budget applied before a Groq request leaves the process. */
export const GROQ_EFFECTIVE_INPUT_BUDGET =
  GROQ_MAX_INPUT_TOKENS - GROQ_INPUT_SAFETY_MARGIN;

/**
 * Conservative ceiling used by structured agents for non-Groq providers too.
 * Kept below GROQ_MAX so mixed fallback chains stay safe if a call is mis-routed.
 */
export const MAX_SAFE_INPUT_TOKENS = GROQ_EFFECTIVE_INPUT_BUDGET;

const TRUNCATION_NOTICE =
  "\n\n[Context truncated to enforce 8000 token Groq input limit]";

/** Per-message role/framing overhead in the chat-completions wire format. */
const PER_MESSAGE_OVERHEAD_TOKENS = 6;

/**
 * Conservative token estimate.
 * ~3 chars/token under-counts rarely for English + JSON + hex (safer than 4).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3);
}

/** Flatten LangChain-style message content to plain text for budgeting. */
export function contentToBudgetText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        if (part && typeof part === "object") {
          try {
            return JSON.stringify(part);
          } catch {
            return String(part);
          }
        }
        return "";
      })
      .join("");
  }
  if (typeof content === "object") {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  return String(content);
}

/**
 * Truncate a single string so estimateTokens(result) <= maxTokens.
 * Appends a short notice when truncation occurs (notice fits inside the budget).
 */
export function fitTextToTokenBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;

  const noticeTokens = estimateTokens(TRUNCATION_NOTICE);
  const bodyBudget = Math.max(0, maxTokens - noticeTokens);
  if (bodyBudget <= 0) {
    // Budget too small for notice — hard slice only.
    const hardChars = Math.max(0, maxTokens * 3);
    return text.slice(0, hardChars);
  }

  const bodyChars = Math.max(0, bodyBudget * 3);
  return text.slice(0, bodyChars) + TRUNCATION_NOTICE;
}

/**
 * Fit system + optional schema hint + user so total estimated tokens stay
 * strictly within maxInputTokens. Truncates user first; truncates system if
 * system alone still overflows.
 */
export function fitPromptToTokenBudget(
  userPrompt: string,
  systemPrompt: string,
  schemaHint = "",
  maxInputTokens = MAX_SAFE_INPUT_TOKENS,
): string {
  const systemTokens = estimateTokens(systemPrompt);
  const schemaTokens = estimateTokens(schemaHint);
  const overhead = systemTokens + schemaTokens + PER_MESSAGE_OVERHEAD_TOKENS * 2;
  const allowedUserTokens = maxInputTokens - overhead;

  if (allowedUserTokens < 64) {
    // System/schema already consume (almost) the whole budget — return a stub.
    return fitTextToTokenBudget(
      userPrompt,
      Math.max(32, Math.min(64, maxInputTokens)),
    );
  }

  if (estimateTokens(userPrompt) <= allowedUserTokens) {
    return userPrompt;
  }

  return fitTextToTokenBudget(userPrompt, allowedUserTokens);
}

/**
 * Fit both system and user prompts so their combined estimate is <= maxInputTokens.
 * Prefer keeping system intact; shrink user first; shrink system only if required.
 */
export function fitSystemAndUserToTokenBudget(
  systemPrompt: string,
  userPrompt: string,
  maxInputTokens = GROQ_EFFECTIVE_INPUT_BUDGET,
): { systemPrompt: string; userPrompt: string } {
  const overhead = PER_MESSAGE_OVERHEAD_TOKENS * 2;
  const budget = Math.max(64, maxInputTokens - overhead);

  let system = systemPrompt;
  let user = userPrompt;

  const systemTokens = estimateTokens(system);
  const userTokens = estimateTokens(user);

  if (systemTokens + userTokens <= budget) {
    return { systemPrompt: system, userPrompt: user };
  }

  // Prefer truncating user content.
  const userBudget = budget - systemTokens;
  if (userBudget >= 64) {
    return {
      systemPrompt: system,
      userPrompt: fitTextToTokenBudget(user, userBudget),
    };
  }

  // System alone is too large — split remaining budget ~70/30 system/user.
  const systemBudget = Math.max(128, Math.floor(budget * 0.7));
  const remainingForUser = Math.max(64, budget - systemBudget);
  system = fitTextToTokenBudget(system, systemBudget);
  user = fitTextToTokenBudget(user, remainingForUser);
  return { systemPrompt: system, userPrompt: user };
}

type BudgetMessage = {
  role?: string | undefined;
  content?: unknown;
  [key: string]: unknown;
};

function messageTokens(message: unknown): number {
  if (message == null) return 0;
  if (typeof message === "string") {
    return estimateTokens(message) + PER_MESSAGE_OVERHEAD_TOKENS;
  }
  if (typeof message !== "object") {
    return estimateTokens(String(message)) + PER_MESSAGE_OVERHEAD_TOKENS;
  }
  return (
    estimateTokens(contentToBudgetText((message as BudgetMessage).content)) +
    PER_MESSAGE_OVERHEAD_TOKENS
  );
}

function withTruncatedContent(message: unknown, maxContentTokens: number): unknown {
  if (typeof message === "string") {
    return fitTextToTokenBudget(message, maxContentTokens);
  }
  if (!message || typeof message !== "object") {
    return fitTextToTokenBudget(String(message ?? ""), maxContentTokens);
  }

  const original = message as BudgetMessage;
  const text = contentToBudgetText(original.content);
  const fitted = fitTextToTokenBudget(text, maxContentTokens);

  // Prefer plain-string content after truncation (LangChain accepts it).
  if (typeof (message as { content?: unknown }).content === "string") {
    // Mutable in-place when possible so class instances (HumanMessage, etc.) keep methods.
    try {
      (message as { content: string }).content = fitted;
      return message;
    } catch {
      return { ...original, content: fitted };
    }
  }

  try {
    (message as { content: string }).content = fitted;
    return message;
  } catch {
    return { ...original, content: fitted };
  }
}

function isSystemMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const m = message as BudgetMessage & {
    getType?: () => string;
    _getType?: () => string;
    type?: string;
  };
  const role = (m.role ?? "").toLowerCase();
  if (role === "system") return true;
  const type =
    m.getType?.() ?? m._getType?.() ?? (typeof m.type === "string" ? m.type : "");
  return type === "system";
}

/**
 * Cap a chat message list so total estimated input tokens <= maxTokens.
 *
 * Strategy:
 * 1. Keep all system messages (truncate their bodies only if required).
 * 2. Drop oldest non-system messages first (keep the latest turn).
 * 3. Truncate remaining message bodies from oldest to newest until under budget.
 */
export function fitMessageArrayToTokenBudget<T>(
  messages: T[],
  maxTokens: number = GROQ_EFFECTIVE_INPUT_BUDGET,
): T[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  if (maxTokens <= 0) return [];

  let total = messages.reduce((sum, m) => sum + messageTokens(m), 0);
  if (total <= maxTokens) return messages;

  const systemIdx: number[] = [];
  const nonSystemIdx: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (isSystemMessage(messages[i])) systemIdx.push(i);
    else nonSystemIdx.push(i);
  }

  // Drop oldest non-system messages first, always keep the last non-system if any.
  const keep = new Set<number>([
    ...systemIdx,
    ...nonSystemIdx.slice(-1), // latest turn
  ]);
  // Re-add newer non-system messages while budget allows (walk from end).
  for (let i = nonSystemIdx.length - 2; i >= 0; i--) {
    const idx = nonSystemIdx[i]!;
    const nextTotal =
      [...keep].reduce((sum, j) => sum + messageTokens(messages[j]), 0) +
      messageTokens(messages[idx]);
    if (nextTotal <= maxTokens) {
      keep.add(idx);
    }
  }

  let working = messages.filter((_, i) => keep.has(i));
  total = working.reduce((sum, m) => sum + messageTokens(m), 0);
  if (total <= maxTokens) return working;

  // Still over: truncate bodies. Non-system first (oldest → newest), then system.
  const truncateOrder = [
    ...working.map((m, i) => ({ m, i, system: isSystemMessage(m) })).filter((x) => !x.system),
    ...working.map((m, i) => ({ m, i, system: isSystemMessage(m) })).filter((x) => x.system),
  ];

  const out = working.slice() as T[];
  for (const { i } of truncateOrder) {
    total = out.reduce((sum, m) => sum + messageTokens(m), 0);
    if (total <= maxTokens) break;

    const overflow = total - maxTokens;
    const current = messageTokens(out[i]);
    const contentBudget = Math.max(
      32,
      current - PER_MESSAGE_OVERHEAD_TOKENS - overflow,
    );
    out[i] = withTruncatedContent(out[i], contentBudget) as T;
  }

  // Final hard guarantee: if still over (pathological), slice last message only.
  total = out.reduce((sum, m) => sum + messageTokens(m), 0);
  if (total > maxTokens && out.length > 0) {
    const last = out.length - 1;
    const others = out
      .slice(0, last)
      .reduce((sum, m) => sum + messageTokens(m), 0);
    const lastBudget = Math.max(32, maxTokens - others - PER_MESSAGE_OVERHEAD_TOKENS);
    out[last] = withTruncatedContent(out[last], lastBudget) as T;
  }

  return out;
}

/**
 * Cap any value LangChain might pass to model.invoke / stream / batch / _generate.
 */
export function capModelInputToGroqBudget(
  input: unknown,
  maxTokens: number = GROQ_EFFECTIVE_INPUT_BUDGET,
): unknown {
  if (input == null) return input;

  if (typeof input === "string") {
    return fitTextToTokenBudget(input, maxTokens);
  }

  if (Array.isArray(input)) {
    return fitMessageArrayToTokenBudget(input, maxTokens);
  }

  // Single message-like object
  if (typeof input === "object" && input !== null && "content" in input) {
    const [fitted] = fitMessageArrayToTokenBudget(
      [input as BudgetMessage],
      maxTokens,
    );
    return fitted;
  }

  // LangChain sometimes wraps as { messages: [...] }
  if (
    typeof input === "object" &&
    input !== null &&
    "messages" in input &&
    Array.isArray((input as { messages: unknown }).messages)
  ) {
    const messages = (input as { messages: unknown[] }).messages;
    return {
      ...(input as Record<string, unknown>),
      messages: fitMessageArrayToTokenBudget(messages, maxTokens),
    };
  }

  return input;
}

/**
 * True when estimated tokens for the given texts exceed the Groq hard cap.
 * Useful for call-site guards and tests.
 */
export function exceedsGroqInputLimit(
  parts: string[],
  maxTokens: number = GROQ_MAX_INPUT_TOKENS,
): boolean {
  const total =
    parts.reduce((sum, p) => sum + estimateTokens(p), 0) +
    parts.length * PER_MESSAGE_OVERHEAD_TOKENS;
  return total > maxTokens;
}
