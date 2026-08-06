// Agent-facing dual-rail discovery — MPP is API-native; this panel makes it findable.
// Humans still checkout via x402 in PaymentChallengePanel.

import type { AgentPaymentsDiscovery } from "@chronicleai/schemas";
import { type ReactElement, useCallback, useEffect, useId, useMemo, useState } from "react";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { formatPaymentRoute, sortPaymentRoutes } from "./payment-route-labels.ts";
import { ChevronDown, ChevronUp, Code2, Cpu, ExternalLink, Globe, Network, ShieldCheck, Terminal } from "lucide-react";

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
    {
      id: "auto",
      label: "Auto Dual-Route (auto)",
      audience: "dual",
      verificationType: "auto_selected_x402_or_mpp",
      currency: "USDC",
      network: "Auto-negotiated (Base/Sepolia for x402, Tempo for MPP)",
      description: "Auto-selects payment rail based on request context.",
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

  // Determine grid columns dynamically based on routes count for perfect symmetry
  const gridColsClass =
    discovery.routes.length === 3
      ? "grid-cols-1 md:grid-cols-3"
      : discovery.routes.length === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : "grid-cols-1 sm:grid-cols-2 md:grid-cols-4";

  const baseUrl = API_BASE.replace(/\/+$/, "");

  return (
    <section
      data-testid={dataTestId}
      aria-labelledby={titleId}
      className="rounded-2xl border border-border bg-card/60 backdrop-blur-md p-6 sm:p-7 shadow-lg shadow-black/5"
    >
      {/* Header section */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4 border-b border-border/50 pb-5">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {routeIds.map((id) => {
              const display = formatPaymentRoute(id);
              return (
                <StatusBadge key={id} label={display.badge} variant={display.badgeVariant} />
              );
            })}
            <div className="h-3.5 w-px bg-border/60 mx-1 hidden sm:block" />
            <StatusBadge
              label={source === "live" ? "Live discovery" : "Cached guide"}
              variant={source === "live" ? "success" : "default"}
            />
          </div>
          <div>
            <h2
              id={titleId}
              className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2 leading-tight"
            >
              <Cpu className="w-5 h-5 text-primary shrink-0" />
              Machine payments
            </h2>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed max-w-3xl">
              People unlock reports with a wallet. Automated agents can buy the same items through
              the API using <span className="font-semibold text-foreground">MPP</span>. The guide below
              shows the exact machine-to-machine flow.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-muted/30 hover:bg-muted/70 text-sm font-medium text-foreground transition-all duration-200 cursor-pointer shadow-sm hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
          data-testid="agent-payments-toggle"
        >
          <Terminal className="w-4 h-4 text-primary" />
          <span>{open ? "Hide API guide" : "Show API guide"}</span>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
      </div>

      {/* Symmetrical Payment Rail Cards */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Network className="w-3.5 h-3.5 text-primary" />
            Available Payment Rails
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            {discovery.routes.length} Active Rails
          </span>
        </div>

        <div className={`grid ${gridColsClass} gap-4 items-stretch`}>
          {discovery.routes.map((route) => {
            const display = formatPaymentRoute(route.id);
            return (
              <div
                key={route.id}
                className="group relative rounded-xl border border-border/80 bg-background/60 hover:bg-background/90 hover:border-primary/50 transition-all duration-200 p-4 flex flex-col justify-between gap-3 shadow-xs hover:shadow-md"
                data-testid={`agent-rail-${route.id}`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge label={display.badge} variant={display.badgeVariant} />
                    <span className="text-[11px] font-mono font-medium text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-md border border-border/30">
                      {route.id.toUpperCase()}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                      {route.label}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5 font-medium leading-snug">
                      {display.audience}
                    </p>
                  </div>
                </div>

                <div className="pt-2 border-t border-border/40 space-y-1 text-[11px] text-muted-foreground font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground/70">Network</span>
                    <span className="font-semibold text-foreground/90 truncate max-w-[150px]">{route.network}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground/70">Auth Type</span>
                    <span className="font-semibold text-foreground/90 truncate max-w-[150px]">{route.verificationType}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground/70">Currency</span>
                    <span className="font-semibold text-primary">{route.currency}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Symmetrical Discovery Endpoints Section */}
      <div className="mt-5 rounded-xl border border-border/60 bg-muted/20 p-4">
        <div className="flex items-center gap-2 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Globe className="w-3.5 h-3.5 text-primary" />
          Discovery Endpoints
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
          <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-background/50 hover:border-primary/30 transition-colors">
            <span className="text-muted-foreground truncate">GET /payments</span>
            <a
              href={`${baseUrl}/payments`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline ml-2 shrink-0"
            >
              <span>View JSON</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-background/50 hover:border-primary/30 transition-colors">
            <span className="text-muted-foreground truncate">GET /.well-known/agent-payments</span>
            <a
              href={`${baseUrl}/.well-known/agent-payments`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline ml-2 shrink-0"
            >
              <span>View JSON</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>

      {/* Expanded API Guide Drawer */}
      {open ? (
        <div
          className="mt-6 pt-6 border-t border-border space-y-6"
          data-testid="agent-payments-guide"
        >
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              MPP Execution Protocol
            </h3>
            <div className="grid grid-cols-1 gap-2">
              {discovery.mpp.steps.map((step, idx) => (
                <div
                  key={step}
                  className="flex items-start gap-3 p-3 rounded-xl border border-border/40 bg-background/40"
                >
                  <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-primary/10 text-primary font-mono text-xs font-bold shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <p className="text-xs text-muted-foreground leading-relaxed font-mono pt-0.5">
                    {step}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Code2 className="w-4 h-4 text-primary" />
              Example Requests (cURL)
            </h3>
            <div className="grid grid-cols-1 gap-4">
              {(
                [
                  ["1. Create MPP challenge", curls.challenge],
                  ["2. Settle with HMAC", curls.settle],
                  ["3. Access with receipt", curls.access],
                ] as const
              ).map(([title, code]) => (
                <div key={title} className="space-y-1.5">
                  <p className="text-xs font-semibold text-foreground/90 font-mono flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                    {title}
                  </p>
                  <pre className="text-xs font-mono leading-relaxed p-4 rounded-xl border border-border/60 bg-muted/40 overflow-x-auto text-foreground whitespace-pre-wrap break-all shadow-inner">
                    {code}
                  </pre>
                </div>
              ))}
            </div>
          </div>

          {discovery.mpp.notes.length > 0 ? (
            <div className="rounded-xl border border-border/40 bg-muted/15 p-4 space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Integration Notes
              </span>
              <ul className="space-y-1.5 text-xs text-muted-foreground leading-relaxed">
                {discovery.mpp.notes.map((note) => (
                  <li key={note} className="flex gap-2">
                    <span className="text-primary font-bold shrink-0" aria-hidden>
                      •
                    </span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground leading-relaxed pt-2 border-t border-border/40 flex items-center justify-between flex-wrap gap-2">
            <span>
              {discovery.humanUi.note} Full machine specification is also available at{" "}
              <a
                href="/llms.txt"
                className="text-primary font-semibold underline underline-offset-2 hover:text-primary/80 transition-colors"
              >
                /llms.txt
              </a>
              .
            </span>
          </p>
        </div>
      ) : null}
    </section>
  );
}
