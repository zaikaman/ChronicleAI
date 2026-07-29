import { motion, type Transition } from "motion/react";
import { CircleCheck, Star, Shield, Landmark, Unlock, Check } from "lucide-react";
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

function PhoneMockup({
  children,
  variant = "full",
}: {
  children: ReactNode;
  variant?: "full" | "compact";
}): ReactNode {
  const isCompact = variant === "compact";

  return (
    <div
      className={`
        relative z-10 overflow-hidden border-neutral-800 bg-background shadow-2xl
        ${
          isCompact
            ? "h-64 w-44 rounded-3xl border-4 md:h-72 md:w-48"
            : "h-96 w-56 rounded-t-4xl border-6 border-b-0 md:h-115 md:w-64"
        }
      `}
    >
      <div
        className={`
          absolute left-1/2 z-10 -translate-x-1/2 rounded-full bg-neutral-800
          ${isCompact ? "top-2 h-4 w-16" : "top-2 h-5 w-20"}
        `}
        aria-hidden="true"
      />
      {children}
    </div>
  );
}

function DecorativeCircles(): ReactNode {
  return (
    <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
      <div className="absolute size-56 rounded-full border border-accent/80" />
      <div className="absolute size-72 rounded-full border border-accent/60" />
      <div className="absolute size-88 rounded-full border border-accent/40" />
    </div>
  );
}

function StepByStepCard({
  latestAlert,
}: {
  latestAlert: { id: string; title: string; summary: string; protocol?: string } | null;
}): ReactNode {
  const headline = latestAlert?.title ?? "Awaiting first signal";
  const body = latestAlert
    ? latestAlert.summary.length > 120
      ? `${latestAlert.summary.slice(0, 120)}…`
      : latestAlert.summary
    : "KeeperHub monitors gas spikes, trades, liquidations, and contract deployments. Live alerts appear here when published.";

  return (
    <motion.div
      {...cardAnimation}
      transition={getCardTransition(0)}
      className="group flex min-h-140 flex-col overflow-hidden rounded-4xl bg-card-primary p-8 pb-0 md:row-span-2"
    >
      <div className="relative z-10 mb-6 text-center transition-transform duration-500 ease-out group-hover:scale-105">
        <h3 className="mb-3 text-2xl font-medium leading-tight text-neutral-900 md:text-4xl">
          Autonomous event monitoring
        </h3>
        <p className="text-sm text-neutral-700">
          KeeperHub watches gas, swaps, liquidations, and deployments — then Chronicle publishes
          plain-language alerts.
        </p>
      </div>

      <div className="flex flex-1 items-end justify-center transition-transform duration-500 ease-out group-hover:scale-[1.02]">
        <PhoneMockup variant="full">
          <div className="absolute inset-0 bg-phone-screen px-5 pt-14">
            <p className="mb-2 text-[10px] tracking-wider text-neutral-500 uppercase">
              {latestAlert ? "Latest published alert" : "Live feed"}
            </p>
            <h4 className="mb-3 line-clamp-3 text-xl leading-tight font-medium tracking-tight text-neutral-900">
              {headline}
            </h4>
            <p className="mb-6 line-clamp-4 text-sm leading-snug text-neutral-500">{body}</p>

            <div className="relative h-40 overflow-hidden rounded-2xl bg-linear-to-br from-accent via-accent/80 to-accent/50 p-4 shadow-xl">
              <div className="relative z-10 flex h-full items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-neutral-900">
                    {latestAlert ? "Bulletin ready" : "Monitoring"}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-neutral-800">
                    {latestAlert ? (
                      <>
                        Published <Check className="inline-block h-4 w-4 text-neutral-900" />
                      </>
                    ) : (
                      "Standing by"
                    )}
                  </p>
                  {latestAlert ? (
                    <Link
                      to={`/alerts/${latestAlert.id}`}
                      className="mt-3 inline-block text-xs font-semibold text-neutral-900 underline underline-offset-2"
                    >
                      Open alert
                    </Link>
                  ) : null}
                </div>
                <CircleCheck className="text-black opacity-25" aria-hidden="true" />
              </div>
            </div>
          </div>
        </PhoneMockup>
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
      className="group relative flex min-h-80 flex-col overflow-hidden rounded-4xl bg-card-secondary p-8 md:block"
    >
      <div className="relative z-10 max-w-56 transition-transform duration-500 ease-out group-hover:scale-105">
        <h3 className="mb-3 text-xl leading-tight font-medium text-card-foreground md:text-2xl">
          Policy-gated trading desk
        </h3>
        <p className="text-sm text-card-foreground-muted">
          LLM proposes. Hard policy disposes. KeeperHub executes risk defend, yield rotation, and
          oracle–AMM legs on Sepolia.
        </p>
      </div>

      <div className="relative mt-8 flex items-center justify-center self-center transition-transform duration-500 ease-out group-hover:scale-105 md:absolute md:top-1/2 md:right-10 md:mt-0 md:-translate-y-1/2 md:self-auto">
        <DecorativeCircles />

        <PhoneMockup variant="compact">
          <div className="absolute inset-0 bg-phone-screen px-3 pt-9">
            <div className="mb-3 flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2 py-1.5">
              <Landmark className="h-3 w-3 shrink-0 text-neutral-500" />
              <span className="truncate text-xs text-neutral-500">Desk book</span>
            </div>
            <p className="mb-0.5 text-xs text-neutral-500">Equity</p>
            <p className="mb-2 truncate font-mono text-base text-neutral-900">
              {formatUsdc(equityUsdc)}
            </p>
            <p className="mb-0.5 text-xs text-neutral-500">Health factor</p>
            <p className="mb-3 font-mono text-sm text-neutral-900">
              {formatHealthFactor(healthFactor)}
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-black">
                {statusLabel}
              </span>
              <Link
                to="/desk"
                className="px-2 py-0.5 text-[10px] text-neutral-500 hover:text-neutral-800"
              >
                open
              </Link>
            </div>
          </div>
        </PhoneMockup>

        <div className="absolute bottom-0 left-1/2 z-20 -translate-x-1/2 rounded-2xl bg-neutral-900 px-5 py-3 whitespace-nowrap shadow-xl">
          <div className="mb-0.5 flex items-center gap-2">
            <span className="text-xs text-neutral-400">Last agent</span>
            <Shield className="h-3 w-3 text-accent" />
          </div>
          <p className="max-w-[11rem] truncate text-sm font-medium text-white">
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
      className="group flex min-h-64 flex-col items-center justify-center rounded-4xl bg-card-secondary p-6 text-center md:p-8"
    >
      <div className="transition-transform duration-500 ease-out group-hover:scale-105">
        <h3 className="mb-2 text-2xl leading-tight font-medium text-card-foreground md:text-3xl">
          On-chain proofs
        </h3>
        <p className="mb-4 max-w-xs text-sm text-card-foreground-muted">
          Digests, trade tickets, and sponsored reports anchor to ChronicleRegistry via KeeperHub.
        </p>
      </div>

      <div className="flex flex-col items-center gap-2 transition-transform duration-500 ease-out group-hover:scale-105">
        <p className="font-mono text-sm text-card-foreground">
          {anchoredDigest?.registryTxHash
            ? truncateHash(anchoredDigest.registryTxHash)
            : "Awaiting first receipt"}
        </p>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-black">
            {anchoredDigest?.registryTxHash ? "anchored" : "pending"}
          </span>
          <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold text-card-foreground">
            ETHEREUM SEPOLIA
          </span>
        </div>
        {anchoredDigest ? (
          <Link
            to={`/digests/${anchoredDigest.id}`}
            className="mt-1 text-xs font-semibold text-card-foreground underline underline-offset-2"
          >
            View digest
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
      className="group flex min-h-64 flex-col items-center justify-center rounded-4xl bg-card-secondary p-6 text-center md:p-8"
    >
      <div className="transition-transform duration-500 ease-out group-hover:scale-110">
        <h3 className="mb-1 text-2xl leading-tight font-medium text-card-foreground md:text-3xl">
          Micropayment
        </h3>
        <h3 className="mb-5 text-2xl leading-tight font-medium text-card-foreground md:text-3xl">
          gated feeds
        </h3>
      </div>

      <div className="flex flex-col items-center gap-2 transition-transform duration-500 ease-out group-hover:scale-105">
        <div className="flex size-14 items-center justify-center rounded-full border-2 border-white/25 bg-accent text-lg font-bold text-black">
          {settledPayments}
        </div>
        <p className="text-sm text-card-foreground-muted">
          {settledPayments === 1 ? "settled payment" : "settled payments"} · {alertCount}{" "}
          {alertCount === 1 ? "alert" : "alerts"} published
        </p>
      </div>

      <div className="mt-5 flex items-center gap-2 text-card-foreground-muted transition-transform duration-500 ease-out group-hover:scale-105">
        <Star className="size-4 fill-current text-accent" />
        <span className="text-xs font-medium">x402 Base Sepolia USDC &amp; MPP for agents</span>
      </div>
    </motion.div>
  );
}

function IntegrationsCard({
  treasuryStatus,
  hasKeeperHubProof,
  deskEquity,
}: {
  treasuryStatus: string;
  hasKeeperHubProof: boolean;
  deskEquity: number | null;
}): ReactNode {
  const stats = [
    {
      icon: <Unlock className="size-4.5 text-accent" />,
      label: "Treasury & CCTP",
      change: treasuryStatus === "unknown" ? "Base ➔ Sepolia" : `${treasuryStatus} · CCTP V2`,
    },
    {
      icon: <Landmark className="size-4.5 text-accent" />,
      label: "Desk equity",
      change: formatUsdc(deskEquity),
    },
    {
      icon: <Shield className="size-4.5 text-accent" />,
      label: "Flashbots Private RPC",
      change: "Strict Fail-Closed",
    },
    {
      icon: <Check className="size-4.5 text-accent" />,
      label: "Smart Gas Preflight",
      change: "Layer A Dry-Run",
    },
    {
      icon: <CircleCheck className="size-4.5 text-accent" />,
      label: "x402 / MPP Dual",
      change: "Auto-Routed",
    },
    {
      icon: <Star className="size-4.5 text-accent" />,
      label: "MCP Server Tooling",
      change: "Active Discovery",
    },
  ];

  return (
    <motion.div
      {...cardAnimation}
      transition={getCardTransition(0.3)}
      className="group flex min-h-64 flex-col rounded-4xl bg-card-primary p-6 md:p-8 md:col-span-2"
    >
      <div className="mb-auto transition-transform duration-500 ease-out group-hover:scale-105">
        <h3 className="mb-2 text-xl leading-tight font-medium text-neutral-900 md:text-2xl">
          Circular economy with a live book
        </h3>
        <p className="max-w-xl text-sm text-neutral-700">
          Premium and sponsored revenue refill the Para MPC treasury. Safety buffers fund gas and
          desk top-ups; surplus routes to creators and affiliates through KeeperHub — with public
          receipts on Activity.
        </p>
      </div>

      <div className="mt-6 grid gap-2 transition-transform duration-500 ease-out group-hover:scale-[1.02] sm:grid-cols-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex items-center justify-between gap-2 rounded-xl bg-background p-3"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {stat.icon}
              <span className="text-sm font-medium text-foreground">{stat.label}</span>
            </div>
            <span className="shrink-0 text-sm font-semibold text-accent capitalize">
              {stat.change}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export function FeaturesBento(): ReactNode {
  // P1-2: same limits/keys as Hero + HomePage (shared React Query cache).
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1.5fr]">
          <StepByStepCard latestAlert={latestAlert} />
          <DeskCard
            equityUsdc={desk?.equityUsdc ?? null}
            healthFactor={desk?.healthFactor ?? null}
            statusLabel={deskStatusLabel}
            lastAgentLine={lastAgentLine}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:col-span-2">
            <ProofCard anchoredDigest={anchoredDigest} />
            <TrustedByCard settledPayments={settledPayments} alertCount={alerts.length} />
            <IntegrationsCard
              treasuryStatus={activity?.treasury.status ?? "unknown"}
              hasKeeperHubProof={hasKeeperHubProof}
              deskEquity={desk?.equityUsdc ?? null}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
