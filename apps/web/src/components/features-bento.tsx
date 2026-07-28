import { motion, type Transition } from "motion/react";
import { CircleCheck, Star, Shield, Zap, Unlock, Check } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAgentActivity } from "../features/activity/use-agent-activity.ts";
import { useAlerts } from "../features/alerts/use-alerts.ts";
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
        relative bg-background shadow-2xl border-neutral-800 overflow-hidden z-10
        ${isCompact 
          ? "w-44 md:w-48 h-64 md:h-72 rounded-3xl border-4" 
          : "w-56 md:w-64 h-96 md:h-115 rounded-t-4xl border-6 border-b-0"
        }
      `}
    >
      <div
        className={`
          absolute left-1/2 -translate-x-1/2 bg-neutral-800 rounded-full z-10
          ${isCompact ? "top-2 w-16 h-4" : "top-2 w-20 h-5"}
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
      <div className="absolute size-56 border border-accent/80 rounded-full" />
      <div className="absolute size-72 border border-accent/60 rounded-full" />
      <div className="absolute size-88 border border-accent/40 rounded-full" />
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
      className="group bg-card-primary rounded-4xl p-8 pb-0 overflow-hidden min-h-140 md:row-span-2 flex flex-col"
    >
      <div className="relative z-10 text-center mb-6 transition-transform duration-500 ease-out group-hover:scale-105">
        <h3 className="text-2xl md:text-4xl font-medium text-neutral-900 leading-tight mb-3">
          Autonomous Event Monitoring
        </h3>
        <p className="text-neutral-700 text-sm">
          KeeperHub monitors gas spikes, trades, liquidations, and contract deployments.
        </p>
      </div>

      <div className="flex-1 flex justify-center items-end transition-transform duration-500 ease-out group-hover:scale-[1.02]">
        <PhoneMockup variant="full">
          <div className="absolute inset-0 bg-phone-screen pt-14 px-5">
            <p className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">
              {latestAlert ? "Latest published alert" : "Live feed"}
            </p>
            <h4 className="text-xl font-medium text-neutral-900 leading-tight tracking-tight mb-3 line-clamp-3">
              {headline}
            </h4>
            <p className="text-sm text-neutral-500 leading-snug mb-6 line-clamp-4">{body}</p>

            <div className="relative bg-linear-to-br from-accent via-accent/80 to-accent/50 rounded-2xl p-4 h-40 shadow-xl overflow-hidden">
              <div className="relative z-10 flex items-start justify-between gap-3 h-full">
                <div>
                  <p className="text-base font-semibold text-neutral-900">
                    {latestAlert ? "Bulletin ready" : "Monitoring"}
                  </p>
                  <p className="text-sm font-medium text-neutral-800 flex items-center gap-1.5 mt-1">
                    {latestAlert ? (
                      <>
                        Published <Check className="h-4 w-4 text-neutral-900 inline-block" />
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
                <CircleCheck className="opacity-25 text-black" aria-hidden="true" />
              </div>
            </div>
          </div>
        </PhoneMockup>
      </div>
    </motion.div>
  );
}

function DashboardCard({
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
      transition={getCardTransition(0.1)}
      className="group bg-card-secondary rounded-4xl p-8 overflow-hidden min-h-80 relative flex flex-col md:block"
    >
      <div className="relative z-10 max-w-48 transition-transform duration-500 ease-out group-hover:scale-105">
        <h3 className="text-xl md:text-2xl whitespace-nowrap font-medium text-card-foreground leading-tight mb-3">
          Verifiable Daily Digests
        </h3>
        <p className="text-card-foreground-muted text-sm">
          Chronicle Registry stores cryptographic publication hashes on the Base Sepolia network.
        </p>
      </div>

      <div className="relative md:absolute mt-8 md:mt-0 md:right-12 md:top-1/2 md:-translate-y-1/2 flex items-center justify-center transition-transform duration-500 ease-out group-hover:scale-105 self-center md:self-auto">
        <DecorativeCircles />

        <PhoneMockup variant="compact">
          <div className="absolute inset-0 bg-phone-screen pt-9 px-3">
            <div className="bg-white rounded-full px-2 py-1.5 mb-3 flex items-center gap-1.5 border border-neutral-200">
              <span className="text-neutral-400 text-xs truncate">
                {anchoredDigest ? "Registry.getDigest" : "No digest yet"}
              </span>
            </div>
            <p className="text-xs text-neutral-500 mb-0.5">
              {anchoredDigest?.registryTxHash ? "Anchored hash" : "Status"}
            </p>
            <p className="text-base font-mono text-neutral-900 mb-3 truncate">
              {anchoredDigest?.registryTxHash
                ? truncateHash(anchoredDigest.registryTxHash)
                : "—"}
            </p>

            <div className="flex gap-1.5 mb-4">
              <span className="bg-accent text-black text-[10px] px-2 py-0.5 rounded-full">
                {anchoredDigest?.registryTxHash ? "anchored" : "pending"}
              </span>
              {anchoredDigest ? (
                <Link
                  to={`/digests/${anchoredDigest.id}`}
                  className="text-neutral-500 text-[10px] px-2 py-0.5 hover:text-neutral-800"
                >
                  view
                </Link>
              ) : null}
            </div>
          </div>
        </PhoneMockup>

        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 bg-neutral-900 rounded-2xl px-5 py-3 shadow-xl z-20 whitespace-nowrap">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-neutral-400 text-xs">Verification</span>
            <Shield className="text-accent w-3 h-3" />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-lg font-medium text-white flex items-center gap-1.5">
              {anchoredDigest?.registryTxHash ? (
                <>
                  Anchored <Check className="h-4.5 w-4.5 text-accent inline-block" />
                </>
              ) : (
                "Standing by"
              )}
            </span>
            <span className="text-xs font-medium text-accent bg-accent/20 px-2 py-0.5 rounded">
              BASE SEPOLIA
            </span>
          </div>
        </div>
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
      transition={getCardTransition(0.2)}
      className="group bg-card-secondary rounded-4xl p-6 md:p-8 flex flex-col items-center justify-center text-center min-h-64"
    >
      <div className="transition-transform duration-500 ease-out group-hover:scale-110">
        <h3 className="text-2xl md:text-3xl font-medium text-card-foreground leading-tight mb-1">
          Micropayment
        </h3>
        <h3 className="text-2xl md:text-3xl font-medium text-card-foreground leading-tight mb-5">
          Gated Feeds
        </h3>
      </div>

      <div className="transition-transform duration-500 ease-out group-hover:scale-105 flex flex-col items-center gap-2">
        <div className="size-14 rounded-full border-2 border-white/25 bg-accent text-black flex items-center justify-center text-lg font-bold">
          {settledPayments}
        </div>
        <p className="text-sm text-card-foreground-muted">
          {settledPayments === 1 ? "settled payment" : "settled payments"} · {alertCount}{" "}
          {alertCount === 1 ? "alert" : "alerts"} published
        </p>
      </div>

      <div className="flex items-center gap-2 mt-5 text-card-foreground-muted transition-transform duration-500 ease-out group-hover:scale-105">
        <Star className="size-4 fill-current text-accent" />
        <span className="text-xs font-medium">Gated with x402 Base Sepolia & MPP Tempo</span>
      </div>
    </motion.div>
  );
}

function IntegrationsCard({
  treasuryStatus,
  hasKeeperHubProof,
}: {
  treasuryStatus: string;
  hasKeeperHubProof: boolean;
}): ReactNode {
  const stats = [
    {
      icon: <Zap className="size-4.5 text-accent" />,
      label: "Treasury status",
      change: treasuryStatus === "unknown" ? "No snapshot" : treasuryStatus,
    },
    {
      icon: <Unlock className="size-4.5 text-accent" />,
      label: "Registry writes",
      change: hasKeeperHubProof ? "Verified" : "Pending",
    },
  ];

  return (
    <motion.div
      {...cardAnimation}
      transition={getCardTransition(0.3)}
      className="group bg-card-primary rounded-4xl p-6 md:p-8 flex flex-col min-h-64"
    >
      <div className="mb-auto transition-transform duration-500 ease-out group-hover:scale-105">
        <h3 className="text-xl md:text-2xl font-medium text-neutral-900 leading-tight mb-2">
          Circular Financial Economy
        </h3>
        <p className="text-neutral-700 text-sm">
          Self-funding model: collected subscription and referral fees replenish Para wallet gas reserves automatically.
        </p>
      </div>

      <div className="flex flex-col gap-2 mt-6 transition-transform duration-500 ease-out group-hover:scale-[1.02]">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex items-center justify-between bg-background rounded-xl p-3"
          >
            <div className="flex items-center gap-2.5">
              {stat.icon}
              <span className="text-foreground font-medium text-sm">{stat.label}</span>
            </div>
            <span className="text-accent text-sm font-semibold capitalize">{stat.change}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export function FeaturesBento(): ReactNode {
  const { alerts } = useAlerts(20);
  const { data: activity } = useAgentActivity();

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

  return (
    <section className="w-full px-6 mb-32 bg-background" data-testid="features-bento-live">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr] gap-4">
          <StepByStepCard latestAlert={latestAlert} />
          <DashboardCard anchoredDigest={anchoredDigest} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TrustedByCard settledPayments={settledPayments} alertCount={alerts.length} />
            <IntegrationsCard
              treasuryStatus={activity?.treasury.status ?? "unknown"}
              hasKeeperHubProof={hasKeeperHubProof}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
