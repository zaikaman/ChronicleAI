# ChronicleAI: The Autonomous On-Chain Newspaper and Paid Intelligence Feed

ChronicleAI is a fully autonomous, self-sustaining AI-run media and data feed business. Operating through KeeperHub as its on-chain execution layer, the agent monitors blockchain state changes and events, generates premium technical market reports, publishes summaries to public platforms, anchors every major alert and digest on-chain as a verifiable proof-of-publication, monetizes deep-dive analytical feeds using x402 and MPP micro-payments, and periodically routes net revenue back to creators and referral partners through KeeperHub-executed on-chain payouts.

---

## 1. Executive Summary

Most hackathon agents focus purely on DeFi trading or simple visual assistants. ChronicleAI solves the problem of information asymmetry in Web3 by running an independent content publication platform that can prove what it knew, when it knew it, what it published, and how it distributed earned revenue. By combining real-time blockchain monitoring, LLM-generated reporting, KeeperHub-executed proof-of-publication transactions, Web2 webhooks, pay-per-call API access, and autonomous treasury routing, ChronicleAI demonstrates a complete circular agent economy with visible on-chain execution.

The core hackathon transaction is simple and defensible: when ChronicleAI publishes an important alert or daily digest, it uses KeeperHub to write a hash of the generated report, source transaction references, timestamp metadata, and content URI to a lightweight Chronicle Registry contract. This creates a public transaction proving that the agent executed on-chain, not just reasoned off-chain.

---

## 2. Core Architecture and KeeperHub Integrations

ChronicleAI is built on top of the KeeperHub execution and reliability layer, utilizing the following core surfaces:

### On-Chain Monitoring (Triggers)
* **Block Dispatcher**: Tracks block headers to spot sudden gas price spikes or spikes in transaction volume.
* **Event Tracker**: Listens to smart contract events, such as large Uniswap or CoW Swap trades, liquidations on Aave V3, or new smart contract deployments.

### Content Generation and Delivery (Actions)
* **LLM Reasoning**: Synthesizes structured event data into clean markdown reports, articles, and newsletters.
* **ChronicleAI Publication UI**: The self-hosted React newspaper site displays all articles, digests, and alerts as browsable content.
* **Telegram Plugin**: Broadcasts alert summaries and news bulletins directly to public chat channels.
* **SMTP Email Service (Nodemailer)**: Sends daily digests to email subscribers using SMTP credentials (e.g. Gmail).

### On-Chain Execution (KeeperHub Write Actions)
* **Chronicle Registry Writes**: For every qualifying alert and daily digest, the agent calls a simple smart contract through KeeperHub's Web3 Write Contract action to store:
  * `contentHash`: hash of the generated report or alert.
  * `sourceEventHash`: hash of the source transaction/event bundle used by the agent.
  * `contentUri`: public URL or storage URI for the published article.
  * `reportType`: alert, daily digest, sponsored watch report, or premium intelligence receipt.
* **Proof-of-Publication Receipts**: Each public article displays the transaction hash created by KeeperHub, proving the agent executed an on-chain publication receipt.
* **Sponsored Watch Receipts**: When a project buys a sponsored monitoring task, ChronicleAI writes a watch receipt on-chain that records the monitored contract, campaign window, and content hash for the final report.
* **Revenue Routing Payouts**: When settled revenue exceeds the operating safety buffer, the agent uses KeeperHub to transfer configured shares to the creator/deployer wallet, DAO treasury, and approved referral partners.
* **Treasury-Gated Execution**: Registry writes only execute when the agent's Para MPC treasury wallet has enough funds above the safety buffer; otherwise the agent logs a failed execution attempt and surfaces a public low-balance warning on the Activity page.

### Monetization and Payments (x402 and MPP)
* **Dual-Protocol Payments**: The agent exposes its full database of detailed analytics via an OpenAPI endpoint. Human readers or secondary trading bots access the full data feed by settling micro-payments via:
  * **x402 (Base)** for EVM-based subscriptions.
  * **MPP (Tempo)** for machine-to-machine micro-billing.
* **Treasury Wallet**: Production Para MPC wallet (API-key programmatic wallet via Para REST) holds subscription revenue. KeeperHub executes registry writes; Para signs outbound revenue transfers and exposes live balance for Loop 3 safety checks.

---

## 3. Financial Sustainability Model (The Circular Economy)

For the agent to run indefinitely without human developer funding, it must balance its cash flow:

### Outgoing Operational Costs
* **Gas Fees**: Required for KeeperHub-executed proof-of-publication registry writes, sponsored watch receipts, optional access receipts, or other smart contract interactions.
* **API Fees**: LLM synthesis and image generation API costs (billed to the agent's wallet or funded via gas sponsorship).

### Incoming Revenue Vectors
* **Pay-Per-Call API**: Users pay a micro-charge (e.g. 0.05 USDC) per request to query the agent's premium feed.
* **Monthly Newsletter Subscriptions**: Handled via recurring x402 agreements.
* **Sponsored Alerts**: Projects pay the agent to run dedicated monitoring tasks on their contracts, with an on-chain sponsored watch receipt proving the monitoring campaign was accepted.
* **Verifiable Report Receipts**: Premium users can verify that the report they bought corresponds to an on-chain content hash rather than mutable off-chain text.

### Autonomous Revenue Router
Once operating funds exceed a configured safety buffer, ChronicleAI routes net revenue according to transparent rules:

* **Creator/Deployer Recovery**: A configurable share of net revenue is sent to the wallet or DAO treasury that deployed the agent. This is framed as creator recovery or treasury funding, not a public investment dividend.
* **Referral Partner Rewards**: x402 subscription intent metadata can include a referral identifier. When that subscriber settles payments, ChronicleAI attributes a capped percentage of eligible revenue to the approved referral partner.
* **Agent Operating Reserve**: The agent always retains a minimum balance for gas, LLM calls, and emergency retry costs before any payout occurs.
* **On-Chain Payout Receipts**: KeeperHub executes payout transactions and the dashboard records recipient, payout period, revenue basis, amount, transaction hash, and reason.
* **Safety Guardrails**: Demo payout recipients are allowlisted, referral percentages are capped, and payouts are batched periodically to reduce gas costs.

---

## 4. Autonomous Execution Loops

ChronicleAI operates via five decoupled loops managed by KeeperHub's execution services:

### Loop 1: The Alert Loop (Real-Time)
* **Trigger**: Event Tracker captures a transaction exceeding a specific threshold (e.g., a swap > $500,000 USD).
* **Action**:
  1. The agent fetches transaction details using the web3 plugin.
  2. The LLM generates a breaking alert.
  3. The agent hashes the alert content and source event bundle.
  4. KeeperHub executes a `publishAlert` transaction on the Chronicle Registry contract.
  5. The agent sends the alert to Telegram with the KeeperHub execution transaction hash.

### Loop 2: The Daily Digest Loop (Scheduled)
* **Trigger**: Scheduled Trigger (daily cron job).
* **Action**:
  1. The agent compiles all on-chain data logged over the past 24 hours.
  2. The LLM writes a comprehensive daily market intelligence report.
  3. The agent creates a digest content hash and source-event Merkle root.
  4. KeeperHub executes a `publishDigest` transaction on the Chronicle Registry contract.
  5. The agent publishes the report to the self-hosted ChronicleAI publication UI with the registry transaction hash.
  6. The agent emails the report to premium subscribers using the SMTP email service.

### Loop 3: The Refunding Loop (Maintenance)
* **Trigger**: Periodic cron job (weekly).
* **Action**:
  1. The agent checks its Para MPC treasury wallet balance.
  2. If the balance exceeds the safety buffer, it retains it for gas.
  3. If the balance drops below the threshold, it triggers an audit report showing utility metrics and records a public low-balance warning on the Activity page.

### Loop 4: The Sponsored Watch Loop (Paid On-Chain Execution)
* **Trigger**: A protocol pays for a sponsored monitoring task through x402 or MPP and submits the contract address or event signature it wants monitored.
* **Action**:
  1. The agent validates the requested watch target and campaign window.
  2. KeeperHub executes a `createSponsoredWatch` transaction on the Chronicle Registry contract, proving that ChronicleAI accepted the monitoring job.
  3. Event Tracker monitors the sponsored contract during the campaign window.
  4. At the end of the campaign, the agent generates a sponsored watch report.
  5. KeeperHub executes a `publishSponsoredReport` transaction with the final report hash and source-event root.
  6. The dashboard shows both transaction hashes as the on-chain audit trail for the paid campaign.

### Loop 5: The Revenue Routing Loop (Autonomous Treasury Distribution)
* **Trigger**: Scheduled Trigger (e.g., weekly) or a KeeperHub workflow.
* **Action**:
  1. The agent totals settled x402/MPP revenue for the payout period.
  2. The agent subtracts estimated gas, API costs, and the required operating reserve.
  3. If net distributable revenue is positive, it calculates creator/deployer recovery and referral partner rewards.
  4. KeeperHub executes batched token transfers from the agent treasury wallet to the allowlisted recipients.
  5. The agent writes payout receipts to the dashboard, including transaction hashes and the payout calculation basis.
  6. If the safety buffer is not met, the agent skips payouts and logs the skipped distribution reason.

---

## 5. Chronicle Registry Contract (On-Chain Execution Target)

To satisfy the hackathon requirement with real, useful transactions, ChronicleAI includes a minimal registry contract deployed on **Ethereum Sepolia** (ops / desk rail). Human x402 payments settle on **Base Sepolia**; treasury rebalances via CCTP so the desk and registry stay co-located on Ethereum Sepolia.

### Required Contract Methods
* **`publishAlert(bytes32 contentHash, bytes32 sourceEventHash, string contentUri)`**: Stores a public alert proof-of-publication.
* **`publishDigest(bytes32 contentHash, bytes32 sourceEventRoot, string contentUri)`**: Stores a daily digest proof-of-publication.
* **`createSponsoredWatch(address targetContract, bytes32 watchSpecHash, uint64 startsAt, uint64 endsAt)`**: Records that the agent accepted a paid monitoring campaign.
* **`publishSponsoredReport(uint256 watchId, bytes32 reportHash, bytes32 sourceEventRoot, string contentUri)`**: Records the final report for a sponsored monitoring campaign.
* **`recordPayout(bytes32 payoutPeriodHash, address recipient, uint256 amount, bytes32 reasonHash)`**: Optionally records payout metadata when the actual token transfer is executed separately through KeeperHub.

### Revenue Routing Execution Target
The revenue router can be implemented with simple KeeperHub token transfer actions for the demo:

* **Creator/DAO payout transfer**: Sends the creator recovery share to the deployer wallet or DAO treasury.
* **Referral reward transfer**: Sends capped referral rewards to approved affiliate wallets.
* **Optional payout registry write**: Records payout metadata on the Chronicle Registry contract when a separate on-chain audit receipt is useful.

The most important demo requirement is that the payout itself is a real KeeperHub-executed on-chain transfer from the agent treasury wallet.

### Demo Transaction Strategy
* The live demo should show ChronicleAI processing a real or replayed qualifying event.
* The agent should call KeeperHub to execute `publishAlert`.
* The demo can also show the weekly revenue router executing a small payout transfer to a creator or referral wallet after a simulated x402/MPP paid subscription.
* The dashboard should display:
  * KeeperHub execution status.
  * Registry transaction hash.
  * Revenue payout transaction hash when applicable.
  * Gas used.
  * Source event reference.
  * Generated alert hash.
* The DoraHacks submission should link directly to this registry transaction.

This keeps ChronicleAI's product identity intact: it is still an autonomous newspaper, but now its credibility and hackathon eligibility come from real KeeperHub-executed on-chain publication receipts.

---

## 6. Hackathon Submission Strategy

To maximize the chance of winning the Grand Prize and the stackable Onboarding UX Improvement bounty:

* **Demonstrate Live Execution**: Link a transaction where KeeperHub executed `publishAlert`, `publishDigest`, `createSponsoredWatch`, or an autonomous revenue-routing payout from the agent's wallet.
* **Show the On-Chain Proof**: In the dashboard, each alert and digest should display its registry transaction hash, content hash, source event hash, gas used, and KeeperHub execution status. Revenue payouts should display payout period, recipient, amount, reason, and transaction hash.
* **Provide the Agent Starter Kit**: Include a repository template demonstrating how developers can build a paid read-workflow API on KeeperHub using x402/MPP.
* **Visual Audit Trail**: Build a polished, glassmorphic dashboard showing recent articles, subscription analytics, referral attribution, KeeperHub execution logs, registry transaction hashes, payout transactions, and raw event provenance.
