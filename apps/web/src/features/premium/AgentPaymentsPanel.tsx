// Agent-facing dual-rail discovery — MPP is API-native; this panel makes it findable.
// Humans still checkout via x402 in PaymentChallengePanel.

import type { AgentPaymentsDiscovery } from "@chronicleai/schemas";
import { type ReactElement, useCallback, useEffect, useId, useMemo, useState } from "react";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { formatPaymentRoute, sortPaymentRoutes } from "./payment-route-labels.ts";

import { API_BASE, fetchWithTimeout } from "../../lib/api.ts";

const FALLBACK_DISCOVERY: AgentPaymentsDiscovery = {
  version: "1",
  name: "ChronicleAI Premium Payments",
  description:
    "Dual-rail micropayments for premium intelligence and sponsored contract watches. Humans pay with x402 (wallet USDC). Machines pay with MPP (HMAC on Tempo).",
  routes: [
    {
      id: "x402",
      label: "x402 (wallet)",
      audience: "human",
      verificationType: "eip712_transfer_with_authorization",
      currency: "USDC",
      network: "Ethereum Sepolia (configurable)",
      description: "Browser wallet path on the /premium UI.",
    },
    {
      id: "mpp",
      label: "MPP (agent)",
      audience: "machine",
      verificationType: "hmac_sha256",
      currency: "USDC",
      network: "Tempo",
      description:
        "Machine path: challenge → HMAC settle → access receipt. Not offered as a browser checkout.",
    },
  ],
  endpoints: {
    discovery: "GET /payments",
    wellKnown: "GET /.well-known/agent-payments",
    listPremiumItems: "GET /premium/items",
    accessPremiumItem: "GET /premium/items/:id",
    createChallenge: "POST /payments/challenges",
    settlePayment: "POST /payments/settlements",
    createSponsoredWatchChallenge: "POST /payments/sponsored-watch/challenges",
    listSponsoredWatches: "GET /premium/watches",
  },
  mpp: {
    summary:
      "List teasers → POST challenge with paymentRoute=mpp → HMAC settle → access with receipt.",
    steps: [
      "GET /premium/items — read paymentRoutes on each teaser.",
      'POST /payments/challenges with paymentRoute: "mpp".',
      "HMAC-SHA256 the challengeData.hmacPayloadTemplate with the shared secret.",
      "POST /payments/settlements with settlementReference = expiresAt:hmac_hex.",
      "GET /premium/items/:id with Authorization: Bearer <accessReceipt>.",
    ],
    challengeRequest: {
      method: "POST",
      path: "/payments/challenges",
      body: {
        premiumItemId: "<item-id>",
        paymentRoute: "mpp",
        payerReference: "0xYourEvmAddress",
      },
    },
    settleRequest: {
      method: "POST",
      path: "/payments/settlements",
      body: {
        challengeReference: "<from challenge>",
        settlementReference: "<expiresAt>:<hmac_hex>",
        paymentRoute: "mpp",
        amountSettled: 0,
        currency: "USDC",
      },
      settlementReferenceFormat:
        "expiresAt:hmac where hmac = hex(HMAC-SHA256(secret, hmacPayloadTemplate))",
    },
    accessRequest: {
      method: "GET",
      path: "/premium/items/:id",
      headers: {
        Authorization: "Bearer <accessReceipt>",
      },
    },
    notes: [
      "MPP is intentionally not a browser wallet flow. Agents hold the shared secret out of band.",
      "Prefer an EVM payerReference so revenue routing can attribute on-chain.",
    ],
  },
  humanUi: {
    path: "/premium",
    paymentRoute: "x402",
    note: "Web checkout is x402-only; agents use this API flow for MPP.",
  },
};

interface AgentPaymentsPanelProps {
  /** When true, expand the technical section by default (e.g. after dual-CTA click). */
  defaultOpen?: boolean;
  /** Optional controlled open state from parent. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  "data-testid"?: string;
}

function buildCurlExamples(apiBase: string): { challenge: string; settle: string; access: string } {
  const base = apiBase.replace(/\/+$/, "");
  return {
    challenge: `curl -sS -X POST "${base}/payments/challenges" \\
  -H "Content-Type: application/json" \\
  -d '{
    "premiumItemId": "<item-id>",
    "paymentRoute": "mpp",
    "payerReference": "0xYourEvmAddress"
  }'`,
    settle: `curl -sS -X POST "${base}/payments/settlements" \\
  -H "Content-Type: application/json" \\
  -d '{
    "challengeReference": "<from-challenge>",
    "settlementReference": "<expiresAt>:<hmac_hex>",
    "paymentRoute": "mpp",
    "amountSettled": <amount>,
    "currency": "USDC"
  }'`,
    access: `curl -sS "${base}/premium/items/<item-id>" \\
  -H "Authorization: Bearer <accessReceipt>"`,
  };
}

export function AgentPaymentsPanel({
  defaultOpen = false,
  open: openControlled,
  onOpenChange,
  "data-testid": dataTestId = "agent-payments-panel",
}: AgentPaymentsPanelProps): ReactElement {
  const titleId = useId();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = openControlled ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (openControlled === undefined) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [onOpenChange, openControlled],
  );

  const [discovery, setDiscovery] = useState<AgentPaymentsDiscovery>(FALLBACK_DISCOVERY);
  const [source, setSource] = useState<"live" | "fallback">("fallback");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetchWithTimeout(`${API_BASE}/payments`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const body = (await res.json()) as AgentPaymentsDiscovery;
        if (body?.version === "1" && Array.isArray(body.routes)) {
          setDiscovery(body);
          setSource("live");
        }
      } catch {
        // Keep static fallback — panel must work offline / if API is down.
      }
    })();
    return () => controller.abort();
  }, []);

  const curls = useMemo(() => buildCurlExamples(API_BASE), []);
  const routeIds = sortPaymentRoutes(discovery.routes.map((r) => r.id));

  return (
    <section
      data-testid={dataTestId}
      aria-labelledby={titleId}
      className="rounded-2xl border border-border bg-frame p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {routeIds.map((id) => {
              const display = formatPaymentRoute(id);
              return (
                <StatusBadge key={id} label={display.badge} variant={display.badgeVariant} />
              );
            })}
            <StatusBadge
              label={source === "live" ? "Live discovery" : "Cached guide"}
              variant={source === "live" ? "success" : "default"}
            />
          </div>
          <h2
            id={titleId}
            className="text-base font-semibold text-foreground leading-snug text-balance"
          >
            Machine payments
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed max-w-2xl text-pretty">
            People unlock reports with a wallet. Automated agents can buy the same items through
            the API using <span className="font-medium text-foreground">MPP</span>. The guide below
            shows the exact machine-to-machine flow.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="shrink-0 px-3.5 py-2 rounded-xl border border-border bg-muted/40 text-sm font-medium text-foreground hover:border-accent/40 hover:bg-muted transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-expanded={open}
          data-testid="agent-payments-toggle"
        >
          {open ? "Hide API guide" : "Show API guide"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {discovery.routes.map((route) => {
          const display = formatPaymentRoute(route.id);
          return (
            <div
              key={route.id}
              className="rounded-xl border border-border bg-background/50 p-3.5"
              data-testid={`agent-rail-${route.id}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <StatusBadge label={display.badge} variant={display.badgeVariant} />
                <span className="text-xs text-muted-foreground">{display.audience}</span>
              </div>
              <p className="text-sm text-foreground font-medium">{route.label}</p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {route.network} · {route.verificationType} · {route.currency}
              </p>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-muted-foreground font-mono break-all">
        Discovery: {API_BASE.replace(/\/+$/, "")}/payments ·{" "}
        {API_BASE.replace(/\/+$/, "")}/.well-known/agent-payments
      </p>

      {open ? (
        <div
          className="mt-5 pt-5 border-t border-border space-y-5"
          data-testid="agent-payments-guide"
        >
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-2">MPP flow</h3>
            <ol className="list-decimal list-outside ml-4 space-y-1.5 text-sm text-muted-foreground leading-relaxed">
              {discovery.mpp.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Example requests</h3>
            {(
              [
                ["1. Create MPP challenge", curls.challenge],
                ["2. Settle with HMAC", curls.settle],
                ["3. Access with receipt", curls.access],
              ] as const
            ).map(([title, code]) => (
              <div key={title}>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">{title}</p>
                <pre className="text-xs font-mono leading-relaxed p-3 rounded-xl border border-border bg-muted/30 overflow-x-auto text-foreground whitespace-pre-wrap break-all">
                  {code}
                </pre>
              </div>
            ))}
          </div>

          {discovery.mpp.notes.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground leading-relaxed">
              {discovery.mpp.notes.map((note) => (
                <li key={note} className="flex gap-2">
                  <span className="text-accent shrink-0" aria-hidden>
                    ·
                  </span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="text-xs text-muted-foreground leading-relaxed">
            {discovery.humanUi.note} Full machine doc also at{" "}
            <a
              href="/llms.txt"
              className="text-foreground underline underline-offset-2 hover:text-accent transition-colors"
            >
              /llms.txt
            </a>
            .
          </p>
        </div>
      ) : null}
    </section>
  );
}
