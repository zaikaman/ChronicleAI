import {
  type FormEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Spinner } from "../../components/ui/spinner.tsx";
import type { AgentChatMessage } from "./use-affiliate.ts";

const INLINE_MARKDOWN_PATTERN = /(\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;

function renderAffiliateMessage(content: string): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of content.matchAll(INLINE_MARKDOWN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push(content.slice(cursor, index));
    }

    const token = match[0];
    if (token.startsWith("[")) {
      nodes.push(
        <a
          key={`message-link-${nodes.length}`}
          href={match[5]}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:opacity-80"
        >
          {match[4]}
        </a>,
      );
    } else {
      nodes.push(
        <strong key={`message-bold-${nodes.length}`} className="font-semibold">
          {match[2] ?? match[3]}
        </strong>,
      );
    }

    cursor = index + token.length;
  }

  if (cursor < content.length) {
    nodes.push(content.slice(cursor));
  }

  return nodes;
}

interface AffiliateAgentChatProps {
  messages: AgentChatMessage[];
  isSending: boolean;
  error: string | null;
  disabled?: boolean;
  onSend: (message: string) => void;
}

export function AffiliateAgentChat({
  messages,
  isSending,
  error,
  disabled,
  onSend,
}: AffiliateAgentChatProps): ReactElement {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  // Scroll only inside the chat panel — never the page (scrollIntoView jumps the viewport).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isSending]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || isSending || disabled) return;
    const text = draft.trim();
    setDraft("");
    onSend(text);
  };

  const quick = (text: string) => {
    if (isSending || disabled) return;
    onSend(text);
  };

  return (
    <div
      className="flex flex-col rounded-2xl border border-border bg-frame overflow-hidden min-h-[28rem]"
      data-testid="affiliate-agent-chat"
    >
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Payout agent</h3>
          <p className="text-xs text-muted-foreground">
            LLM agent with tools — withdrawals execute on-chain via KeeperHub
          </p>
        </div>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
          LLM + KeeperHub
        </span>
      </div>

      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3 min-h-[16rem]"
      >
        {messages.map((m, i) => (
          <div
            key={`${m.role}-${i}`}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words ${
                m.role === "user"
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground border border-border"
              }`}
            >
              {m.role === "assistant" ? renderAffiliateMessage(m.content) : m.content}
            </div>
          </div>
        ))}
        {isSending ? (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm bg-muted text-muted-foreground border border-border">
              <Spinner size="xs" label="Agent is working" />
              <span>Agent is working…</span>
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="px-4 text-xs text-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="px-3 pb-2 flex flex-wrap gap-1.5">
        {["Show my stats", "What's my balance?", "Withdraw all"].map((label) => (
          <button
            key={label}
            type="button"
            disabled={disabled || isSending}
            onClick={() => quick(label)}
            className="text-xs px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-50 transition-colors"
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="p-3 border-t border-border flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled || isSending}
          placeholder={disabled ? "Connect a wallet to chat" : "Ask the agent…"}
          className="flex-1 min-w-0 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Message to payout agent"
        />
        <button
          type="submit"
          disabled={disabled || isSending || !draft.trim()}
          className="shrink-0 rounded-xl bg-foreground text-background px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity inline-flex items-center gap-2"
        >
          {isSending ? <Spinner size="xs" label="Sending" /> : null}
          {isSending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}
