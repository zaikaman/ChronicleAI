# ChronicleAI

> **Watch. Earn. Act.**
>
> ChronicleAI is an AI research desk that monitors important onchain activity, sells a **Chronicle Pass** subscription for deeper intelligence, uses that predictable revenue for carefully controlled treasury actions, and publishes public proof of what happened.

[![KeeperHub](https://img.shields.io/badge/KeeperHub-execution%20%26%20reliability-blueviolet?style=for-the-badge)](https://keeperhub.com)
[![Tests](https://img.shields.io/badge/Tests-1255%20passing-brightgreen?style=for-the-badge)](https://github.com/zaikaman/ChronicleAI#verification)
[![LangChainJS](https://img.shields.io/badge/LangChainJS-agent%20framework-1C3C3C?style=for-the-badge&logo=langchain&logoColor=white)](https://js.langchain.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?style=for-the-badge)](https://www.typescriptlang.org/)

![youtube](https://youtu.be/E8M1e9Rmzes)

## How ChronicleAI works

ChronicleAI turns onchain information into a visible business loop:

**Watch → Earn → Act → Prove**

```text
[Onchain Activity] ---> [Watch Update & Telegram DM]
                               |
                               v
                     [Premium Intelligence]
                               |
                               v
                  [Revenue Routed to Treasury]
                               |
                               v
                    [Desk Safety Checks]
                               |
                               v
                    [KeeperHub Execution]
                               |
                               v
                    [Verified Onchain Action]
                               |
                               v
                [Public Proof & Audit Trail]
```

- **Watch:** ChronicleAI continuously monitors onchain activity across two streams: public **Market events** and **Desk triggers** published on the [Alerts](https://chronicle-ai-web.vercel.app/alerts) feed, and targeted wallet/contract monitoring with Telegram notifications on [Watch](https://chronicle-ai-web.vercel.app/watch).
- **Earn:** Readers subscribe to **Chronicle Pass at $4.99/month** for deep dives and full archives; sponsored Watch campaigns and machine/API feeds are separate products.
- **Act:** The desk applies safety rules before deciding whether treasury capital should be used, defended, rotated, or held.
- **Prove:** KeeperHub handles approved onchain actions, while ChronicleAI links receipts, tx hashes, and audit trails.

Activity can start with an external market event or internal desk condition (APY variance, health-factor shift, gas, capital). ChronicleAI only labels an action verified when a real decision, transaction, and public proof exist.

Chronicle Pass subscriptions, per-item machine feeds, Watch campaigns, sponsored reports, treasury routing, and affiliate payouts extend this loop, showing how ChronicleAI funds an operating desk from predictable intelligence revenue.

## See it in action

**ChronicleAI watches something important, helps people understand it, sells a $4.99/month Chronicle Pass for the deeper answer, routes subscription revenue through safety rules into a treasury desk, executes through KeeperHub, and shows the proof.**

> [!IMPORTANT]
> **Battle-Tested Execution at Scale:** Rather than a static demo or one-off mock, ChronicleAI is a battle-tested autonomous desk that has executed over **3,000+ unique verified transactions through KeeperHub** — spanning automated market alerts, yield rebalances, registry proof publications, trade tickets, and sponsored intelligence updates. View the complete, paginated live execution audit stream at [chronicleai-76fcd1c06def.herokuapp.com/transactions.txt?page=1&limit=100](https://chronicleai-76fcd1c06def.herokuapp.com/transactions.txt?page=1&limit=100).

| Surface | What it shows |
| --- | --- |
| [Alerts](https://chronicle-ai-web.vercel.app/alerts) | Public monitoring feed for **Market events** (swaps, liquidations, APY shifts) and **Desk triggers** (signals, capital moves, microtrades). |
| [Watch](https://chronicle-ai-web.vercel.app/watch) | Premium targeted monitoring for wallets, contracts, and protocols with Telegram updates. |
| [Chronicle Desk](https://chronicle-ai-web.vercel.app/desk) | Treasury proposals, safety rules, and preflight status. |
| [Agent Activity](https://chronicle-ai-web.vercel.app/activity) | KeeperHub execution logs, routing, outcomes, and audit context. |
| [Verified transaction](https://sepolia.etherscan.io/tx/0xf7c52b28894b6551bd4305085141ccca70898f969bd8ac589bf52c4bb0a3d0b6) | Onchain action verified independently. |
| [3,000+ Unique Transaction Audit Stream](https://chronicleai-76fcd1c06def.herokuapp.com/transactions.txt?page=1&limit=100) | Full paginated live audit log of 3,000+ unique verified transactions executed through KeeperHub. |

### Source vs execution chains

Alerts include **Mainnet market Alerts** and **Sepolia Desk-trigger Alerts**. Market intelligence is observed on **Ethereum Mainnet** while publication and desk execution run on **Ethereum Sepolia**. Alert cards explicitly distinguish source chain from publication/execution chain.

## Full system overview

ChronicleAI is an autonomous onchain intelligence business with a public memory: it converts market activity into sourced Alerts and digests, sells a **Chronicle Pass** subscription for human editorial intelligence, sells machine-readable feeds over x402/MPP, and routes configurable revenue into a policy-gated market desk. When acting, KeeperHub turns decisions into auditable onchain Actions.

### Chronicle Pass — subscription-first premium

Chronicle Pass is the primary human monetization path at **$4.99 USDC/month**, wallet-authenticated and renewed — never charged silently.

| Tier | Includes |
| --- | --- |
| **Free** | Public alerts, digest highlights, archive previews, one monthly deep dive |
| **Chronicle Pass ($4.99/mo)** | Every human deep dive as published, historical premium items, full editorial archive, premium digests |

- **Wallet-authenticated management:** Signed-message challenge (`POST /subscriptions/auth/challenge` → `/verify`) creates a secure HttpOnly session; managed at `/subscription`.
- **Entitlement checked per request:** Expiry or failed renewal revokes access at the entitlement layer.
- **Separate product lines:** Sponsored Watch campaigns, machine-readable feeds, desk feeds, and per-item API payments exist separately outside the Pass.

### Watch & Alerts — continuous public & targeted monitoring

ChronicleAI watches onchain activity across two complementary layers:

1. **Public Alerts feed ([`/alerts`](https://chronicle-ai-web.vercel.app/alerts)):** Continuous public monitoring for **Market events** (swaps, liquidations, APY differentials on Ethereum Mainnet) and **Desk triggers** (desk signals, capital moves, microtrades on Sepolia).
2. **Targeted Watch Service ([`/watch`](https://chronicle-ai-web.vercel.app/watch)):** Premium paid monitoring for humans and AI agents. Customers purchase campaigns for any wallet, contract, or protocol, receiving private Telegram DMs and onchain reports.

### Paid Watch through the KeeperHub Marketplace

The canonical paid Watch path is a listed KeeperHub workflow, not a second monitoring implementation. KeeperHub handles the marketplace payment and workflow invocation; ChronicleAI keeps ownership of Telegram binding, campaign creation, event monitoring, alert delivery, and report publication.

- **Listing:** `chronicleai-paid-onchain-watch-v2`, priced at **0.05 USDC per call**.
- **Payment rail:** Watch supports **x402 on Base Mainnet** for browser payments and **MPP** for agent payments through the same KeeperHub Marketplace workflow. The browser flow signs `PAYMENT-SIGNATURE`; an MPP-capable agent answers the `Authorization: Payment ...` challenge and retries the call with its payment credential.
- **Workflow input:** only `targetContract`, `targetKind`, `focusKey`, `durationHours`, `visibility`, and `telegramBindingCode` are required. The `telegramBindingCode` field name is retained for listing compatibility, but its value is the reusable `ctai_...` token. `requestId`, `startsAt`, `endsAt`, and `watchSpecHash` are not marketplace inputs; ChronicleAI derives any required provenance and campaign-window data internally.
- **Telegram binding:** open [`@chronicleai_bot`](https://t.me/chronicleai_bot), send `/start`, and paste the persistent `ctai_...` token. The token is reusable until `/disconnect`; the Watch UI remembers it and links the connected wallet with one personal-signature step.
- **Free-tier bridge:** the workflow uses KeeperHub's Telegram action to send a `CHRONICLE_INGEST v1` envelope to ChronicleAI. It does not require a paid KeeperHub HTTP node.

```text
Watch UI / agent
  -> KeeperHub Marketplace call: chronicleai-paid-onchain-watch-v2
  -> x402 payment challenge on Base Mainnet (or marketplace MPP path)
  -> KeeperHub Telegram action -> ChronicleAI /telegram/webhook
  -> existing createSponsoredWatch workflow on Ethereum Sepolia
  -> asynchronous monitoring -> Telegram alerts -> publishSponsoredReport
```

The Watch UI forwards the KeeperHub `PAYMENT-REQUIRED` challenge, signs Circle USDC `TransferWithAuthorization` on Base (`chainId 8453`), and retries the same marketplace call with `PAYMENT-SIGNATURE`. The ChronicleAI proxy validates the KeeperHub signature headers and forwards only the marketplace request; the KeeperHub organization API key never reaches the browser.

Distinction from generic trading bots:
- **Publishes what it sees** as public Alerts rather than keeping market view private.
- **Monetizes deeper intelligence** via recurring Chronicle Pass subscriptions.
- **Routes revenue into a controlled treasury desk** rather than executing every observation.
- **Acts only after policy and preflight checks** instead of LLM broadcasting arbitrary calldata.
- **Proves outcomes** with registry receipts, KeeperHub run IDs, tx hashes, and activity trails.

## System architecture

```text
[Onchain Events] ---> [Public Alert] ---> [Registry Proof]
                            |        ---> [Premium Intelligence]
                            v
                      [Desk Signal]
                            |
                            v
               [Hard Policy & Preflight]
                            |
                            v
              [KeeperHub MCP & Workflow]
                            |
                            v
                    [Onchain Action]
                            |
                            v
               [Activity & Audit Trail]
```

KeeperHub owns execution; ChronicleAI owns intelligence, Alert→Signal projection, policy, product experience, and proof.

## Judge links

| Requirement | Link |
| --- | --- |
| Source code | [github.com/zaikaman/ChronicleAI](https://github.com/zaikaman/ChronicleAI) |
| Live activity & execution proof | [chronicle-ai-web.vercel.app/activity](https://chronicle-ai-web.vercel.app/activity) |
| Live desk & audit timeline | [chronicle-ai-web.vercel.app/desk](https://chronicle-ai-web.vercel.app/desk) |
| Live alerts & causal chains | [chronicle-ai-web.vercel.app/alerts](https://chronicle-ai-web.vercel.app/alerts) |
| KeeperHub Marketplace x402 proof | [0.05 USDC Base Mainnet payment](https://basescan.org/tx/0xf3567d3e87513aa471b23f5330a46b0e5c0c5db0225c05bde187199a55b19c30) |
| Live 3,000+ KeeperHub Tx audit stream | [chronicleai-76fcd1c06def.herokuapp.com/transactions.txt](https://chronicleai-76fcd1c06def.herokuapp.com/transactions.txt?page=1&limit=100) |
| Registry contract | [`0xD8Deb4475a7E23E194Bc93f8739858Fb20744111`](https://sepolia.etherscan.io/address/0xD8Deb4475a7E23E194Bc93f8739858Fb20744111) |

## Key capabilities

- **Public intelligence:** Alerts, daily digests, trade tickets, capital-move records, and proof-of-publication receipts.
- **Alert → Signal projection:** Maps eligible market events into desk signals and records causal metadata.
- **Desk-trigger Alerts:** Creates public Alerts from non-ignore Desk signals and capital decisions.
- **Chronicle Pass subscription:** Wallet-authenticated $4.99/mo pass covering all deep dives and archive.
- **Dual-Rail Auto Selection:** MPP (Tempo HMAC) for AI agents (`X-Chronicle-Client: agent`), x402 (Base USDC) for browser wallets.
- **Watch premium service:** Target monitoring with Telegram DMs, contract event classification, and onchain reports.
- **Telegram binding:** `/start` issues a durable `ctai_...` token linking a chat to private Watch alerts. ChronicleAI stores only its hash server-side, remembers the linked wallet after a personal signature, and revokes the binding on `/disconnect` (`VITE_TELEGRAM_BOT_USERNAME` must match the webhook-registered bot).
- **Desk reasoning & KeeperHub execution:** LangChainJS reasoning gated by hard policy; KeeperHub MCP & REST execution.
- **Reliability layer:** Preflight simulation, idempotency keys, private routing, kill-switch, structured audit trail.

## Deep proof set

ChronicleAI includes 34 KeeperHub workflow definitions (29 core, 5 optional mainnet monitoring). Verified onchain proofs:

| Surface / workflow | Action | Transaction |
| --- | --- | --- |
| Desk Oracle Arbitrage | Uniswap V3 swap via KeeperHub private route | [0xf7c52b28…0a3d0b6](https://sepolia.etherscan.io/tx/0xf7c52b28894b6551bd4305085141ccca70898f969bd8ac589bf52c4bb0a3d0b6) |
| Desk Yield Rotation | Uniswap LINK→USDC swap via KeeperHub | [0xa6ccb246…51279d2a](https://sepolia.etherscan.io/tx/0xa6ccb2467f04e4159a0219fba7a3de307a2e196487cc6242d80493b851279d2a) |
| Desk Treasury Sweep | Treasury transfer workflow | [0x47d1f3b9…4cebeeda](https://sepolia.etherscan.io/tx/0x47d1f3b90396e4fd63168f056d027cf0c9c8bd90949041f749bb249e4cebeeda) |
| Daily Digest | `ChronicleRegistry.publishDigest` | [0xe25efe40…38d204](https://sepolia.etherscan.io/tx/0xe25efe406b08c852aafdca4b990d02c480707fd0c814c0bca852c679ed38d204) |
| Intelligence Alert | `ChronicleRegistry.publishAlert` | [0x4acf30c4…bcc62f6a](https://sepolia.etherscan.io/tx/0x4acf30c4948dd0ddcde8c1377af22fc1c6acd01662b7470a785ae293bcc62f6a) |
| Desk Capital Top-up | `recordCapitalMove` workflow | [0x7aac47c6…f224bf](https://sepolia.etherscan.io/tx/0x7aac47c61d30b15a7cb381423731fbd61936e086c5e54402a7a3d54395f224bf) |
| Trade Ticket | `ChronicleRegistry.recordTradeTicket` | [0xaf1c821f…a1952](https://sepolia.etherscan.io/tx/0xaf1c821f6edbd78af9f6f63d0a982d311d5db05dc217db3787a61179ca4a1952) |
| Capital Move | `ChronicleRegistry.recordCapitalMove` | [0x254764d5…172c5](https://sepolia.etherscan.io/tx/0x254764d54457a753ad1e2ff6f3e9dec483bfcbdfa7f56a0630ddba0753b172c5) |
| Legacy x402 Premium Receipt | `transferWithAuthorization` → `recordPremiumReceipt` | Base Sepolia payment: [0x19d45cdb…4a82](https://sepolia.basescan.org/tx/0x19d45cdbef7ab0ba260b823163fd988921b98ca3630c2899af5a1ca27f1e4a82) → Receipt on Sepolia: [0x9e109ac9…2d96](https://sepolia.etherscan.io/tx/0x9e109ac9caa345206c9fb863adcb5dfe9c966df8969b434af9c5f3f7f2c62d96) |
| KeeperHub Marketplace Watch payment | 0.05 USDC x402 payment on Base Mainnet for `chronicleai-paid-onchain-watch-v2` | [0xf3567d3e…b19c30](https://basescan.org/tx/0xf3567d3e87513aa471b23f5330a46b0e5c0c5db0225c05bde187199a55b19c30) → Watch creation receipt on Sepolia: [0x64b8117b…94f850](https://sepolia.etherscan.io/tx/0x64b8117b3c08c75f3491411ae098432a75450917bf3ea4213a1c450fbb94f850) |
| MPP Premium Receipt | `recordPremiumReceipt` | [0xe5dd502b…529851](https://sepolia.etherscan.io/tx/0xe5dd502b509fbaecc5a6341130fdc104aa11a1b66b7af0d0386dcd436a529851) |
| Sponsored Watch | `createSponsoredWatch` | [0xcc5eb3b6…85b2](https://sepolia.etherscan.io/tx/0xcc5eb3b64e1ceb743e99a98525707b3594c36dfec91f1bbb497b2a4e64d785b2) |
| Sponsored Report | `publishSponsoredReport` | [0x92d63e8b…bdf7](https://sepolia.etherscan.io/tx/0x92d63e8b3912e6fc57b19637cbbb158d20fce8e801997bce6a0489c68846bdf7) |
| Affiliate Payout | `recordAffiliatePayout` | [0xd4739e92…d7fc](https://sepolia.etherscan.io/tx/0xd4739e92b6ae88f61d06c63cd10e22794da86f058356484f7decced41af2d7fc) |

## KeeperHub integration

| Surface | Implementation | What it contributes |
| --- | --- | --- |
| Workflow execution | [`apps/api/src/desk/execution-bridge.ts`](apps/api/src/desk/execution-bridge.ts) | Workflow production writes, idempotency, transaction receipts, REST fallback. |
| MCP server | [`apps/api/src/services/keeperhub-mcp-execute.ts`](apps/api/src/services/keeperhub-mcp-execute.ts) | `list_workflows → get_workflow → execute_workflow`; native LangChain ReAct with fallback. |
| Smart gas & preflight | [`apps/api/src/desk/kh-simulate-preflight.ts`](apps/api/src/desk/kh-simulate-preflight.ts) | Dry-run validation before desk writes. |
| Private routing | [`apps/api/src/services/keeperhub-private-capability.ts`](apps/api/src/services/keeperhub-private-capability.ts) | Private routing for desk & kill-switch actions; public routing for registry writes. |
| Dual-Rail Auto Selection | [`apps/api/src/services/payment-challenge-service.ts`](apps/api/src/services/payment-challenge-service.ts) | MPP for AI agents, x402 for browser wallets. |
| x402 / MPP Adapters | [`apps/api/src/payments/x402-payment-adapter.ts`](apps/api/src/payments/x402-payment-adapter.ts) and [`apps/api/src/payments/mpp-payment-adapter.ts`](apps/api/src/payments/mpp-payment-adapter.ts) | Dual-protocol premium intelligence access and onchain receipt anchoring. |
| Paid Watch Marketplace bridge | [`apps/api/src/routes/keeperhub-marketplace-proxy-routes.ts`](apps/api/src/routes/keeperhub-marketplace-proxy-routes.ts), [`apps/api/src/routes/keeperhub-sponsored-watch-routes.ts`](apps/api/src/routes/keeperhub-sponsored-watch-routes.ts), and [`apps/web/src/features/watch/WatchRequestForm.tsx`](apps/web/src/features/watch/WatchRequestForm.tsx) | Forwards the KeeperHub x402 challenge, validates the signed marketplace request, emits the Telegram ingest envelope, and returns the asynchronous Watch result. |
| Persistent Watch binding | [`apps/api/src/services/telegram-binding-service.ts`](apps/api/src/services/telegram-binding-service.ts), [`apps/api/src/routes/telegram-binding-routes.ts`](apps/api/src/routes/telegram-binding-routes.ts), and [`supabase/migrations/058_persistent_telegram_bindings.sql`](supabase/migrations/058_persistent_telegram_bindings.sql) | Reusable Telegram token, wallet-link signature, server-side token hashing, and explicit `/disconnect` revocation. |
| Audit trail | [`apps/api/src/desk/execution-audit.ts`](apps/api/src/desk/execution-audit.ts) | Correlates preflight, KeeperHub logs, receipts, gas, routing, failure details. |

### Execution routing policy

| Transaction class | Route | Gas / status label |
| --- | --- | --- |
| Desk strategies (`oracle_arb`, `rotate_yield`, …) | KeeperHub private workflow | Wallet gas; **Private route** |
| Kill-switch residual | KeeperHub private workflow, strict | Wallet gas; **Private route** |
| Treasury / revenue transfer | KeeperHub public workflow when configured | Wallet gas; **Public route** |
| Registry alerts, digests, receipts, sponsored watches | KeeperHub public workflow | Sponsorship preferred; **Public (Sponsorship requested)** |

## Safety model & authority separation

ChronicleAI separates decision authority from execution infrastructure. LLM reasoning acts as an advisory proposal generator, while a pure deterministic policy engine handles execution gating.

```text
[Desk Signal] ---> [LLM Desk Trading Agent]
                         | (Proposal + Confidence)
                         v
               [mapProposalToDecision]
                         | (Min Confidence Gate)
                         v
              {Pure Policy Engine}
             /                    \
  (Violation)                      (Policy Approved)
       v                                   v
[Policy Verdict: Defer/Hold]   [KeeperHub Preflight Sim]
                               /                       \
                      (Revert/Error)                 (Preflight OK)
                            v                              v
                    [Soft Abort]                 [KeeperHub Engine]
                                                           |
                                                           v
                                              [Sepolia & Registry Proof]
```

### Key invariants & safeguards
1. **Authority Separation:** Deterministic policy in [`apps/api/src/desk/policy-engine.ts`](apps/api/src/desk/policy-engine.ts) owns Health Factor floors, trade limits, equity floors, and kill-switch states. LLMs cannot self-approve.
2. **Tightening-Only Advisory:** Proposals below confidence threshold default to `hold`. An LLM cannot override policy denial. Critical HF breaches trigger `applyForceDefendOverride`.
3. **Preflight Dry-Run:** Material workflows are simulated via [`apps/api/src/desk/kh-simulate-preflight.ts`](apps/api/src/desk/kh-simulate-preflight.ts) prior to broadcast. Reverting paths abort without burning gas.
4. **Idempotency & Receipts:** Confirmed onchain writes are never retried. Canonical hashes and run IDs anchor in `ChronicleRegistry`.

### Failure & recovery case study: MCP transport disconnect → REST API fallback

```text
[KeeperHub Action Triggered] ---> {Try KeeperHub MCP}
                                 /                  \
                        (Transport Drop / 5s)      (Success)
                                /                      \
                    [Emit mcp_failed Log]               \
                            |                            |
                            v                            v
               [KeeperHub REST Fallback] ---> [Broadcast Onchain Action]
                                                         |
                                                         v
                                              [Update Registry: succeeded]
```

When KeeperHub MCP disconnects, `softAppendExecutionLog` records `mcp_failed` and [`apps/api/src/services/keeperhub-write-client.ts`](apps/api/src/services/keeperhub-write-client.ts) switches transparently to KeeperHub REST API (`/api/workflows/execute`). The workflow completes without dropped transactions or duplicate writes.

```json
[
  {
    "action_type": "registry_write",
    "entity_type": "keeperhub_workflow",
    "status": "failed",
    "message": "KeeperHub MCP execution failed: socket closed (timeout 5000ms); attempting REST API fallback",
    "details": {
      "method": "publishAlert",
      "workflowId": "m4q4c63ixjoqvjq705116",
      "executionPath": "mcp",
      "mcp_url": "https://app.keeperhub.com/mcp",
      "error": "MCP transport timeout",
      "fallbackTriggered": true
    },
    "created_at": "2026-08-03T15:34:08.120Z"
  },
  {
    "action_type": "registry_write",
    "entity_type": "keeperhub_workflow",
    "status": "succeeded",
    "message": "KeeperHub publishAlert succeeded (via REST fallback)",
    "details": {
      "method": "publishAlert",
      "chainId": 11155111,
      "workflowId": "m4q4c63ixjoqvjq705116",
      "executionPath": "rest_fallback",
      "executedViaKeeperHub": true,
      "keeper_hub_run_id": "mrxecw9jaurr4y6ma5mh6",
      "tx_hash": "0xdeaf6568beed23962733d93e5575d2d8b182ee2d5f691609bb137a5f36166956",
      "explorer_url": "https://sepolia.etherscan.io/tx/0xdeaf6568beed23962733d93e5575d2d8b182ee2d5f691609bb137a5f36166956"
    },
    "created_at": "2026-08-03T15:34:53.519Z"
  }
]
```

## Setup & execution

```bash
pnpm install
pnpm --filter @chronicleai/api exec tsx scripts/keeperhub-stack-smoke.ts
pnpm dev
```

Local endpoints:
- Web: `http://localhost:5173`
- API: `http://localhost:3000`

## Verification

1,238 passing tests across 139 test files, plus 34 KeeperHub workflow definitions.

```bash
pnpm type-check
pnpm test
```

## License and acknowledgments

Built for **The Last Mile: KeeperHub AI Agent Hackathon 2026**.

- Execution & reliability: [KeeperHub](https://keeperhub.com)
- Agent framework: [LangChainJS](https://js.langchain.com/)
- Cross-chain treasury: [Circle CCTP](https://www.circle.com/en/cross-chain-transfer-protocol)
- MPC custody: [Para](https://getpara.com/)
