import { Bot, ChevronDown } from "lucide-react";
import { type ReactElement, useState } from "react";
import { API_BASE } from "../../lib/api.ts";

const KEEPERHUB_WATCH_PATH = "/keeperhub/marketplace/watch/call";
const KEEPERHUB_WORKFLOW_SLUG = "chronicleai-paid-onchain-watch-v2";

export function AgentPaymentInstructions(): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const apiOrigin = API_BASE.replace(/\/+$/, "");

  return (
    <div
      className="mt-4 rounded-xl border border-border bg-muted/40"
      data-testid="watch-agent-instructions"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] focus:ring-inset"
        aria-expanded={isOpen}
        aria-controls="watch-agent-instructions-panel"
        onClick={() => setIsOpen((open) => !open)}
        data-testid="watch-agent-instructions-toggle"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <Bot className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>Agent access · MPP</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <div
          id="watch-agent-instructions-panel"
          className="border-t border-border px-4 pb-4 pt-3 text-xs leading-relaxed text-muted-foreground"
          data-testid="watch-agent-instructions-panel"
        >
          <p className="m-0 max-w-3xl">
            MPP is the machine payment route for the KeeperHub Marketplace workflow. Humans still
            use the wallet checkout above; agents call the same Watch workflow with a Tempo MPP
            credential.
          </p>

          <ol className="mt-3 grid gap-3 pl-4 marker:font-semibold marker:text-foreground">
            <li>
              <span className="font-semibold text-foreground">Human handoff:</span> open{" "}
              <a
                href="https://t.me/chronicleai_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
              >
                @chronicleai_bot
              </a>
              , send <code>/start</code>, and give the returned Telegram binding code to the agent
              over a private channel. The code is required so alerts reach the right Telegram chat;
              do not put it in public prompts, logs, or source control.
            </li>
            <li>
              <span className="font-semibold text-foreground">Start the workflow:</span>{" "}
              <code className="break-all text-foreground">POST {KEEPERHUB_WATCH_PATH}</code> with
              the Watch fields below and the human-provided <code>telegramBindingCode</code>. The
              first request has no payment header; KeeperHub returns a 402 with a{" "}
              <code>WWW-Authenticate: Payment ...</code> MPP challenge.
            </li>
            <li>
              <span className="font-semibold text-foreground">Pay and retry:</span> use an
              MPP-compatible agent client to answer that Tempo charge challenge, then retry the same
              request with <code>Authorization: Payment &lt;credential&gt;</code>. KeeperHub
              verifies the credential and returns a <code>Payment-Receipt</code>; keep the MPP
              client secret or account configuration in the agent runtime, never in this browser UI.
            </li>
          </ol>

          <div className="mt-3 rounded-lg border border-border bg-frame px-3 py-2.5">
            <p className="m-0 font-medium text-foreground">Agent request shape</p>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
              {JSON.stringify(
                {
                  targetContract: "0xYourTargetAddress",
                  targetKind: "contract",
                  focusKey: "none",
                  durationHours: 1,
                  visibility: "private",
                  telegramBindingCode: "<human-provided-code>",
                },
                null,
                2,
              )}
            </pre>
          </div>

          <p className="mt-3 mb-0">
            The canonical KeeperHub Marketplace workflow is{" "}
            <code className="break-all text-foreground">{KEEPERHUB_WORKFLOW_SLUG}</code> on Base
            Mainnet. API base for this deployment:{" "}
            <code className="break-all text-foreground">{apiOrigin}</code>.
          </p>
        </div>
      ) : null}
    </div>
  );
}
