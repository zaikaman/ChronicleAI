import { LogoLoop, type LogoItem } from "./logo-loop";
import {
  ArrowDownRight,
  Activity,
  ShieldCheck,
  Landmark,
  Check,
} from "lucide-react";
import { motion, useMotionValue, useSpring } from "motion/react";
import { useMemo, useRef, type ReactNode, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { useAgentActivity } from "../features/activity/use-agent-activity.ts";
import { useAlerts } from "../features/alerts/use-alerts.ts";
import { formatHealthFactor, formatUsdc, strategyLabel } from "../features/desk/format.ts";
import { useDeskStatus } from "../features/desk/use-desk.ts";
import { chainLabel, truncateHash } from "../lib/explorer.ts";

const ease = [0.23, 1, 0.32, 1] as const;

const fadeInUp = {
  hidden: { opacity: 0, y: 20, filter: "blur(8px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const fadeInScale = {
  hidden: { opacity: 0, scale: 0.95, filter: "blur(8px)" },
  visible: { opacity: 1, scale: 1, filter: "blur(0px)" },
};

const logos: LogoItem[] = [
  { node: <span className="text-[1em] font-semibold tracking-tight">KeeperHub Workflows</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">Flashbots Protect RPC</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">Circle CCTP V2</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">KeeperHub MCP Server</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">Ethereum Sepolia</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">Aave V3</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">Uniswap V3</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">x402 Micropayments</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">MPP Tempo</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">Gemini</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">OpenAI</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">Groq</span> },
];

const PARALLAX_INTENSITY = 20;

function HeroDashboard(): ReactNode {
  const { alerts, isLoading: alertsLoading } = useAlerts(5);
  const { data: activity, isLoading: activityLoading } = useAgentActivity();
  const { data: desk, isLoading: deskLoading } = useDeskStatus();

  const isLoading = alertsLoading || activityLoading || deskLoading;

  const signals = useMemo(() => {
    return alerts.slice(0, 3).map((alert) => {
      const networkLabel =
        typeof alert.chainId === "number" ? chainLabel(alert.chainId) : undefined;
      const tag =
        networkLabel ??
        (alert.protocol ? alert.protocol : alert.confidence ? `${alert.confidence} conf` : "Live");

      return {
        id: alert.id,
        name: alert.title,
        details:
          alert.summary.length > 90 ? `${alert.summary.slice(0, 90)}…` : alert.summary,
        tag,
        href: `/alerts/${alert.id}`,
      };
    });
  }, [alerts]);

  const latestAnchoredDigest = useMemo(() => {
    if (!activity?.digests?.length) return null;
    return (
      activity.digests.find((d) => Boolean(d.registryTxHash)) ?? activity.digests[0] ?? null
    );
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
    if (agent.action === "defend") return "Risk defend proposed";
    if (agent.action === "hold") return "Hold — no trade";
    if (agent.action === "defer") return "Deferred under policy";
    return agent.action;
  }, [desk?.lastAgent]);

  return (
    <div
      className="aspect-[16/9] w-full bg-neutral-950 p-5 text-white sm:p-8"
      data-testid="hero-live-dashboard"
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            ChronicleAI · Newspaper + Desk
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-4xl">
            Live agent console
          </h2>
        </div>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-black">
          <Activity className="h-6 w-6" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
          <div className="mb-4 flex items-center justify-between gap-2">
            <span className="text-sm text-white/60">
              {isLoading ? "Loading signals…" : "Latest published alerts"}
            </span>
            <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-black">
              KeeperHub
            </span>
          </div>
          <div className="space-y-3">
            {signals.length === 0 && !isLoading ? (
              <div className="rounded-xl bg-black/30 p-4 text-sm text-white/50">
                No published alerts yet. Signals appear here when ChronicleAI detects significant
                on-chain events.
              </div>
            ) : (
              signals.map((s) => (
                <Link
                  key={s.id}
                  to={s.href}
                  className="flex items-center justify-between rounded-xl bg-black/30 p-3 transition-colors hover:bg-black/45"
                >
                  <div className="min-w-0 pr-3">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-white/45">{s.details}</p>
                  </div>
                  <span className="flex-shrink-0 rounded-lg bg-accent/10 px-2 py-1 font-mono text-xs font-semibold text-accent">
                    {s.tag}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="grid gap-4">
          <Link
            to="/desk"
            className="rounded-2xl bg-accent p-4 text-black transition-opacity hover:opacity-95"
            data-testid="hero-desk-panel"
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Landmark className="h-4 w-4" />
              Chronicle Desk
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="hero-desk-equity">
              {isLoading ? "—" : formatUsdc(desk?.equityUsdc ?? null)}
            </p>
            <p className="mt-1 text-sm text-black/60">
              Book equity · HF {isLoading ? "—" : formatHealthFactor(desk?.healthFactor ?? null)} ·{" "}
              {deskStatusLabel}
            </p>
            {lastAgentLine ? (
              <p className="mt-2 text-xs font-medium text-black/70">{lastAgentLine}</p>
            ) : (
              <p className="mt-2 text-xs text-black/55">
                LLM proposes · policy disposes · KeeperHub executes
              </p>
            )}
          </Link>

          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-accent" />
              On-chain publication proof
            </div>
            {latestAnchoredDigest ? (
              <Link
                to={`/digests/${latestAnchoredDigest.id}`}
                className="flex flex-col gap-1 text-sm leading-relaxed text-white/70 transition-colors hover:text-white"
              >
                <span className="flex items-center gap-1.5 font-medium text-white">
                  {latestAnchoredDigest.title.length > 48
                    ? `${latestAnchoredDigest.title.slice(0, 48)}…`
                    : latestAnchoredDigest.title}
                  {latestAnchoredDigest.registryTxHash ? (
                    <Check className="inline-block h-3.5 w-3.5 text-accent" />
                  ) : null}
                </span>
                <span className="font-mono text-xs text-white/45">
                  {latestAnchoredDigest.registryTxHash
                    ? truncateHash(latestAnchoredDigest.registryTxHash)
                    : "Awaiting registry receipt"}
                </span>
              </Link>
            ) : (
              <p className="text-sm leading-relaxed text-white/50">
                {isLoading
                  ? "Loading digest anchors…"
                  : "No digests anchored yet. Daily digests and trade tickets appear here after KeeperHub execution."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Hero(): ReactNode {
  const sectionRef = useRef<HTMLElement>(null);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const springConfig = { damping: 25, stiffness: 150 };
  const x = useSpring(mouseX, springConfig);
  const y = useSpring(mouseY, springConfig);

  const handleMouseMove = (e: MouseEvent<HTMLElement>) => {
    if (!sectionRef.current) return;
    if (window.innerWidth < 850) return;

    const rect = sectionRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const offsetX = (e.clientX - centerX) / (rect.width / 2);
    const offsetY = (e.clientY - centerY) / (rect.height / 2);

    mouseX.set(offsetX * PARALLAX_INTENSITY);
    mouseY.set(offsetY * PARALLAX_INTENSITY);
  };

  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  return (
    <section
      ref={sectionRef}
      className="relative z-0 flex flex-col"
      style={{ colorScheme: "light" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        className="absolute inset-0 -z-10 min-[850px]:inset-2.5 rounded-br-4xl rounded-bl-4xl bg-cover bg-center bg-no-repeat brightness-125 min-[850px]:scale-105"
        style={{
          // Prefer modern formats (P1-5); browsers that support image-set pick AVIF/WebP.
          backgroundImage:
            "image-set(url(/BG.avif) type('image/avif'), url(/BG.webp) type('image/webp'), url(/BG.jpg) type('image/jpeg'))",
          x,
          y,
        }}
        aria-hidden="true"
      />

      <div className="flex items-start justify-center px-6 pt-64 max-[850px]:pt-32">
        <motion.div
          className="flex max-w-4xl flex-col items-center text-center max-[850px]:w-full max-[850px]:items-start max-[850px]:text-left"
          initial="hidden"
          animate="visible"
          transition={{ staggerChildren: 0.15, delayChildren: 0.2 }}
        >
          <motion.div
            className="mb-6 inline-flex items-center gap-1.5 rounded-xl border border-black/10 bg-white py-1.5 pl-4 pr-3 text-sm font-medium text-black"
            variants={fadeInUp}
            transition={{ duration: 0.8, ease }}
          >
            Autonomous newspaper
            <span className="text-accent">+</span>
            policy-gated desk
          </motion.div>

          <h1 className="mb-6 text-8xl font-medium leading-[1.1] tracking-tight text-black max-[850px]:text-5xl">
            <motion.span
              className="block font-bold tracking-tighter"
              style={{ fontFamily: "var(--font-space-grotesk)" }}
              variants={fadeInUp}
              transition={{ duration: 0.8, ease }}
            >
              ChronicleAI
            </motion.span>
            <motion.span className="block" variants={fadeInUp} transition={{ duration: 0.8, ease }}>
              Intelligence that <span className="font-serif italic text-accent">acts</span>
            </motion.span>
          </h1>

          <motion.p
            className="mb-8 max-w-2xl text-lg text-neutral-600"
            variants={fadeInUp}
            transition={{ duration: 0.8, ease }}
          >
            An autonomous onchain intelligence registry &amp; trading desk powered by KeeperHub's 6 execution surfaces: 
            Workflows, MCP Server tools, x402/MPP dual-routing, smart gas preflight dry-runs, Flashbots private RPCs, 
            and Circle CCTP cross-chain liquidity rebalancing.
          </motion.p>

          <motion.div
            variants={fadeInScale}
            transition={{ duration: 0.8, ease }}
            className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center max-[850px]:w-full"
          >
            <Link
              to="/publications"
              className="group relative inline-flex cursor-pointer items-center max-[850px]:w-full"
            >
              <span className="absolute inset-y-0 right-0 w-[calc(100%-2rem)] rounded-xl bg-accent max-[850px]:w-full" />
              <span className="relative z-10 rounded-xl bg-black px-6 py-3 font-medium text-white max-[850px]:flex-1">
                Explore Newspaper
              </span>
              <span className="relative z-10 -left-px flex h-11 w-11 items-center justify-center rounded-xl text-black">
                <ArrowDownRight className="h-5 w-5 transition-transform duration-300 group-hover:-rotate-45" />
              </span>
            </Link>
            <Link
              to="/desk"
              className="inline-flex items-center justify-center rounded-xl border border-black/15 bg-white/80 px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-white max-[850px]:w-full"
            >
              Open Desk
            </Link>
            <Link
              to="/activity"
              className="inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-black/70 transition-colors hover:text-black max-[850px]:w-full"
            >
              Agent activity
            </Link>
          </motion.div>
        </motion.div>
      </div>

      <motion.div
        className="relative mt-24 px-6 max-[850px]:mt-10"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.6, ease }}
      >
        <div className="relative mx-auto max-w-5xl">
          <div className="relative overflow-hidden rounded-2xl border border-neutral-200 shadow-2xl/5 mask-[linear-gradient(to_bottom,black_50%,transparent_100%)] dark:mix-blend-darken [-webkit-mask-image:linear-gradient(to_bottom,black_50%,transparent_100%)]">
            <HeroDashboard />
          </div>
        </div>
      </motion.div>

      <motion.div
        className="pt-24 pb-12"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1, ease }}
      >
        <LogoLoop logos={logos} speed={60} logoHeight={42} gap={124} />
      </motion.div>
    </section>
  );
}
