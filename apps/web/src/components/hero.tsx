import { LogoLoop, type LogoItem } from "./logo-loop";
import { ArrowDownRight, Activity, ShieldCheck, Rss, Check } from "lucide-react";
import { motion, useMotionValue, useSpring } from "motion/react";
import { useMemo, useRef, type ReactNode, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { useAgentActivity } from "../features/activity/use-agent-activity.ts";
import { useAlerts } from "../features/alerts/use-alerts.ts";
import { truncateHash } from "../lib/explorer.ts";

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
  { node: <span className="text-[1em] font-semibold tracking-tight">KeeperHub</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">Ethereum</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">Base Sepolia</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">x402 Micropayments</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">MPP Tempo</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">Gemini 3.5</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">OpenAI GPT-4o</span> },
  { node: <span className="text-[1em] font-semibold tracking-tight">Groq Llama-3</span> },
];

const PARALLAX_INTENSITY = 20;

const CHAIN_LABELS: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  84532: "Base Sepolia",
  11155111: "Sepolia",
};

function HeroDashboard(): ReactNode {
  const { alerts, isLoading: alertsLoading } = useAlerts(5);
  const { data: activity, isLoading: activityLoading } = useAgentActivity();

  const isLoading = alertsLoading || activityLoading;

  const signals = useMemo(() => {
    return alerts.slice(0, 3).map((alert) => {
      const chainLabel =
        typeof alert.chainId === "number"
          ? (CHAIN_LABELS[alert.chainId] ?? `Chain ${alert.chainId}`)
          : undefined;
      const tag =
        chainLabel ??
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

  const settledPayments = useMemo(
    () => activity?.payments.filter((p) => p.status === "settled").length ?? 0,
    [activity],
  );

  const latestAnchoredDigest = useMemo(() => {
    if (!activity?.digests?.length) return null;
    return (
      activity.digests.find((d) => Boolean(d.registryTxHash)) ?? activity.digests[0] ?? null
    );
  }, [activity]);

  return (
    <div className="aspect-[16/9] w-full bg-neutral-950 p-5 text-white sm:p-8" data-testid="hero-live-dashboard">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">ChronicleAI Agent</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-4xl">Live Signal Monitor</h2>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-black">
          <Activity className="h-6 w-6" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm text-white/60">
              {isLoading ? "Loading signals…" : "Latest published alerts"}
            </span>
            <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-black">KeeperHub</span>
          </div>
          <div className="space-y-3">
            {signals.length === 0 && !isLoading ? (
              <div className="rounded-xl bg-black/30 p-4 text-sm text-white/50">
                No published alerts yet. Signals appear here when ChronicleAI detects significant on-chain events.
              </div>
            ) : (
              signals.map((s) => (
                <Link
                  key={s.id}
                  to={s.href}
                  className="flex items-center justify-between rounded-xl bg-black/30 p-3 hover:bg-black/45 transition-colors"
                >
                  <div className="min-w-0 pr-3">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <p className="mt-1 text-xs text-white/45 line-clamp-2">{s.details}</p>
                  </div>
                  <span className="font-mono text-xs font-semibold text-accent bg-accent/10 px-2 py-1 rounded-lg flex-shrink-0">
                    {s.tag}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-2xl bg-accent p-4 text-black">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Rss className="h-4 w-4" />
              Settled micropayments
            </div>
            <p className="mt-4 text-5xl font-semibold tracking-tight" data-testid="hero-settled-payments">
              {isLoading ? "—" : settledPayments.toLocaleString()}
            </p>
            <p className="mt-2 text-sm text-black/60">
              From live x402 &amp; MPP settlements recorded by the agent.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-accent" />
              On-chain anchor
            </div>
            {latestAnchoredDigest ? (
              <Link
                to={`/digests/${latestAnchoredDigest.id}`}
                className="text-sm leading-relaxed text-white/70 hover:text-white transition-colors flex flex-col gap-1"
              >
                <span className="flex items-center gap-1.5 font-medium text-white">
                  {latestAnchoredDigest.title.length > 48
                    ? `${latestAnchoredDigest.title.slice(0, 48)}…`
                    : latestAnchoredDigest.title}
                  {latestAnchoredDigest.registryTxHash ? (
                    <Check className="h-3.5 w-3.5 text-accent inline-block" />
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
                  : "No digests anchored yet. Daily digests appear here after publication."}
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
      className="flex flex-col relative z-0" 
      style={{ colorScheme: 'light' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div 
        className="absolute inset-0 min-[850px]:inset-2.5 bg-cover bg-center bg-no-repeat -z-10 brightness-125 rounded-br-4xl rounded-bl-4xl min-[850px]:scale-105"
        style={{ 
          backgroundImage: 'url(/BG.jpg)',
          x,
          y,
        }}
        aria-hidden="true"
      />
      
      <div className="flex items-start justify-center px-6 pt-64 max-[850px]:pt-32">
        <motion.div
          className="flex flex-col items-center max-[850px]:items-start text-center max-[850px]:text-left max-w-4xl max-[850px]:w-full"
          initial="hidden"
          animate="visible"
          transition={{ staggerChildren: 0.15, delayChildren: 0.2 }}
        >
          <motion.div
            className="inline-flex items-center gap-1.5 pl-4 pr-3 py-1.5 rounded-xl border border-black/10 bg-white text-black text-sm font-medium mb-6"
            variants={fadeInUp}
            transition={{ duration: 0.8, ease }}
          >
            Autonomous On-Chain newspaper
            <span className="text-accent">+</span>
          </motion.div>

          <h1 className="text-8xl max-[850px]:text-5xl font-medium tracking-tight leading-[1.1] mb-6 text-black">
            <motion.span
              className="block font-bold tracking-tighter"
              style={{ fontFamily: "var(--font-space-grotesk)" }}
              variants={fadeInUp}
              transition={{ duration: 0.8, ease }}
            >
              ChronicleAI
            </motion.span>
            <motion.span
              className="block"
              variants={fadeInUp}
              transition={{ duration: 0.8, ease }}
            >
              Intelligence with <span className="italic font-serif text-accent">Proof</span>
            </motion.span>
          </h1>

          <motion.p
            className="text-lg text-neutral-600 mb-8"
            variants={fadeInUp}
            transition={{ duration: 0.8, ease }}
          >
            An autonomous on-chain newspaper. Read free alerts and digests, verify KeeperHub publication proofs, and unlock deeper analysis with x402 or MPP — only when you pay.
          </motion.p>

          <motion.div
            variants={fadeInScale}
            transition={{ duration: 0.8, ease }}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 max-[850px]:w-full"
          >
            <Link
              to="/publications"
              className="group relative cursor-pointer inline-flex items-center max-[850px]:w-full"
            >
              <span className="absolute right-0 inset-y-0 w-[calc(100%-2rem)] max-[850px]:w-full rounded-xl bg-accent" />
              <span className="relative z-10 px-6 py-3 rounded-xl bg-black text-white font-medium max-[850px]:flex-1">
                Explore Newspaper
              </span>
              <span className="relative -left-px z-10 w-11 h-11 rounded-xl flex items-center justify-center text-black">
                <ArrowDownRight className="w-5 h-5 transition-transform duration-300 group-hover:-rotate-45" />
              </span>
            </Link>
            <Link
              to="/alerts"
              className="inline-flex items-center justify-center rounded-xl border border-black/15 bg-white/80 px-6 py-3 text-sm font-semibold text-black hover:bg-white transition-colors max-[850px]:w-full"
            >
              Live alerts
            </Link>
          </motion.div>
        </motion.div>
      </div>

      <motion.div
        className="relative px-6 mt-24 max-[850px]:mt-10"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.6, ease }}
      >
        <div className="relative max-w-5xl mx-auto">
          <div 
            className="relative dark:mix-blend-darken rounded-2xl overflow-hidden border border-neutral-200 shadow-2xl/5 mask-[linear-gradient(to_bottom,black_50%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_50%,transparent_100%)]"
          >
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
