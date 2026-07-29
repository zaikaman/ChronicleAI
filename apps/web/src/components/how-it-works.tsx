import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { BrainCircuit, ShieldCheck, Activity, Landmark } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

const steps = [
  {
    icon: Activity,
    title: "Monitor & Discover Tools via MCP",
    description:
      "KeeperHub Event Tracker, Block Dispatcher, and MCP Server discover dynamic onchain execution capabilities, feeding market events, APY shifts, and gas regimes into the agent pipeline.",
  },
  {
    icon: BrainCircuit,
    title: "Reason & Preflight Dry-Run",
    description:
      "Tri-provider LLMs (Gemini, OpenAI, Groq) formulate strategic proposals. Before any live transaction, Layer A dry-run preflight (simulate: true) verifies execution logic and computes adaptive gas pricing.",
  },
  {
    icon: Landmark,
    title: "Execute Privately through KeeperHub",
    description:
      "Approved trades execute onchain via KeeperHub workflows using Flashbots Protect private mempools (Ethereum Sepolia), shielding capital movements from MEV front-running and sandwich attacks.",
  },
  {
    icon: ShieldCheck,
    title: "Prove, Settle & Rebalance via CCTP",
    description:
      "Onchain registry proofs anchor to ChronicleRegistry. Paid feeds settle via x402 / MPP dual-protocol challenge routing, while Circle CCTP worker automatically rebalances liquidity between Base and Sepolia.",
  },
];

function StepItem({
  step,
  isLast,
}: {
  step: (typeof steps)[0];
  isLast: boolean;
}): ReactNode {
  const Icon = step.icon;

  return (
    <div className={`relative flex gap-5 ${isLast ? "" : "pb-40 lg:pb-52"}`}>
      <div
        className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent"
        aria-hidden="true"
      >
        <Icon className="h-5 w-5 text-black" strokeWidth={2} />
      </div>

      <div className="pt-1">
        <h3 className="text-xl font-semibold text-foreground sm:text-2xl">{step.title}</h3>
        <p className="mt-2 max-w-sm text-base leading-relaxed text-foreground/60">
          {step.description}
        </p>
      </div>
    </div>
  );
}

export function HowItWorks(): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 0.3", "end 0.7"],
  });

  const lineHeight = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <section ref={containerRef} className="relative w-full bg-background">
      <div className="mx-auto grid max-w-5xl gap-12 px-6 py-20 sm:py-28 lg:grid-cols-2 lg:gap-20">
        <div className="lg:sticky lg:top-48 lg:h-fit lg:self-start">
          <h2 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            How it works
          </h2>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-foreground/60">
            From raw on-chain signal to verifiable publication — and, when policy allows, to a real
            KeeperHub-executed trade ticket.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Link
                to="/publications"
                className="inline-flex cursor-pointer items-center rounded-xl bg-foreground px-6 py-3 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
              >
                Explore Newspaper
              </Link>
            </motion.div>
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Link
                to="/desk"
                className="inline-flex cursor-pointer items-center rounded-xl border border-border bg-frame px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Open Desk
              </Link>
            </motion.div>
          </div>
        </div>

        <div className="relative">
          <div
            className="absolute top-6 left-6 h-[calc(100%-6rem)] w-0.5 -translate-x-1/2 bg-foreground/10"
            aria-hidden="true"
          >
            <motion.div
              style={{ height: lineHeight, willChange: "height" }}
              className="w-full bg-accent"
            />
          </div>

          <ol className="relative m-0 list-none p-0">
            {steps.map((step, index) => (
              <li key={step.title}>
                <StepItem step={step} isLast={index === steps.length - 1} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
