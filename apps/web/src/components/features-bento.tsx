import { Activity, Landmark, ShieldCheck } from "lucide-react";
import { type Transition, motion } from "motion/react";
import { type ReactNode, useMemo } from "react";
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

type AlertPreview = {
  id: string;
  title: string;
  summary: string;
};

function AlertCardPreview({ latestAlert }: { latestAlert: AlertPreview | null }): ReactNode {
  const headline = latestAlert?.title ?? "Awaiting the next alert";
  const body = latestAlert
    ? latestAlert.summary.length > 120
      ? `${latestAlert.summary.slice(0, 120)}…`
      : latestAlert.summary
    : "ChronicleAI turns significant onchain activity into a plain-language public Alert.";

  return (
    <motion.div
      {...cardAnimation}
      transition={getCardTransition(0)}
      className="group flex h-full min-h-80 flex-col justify-between overflow-hidden rounded-4xl bg-card-primary p-8"
    >
      <div className="relative z-10 transition-transform duration-500 ease-out group-hover:scale-105">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-black/10 px-3 py-1 text-xs font-semibold text-neutral-900">
          <Activity className="h-3.5 w-3.5" /> 1 · Alert
        </div>
        <h3 className="mb-2 text-2xl font-medium leading-tight text-neutral-900 md:text-3xl">
          A public bulletin from chain
        </h3>
        <p className="text-sm text-neutral-700">
          Onchain activity becomes a sourced Alert — the first input in the desk response loop.
        </p>
      </div>

      <div className="mt-6 rounded-2xl bg-neutral-950 p-4 text-white shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-[10px] uppercase tracking-wider text-accent">
            {latestAlert ? "Latest public alert" : "Live feed"}
          </p>
          <span className="rounded-full bg-accent/20 px-2 py-0.5 font-mono text-[10px] text-accent">
            Desk input
          </span>
        </div>
        <h4 className="mt-2 line-clamp-1 text-sm font-semibold text-white">{headline}</h4>
        <p className="mt-1 line-clamp-2 text-xs text-white/60">{body}</p>
        {latestAlert ? (
          <Link
            to={`/alerts/${latestAlert.id}`}
            className="mt-3 inline-flex text-xs font-semibold text-accent underline underline-offset-2 hover:text-white"
          >
            Open alert →
          </Link>
        ) : null}
      </div>
    </motion.div>
  );
}

function DecisionCard({
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
          <Landmark className="h-3.5 w-3.5" /> 2 · Signal
        </div>
        <h3 className="mb-2 text-xl font-medium leading-tight text-card-foreground md:text-2xl">
          Alert becomes desk input
        </h3>
        <p className="text-sm text-card-foreground-muted">
          Eligible Alerts project into Desk Signals. The model proposes; hard policy checks size,
          health, pause state, and route before any Action.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
          <p className="font-medium text-[10px] uppercase text-neutral-400">Desk equity</p>
          <p className="mt-1 font-mono text-base font-semibold text-white">
            {formatUsdc(equityUsdc)}
          </p>
          <span className="mt-1 inline-block rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-black">
            {statusLabel}
          </span>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
          <p className="font-medium text-[10px] uppercase text-neutral-400">Health factor</p>
          <p className="mt-1 font-mono text-base font-semibold text-accent">
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
      className="group flex h-full min-h-64 flex-col justify-between overflow-hidden rounded-4xl bg-card-secondary p-8 md:col-span-2 md:flex-row md:items-end md:gap-12"
    >
      <div className="max-w-xl transition-transform duration-500 ease-out group-hover:translate-x-1">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
          <ShieldCheck className="h-3.5 w-3.5" /> 3 · Action
        </div>
        <h3 className="mb-2 text-xl font-medium leading-tight text-card-foreground md:text-2xl">
          Execute and prove
        </h3>
        <p className="text-sm text-card-foreground-muted">
          Policy-approved Actions run through KeeperHub. Registry receipts and logs keep Alert,
          Signal, Decision, and transaction linked on one causal chain.
        </p>
      </div>

      <div className="mt-6 flex min-w-0 flex-1 flex-col gap-2 rounded-2xl border border-white/10 bg-black/40 p-4 md:mt-0">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase text-black">
            {anchoredDigest?.registryTxHash ? "Anchored" : "Pending"}
          </span>
          <span className="font-mono text-[10px] text-white/50">ETHEREUM SEPOLIA</span>
        </div>
        <p className="truncate font-mono text-xs text-white">
          {anchoredDigest?.registryTxHash
            ? truncateHash(anchoredDigest.registryTxHash)
            : "Awaiting registry receipt"}
        </p>
        {anchoredDigest ? (
          <Link
            to={`/digests/${anchoredDigest.id}`}
            className="text-xs font-semibold text-accent underline underline-offset-2 hover:text-white"
          >
            Open registry proof →
          </Link>
        ) : null}
      </div>
    </motion.div>
  );
}

export function FeaturesBento(): ReactNode {
  const { alerts } = useAlerts(5);
  const { data: activity } = useAgentActivity();
  const { data: desk } = useDeskStatus();

  const latestAlert = useMemo<AlertPreview | null>(() => {
    const alert = alerts[0];
    if (!alert) return null;
    return {
      id: alert.id,
      title: alert.title,
      summary: alert.summary,
    };
  }, [alerts]);

  const anchoredDigest = useMemo(() => {
    if (!activity?.digests?.length) return null;
    const digest =
      activity.digests.find((item) => Boolean(item.registryTxHash)) ?? activity.digests[0] ?? null;
    if (!digest) return null;
    return {
      id: digest.id,
      title: digest.title,
      ...(digest.registryTxHash ? { registryTxHash: digest.registryTxHash } : {}),
    };
  }, [activity]);

  const deskStatusLabel = useMemo(() => {
    if (!desk) return "Standing by";
    if (desk.killSwitch.armed) return "Kill switch armed";
    if (desk.paused) return "Paused";
    if (desk.heartbeat.stale) return "Heartbeat stale";
    return "Live";
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
        <div className="mb-8 max-w-2xl">
          <p className="text-sm font-semibold text-accent">The core loop</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Every step stays visible.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-foreground/60">
            Follow the same path a judge follows: Alert → Signal → Action → Proof.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <AlertCardPreview latestAlert={latestAlert} />
          <DecisionCard
            equityUsdc={desk?.equityUsdc ?? null}
            healthFactor={desk?.healthFactor ?? null}
            statusLabel={deskStatusLabel}
            lastAgentLine={lastAgentLine}
          />
          <ProofCard anchoredDigest={anchoredDigest} />
        </div>
      </div>
    </section>
  );
}
