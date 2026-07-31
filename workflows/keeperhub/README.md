# ChronicleAI ↔ KeeperHub Workflows

## Write workflows (P0 — material on-chain path)

These are the **only** production write path for Chronicle Registry and revenue transfers. Chronicle API triggers them exclusively via KeeperHub workflow execute (`POST /api/workflows/{id}/execute`). Direct Execution (`/api/execute/contract-call`, `/api/execute/transfer`) is **not** used — every write requires the matching `KEEPERHUB_WORKFLOW_*` env ID.

| File | Registry / action | Trigger input |
|------|-------------------|---------------|
| `chronicle-publish-alert.workflow.json` | `publishAlert` | `alertHash`, `ipfsUri` |
| `chronicle-publish-digest.workflow.json` | `publishDigest` | `digestHash`, `sourceEventRoot`, `ipfsUri` |
| `chronicle-create-sponsored-watch.workflow.json` | `createSponsoredWatch` | `targetContract`, `watchSpecHash`, `startsAt`, `endsAt` |
| `chronicle-publish-sponsored-report.workflow.json` | `publishSponsoredReport` | `watchId`, `reportContentHash`, `sourceEventRoot`, `reportUri` |
| `chronicle-record-payout.workflow.json` | `recordPayout` | `payoutPeriodHash`, `recipient`, `amount`, `reasonHash` |
| `chronicle-publish-trade-ticket.workflow.json` | `publishTradeTicket` | `ticketHash`, `signalHash`, `intentHash`, `contentUri` (`/desk/tickets/:id`) |
| `chronicle-record-capital-move.workflow.json` | `recordCapitalMove` | `moveId`, `from`, `to`, `amount` (USDC base units), `reasonHash` |
| `chronicle-revenue-transfer.workflow.json` | **USDC** ERC-20 transfer | `recipientAddress`, `amount` (human USDC) |

## Desk strategy + capital workflows (v1)

All desk strategy / capital write paths run on **Ethereum Sepolia (`11155111`)** with the **KeeperHub desk execution wallet** as signer. Chronicle API builds trigger inputs (no mock fills) and calls `POST /api/workflows/{id}/execute`.

| File | Env ID | Strategy / action | Trigger input (API) |
|------|--------|-------------------|---------------------|
| `desk-defend.workflow.json` | `KEEPERHUB_WORKFLOW_DESK_DEFEND` | `risk_defend` | `mode` (`repay`\|`withdraw`), `asset` (address), `amount` (base units), `deskAddress` |
| `desk-rotate-yield.workflow.json` | `KEEPERHUB_WORKFLOW_DESK_ROTATE` | `yield_rotation` | `direction` (`into_aave_link`\|`out_of_aave_link`), `amountIn`, `amountLink`, `amountOutMinimum`, `deskAddress` (base units; amount = min(policy, balance)) |
| `desk-oracle-arb.workflow.json` | `KEEPERHUB_WORKFLOW_DESK_ORACLE_ARB` | `oracle_amm` | `tokenIn`, `tokenOut`, `amountIn`, `amountOutMinimum`, `fee`, `deskAddress` |
| `desk-kill-switch.workflow.json` | `KEEPERHUB_WORKFLOW_DESK_KILL_SWITCH` | emergency flatten + return | `amount` (human USDC), `treasuryAddress`, `deskAddress`, `withdrawLink` (`true`\|`false`), `amountLink` (base or max uint) |
| `desk-sweep.workflow.json` | `KEEPERHUB_WORKFLOW_DESK_SWEEP` | profit sweep | `amount` (human USDC), `treasuryAddress` |

**Strategy legs (planning is in `apps/api/src/desk/`):**

| Strategy | Signals | Legs |
|----------|---------|------|
| **risk_defend** | Aave `get-user-account-data` HF vs `DESK_HF_WARN` / `DESK_HF_CRITICAL` | Prefer USDC/LINK repay; withdraw collateral when critical with no inventory |
| **yield_rotation** | Aave LINK supply APY vs idle USDC; edge ≥ `DESK_APY_DELTA_BPS` for N polls | into: Uniswap USDC→LINK → Aave supply LINK; out: withdraw → LINK→USDC |
| **oracle_amm** | Chainlink ETH/USD vs Uniswap mid; `\|basisBps\| ≥ DESK_BASIS_BPS` | Single capped `swap-exact-input` (fade dislocation); no leverage |
| **kill switch** | Stale heartbeat (`DESK_KILL_HEARTBEAT_MS`), manual arm, critical failures | Pause intents → best-effort Aave withdraw → residual USDC desk→treasury |

**Approvals (one-time on desk wallet):**

- USDC approve Uniswap SwapRouter02 (`0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`) — also done in-workflow
- USDC/LINK approve Aave V3 Pool (`0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951`) — also done in-workflow
- Prefer **LINK supply** on Aave Sepolia (USDC/DAI supply often capped)

After import, set the five `KEEPERHUB_WORKFLOW_DESK_*` env vars on Chronicle API.

**Setup**

1. Deploy Chronicle Registry; set `CHRONICLE_REGISTRY_ADDRESS`.
2. Create a KeeperHub org API key (`kh_…`); set `KEEPERHUB_API_KEY` + `KEEPERHUB_API_BASE_URL`.
3. Import write workflow JSONs (replace `YOUR_CHRONICLE_REGISTRY_ADDRESS`), enable, and **set all required** `KEEPERHUB_WORKFLOW_*` IDs (writes fail hard without them).
4. Direct ethers `sendTransaction` is disabled unless `ALLOW_DIRECT_ETHERS_WRITES=true` (local tests only; never production).

Each successful write stores `keeper_hub_run_id`, `tx_hash`, and `explorer_url`. Activity page shows **Executed via KeeperHub** with run id + tx.

## Routing policy (Ethereum Sepolia)

ChronicleAI desk and material on-chain writes target **Ethereum Sepolia only** (`11155111`). Desk and kill-switch workflows use KeeperHub’s KEEP-137 private route where configured. Treasury/revenue transfer workflows use the public mempool because the private RPC is too slow for reliable payouts.

**Product honesty:** This is a **private submission path** and full use of KeeperHub’s routing surface on Sepolia. It is **not** a claim of mainnet-scale sandwich economics or “MEV-proof” markets. Prefer copy like “Private route” / “private submission path (Flashbots Protect · Sepolia)” over “MEV-protected.”

Full implementation plan: [`docs/private-routing-implementation-plan.md`](../../docs/private-routing-implementation-plan.md).

### Workflow node flags

On private desk and kill-switch write nodes (`web3/write-contract`, `web3/approve-token`, `uniswap/*`, `aave-v3/*`, …):

```json
"usePrivateMempool": true,
"strict": true
```

| Flag | Meaning |
|------|---------|
| `usePrivateMempool: true` | KeeperHub swaps the primary RPC to the chain’s private mempool URL when the chain supports it |
| `usePrivateMempool: false` | KeeperHub submits through the normal public mempool; used by revenue/treasury transfer workflows |
| `strict: true` (default true) | Private RPC failure does **not** fall back to the public mempool — the step fails closed |

### Sepolia Flashbots Protect RPC

| Network | Private / Protect RPC |
|---------|------------------------|
| Ethereum Sepolia (`11155111`) | `https://rpc-sepolia.flashbots.net/` |

Source: [Flashbots Protect quick start](https://docs.flashbots.net/flashbots-protect/quick-start).

**How KeeperHub applies the flag (KEEP-137):** when `usePrivateMempool` is true, the chain’s **entire primary JSON-RPC URL** is swapped to the private endpoint (not only `eth_sendRawTransaction`). That means approve / Uniswap / Aave steps also run `eth_call`, gas estimate, nonce, and balance reads against Protect.

**Ops failure mode (common on Sepolia):** bare Protect is much slower than a normal public Sepolia RPC. Desk workflows (e.g. `desk-oracle-arb`: approve + `uniswap/swap-exact-input`) issue many reads before send; under `strict: true` a Protect read timeout surfaces as:

```text
RPC failed on primary endpoint: timeout (operation="request.send", reason="timeout", code=TIMEOUT)
```

That is a **KeeperHub private RPC config / latency** issue, not a bad Chronicle workflow JSON.

**Recommended private URL (Flashbots custom read RPC):** point Protect writes at Flashbots, and proxy **reads** to your fast public Sepolia RPC via the `url` query param ([settings guide](https://docs.flashbots.net/flashbots-protect/settings-guide#custom-read-rpc)):

```json
{
  "eth-sepolia": {
    "isPrivateMempoolRpcEnabled": true,
    "privateMempoolRpcUrl": "https://rpc-sepolia.flashbots.net/?url=https://YOUR_FAST_SEPOLIA_RPC"
  }
}
```

Examples for `YOUR_FAST_SEPOLIA_RPC`: the same URL as KeeperHub’s public Sepolia primary (Alchemy/Infura/publicnode), URL-encoded if needed. Writes (`eth_sendRawTransaction`) still go private; reads go to the `url` backend.

Bare Protect (no `url=`) can still work for dust tests but is more likely to time out under multi-call Uniswap paths.

**Do not** hardcode this URL into ChronicleAI API. It belongs in **KeeperHub** chain config (`CHAIN_RPC_CONFIG` / seed).

Verify on the KeeperHub instance: `GET /api/chains` → chainId `11155111` has `usePrivateMempoolRpc === true` and a populated private RPC URL. Chronicle boot log should show:

```text
[private-routing] KeeperHub chain 11155111 … usePrivateMempoolRpc=true
```

If the flag is set in workflow JSON but the chain is **not** configured, KeeperHub warns and may submit via the **public** mempool. Chronicle must not claim “protected” until capability is verified (see plan Phase 2/4).

**Do not “fix” by setting `strict: false` on desk/kill nodes for production demos** — that re-opens public mempool fallback when Protect is flaky. Prefer the `url=` read proxy instead.

### Gas sponsorship trade-off

Private routing and KeeperHub **gas sponsorship** (Turnkey Gas Station) are **mutually exclusive**. When `usePrivateMempool` is on:

- The desk / org wallet must hold **native Sepolia ETH** for gas.
- Low-balance monitoring should surface that private route requires gas balance (no sponsorship bailout).

### Routing policy matrix (target)

| Transaction class | Preferred route |
|-------------------|-----------------|
| Desk Uniswap swaps, approvals, Aave legs | **Private** (strict) |
| Kill-switch residual USDC | **Private** (strict) — always |
| Desk / revenue sweep ≥ threshold | **Private** via KH `transfer-token` |
| Desk / revenue sweep &lt; threshold | Para or public KH (ops simplicity / sponsorship OK) |
| Registry publish (alert/digest/ticket/…) | Per `REGISTRY_USE_PRIVATE_MEMPOOL` (full-stack private vs sponsorship-friendly public) |

### Chronicle env defaults (policy)

Documented in `apps/api/.env.example`. Defaults for maximum Sepolia surface usage:

| Variable | Default | Meaning |
|----------|---------|---------|
| `DESK_USE_PRIVATE_MEMPOOL` | `true` | Prefer private routing for desk KH workflows |
| `DESK_PRIVATE_MEMPOOL_STRICT` | `true` | Expectation for workflow `strict`; kill-switch always strict |
| `TREASURY_PRIVATE_TRANSFER_THRESHOLD_USDC` | `50` | Legacy compatibility setting; treasury/revenue transfers use the public KH path |
| `REGISTRY_USE_PRIVATE_MEMPOOL` | `true` | Registry writes request private when workflows carry the flag |
| `ROUTING_PROVIDER_LABEL` | `flashbots_protect` | Label for UI / execution_logs |

### Phase 3 path selection (treasury spends)

Hybrid production path (`PARA_API_KEY` + KeeperHub):

```
if KEEPERHUB_WORKFLOW_TRANSFER configured
  → KeeperHub sendTransfer (workflow usePrivateMempool=false; run id + public routing metadata)
else
  → Para MPC fallback or existing single-path client
```

- Capital manager top-ups use the same public KH transfer workflow when configured.
- Desk sweeps and kill-switch residual always go through KH workflows (private + strict); policy cannot disable kill-switch private routing.
- Do **not** describe revenue/treasury transfers as private; the workflow intentionally uses the public mempool.
- KH transfers spend from the KeeperHub execution wallet — fund it with Sepolia USDC.

### Operator checklist (enable end-to-end)

1. **KeeperHub chain config** — Set Sepolia private mempool RPC as above; confirm `GET /api/chains` for `11155111`.
2. **Fund desk wallet** — Sepolia ETH on the KeeperHub execution wallet (`DESK_WALLET_ADDRESS`). Private route has no gas sponsorship.
3. **Workflow JSON** — Keep private desk/kill-switch nodes at `"usePrivateMempool": true`; keep revenue/treasury transfer nodes at `"usePrivateMempool": false`. Keep `workflows/keeperhub/` and `workflows/keeperhub-ready/` in sync.
4. **Re-import** — After JSON changes, re-import into KeeperHub (or patch each write node: Network → “Sepolia (Flashbots)” / private mempool toggle). If import creates **new** workflow IDs, re-bind all `KEEPERHUB_WORKFLOW_*` env vars on Chronicle API.
5. **Chronicle policy env** — Set the private-routing vars from the table above (see `.env.example`).
6. **Smoke** — Execute a dust `transfer-token` or registry write on Sepolia; confirm tx lands; after product Phase 2, confirm Activity shows private-route metadata.

### Minimal write-node snippet

```json
{
  "actionType": "web3/transfer-token",
  "network": "11155111",
  "usePrivateMempool": true,
  "strict": true,
  "tokenConfig": "{\"mode\":\"custom\",\"customToken\":{\"address\":\"0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238\",\"symbol\":\"USDC\"}}",
  "amount": "{{@trigger-manual:Trigger.amount}}",
  "recipientAddress": "{{@trigger-manual:Trigger.recipientAddress}}"
}
```

Same pattern for `web3/approve-token`, `web3/write-contract`, `uniswap/swap-exact-input`, and `aave-v3/*` write actions.

## Loop 4 — Sponsored watch campaign cycle

After payment settlement creates a watch (`createSponsoredWatch`), ChronicleAI runs the campaign loop automatically every 60s and via KeeperHub:

```bash
curl -X POST "https://YOUR_HOST/keeperhub/sponsored-watches/run" \
  -H "Content-Type: application/json" \
  -H "X-ChronicleAI-Signature: $KEEPERHUB_WEBHOOK_SECRET" \
  -d '{}'
```

Cycle steps: activate accepted watches → correlate Event Tracker events to `target_contract` during the window → at `ends_at` generate report → `publishSponsoredReport(watchId, reportHash, sourceEventRoot, contentUri)` → dashboard shows both create + report tx hashes.

## Monitoring workflows (Telegram free-plan bridge)

KeeperHub **Send Webhook** is a **Pro** feature. Monitoring workflows use **Telegram Send Message** instead (`telegram/send-message`, free-plan / fixed-host egress):

```text
Event / Block / Schedule + protocol reads
  → telegram/send-message  (CHRONICLE_INGEST v1 + JSON envelope)
      → Telegram group
          → ingest bot webhook → Chronicle POST /telegram/webhook
              → event/block pipeline OR desk_read → /keeperhub/desk/signals quality bar
```

### Desk-grade polls (Phase 9 — Sepolia execution inputs)

These drive the desk signal engine (`policy_verdict`). All use `network: "11155111"` and `kind: desk_read`.

**Free-tier cadences are baked into the JSON** (target ≤5k runs/mo per KH org when split across accounts — see below).

| File | Cadence (free tier) | ~runs/mo | Signal type | Downstream |
|------|---------------------|----------|-------------|------------|
| `desk-health-poll.workflow.json` | Schedule **30m** | ~1.4k | `health_factor` | risk_defend |
| `desk-rates-poll.workflow.json` | Schedule **30m** | ~1.4k | `apy_delta` | yield_rotation |
| `desk-basis-poll.workflow.json` | Schedule **30m** | ~1.4k | `oracle_basis` | oracle_amm (see basis pricing note) |
| `desk-gas-poll.workflow.json` | every **150th** Sepolia block (~30m) | ~1.4k | `gas_regime` | policy gas defer |
| `desk-capital-tick.workflow.json` | Schedule **hourly** | ~720 | `capital_tick` | capital manager |

**Placeholders (import-safe templates under `workflows/keeperhub/`):**

- Desk wallet address fields must be a real `0x` + 40 hex chars at import time (KeeperHub rejects non-address strings like `YOUR_DESK_…` with `INVALID_ACTION_CONFIG`). Templates ship with `0x0000000000000000000000000000000000000001` — replace with your real `DESK_WALLET_ADDRESS` before enabling.
- Telegram: `YOUR_TELEGRAM_INGEST_CHAT_ID` is fine for chatId (not an address field); still replace with the real group id before enable.

**Import-ready copies (`workflows/keeperhub-ready/`):** regenerate from templates + `apps/api/.env` so every placeholder is filled:

```bash
node scripts/prepare-keeperhub-ready.mjs
```

Substitutions: `YOUR_TELEGRAM_INGEST_CHAT_ID` → `TELEGRAM_INGEST_CHAT_ID`, desk `0x0000…0001` → `DESK_WALLET_ADDRESS`, registry write `contractAddress` → `CHRONICLE_REGISTRY_ADDRESS`. Prefer importing from `keeperhub-ready/` for local/demo deploys.

### Free-tier multi-account split (≤5k runs/mo each)

KeeperHub free plan is ~**5000 workflow runs/month** per org. **All Manual write workflows stay on one org** (desk wallet + `KEEPERHUB_API_KEY`). Monitors only need Telegram → Chronicle.

| Account | Workflows | Est. runs/mo |
|---------|-----------|--------------|
| **1 — Writer** | All `desk-defend` / `desk-sweep` / `desk-rotate-*` / `desk-oracle-arb` / `desk-kill-switch` + all `chronicle-publish-*` / `chronicle-record-*` / `chronicle-revenue-transfer` / sponsored watch | sparse (&lt;1k) |
| **2 — Desk polls** | `desk-health-poll`, `desk-rates-poll`, `desk-basis-poll` (all 30m) | ~4.3k |
| **3 — Gas + capital + events** | `desk-gas-poll` (150 blocks), `desk-capital-tick` (hourly), `aave-v3-liquidation`, `aave-v3-supply`, `aave-v3-withdraw`, `uniswap-v3-pool-created` | ~2–3.5k |
| **4 — Newspaper vanity (optional)** | `gas-volume-block-monitor` (every 300 mainnet blocks), `uniswap-v3-usdc-weth-swap` (hourly), `cow-protocol-trade` (hourly), `cex-usdc-transfer-monitor` (hourly), `stablecoin-usdc-mint-burn` (hourly) — or leave disabled | ~2–4k+ (For Each can add) |

Wire **Account 1** workflow IDs into Chronicle env. Accounts 2–4 only need the Telegram send connection + same ingest chat.

**Delivery (pick one consistently):**

1. **Telegram** `CHRONICLE_INGEST v1` with `"kind":"desk_read"` (free tier — default in JSON files), or  
2. **Signed POST** `/keeperhub/desk/signals` with `X-ChronicleAI-Signature` (when KH webhook plan allows).

**Signal quality bar (reject if missing):**

- `chainId === 11155111`
- numeric features used by policy (HF, APY bps, basis bps, gas gwei — API normalizes Aave rays / Chainlink answers)
- `dedupe_key` (optional in payload; API builds a windowed key when omitted)
- source proofs (`sources.readResults`, `contracts`, `pollKind`, or `workflowRunId`)
- Qualification is **`policy_verdict`** from the desk signal engine (not magnitude alone)

**Oracle vs AMM basis pricing (`desk-basis-poll`):**

- **Method:** Uniswap V3 QuoterV2 `quoteExactInputSingle` on Sepolia fee tier **3000** (pool `0x6Ce0896eAE6D4BD668fDe41BB784548fb8F59b50`).
- **Legs:** (1) 1 WETH → USDC, (2) 1000 USDC → WETH. Chronicle computes ETH/USD mid as the **geometric mean** of both legs (falls back to whichever leg is present).
- **Scaling:** `ammPrice = (amountOut / 10^outDec) / (amountIn / 10^inDec)` for WETH→USDC (WETH=18, USDC=6); reverse leg is inverted to ETH/USD. Token order is explicit in features (`ammTokenIn` / `ammTokenOut` / `ammQuoteDirection`).
- **Clamps:** `|basisBps| > DESK_BASIS_ABSURD_BPS` (2000) or ETH/USD outside `[50, 500_000]` → `policy_verdict=ignore` / fusion `data_quality` — never trade.
- **Sepolia note:** Live WETH/USDC pools often mark ETH ~16k while Chainlink is ~1.8k. That is a thin-pool mark, **not** a decimal bug in ingest. `oracle_amm` correctly idles until mid is honest; when markets are flat, expect `basis_below_threshold` (not `data_quality`).

### Newspaper monitors (not desk execution inputs)

| File | Network | Role |
|------|---------|------|
| `aave-v3-liquidation.workflow.json` | **Sepolia** | Desk-chain liquidation events (re-homed) |
| `aave-v3-supply.workflow.json` | **Sepolia** | Protocol deposit → `protocol_deposit` |
| `aave-v3-withdraw.workflow.json` | **Sepolia** | Protocol withdraw → `protocol_withdraw` |
| `uniswap-v3-pool-created.workflow.json` | **Sepolia** | Desk-chain pool creates (re-homed) |
| `gas-volume-block-monitor.workflow.json` | Mainnet | Newspaper gas/volume only — desk uses `desk-gas-poll` |
| `uniswap-v3-usdc-weth-swap.workflow.json` | Mainnet | **Vanity large-swap** — not an execution input |
| `cow-protocol-trade.workflow.json` | Mainnet | **Vanity large-trade** — CoW not a v1 desk venue |
| `cex-usdc-transfer-monitor.workflow.json` | Mainnet | **Vanity CEX flow** — USDC Transfer ≥ $500k; Chronicle labels CEX wallets → `cex_inflow` / `cex_outflow` |
| `stablecoin-usdc-mint-burn.workflow.json` | Mainnet | **Vanity supply** — USDC Mint/Burn ≥ $1M → `stablecoin_mint` / `stablecoin_burn` |

**Free-tier newspaper guidance**

- Prefer **hourly Schedule + block lookback (~320)** over `blockInterval: 1` or live Event on hot pools
- One **vanity account** for mainnet newspaper (swaps + CEX + mints) if free tier is tight
- Liq + protocol supply/withdraw + desk polls stay on **Sepolia** monitor account
- Start CEX monitor **USDC-only**; add WETH in a later phase
- Align size filters with `EVENT_THRESHOLDS` in `@chronicleai/config` ($500k CEX/protocol, $1M mint/burn, $500k swaps)

### Two-bot setup (required)

Bots **do not receive their own messages**. Use two bots in one private supergroup:

1. **Ingest bot** (`TELEGRAM_INGEST_BOT_TOKEN` on Chronicle, or legacy `TELEGRAM_BOT_TOKEN`)
   - @BotFather → create bot  
   - `/setprivacy` → **Disable** (so it sees other bots in groups)  
   - Add to the group as member/admin  
2. **Send bot** (`TELEGRAM_SEND_BOT_TOKEN` on Chronicle + KeeperHub → Connections → Telegram)
   - Separate bot token  
   - Add to the **same** group  
   - Chronicle also uses this token for post-registry alert/digest broadcasts  
3. Get group chat id (e.g. forward a group message to `@userinfobot`, or inspect a `getUpdates` dump). Usually `-100…`.
4. Chronicle env (Heroku + local):
   - `TELEGRAM_INGEST_BOT_TOKEN` = ingest bot  
   - `TELEGRAM_SEND_BOT_TOKEN` = send bot (same token as KeeperHub Telegram Connection)  
   - `TELEGRAM_CHAT_ID` / `TELEGRAM_INGEST_CHAT_ID` = group id  
   - `TELEGRAM_WEBHOOK_SECRET` = random `A-Za-z0-9_-` (1–256 chars)  
5. Set public API URL so **boot auto-registers** the Telegram webhook (no script after each deploy):

```text
PUBLIC_API_BASE_URL=https://YOUR_HEROKU_HOST
TELEGRAM_INGEST_BOT_TOKEN=...
TELEGRAM_SEND_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
```

On every dyno start, Chronicle calls Telegram `getWebhookInfo` / `setWebhook` only if the URL is missing or wrong. Optional one-shot debug: `.\scripts\set-telegram-webhook.ps1`.

6. In monitoring JSON, set `chatId` to that group id (`YOUR_TELEGRAM_INGEST_CHAT_ID`).
7. Import into KeeperHub → bind the **send bot** Telegram connection → enable.

Message envelope (already in the workflow files):

```text
CHRONICLE_INGEST v1
{"kind":"event"|"block"|"digest_run"|"desk_read","payload":{ ... }}
```

`desk_read` payload shape (minimal):

```json
{
  "signalType": "health_factor",
  "chainId": 11155111,
  "pollKind": "desk-health-poll",
  "features": { "healthFactorRay": "…", "totalCollateralBase": "…", "totalDebtBase": "…" },
  "sources": {
    "pollKind": "desk-health-poll",
    "contracts": ["0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951"],
    "readResults": { "healthFactor": "…" }
  }
}
```

### Prerequisites

1. Chronicle API deployed with:
   - `RPC_URL` (block analysis + USD magnitudes)
   - `TELEGRAM_*` ingest vars above
2. KeeperHub org with Event Tracker + Block Dispatcher for your chains
3. Placeholders:
   - `YOUR_TELEGRAM_INGEST_CHAT_ID` → group chat id  
   - Write workflows: `YOUR_CHRONICLE_REGISTRY_ADDRESS`

**Import shape (KeeperHub rejects `INVALID_ACTION_CONFIG` otherwise):**
- Telegram actions: only `actionType`, `chatId`, `message`, `parseMode` (no `integrationType` on config).
- `web3/transfer-funds` uses `recipientAddress` (not `toAddress`).
- `web3/write-contract` requires `network`, `contractAddress`, `abi`, `abiFunction` (and optional `functionArgs`).
- Prefer `integrationBindings: []` (re-bind Telegram Connection after import).

## Workflows

| File | Trigger (free tier) | Bridge | Downstream |
|------|---------------------|--------|------------|
| `desk-health-poll.workflow.json` | Schedule **30m** + Aave HF (Sepolia) | Telegram | `kind:desk_read` → risk |
| `desk-rates-poll.workflow.json` | Schedule **30m** + Aave LINK reserve | Telegram | `kind:desk_read` → rotation |
| `desk-basis-poll.workflow.json` | Schedule **30m** + Chainlink + Quoter | Telegram | `kind:desk_read` → oracle arb |
| `desk-gas-poll.workflow.json` | Block every **150th** Sepolia | Telegram | `kind:desk_read` → gas regime |
| `desk-capital-tick.workflow.json` | Schedule **hourly** | Telegram | `kind:desk_read` → capital tick |
| `aave-v3-liquidation.workflow.json` | Event `LiquidationCall` **Sepolia** | Telegram | `kind:event` → + cluster synthesizer |
| `aave-v3-supply.workflow.json` | Event `Supply` **Sepolia** | Telegram | `protocol_deposit` |
| `aave-v3-withdraw.workflow.json` | Event `Withdraw` **Sepolia** | Telegram | `protocol_withdraw` |
| `uniswap-v3-pool-created.workflow.json` | Event `PoolCreated` **Sepolia** | Telegram | `kind:event` |
| `gas-volume-block-monitor.workflow.json` | Block every **300th** mainnet | Telegram | newspaper `kind:block` |
| `uniswap-v3-usdc-weth-swap.workflow.json` | Schedule **hourly** mainnet vanity | Telegram | newspaper large `Swap` |
| `cow-protocol-trade.workflow.json` | Schedule **hourly** mainnet vanity | Telegram | newspaper large `Trade` |
| `cex-usdc-transfer-monitor.workflow.json` | Schedule **hourly** mainnet USDC Transfer | Telegram | `cex_inflow` / `cex_outflow` |
| `stablecoin-usdc-mint-burn.workflow.json` | Schedule **hourly** mainnet Mint/Burn | Telegram | `stablecoin_mint` / `stablecoin_burn` |

### Daily digests

`chronicle-publish-digest.workflow.json` only performs the **on-chain** `publishDigest` write *after* Chronicle already generated a digest. It does **not** schedule generation.

**Generation path (default):** Chronicle’s in-process scheduler (`DIGEST_SCHEDULE_ENABLED=true`) runs every ~15 minutes and generates the **previous completed UTC day** once it is ready (after 00:15 UTC). Logs: `[digest-scheduler]`.

**Manual force (any time):**

```bash
curl -X POST "https://YOUR_HOST/keeperhub/digests/run" \
  -H "Content-Type: application/json" \
  -H "X-ChronicleAI-Signature: $KEEPERHUB_WEBHOOK_SECRET" \
  -d '{"window":"previous_utc_day"}'
```

Empty body `{}` is equivalent to `previous_utc_day`. Explicit `periodStart` / `periodEnd` ISO strings still work.

**Dual-rail settlement:**

| Rail | Chain | What runs here |
|------|-------|----------------|
| **Payment** (users) | Base Sepolia `84532` | x402 / CDP USDC settlement only — **not** KeeperHub write workflows |
| **Ops / desk / registry** | Ethereum Sepolia `11155111` | All `chronicle-*` and `desk-*` write workflows, registry proofs, capital |
| **Bridge** | CCTP V2 Base → ETH Sepolia | Batched treasury rebalance (see `docs/CCTP-TREASURY-REBALANCE-PLAN.md`) |
| **Newspaper vanity** | Ethereum Mainnet `1` | Optional large-swap / CEX / mint monitors only |

Monitoring source events may still reference Ethereum Mainnet for newspaper context. Desk execution policy only acts on Ethereum Sepolia signals (see `@chronicleai/config` `SEPOLIA_DESK` / `isExecutableDeskChain`).

### Free tier execution budget (5 000 runs / month)

Each workflow run counts as **one KeeperHub execution**. Defaults in this folder stay under budget **when split across accounts** (see multi-account table above). Putting every monitor on one free org will still exceed 5k.

| Setup | Rough rate | Fits free tier? |
|-------|------------|-----------------|
| Block monitor `blockInterval: 1` (ETH) | ~7 200 / **day** | **No** — burns quota in hours |
| Desk gas poll / mainnet gas @ `blockInterval: 150–300` | ~24–48 / day ≈ ~0.7–1.4k / month | Yes |
| Desk health+rates+basis @ Schedule 30m (three workflows) | ~144 / day ≈ ~4.3k / month | Yes **on their own org** |
| Uniswap + CoW vanity @ Schedule **hourly** + size filter | ~24 schedule fires / workflow / day | Yes — For Each can still add runs on busy hours |
| Sparse Event monitors (Aave liquidation, PoolCreated) | Only when that event fires | Yes |
| Write workflows (Manual, Account 1) | Only when Chronicle publishes/pays | Fine |

### Significant-event filtering (free tier)

KeeperHub **Event** triggers have **no amount filter**. Every matching log starts a billable run. A Condition after the trigger still burns quota.

For hot pools (USDC/WETH Swap, CoW Trade) the ready workflows use Schedule + query + size filter (not live Event triggers):

```text
Schedule (0 * * * * UTC — hourly free tier)
  → web3/query-events  (block lookback ~320 ≈ 1h with overlap)
  → For Each events
      → Condition  (~$500k+: USDC ≥ 500_000e6 or WETH ≥ 200e18; CoW: USDC/USDT/WETH legs)
          true → telegram/send-message  (CHRONICLE_INGEST)
```

Aligns with Chronicle `EVENT_THRESHOLDS.large_swap.minMagnitude` ($500k). Leave vanity disabled if the demo does not need mainnet newspaper noise.

Keep **Aave Liquidation** and **PoolCreated** as true Event triggers (sparse).

**Recommendation on free tier:** re-import the Schedule-based swap/CoW JSONs; pause any leftover Event-based Swap workflow; save quota for **on-chain write** runs that judges care about.

## After import

1. Bind KeeperHub **Telegram Connection** (send bot token).
2. Enable each workflow.
3. Confirm Event Tracker / Block Dispatcher logs show the workflows as tracked.
4. Confirm group receives `CHRONICLE_INGEST v1` messages and Heroku logs show `[telegram-ingest]`.
5. Direct smoke (bypasses Telegram) still works:

```bash
# Classified event
curl -X POST "https://YOUR_HOST/keeperhub/events" \
  -H "Content-Type: application/json" \
  -H "X-ChronicleAI-Signature: $KEEPERHUB_WEBHOOK_SECRET" \
  -d '{"sourceEventId":"smoke-1","eventType":"gas_spike","chainId":1,"capturedAt":"2026-07-09T00:00:00Z","magnitude":{"value":600,"unit":"gwei"},"rawPayload":{}}'

# Block analysis (requires RPC_URL)
curl -X POST "https://YOUR_HOST/keeperhub/blocks" \
  -H "Content-Type: application/json" \
  -H "X-ChronicleAI-Signature: $KEEPERHUB_WEBHOOK_SECRET" \
  -d '{"chainId":1,"blockNumber":20000000}'
```

## How normalization works

- **Events**: raw Event Tracker payloads (`eventName`, `address`, `args`, …) are mapped server-side with USD magnitudes and **flow enrichment** (roles, labels, direction) when possible:

| Raw `eventName` | Output `eventType` |
| --- | --- |
| `Swap` / CoW `Trade` | `large_swap` + direction heuristics |
| `LiquidationCall` | `liquidation` → optional synthetic `liquidation_cluster` |
| `Transfer` + CEX label | `cex_inflow` / `cex_outflow` |
| Aave `Supply` / `Withdraw` | `protocol_deposit` / `protocol_withdraw` |
| USDC `Mint` / `Burn` (or zero-address Transfer) | `stablecoin_mint` / `stablecoin_burn` |
| `PoolCreated` | `contract_deployment` (not auto-published) |

- **Blocks**: Chronicle fetches the block over RPC, measures `baseFeePerGas` and tx count, applies configured thresholds, and may emit `gas_spike`, `volume_anomaly`, and `contract_deployment`.
- **Entity labels**: curated in `@chronicleai/config` `entity-labels.ts` (small CEX set; never invent at LLM time).
- **Thresholds**: `EVENT_THRESHOLDS` + `LIQUIDATION_CLUSTER` in `@chronicleai/config` defaults.

## Dual-rail network defaults (payment Base + ops Sepolia)

### Where does ChronicleRegistry live?

**Ethereum Sepolia (`11155111`) — not Base.**

| Concern | Chain | Why |
| --- | --- | --- |
| Human premium pay (x402 / CDP) | **Base Sepolia** | CDP facilitator + Circle USDC EIP-3009 on Base |
| ChronicleRegistry + trade tickets | **Ethereum Sepolia** | Same chain as desk capital, strategies, and KH write wallet |
| Desk strategies / polls / capital | **Ethereum Sepolia** | Aave / Uniswap / Chainlink venues in `SEPOLIA_DESK` |
| Affiliate / creator USDC payouts | **Ethereum Sepolia** | Ops float after CCTP rebalance (not Base payment USDC) |
| Base → Sepolia treasury rebalance | **CCTP V2** | Burns Base USDC, mints Sepolia USDC into treasury |

Deploying the registry on Base would split proofs away from the desk book and force every strategy/ticket path onto the payment rail. Keep registry co-located with the desk.

### Network defaults

| Item | Value |
| --- | --- |
| Ops / registry / desk chain | Ethereum Sepolia (`11155111`) |
| `KEEPERHUB_NETWORK` | `sepolia` |
| Desk USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (Circle ETH Sepolia) |
| Ops explorer | https://sepolia.etherscan.io |
| Payment chain (x402) | Base Sepolia (`84532`) |
| `X402_CHAIN_ID` / payment USDC | `84532` / `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Payment explorer | https://sepolia.basescan.org |
| Desk venues | `@chronicleai/config` → `SEPOLIA_DESK` |

Write workflow JSON files under this folder use `network: "11155111"`. That is intentional — **do not re-home write workflows to `84532`**. After registry redeploy, replace `contractAddress` with the new `CHRONICLE_REGISTRY_ADDRESS` and re-import (or edit) workflows in KeeperHub.

### Deploy ChronicleRegistry

```bash
cd packages/contracts
# Ensure apps/api/.env has PARA_WALLET_PRIVATE_KEY (deployer) with Ethereum Sepolia ETH
# Optional: DESK_WALLET_ADDRESS=0x… to grant operator in the same script
pnpm exec hardhat run scripts/deploy.ts --network sepolia
```

Then set:

```bash
CHRONICLE_REGISTRY_ADDRESS=0x…
KEEPERHUB_NETWORK=sepolia
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com   # desk / registry RPC
# Payment rail (Base) — separate from desk RPC
X402_CHAIN_ID=84532
X402_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
X402_RPC_URL=https://sepolia.base.org
DESK_USDC_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
```

If the deploy script did not set the operator:

```bash
# Grant KH desk wallet operator rights (deploy key ≠ desk hot path)
cast send $CHRONICLE_REGISTRY_ADDRESS "setOperator(address,bool)" $DESK_WALLET_ADDRESS true \
  --rpc-url $RPC_URL --private-key $PARA_WALLET_PRIVATE_KEY
```

### Funding runbook (4.4)

| Wallet | Needs | Sources |
| --- | --- | --- |
| **Treasury Base pocket** (Para MPC) | Base Sepolia ETH (CCTP gas) + Base Circle USDC (x402 revenue) | [Base Sepolia faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet), [Circle USDC faucet](https://faucet.circle.com/) (Base Sepolia) |
| **Treasury Sepolia pocket** (same address) | Sepolia ETH (gas) + Sepolia USDC (desk float after CCTP; optional bootstrap seed) | [Google Cloud Sepolia ETH faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia), Circle faucet (Ethereum Sepolia) |
| **Desk** (KeeperHub execution wallet) | Sepolia ETH (gas) + USDC from first capital top-up | Fund ETH via faucet; USDC arrives via Loop 7 top-up (Para → desk) — do **not** rely on an empty desk for strategy demos |
| **Strategy assets** | LINK when supplying to Aave Sepolia | Aave faucet / KH protocol setup (USDC supply is often capped on Aave Sepolia — prefer LINK after USDC→LINK swap) |

Treasury safety: never top up the desk if Para Sepolia USDC would drop below `TREASURY_SAFETY_BUFFER` + `TREASURY_USDC_OPERATING_RESERVE`. Prefer CCTP rebalance when Base float is high and Sepolia float is low.

### Dual-rail acceptance

- [ ] x402 challenge/settlement succeeds on **Base Sepolia** USDC to treasury address (basescan)
- [ ] Registry `publishAlert` (or smoke write) lands on **sepolia.etherscan.io** (not basescan)
- [ ] Write workflows use `network: "11155111"` and `CHRONICLE_REGISTRY_ADDRESS` on Ethereum Sepolia
- [ ] Para USDC transfer treasury → desk address succeeds on **Ethereum Sepolia**
- [ ] CCTP can move Base treasury USDC → Sepolia treasury USDC when rebalance is enabled
- [ ] UI proof links: payments → basescan; registry / desk / payouts → etherscan Sepolia
