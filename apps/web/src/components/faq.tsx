import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";

const faqs = [
  {
    question: "What is ChronicleAI?",
    answer:
      "ChronicleAI is a self-funding onchain intelligence desk. It watches markets, publishes public Alerts, sells deeper analysis to humans and AI agents, routes premium revenue into a risk-controlled treasury, and sends only approved Actions through KeeperHub with public proof.",
  },
  {
    question: "What does ChronicleAI sell?",
    answer:
      "The public layer provides sourced Alerts and digests. Chronicle Pass — $4.99/month — unlocks every human deep dive and the full editorial archive. Sponsored Watch campaigns and machine-readable feeds are priced separately through ChronicleAI’s x402 or MPP payment rails.",
  },
  {
    question: "How much does premium access cost?",
    answer:
      "Readers subscribe to Chronicle Pass at $4.99 USDC per month, authorized by their wallet. One subscription covers all deep dives, historical premium items, and archive access. Renewal is always user-initiated — ChronicleAI never charges a wallet silently. Sponsored watches and API/agent feeds are separate, per-item products.",
  },
  {
    question: "What is Chronicle Desk?",
    answer:
      "Chronicle Desk is the treasury review and execution surface. It shows the market context, proposal, risk checks, preflight result, and KeeperHub Action state before a transaction can be sent.",
  },
  {
    question: "How is content and trade activity verified?",
    answer:
      "A path is only called verified when a real decision, action, and transaction proof exist. Approved Actions run through KeeperHub and may anchor a receipt on ChronicleRegistry. The market context, policy decision, transaction hash, and public execution trail stay linked.",
  },
  {
    question: "Can the LLM trade freely?",
    answer:
      "No. Eligible Alerts become Signals first when applicable; the model then outputs structured proposals only (propose, hold, defer, defend) with allowlisted strategies and size hints. Policy enforces notional caps, health-factor gates, cooldowns, gas regime, and kill-switch. If validation fails, the safe default is hold — no KeeperHub write. Registry or publication failure never blocks a safe Desk action.",
  },
];

const ease = [0.23, 1, 0.32, 1] as const;

function FAQItem({
  faq,
  index,
  isOpen,
  onToggle,
}: {
  faq: (typeof faqs)[0];
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}): ReactNode {
  return (
    <motion.li
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, ease, delay: index * 0.05 }}
      className="rounded-2xl bg-frame p-5 shadow-sm sm:p-6"
    >
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`faq-answer-${index}`}
        id={`faq-question-${index}`}
      >
        <span className="text-base font-medium text-foreground sm:text-lg">{faq.question}</span>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.3, ease }}
          className="shrink-0"
          aria-hidden="true"
        >
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.section
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease }}
            className="overflow-hidden"
            id={`faq-answer-${index}`}
            aria-labelledby={`faq-question-${index}`}
          >
            <p className="pt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
              {faq.answer}
            </p>
          </motion.section>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export function FAQ(): ReactNode {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const handleToggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="w-full px-6 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease }}
          className="mb-12 text-center sm:mb-16"
        >
          <span className="text-sm font-medium text-muted-foreground">
            Frequently Asked Questions
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Common questions
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
            Market intelligence, Chronicle Pass subscriptions, treasury controls, KeeperHub
            execution, and the proof behind every approved run.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex"
            >
              <Link
                to="/alerts"
                className="inline-flex cursor-pointer items-center rounded-xl bg-foreground px-6 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
              >
                View live alerts
              </Link>
            </motion.div>
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex"
            >
              <Link
                to="/desk"
                className="inline-flex cursor-pointer items-center rounded-xl border border-border bg-frame px-6 py-2.5 text-sm font-semibold text-foreground transition-colors"
              >
                Open Desk
              </Link>
            </motion.div>
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex"
            >
              <Link
                to="/subscription"
                className="inline-flex cursor-pointer items-center rounded-xl border border-border bg-frame px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Get Chronicle Pass
              </Link>
            </motion.div>
            <motion.a
              href="https://sepolia.etherscan.io/address/0xD8Deb4475a7E23E194Bc93f8739858Fb20744111"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex cursor-pointer items-center rounded-xl border border-border bg-frame px-6 py-2.5 text-sm font-semibold text-foreground transition-colors"
            >
              Chronicle Registry
            </motion.a>
          </div>
        </motion.div>

        <ul className="flex flex-col gap-3">
          {faqs.map((faq, index) => (
            <FAQItem
              key={faq.question}
              faq={faq}
              index={index}
              isOpen={openIndex === index}
              onToggle={() => handleToggle(index)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
