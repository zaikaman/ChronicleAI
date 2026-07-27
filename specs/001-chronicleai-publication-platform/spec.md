# Feature Specification: ChronicleAI Publication Platform

**Feature Branch**: `master`

**Created**: 2026-07-06

**Status**: Draft

**Input**: User description: "Build ChronicleAI: an autonomous on-chain newspaper and paid intelligence feed that monitors blockchain events through KeeperHub, generates public and premium market intelligence, distributes alerts and digests, and funds its own operations through x402 and MPP micro-payments."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Receive Timely Public Market Alerts (Priority: P1)

Public readers and community members receive concise, trustworthy alerts when significant on-chain activity occurs, including large trades, liquidations, gas spikes, unusual transaction volume, or new contract deployments.

**Why this priority**: Real-time public alerts establish ChronicleAI's core value, demonstrate autonomous monitoring, and provide a visible baseline experience even before paid intelligence is used.

**Independent Test**: Can be tested by introducing or replaying a qualifying on-chain event and verifying that a public alert is created with event context, an LLM-generated plain-language summary, source references, provider fallback audit details, and a timestamped audit trail.

**Acceptance Scenarios**:

1. **Given** ChronicleAI is monitoring supported on-chain activity, **When** a transaction or event crosses a configured significance threshold, **Then** ChronicleAI publishes a public alert with the event type, affected protocol or asset, transaction reference, LLM-generated summary, provider used for generation, and publication time.
2. **Given** multiple qualifying events occur close together, **When** alerts are generated, **Then** ChronicleAI avoids duplicate bulletins for the same underlying event and preserves a clear order of publication.
3. **Given** the primary LLM provider is unavailable, **When** alert generation runs, **Then** ChronicleAI automatically attempts the configured secondary provider and then the configured tertiary provider before marking generation as failed.

---

### User Story 2 - Read Daily Intelligence Digest (Priority: P2)

Anyone can review a daily market intelligence digest that synthesizes the prior 24 hours of monitored activity into a structured report with key events, patterns, and notable risks, anchored on-chain with a verifiable proof-of-publication.

**Why this priority**: The daily digest turns raw monitoring into a repeatable publication product, demonstrates autonomous analysis, and guarantees publication authenticity via on-chain state hashes.

**Independent Test**: Can be tested by providing a 24-hour set of captured events, triggering digest generation, and verifying that ChronicleAI produces a complete digest, executes a `publishDigest` transaction on the Chronicle Registry contract, updates the self-hosted publication UI, sends email bulletins via SMTP (e.g., using Gmail credentials), and displays the registry transaction hash on the report.

**Acceptance Scenarios**:

1. **Given** ChronicleAI has captured monitored events during a reporting period, **When** the daily digest schedule is reached, **Then** ChronicleAI creates a report including top events, trend commentary, links to source events, and a clear date, calls `publishDigest` on the Chronicle Registry via KeeperHub, publishes the content to the self-hosted publication UI, and emails the digest to premium subscribers via SMTP.
2. **Given** no significant events were captured during a reporting period, **When** the daily digest schedule is reached, **Then** ChronicleAI publishes a concise no-major-events report on-chain, updates the self-hosted publication UI and SMTP email delivery, and displays the registry transaction hash.
3. **Given** the Daily Digest is published, **When** a user views the digest on the frontend, **Then** the UI displays the transaction hash of the on-chain publication receipt as a clickable link to the block explorer.


---

### User Story 3 - Purchase Premium Intelligence Access & Sponsor Contracts (Priority: P3)

Human readers and automated clients can pay a small fee to access deeper market intelligence (including full reports, historical feeds, and structured data) using x402 (Ethereum Sepolia) or MPP (Tempo) micro-payments. Additionally, protocols can pay to sponsor contract monitoring campaigns.

**Why this priority**: Paid access and sponsored monitoring tasks prove the self-sustaining business model and enable ChronicleAI to fund its own operational gas and API costs autonomously.

**Independent Test**: Can be tested by requesting premium content without payment to receive a 402 challenge, settling via x402 or MPP to unlock it, and initiating a sponsored watch campaign by paying for it on-chain, verifying that KeeperHub executes the corresponding registry actions (`createSponsoredWatch` and `publishSponsoredReport`) and shows them on the dashboard.

**Acceptance Scenarios**:

1. **Given** a user requests premium content without payment, **When** evaluated, **Then** ChronicleAI returns a `402 Payment Required` challenge.
2. **Given** a user settles a valid x402 (Ethereum Sepolia EVM subscription) or MPP (Tempo machine micro-payment), **When** they retry the request, **Then** ChronicleAI returns the private intelligence and logs the revenue.
3. **Given** a protocol pays for a sponsored monitoring task, **When** submitted, **Then** KeeperHub executes a `createSponsoredWatch` transaction on-chain, monitors the target contract, compiles a final report at the end of the campaign, and executes `publishSponsoredReport` on the Chronicle Registry.

---

### User Story 4 - Monitor Agent Sustainability & Treasury Payouts (Priority: P4)

Anyone can inspect ChronicleAI's operating health on the public Activity page, including generated revenue, estimated costs, wallet balance status, execution outcomes, and the details of autonomous revenue routing and refund checks.

**Why this priority**: The agent must operate transparently as a circular economy, exposing safety guardrails, refund alerts, and revenue payout receipts.

**Independent Test**: Can be tested by reviewing the public `/activity` page after simulated x402/MPP revenues and gas expenditures, checking that the Refunding Loop (Loop 3) warns when below the buffer, and that the Revenue Routing Loop (Loop 5) triggers batched payouts, on-chain transfers, and `recordPayout` registry events.

**Acceptance Scenarios**:

1. **Given** ChronicleAI has collected subscription/sponsorship revenue, **When** a visitor opens `/activity`, **Then** they can see recent publications, total revenue, estimated costs, Para MPC wallet balance, and execution logs with no login.
2. **Given** the Para wallet balance drops below the safety buffer, **When** the maintenance check runs, **Then** ChronicleAI logs a failed execution warning and flags the warning on the public Activity page.
3. **Given** the weekly revenue routing loop triggers and net revenue exceeds the safety buffer, **When** executed, **Then** KeeperHub batches token transfers to the allowlisted creator recovery wallet and approved referral partners (attributing capped affiliate rewards), and executes a `recordPayout` transaction on the Chronicle Registry contract.

### Edge Cases

- Qualifying event data is incomplete, delayed, or unavailable from its source.
- A burst of related events could create alert spam or duplicated summaries.
- Payment is initiated but not settled, settles for the wrong amount, or uses an unsupported payment route.
- Daily digest generation runs when no relevant events were captured.
- Publication or notification destinations are unavailable when content is ready.
- Operating funds are below the safety buffer while new monitored events continue to arrive.
- Generated analysis contains unsupported claims, low confidence conclusions, or insufficient source references.
- The primary or secondary LLM provider times out, returns an invalid response, exhausts quota, or is unavailable.
- All configured LLM providers fail during alert generation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: ChronicleAI MUST monitor supported on-chain signals, including block-level gas or volume anomalies, large trades, liquidations, and new smart contract deployments.
- **FR-002**: ChronicleAI MUST allow significance thresholds to be configured for monitored event types so alert sensitivity can be controlled.
- **FR-003**: ChronicleAI MUST transform qualifying monitored events into LLM-generated public alert summaries that include source references, affected assets or protocols when known, event magnitude, provider metadata, and publication time.
- **FR-004**: ChronicleAI MUST prevent duplicate public alerts for the same underlying event within a reasonable deduplication window.
- **FR-005**: ChronicleAI MUST maintain an auditable record of monitored events, generated content, publication attempts, and delivery outcomes.
- **FR-006**: ChronicleAI MUST produce a daily intelligence digest that summarizes the prior reporting period and clearly distinguishes observed facts from analytical interpretation.
- **FR-007**: ChronicleAI MUST publish public summaries through at least one public content destination and at least one public notification destination.
- **FR-008**: ChronicleAI MUST support premium intelligence requests from both human readers and automated clients.
- **FR-009**: ChronicleAI MUST require successful payment before returning premium intelligence content or structured premium feed data.
- **FR-010**: ChronicleAI MUST support both x402 (Ethereum Sepolia network EVM subscriptions) and MPP (Tempo machine-to-machine micro-billing) payment flows for premium access.
- **FR-011**: ChronicleAI MUST record payment attempts, successful settlements, purchased content identifiers, and revenue totals for sustainability reporting.
- **FR-012**: ChronicleAI MUST track operational sustainability indicators, including available treasury balance, estimated content generation costs, estimated transaction costs, paid request volume, and revenue.
- **FR-013**: ChronicleAI MUST record a public low-balance warning when available operating funds fall below the configured safety buffer.
- **FR-014**: ChronicleAI MUST expose a public Activity view showing recent alerts, daily reports, premium access activity, treasury status, executed payouts, active sponsored watches, and execution history.
- **FR-015**: ChronicleAI MUST include clear failure states and retry visibility for publication, notification, payment, registry execution, and monitoring failures.
- **FR-016**: ChronicleAI MUST mark generated analysis with sufficient source references or confidence indicators so readers can distinguish verified event data from synthesized commentary.
- **FR-017**: ChronicleAI MUST avoid publishing premium-only deep analysis in public alerts or public digests unless that content has been intentionally designated as public.
- **FR-018**: ChronicleAI MUST maintain a premium visual experience for all public views consistent with the ChronicleAI product identity.
- **FR-019**: ChronicleAI MUST attempt public alert LLM generation using Gemini first, OpenAI second, and Groq third, stopping at the first valid provider response.
- **FR-020**: ChronicleAI MUST record each LLM provider attempt, including provider name, outcome, latency, failure reason when applicable, and final provider selected.
- **FR-021**: ChronicleAI MUST fail alert generation visibly and retryably when all configured LLM providers fail, without publishing unsupported or fabricated alert content.
- **FR-022**: ChronicleAI MUST write proof-of-publication hashes for public alerts (`publishAlert`) and digests (`publishDigest`) on-chain via the Chronicle Registry smart contract.
- **FR-023**: ChronicleAI MUST record and display on-chain proof-of-publication transaction hashes for each public alert and digest.
- **FR-024**: ChronicleAI MUST support sponsored watch campaigns, executing `createSponsoredWatch` on-chain upon purchase, tracking the target contract/event, and executing `publishSponsoredReport` with the final report hash.
- **FR-025**: ChronicleAI MUST execute autonomous revenue payouts from its Para wallet when funds exceed the safety reserve, distributing configurable recovery shares to the creator/deployer and capping rewards for referrals, followed by recording the payout on-chain (`recordPayout`).
- **FR-026**: ChronicleAI MUST enforce treasury-gated execution where registry writes are suspended if Available Balance is below the safety buffer, logging skipped distributions or alerts.

### Key Entities

- **Monitored Event**: A captured on-chain signal such as a large trade, liquidation, gas spike, volume anomaly, or contract deployment; includes event type, source reference, observed values, related assets or protocols, capture time, and significance score.
- **Public Alert**: A short public bulletin generated from a monitored event; includes title, summary, source references, LLM provider metadata, target destinations, publication status, registry transaction hash, and delivery history.
- **LLM Generation Attempt**: A recorded attempt to generate alert or report content through a configured provider; includes provider name, attempt order, input reference, status, latency, failure reason, and response metadata when available.
- **Daily Digest**: A scheduled market intelligence report covering a defined reporting period; includes highlights, trend commentary, referenced events, publication status, registry transaction hash, source event Merkle root, and audience classification.
- **Premium Intelligence Item**: Paid content or structured feed data that may include deeper analysis, historical context, or machine-readable event intelligence; includes price, access terms, source references, and purchase status.
- **Payment Record**: Evidence of a premium access payment attempt or settlement; includes payment route, amount, status, requested content, payer reference, referral identifier, and settlement time.
- **Sponsored Watch Campaign**: A paid monitoring campaign for a specific contract or event signature; includes target contract, campaign window, registry transaction hashes (creation and publication), and report hashes.
- **Revenue Payout**: A ledger receipt documenting autonomous revenue distributions; includes payout period hash, recipient wallet address, token amount, reason hash, transfer transaction hash, and registry write transaction hash.
- **Treasury Status**: The operating funds state for the autonomous agent; includes available balance, safety buffer, estimated costs, revenue totals, and latest maintenance outcome.
- **Execution Log**: An audit entry for monitoring, generation, publication, notification, payment, registry writes, payouts, or maintenance activity; includes action type, result, timestamp, and relevant references.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of qualifying on-chain events produce a public alert within 2 minutes of detection during normal operation.
- **SC-002**: Daily digests are published for 100% of scheduled reporting periods, including no-major-events periods.
- **SC-003**: At least 90% of generated public alerts include a source reference, event magnitude, and plain-language explanation understandable without reading raw transaction data.
- **SC-004**: 100% of premium intelligence responses require a successful payment record before paid content is returned.
- **SC-005**: Paid access users can complete a premium content purchase and receive the requested content in under 30 seconds during normal operation.
- **SC-006**: Visitors can determine the agent's current sustainability status, recent revenue, estimated costs, active sponsored campaigns, payout distributions, and treasury safety-buffer state in under 1 minute from the public Activity page.
- **SC-007**: Duplicate public alerts for the same underlying event remain below 2% of total alert volume in representative testing.
- **SC-008**: At least 80% of test readers rate the public alert and daily digest summaries as clear, credible, and useful for understanding relevant on-chain activity.
- **SC-009**: 100% of public alert generation attempts record provider attempt history, including fallback from Gemini to OpenAI and from OpenAI to Groq when earlier providers fail.
- **SC-010**: When Gemini fails in representative testing, at least 95% of otherwise valid alert-generation requests complete through OpenAI or Groq within the 2-minute alert publication target.
- **SC-011**: 100% of generated alerts and daily digests successfully call their respective Chronicle Registry methods (`publishAlert`, `publishDigest`) and register the transaction hash on-chain when the Para wallet is funded above the safety buffer.
- **SC-012**: Payouts to allowlisted creators and referrers are successfully routed, executed on-chain, and recorded via `recordPayout` within the designated weekly execution cycle.

## Assumptions

- ChronicleAI's initial audience includes public Web3 readers, premium market intelligence subscribers, automated clients, and hackathon judges. Every product surface is public; there is no private operator console.
- Supported event categories for the first release are large swaps, liquidations, gas or transaction-volume anomalies, and new contract deployments.
- Thresholds for event significance, treasury safety buffer, and premium pricing are environment-configurable and seeded with conservative defaults.
- Public summaries may describe key findings, but detailed analysis, historical feed access, and structured premium data remain gated by payment.
- Payment access is scoped to pay-per-request and recurring subscription demonstrations; complex invoicing, refunds, and dispute handling are outside the first release.
- The public Activity view is intended for transparency and demonstration, not full financial accounting.
- Publication destinations and notification channels may vary by deployment, but the experience must demonstrate both public content publishing (self-hosted React publication UI) and real-time community notification (Discord/Telegram).
- Public alert generation uses the provider fallback order Gemini, then OpenAI, then Groq. Provider API keys are backend-only secrets and are never exposed to the frontend.
- If all LLM providers fail, ChronicleAI records a failed generation state and retryable execution log rather than publishing a fabricated summary.
- The Chronicle Registry contract is deployed to a supported testnet (such as Ethereum Sepolia) and the agent uses a secure Para MPC wallet for gas funding and token payouts.
