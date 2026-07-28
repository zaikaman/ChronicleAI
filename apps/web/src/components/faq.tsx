import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

const faqs = [
  {
    question: "What is ChronicleAI?",
    answer:
      "ChronicleAI is an autonomous on-chain newspaper and paid intelligence feed. It monitors blockchain events (trades, liquidations, gas spikes, deployments) via KeeperHub, analyzes them using a fallback hierarchy of Gemini, OpenAI, and Groq, publishes verifiable reports on-chain, and distributes real-time alerts.",
  },
  {
    question: "How is content verified?",
    answer:
      "Every major digest is anchored on Base Sepolia via KeeperHub writes to the Chronicle Registry. Open any report for a clickable proof transaction, or visit Agent Activity for the public execution trail, treasury health, and payout receipts — no login required.",
  },
  {
    question: "How does the paid intelligence access work?",
    answer:
      "Deeper market intelligence, historical feeds, and structured data are gated. Access can be purchased by automated machine clients or human readers using x402 (Base Sepolia subscription) or MPP (Tempo micro-payments) payment routes.",
  },
  {
    question: "How is ChronicleAI self-sustaining?",
    answer:
      "The agent funds its own operational costs—including gas fees and API keys—autonomously. It runs a circular economy loop where subscription, sponsorship, and micro-payment revenues are collected into its Para MPC treasury wallet, with KeeperHub executing on-chain registry writes and Para signing revenue transfers.",
  },
  {
    question: "What are sponsored watches?",
    answer:
      "Protocols or users can pay a small fee to create sponsored watch campaigns. The agent monitors a specific contract or event signature, compiles intelligence reports, and registers them on-chain under the sponsor's name.",
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
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, ease, delay: index * 0.05 }}
      onClick={onToggle}
      className="cursor-pointer rounded-2xl bg-frame p-5 shadow-sm sm:p-6"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      aria-expanded={isOpen}
    >
      <div className="flex w-full items-center justify-between gap-4 text-left">
        <span className="text-base font-medium text-foreground sm:text-lg">
          {faq.question}
        </span>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.3, ease }}
          className="shrink-0"
        >
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        </motion.div>
      </div>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease }}
            className="overflow-hidden"
          >
            <p className="pt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
              {faq.answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
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
            Everything you need to know about ChronicleAI verification and operations.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex"
            >
              <Link
                to="/publications"
                className="inline-flex items-center rounded-xl bg-foreground px-6 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90 cursor-pointer"
              >
                Browse Newspaper
              </Link>
            </motion.div>
            <motion.a
              href="https://sepolia.basescan.org"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex items-center rounded-xl border border-border bg-frame px-6 py-2.5 text-sm font-semibold text-foreground transition-colors cursor-pointer"
            >
              Chronicle Registry
            </motion.a>
          </div>
        </motion.div>

        <div className="flex flex-col gap-3" role="list">
          {faqs.map((faq, index) => (
            <FAQItem
              key={index}
              faq={faq}
              index={index}
              isOpen={openIndex === index}
              onToggle={() => handleToggle(index)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
