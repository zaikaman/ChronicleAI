import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

const faqs = [
  {
    question: "What is ChronicleAI?",
    answer:
      "ChronicleAI is an autonomous on-chain newspaper and policy-gated market desk. It monitors blockchain events via KeeperHub, publishes free alerts and digests with proof-of-publication, sells premium intelligence through x402 and MPP, and runs a closed-loop trading book on Ethereum Sepolia — where an LLM proposes, hard policy decides, and KeeperHub executes.",
  },
  {
    question: "What is Chronicle Desk?",
    answer:
      "The desk is ChronicleAI's capital book: USDC inventory managed against AUM floors and ceilings, with three strategies (risk defend on Aave health factor, yield rotation via Uniswap + Aave, and oracle–AMM basis trades). Every risk-increasing intent is validated by policy; only then does KeeperHub run strategy workflows and anchor a trade ticket on ChronicleRegistry.",
  },
  {
    question: "How is content and trade activity verified?",
    answer:
      "Major digests, alerts, sponsored reports, and trade tickets are written through KeeperHub to ChronicleRegistry on Ethereum Sepolia. Open any publication or desk ticket for a clickable proof transaction, or visit Agent Activity for the public execution trail, treasury health, payouts, and capital moves — no login required.",
  },
  {
    question: "How does paid intelligence access work?",
    answer:
      "Deeper market intelligence, historical feeds, and structured desk data can be gated. Humans pay with x402 (EIP-712 USDC on Base Sepolia via CDP); automated clients settle via MPP. Desk execution and registry proofs stay on Ethereum Sepolia. Sponsored watches let protocols fund dedicated monitoring campaigns with on-chain create and report receipts.",
  },
  {
    question: "How is ChronicleAI self-sustaining?",
    answer:
      "Subscription, sponsorship, and micropayment revenue lands in a Para MPC treasury. The agent retains a safety buffer for gas and operations, can top up the desk book, and routes surplus to creator and affiliate wallets via KeeperHub-executed transfers — with public payout receipts on Activity.",
  },
  {
    question: "Can the LLM trade freely?",
    answer:
      "No. The model outputs structured proposals only (propose, hold, defer, defend) with allowlisted strategies and size hints. Policy enforces notional caps, health-factor gates, cooldowns, gas regime, and kill-switch. If validation fails, the safe default is hold — no KeeperHub write.",
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
        <span className="text-base font-medium text-foreground sm:text-lg">{faq.question}</span>
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
            Newspaper proofs, desk policy, payments, and how KeeperHub keeps every action
            auditable.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="inline-flex">
              <Link
                to="/publications"
                className="inline-flex cursor-pointer items-center rounded-xl bg-foreground px-6 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
              >
                Browse Newspaper
              </Link>
            </motion.div>
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="inline-flex">
              <Link
                to="/desk"
                className="inline-flex cursor-pointer items-center rounded-xl border border-border bg-frame px-6 py-2.5 text-sm font-semibold text-foreground transition-colors"
              >
                Open Desk
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

        <div className="flex flex-col gap-3" role="list">
          {faqs.map((faq, index) => (
            <FAQItem
              key={faq.question}
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
