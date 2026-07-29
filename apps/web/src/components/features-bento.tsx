import { motion, type Transition } from "motion/react";
import { CircleCheck, Star, Shield, Landmark, Unlock, Check, Activity } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAgentActivity } from "../features/activity/use-agent-activity.ts";
import { useAlerts } from "../features/alerts/use-alerts.ts";
import { formatHealthFactor, formatUsdc, strategyLabel } from "../features/desk/format.ts";
import { useDeskStatus } from "../features/desk/use-desk.ts";
import { truncateHash } from "../lib/explorer.ts";

const EASE = [0.23, 1, 0.32, 1] as const;

const cardAnimation = {
  initial: { opacity: 0, y: 40 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-100px" },
};

const getCardTransition = (delay = 0): Transition => ({
  duration: 0.8,
  ease: EASE,
  delay,
});

function StepByStepCard({
  latestAlert,
}: {
  latestAlert: { id: string; title: string; summary: string; protocol?: string } | null;
}): ReactNode {
  const headline = latestAlert?.title ?? "Awaiting first signal";
  const body = latestAlert
    ? latestAlert.summary.length > 100
      ? `${latestAlert.summary.slice(0, 100)}…`
      : latestAlert.summary
    : "KeeperHub watches gas spikes, trades, liquidations, and contract deployments. Live alerts appear here when published.";

  return (
    <motion.div
      {...cardAnimation}
      transition={getCardTransition(0)}
      className="group flex h-full min-h-80 flex-col justify-between overflow-hidden rounded-4xl bg-card-primary p-8"
    >
      <div className="relative z-10 transition-transform duration-500 ease-out group-hover:scale-105">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-black/10 px-3 py-1 text-xs font-semibold text-neutral-900">
          <Activity className="h-3.5 w-3.5" /> Live Monitoring
        </div>
        <h3 className="mb-2 text-2xl font-medium leading-tight text-neutral-900 md:text-3xl">
          Autonomous event monitoring
        </h3>
        <p className="text-sm text-neutral-700">
          KeeperHub watches gas, swaps, liquidations, and deployments — then Chronicle publishes plain-language alerts.
        </p>
      </div>

      <div className="mt-6 rounded-2xl bg-neutral-950 p-4 text-white shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wider text-accent font-semibold">
            {latestAlert ? "Latest published alert" : "Live feed"}
          </p>
          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-mono text-accent">
            KeeperHub
          </span>
        </div>
        <h4 className="mt-2 line-clamp-1 text-sm font-semibold text-white">
          {headline}
        </h4>
        <p className="mt-1 line-clamp-2 text-xs text-white/60">{body}</p>
      </div>
    </motion.div>
  );
}

function DeskCard({
  equityUsdc,
  healthFactor,
  statusLabel,
  lastAgentLine,
}: {
  equityUsdc: number | null;
  healthFactor: number | null;
  statusLabel: string;
  lastAgentLine: string | null;
}): ReactNode {
  return (
    <motion.div
      {...cardAnimation}
      transition={getCardTransition(0.1)}
      className="group flex h-full min-h-80 flex-col justify-between overflow-hidden rounded-4xl bg-card-secondary p-8"
    >
      <div className="relative z-10 transition-transform duration-500 ease-out group-hover:scale-105">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
          <Landmark className="h-3.5 w-3.5" /> Closed-Loop Desk
        </div>
        <h3 className="mb-2 text-xl font-medium leading-tight text-card-foreground md:text-2xl">
          Policy-gated trading desk
        </h3>
        <p className="text-sm text-card-foreground-muted">
          LLM proposes. Hard policy disposes. KeeperHub executes risk defend, yield rotation, and oracle–AMM legs on Sepolia.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
          <p className="text-[10px] uppercase text-neutral-400 font-medium">Desk Equity</p>
          <p className="mt-1 text-base font-semibold font-mono text-white">
            {formatUsdc(equityUsdc)}
          </p>
          <span className="mt-1 inline-block rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-black">
            {statusLabel}
          </span>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
          <p className="text-[10px] uppercase text-neutral-400 font-medium">Health Factor</p>
          <p className="mt-1 text-base font-semibold font-mono text-accent">
            {formatHealthFactor(healthFactor)}
          </p>
          <p className="mt-1 truncate text-[10px] text-white/60">
            {lastAgentLine ?? "Standing by"}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function PreflightCctpCard(): ReactNode {
  return (
    <motion.div
      {...cardAnimation}
      transition={getCardTransition(0.15)}
      className="group flex h-full min-h-80 flex-col justify-between overflow-hidden rounded-4xl bg-card-secondary p-8"
    >
      <div className="transition-transform duration-500 ease-out group-hover:scale-105">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
          <Shield className="h-3.5 w-3.5" /> Smart Gas &amp; CCTP V2
        </div>
        <h3 className="mb-2 text-xl font-medium leading-tight text-card-foreground md:text-2xl">
          Preflight &amp; CCTP Bridge
        </h3>
        <p className="text-sm text-card-foreground-muted">
          Layer A dry-run preflight (simulate: true) verifies execution logic before broadcast. Circle CCTP auto-rebalances USDC liquidity between Base and Sepolia.
        </p>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs font-mono text-white/90">
          Layer A Dry-Run: Verified
        </span>
        <span className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs font-mono text-accent">
          CCTP Base ➔ Sepolia
        </span>
      </div>
    </motion.div>
  );
}

function ProofCard({
  anchoredDigest,
}: {
  anchoredDigest: {
    id: string;
    title: string;
    registryTxHash?: string;
  } | null;
}): ReactNode {
  return (
    <motion.div
      {...cardAnimation}
      transition={getCardTransition(0.2)}
      className="group flex h-full min-h-80 flex-col justify-between rounded-4xl bg-card-secondary p-8"
    >
      <div className="transition-transform duration-500 ease-out group-hover:scale-105">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
          <Check className="h-3.5 w-3.5" /> Registry Proofs
        </div>
        <h3 className="mb-2 text-xl font-medium leading-tight text-card-foreground md:text-2xl">
          On-chain proofs
        </h3>
        <p className="text-sm text-card-foreground-muted">
          Digests, trade tickets, and sponsored reports anchor to ChronicleRegistry on Ethereum Sepolia via KeeperHub.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/40 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-black uppercase">
            {anchoredDigest?.registryTxHash ? "anchored" : "pending"}
          </span>
          <span className="text-[10px] font-mono text-white/50">ETHEREUM SEPOLIA</span>
        </div>
        <p className="truncate font-mono text-xs text-white">
          {anchoredDigest?.registryTxHash
            ? truncateHash(anchoredDigest.registryTxHash)
            : "Awaiting first receipt"}
        </p>
        {anchoredDigest ? (
          <Link
            to={`/digests/${anchoredDigest.id}`}
            className="text-xs font-semibold text-accent underline underline-offset-2 hover:text-accent/80"
          >
            View anchored digest
          </Link>
        ) : null}
      </div>
    </motion.div>
  );
}

function TrustedByCard({
  settledPayments,
  alertCount,
}: {
  settledPayments: number;
  alertCount: number;
}): ReactNode {
  return (
    <motion.div
      {...cardAnimation}
      transition={getCardTransition(0.25)}
      className="group flex h-full min-h-80 flex-col justify-between rounded-4xl bg-card-secondary p-8"
    >
      <div className="transition-transform duration-500 ease-out group-hover:scale-105">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
          <Star className="h-3.5 w-3.5" /> Micropayments
        </div>
        <h3 className="mb-2 text-xl font-medium leading-tight text-card-foreground md:text-2xl">
          Gated intelligence feeds
        </h3>
        <p className="text-sm text-card-foreground-muted">
          Pay-per-execution micro-subscriptions settled via x402 Base Sepolia USDC &amp; MPP Tempo dual-routing.
        </p>
      </div>

      <div className="mt-6 flex items-center justify-between rounded-2xl border border-white/10 bg-black/40 p-4">
        <div>
          <p className="text-2xl font-bold font-mono text-accent">{settledPayments}</p>
          <p className="text-xs text-white/70">
            {settledPayments === 1 ? "Settled payment" : "Settled payments"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold font-mono text-white">{alertCount}</p>
          <p className="text-xs text-white/70">Alerts published</p>
        </div>
      </div>
    </motion.div>
  );
}

function IntegrationsCard({
  treasuryStatus,
  hasKeeperHubProof: _hasProof,
  deskEquity,
}: {
  treasuryStatus: string;
  hasKeeperHubProof: boolean;
  deskEquity: number | null;
}): ReactNode {
  const stats = [
    {
      icon: <Unlock className="size-3.5 text-accent" />,
      label: "Treasury & CCTP",
      change: treasuryStatus === "unknown" ? "Base ➔ Sepolia" : `${treasuryStatus} · CCTP V2`,
    },
    {
      icon: <Landmark className="size-3.5 text-accent" />,
      label: "Desk Equity",
      change: formatUsdc(deskEquity),
    },
    {
      icon: <Shield className="size-3.5 text-accent" />,
      label: "Flashbots Private",
      change: "Strict Fail-Closed",
    },
    {
      icon: <Check className="size-3.5 text-accent" />,
      label: "Smart Gas Preflight",
      change: "Layer A Dry-Run",
    },
    {
      icon: <CircleCheck className="size-3.5 text-accent" />,
      label: "x402 / MPP Dual",
      change: "Auto-Routed",
    },
    {
      icon: <Star className="size-3.5 text-accent" />,
      label: "MCP Server Tooling",
      change: "Active Discovery",
    },
  ];

  return (
    <motion.div
      {...cardAnimation}
      transition={getCardTransition(0.3)}
      className="group flex h-full min-h-80 flex-col justify-between rounded-4xl bg-card-primary p-8"
    >
      <div className="transition-transform duration-500 ease-out group-hover:scale-105">
        <h3 className="mb-2 text-xl leading-tight font-medium text-neutral-900 md:text-2xl">
          Circular economy with a live book
        </h3>
        <p className="text-sm text-neutral-700">
          Premium revenue refills Para MPC treasury. Safety buffers fund gas &amp; top-ups; surplus routes to creators via KeeperHub.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex flex-col gap-1 rounded-xl bg-background/90 p-2.5 border border-white/5"
          >
            <div className="flex items-center gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
              {stat.icon}
              <span className="truncate">{stat.label}</span>
            </div>
            <span className="font-mono text-xs font-semibold text-neutral-900 dark:text-accent truncate">
              {stat.change}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export function FeaturesBento(): ReactNode {
  const { alerts } = useAlerts(5);
  const { data: activity } = useAgentActivity();
  const { data: desk } = useDeskStatus();

  const latestAlert = useMemo(() => {
    const alert = alerts[0];
    if (!alert) return null;
    const item: { id: string; title: string; summary: string; protocol?: string } = {
      id: alert.id,
      title: alert.title,
      summary: alert.summary,
    };
    if (alert.protocol) item.protocol = alert.protocol;
    return item;
  }, [alerts]);

  const anchoredDigest = useMemo(() => {
    if (!activity?.digests?.length) return null;
    const digest =
      activity.digests.find((d) => Boolean(d.registryTxHash)) ?? activity.digests[0] ?? null;
    if (!digest) return null;
    const item: { id: string; title: string; registryTxHash?: string } = {
      id: digest.id,
      title: digest.title,
    };
    if (digest.registryTxHash) item.registryTxHash = digest.registryTxHash;
    return item;
  }, [activity]);

  const settledPayments = useMemo(
    () => activity?.payments.filter((p) => p.status === "settled").length ?? 0,
    [activity],
  );

  const hasKeeperHubProof = useMemo(() => {
    if (!activity) return false;
    return (
      activity.digests.some((d) => Boolean(d.registryTxHash || d.keeperHubRunId)) ||
      activity.alerts.some((a) => Boolean(a.registryTxHash || a.keeperHubRunId)) ||
      (activity.payouts?.some((p) => Boolean(p.registryTxHash || p.keeperHubRunId)) ?? false)
    );
  }, [activity]);

  const deskStatusLabel = useMemo(() => {
    if (!desk) return "standing by";
    if (desk.killSwitch.armed) return "kill armed";
    if (desk.paused) return "paused";
    if (desk.heartbeat.stale) return "stale";
    return "live";
  }, [desk]);

  const lastAgentLine = useMemo(() => {
    const agent = desk?.lastAgent;
    if (!agent) return null;
    if (agent.forceMaintenanceOverride) {
      return `Force maintenance · ${formatUsdc(agent.notionalUsdc)}`;
    }
    if (agent.forceDefendOverride) return "Force defend";
    if (agent.action === "propose" && agent.strategy) {
      return `${strategyLabel(agent.strategy)} · ${formatUsdc(agent.notionalUsdc)}`;
    }
    if (agent.action === "defend") return "Risk defend";
    if (agent.action === "hold") return "Hold";
    if (agent.action === "defer") return "Deferred";
    return agent.action;
  }, [desk?.lastAgent]);

  return (
    <section className="mb-32 w-full bg-background px-6" data-testid="features-bento-live">
      <div className="mx-auto max-w-5xl">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Row 1: Event Monitoring (1) + Desk (2) */}
          <StepByStepCard latestAlert={latestAlert} />
          <DeskCard
            equityUsdc={desk?.equityUsdc ?? null}
            healthFactor={desk?.healthFactor ?? null}
            statusLabel={deskStatusLabel}
            lastAgentLine={lastAgentLine}
          />

          {/* Row 2: Preflight & CCTP (3) + Proofs (4) */}
          <PreflightCctpCard />
          <ProofCard anchoredDigest={anchoredDigest} />

          {/* Row 3: Micropayments (5) + Circular Economy & Surfaces (6) */}
          <TrustedByCard settledPayments={settledPayments} alertCount={alerts.length} />
          <IntegrationsCard
            treasuryStatus={activity?.treasury.status ?? "unknown"}
            hasKeeperHubProof={hasKeeperHubProof}
            deskEquity={desk?.equityUsdc ?? null}
          />
        </div>
      </div>
    </section>
  );
}
