# Product

## Register

product

## Platform

web

## Users

Public crypto readers scanning ChronicleAI for timely, verifiable on-chain market intelligence. They open alerts and digests under time pressure—checking large trades, liquidations, gas spikes, and risk signals—and need plain-language summaries they can trust without logging in. Secondary personas include protocol teams who sponsor contract watches and inspect public agent activity, and automated clients that pay for premium structured feeds; design defaults to the human reader first.

## Product Purpose

ChronicleAI is an autonomous on-chain newspaper, paid intelligence feed, and policy-gated market desk. It monitors blockchain activity through KeeperHub, publishes public Alerts and daily digests with proof-of-publication receipts, projects eligible Alerts into Desk Signals (Alert → Signal → Action), monetizes deeper analysis via x402/MPP micropayments, runs a closed-loop trading book (risk defend, yield rotation, oracle–AMM) where an LLM proposes under hard policy and KeeperHub executes, and exposes a transparent Activity trail for treasury health, desk intents, trade tickets, and execution outcomes. Success means readers can go from “what happened on-chain?” to a sourced, verifiable summary in seconds—and can confirm the agent actually executed, not only reasoned.

## Brand Personality

**Precise · Verifiable · Calm.** Editorial confidence of a serious market desk: clear hierarchy, sourced claims, and visible on-chain proofs. Voice is direct and technical when needed, never hype. Emotional goals: confidence that the feed is accurate and auditable; calm focus while scanning dense market signal; quiet trust rather than urgency theater.

## Anti-references

- Generic SaaS crypto dashboards: navy/purple gradients, glassmorphism, hero-metric templates, identical icon+heading feature card grids, and “AI made that” landing scaffolds.
- Casino / meme degen aesthetics: neon overload, confetti, pump-style urgency, gambling UI.
- Pure blockchain explorers: raw transaction tables with no editorial hierarchy, no human-readable narrative, no publication craft.

## Design Principles

1. **Proof before polish** — On-chain hashes, explorer links, and execution status are first-class UI, not footnotes. If it claimed to publish, show the receipt.
2. **Editorial over dashboard** — Structure content like a newspaper desk (headline → summary → source → proof), not like an analytics wall of equal-weight cards.
3. **Calm density** — Surface high signal without shouting. Prefer clear type hierarchy and progressive disclosure over badges, neon, and motion noise.
4. **Trust through transparency** — Empty, loading, and failure states are honest and recoverable; never fake liveness or hide treasury/execution risk.
5. **Human first, machine ready** — Optimize scanning and reading for people; keep premium and payment flows unambiguous for wallets and automated clients without compromising the reader experience.
6. **Honest execution routing & gas sponsorship** — Desk trades and capital moves on Ethereum Sepolia use a **private submission path** (Flashbots Protect via KeeperHub private mempool routing). Public registry writes (alerts, digests, sponsored reports, receipts) use public mempool submission with **KeeperHub gas sponsorship** preferred. Product copy must say “private route” or “Public (Sponsorship requested)” accurately based on on-chain and workflow status.

## Hybrid execution routing (product note)

| Class | Routing | Sponsorship | Product copy |
|-------|---------|-------------|--------------|
| **Desk Strategies & Capital** | Private Mempool (Flashbots Protect) | Not applicable | "Private route" / "Private route (requested)" |
| **Registry & Alerts** | Public Mempool | Preferred / Sponsored | "Public (Sponsorship requested)" / "Public (Sponsored)" |
| Chain | Ethereum Sepolia (`11155111`) | Org Turnkey Gas Station | Honest badges on Activity and Desk feeds |

Operator and workflow setup: `workflows/keeperhub/README.md` (Private routing section).

## Execution audit (product note)

Desk trade tickets may include a continuous **execution audit** story: **policy preflight → workflow submit → outcome** (gas, txs, terminal status), plus **Run steps** from KeeperHub execution logs when available. Optional later: KeeperHub dry-run on preflight.

| Prefer | Avoid |
|--------|--------|
| Execution audit | “MEV-proof log” |
| Policy preflight | “KeeperHub simulation” for HF-only policy checks |
| KeeperHub dry-run | Bare “we simulated” without naming the dry-run path |
| Workflow run / KeeperHub run | “Job id” alone |
| Private submission path | “MEV-protected” as an absolute claim |
| Gas used (when real) | Invented estimates presented as fact |
| Outcome filled / failed | “Probably landed” |

Tone stays calm, editorial, proof-first — same as the rest of the desk ticket.

## Accessibility & Inclusion

Target **WCAG 2.2 AA**. Body text contrast ≥4.5:1 (large text ≥3:1); placeholders meet body contrast. Full keyboard access and visible focus rings. Skip-to-content and semantic landmarks remain standard. Honor `prefers-reduced-motion` for all motion (crossfade or instant alternatives). Do not rely on color alone for status (execution success/failure, confidence, payment state).
