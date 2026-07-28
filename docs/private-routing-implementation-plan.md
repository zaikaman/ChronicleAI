# ChronicleAI — Private Routing / MEV Protection Implementation Plan

**Status:** Phase 4 implemented (maximum potential Sepolia polish)  
**Owner:** ChronicleAI  
**Scope:** Ethereum Sepolia only (`11155111`)  
**Depends on:** KeeperHub KEEP-137 (private mempool / Flashbots Protect)  
**Last updated:** 2026-07-16  

---

## 1. Goal

Use KeeperHub’s **private routing** surface fully inside ChronicleAI on **Ethereum Sepolia** so that:

1. Material on-chain writes that go through KeeperHub are submitted via a **private mempool RPC** (Flashbots Protect Sepolia when configured).
2. Readers, judges, and operators can **see** that private routing was requested (Activity, tickets, digests).
3. Policy chooses between **private route** and **public + gas sponsorship** where that trade-off matters.
4. Large treasury value moves do not silently bypass protection via the Para public-broadcast path.
5. Product copy stays honest: on Sepolia this is a **private submission path** and KeeperHub surface usage — not a claim of mainnet-scale sandwich economics.

**Success looks like:** desk swaps, approvals, Aave legs, revenue transfers, and kill-switch residual moves execute with `usePrivateMempool: true` through KeeperHub on Sepolia; Activity shows a clear “Private route” proof; large payouts prefer the KH private transfer path.

**Out of scope:** Ethereum mainnet promotion, CoW Protocol execution (CoW venues are mainnet/L2 mainnets, not Sepolia desk v1).

---

## 2. Background: What KeeperHub Provides

| Concept | Detail |
|--------|--------|
| Feature | KEEP-137 — private mempool routing (Flashbots Protect–style) |
| Workflow config | Per write node: `"usePrivateMempool": true`, optional `"strict": true` (default true) |
| Runtime | `resolveRpcConfig` swaps primary RPC to chain `defaultPrivateRpcUrl` when flag is set and chain supports it |
| Strict mode | Private RPC failure does **not** fall back to public mempool |
| Supported actions | `web3/write-contract`, `transfer-token`, `transfer-funds`, `approve-token`, all protocol **write** actions (`uniswap/*`, `aave-v3/*`, …) |
| Gas sponsorship | **Mutually exclusive** — private route skips Turnkey Gas Station (wallet must hold native ETH on Sepolia) |
| Chain capability | Requires `usePrivateMempoolRpc=true` + populated `defaultPrivateRpcUrl` on the Sepolia chain row |
| If unconfigured | Flag set but no private RPC → warn + public mempool |

### Flashbots Protect RPC (Sepolia)

| Network | Private / Protect RPC |
|---------|------------------------|
| Ethereum Sepolia | `https://rpc-sepolia.flashbots.net/` |

Source: [Flashbots Protect quick start](https://docs.flashbots.net/flashbots-protect/quick-start).

Desk and registry workflows already target `network: "11155111"`. This plan does not change that chain.

---

## 3. Current ChronicleAI State (Gap Analysis)

| Area | Today | Gap |
|------|--------|-----|
| Workflows under `workflows/keeperhub/` | No `usePrivateMempool` anywhere | Flag never set |
| Desk (rotate, oracle arb, defend, kill, sweep) | Public Uniswap / Aave / transfer on Sepolia | No private submission path |
| Registry writes | `web3/write-contract` public path | Low sandwich value; still useful for full-stack consistency |
| Revenue transfer | KH `transfer-token` without private flag | No private path for payouts |
| Treasury spends | **Para MPC** `signTransaction` + public broadcast | Bypasses KeeperHub private routing entirely |
| Activity / UI | “Executed via KeeperHub” + run id / tx | No routing mode badge or copy |
| Execution logs | Success/fail + receipt fields | No `routing: private_mempool` metadata |
| Env / policy | No `DESK_USE_PRIVATE_MEMPOOL` | No runtime control |
| Docs | Workflow README silent on private routing | Operators cannot configure end-to-end |

---

## 4. Non-Goals

- Ethereum mainnet (or other production L1/L2) desk promotion.
- CoW Protocol trading integration.
- Building a custom private relay or Flashbots builder.
- Claiming mainnet-scale sandwich protection on Sepolia (be honest in product copy).
- Editing KeeperHub core (`keeperhub/` is read-only for this project).
- Replacing all Para usage (Para remains valid for balance reads and low-value ops unless policy escalates).
- Hardcoding private RPC URLs into ChronicleAI API (those belong in **KeeperHub** `CHAIN_RPC_CONFIG`).

---

## 5. Architecture (Target)

```
Chronicle control plane / desk / revenue services
        │
        │  policy: private_mempool | public_sponsored
        ▼
KeeperHub workflow execute (POST /api/workflows/{id}/execute)
        │
        │  node config: usePrivateMempool + strict
        ▼
KeeperHub write-contract / transfer / approve / protocol-write
        │
        │  resolveRpcConfig(usePrivateMempool)
        ▼
Flashbots Protect Sepolia  ──or──  public Sepolia RPC (+ optional gas sponsorship)
        │
        ▼
Ethereum Sepolia (11155111)
        │
        ▼
Chronicle receipt store + execution_logs
        │  details.routing = private_mempool | public
        ▼
Activity UI / trade tickets / digests
```

### Routing policy matrix (target)

| Transaction class | Preferred route | Rationale |
|-------------------|-----------------|-----------|
| Desk Uniswap swaps | **Private** (strict) | Exercise full KH private path on swaps |
| Desk approvals | **Private** (strict) | Same submission path as swaps |
| Desk Aave supply/withdraw/repay | **Private** (strict) | Full strategy legs consistent |
| Kill-switch residual USDC | **Private** (strict) | Emergency value move; always protect |
| Desk / revenue sweep ≥ threshold | **Private** via KH transfer | Close Para hole for large size |
| Desk / revenue sweep &lt; threshold | Para or public KH | Ops simplicity / gas sponsorship OK |
| Registry publish (alert/digest/ticket) | **Private** if policy “full stack”; else public + sponsorship | Low MEV value; optional consistency |
| CCTP burn/mint | Existing path; private only if later executed via KH write + flag | Bridge semantics; document separately |

---

## 6. Prerequisites (Operator / Deploy)

These are **outside** Chronicle repo code but **block** real private submission.

### 6.1 KeeperHub chain config (Sepolia)

Set in KeeperHub `CHAIN_RPC_CONFIG` (shape as used by KH seed):

```json
{
  "eth-sepolia": {
    "isPrivateMempoolRpcEnabled": true,
    "privateMempoolRpcUrl": "https://rpc-sepolia.flashbots.net/?url=https://YOUR_FAST_SEPOLIA_RPC"
  }
}
```

**Why `?url=`:** KeeperHub swaps the **whole primary RPC** to the private URL when `usePrivateMempool` is set (reads + writes). Bare `https://rpc-sepolia.flashbots.net/` is slow on Sepolia and often yields ethers `TIMEOUT` / `RPC failed on primary endpoint` on multi-call desk paths (approve + Uniswap). Flashbots supports a [custom read RPC](https://docs.flashbots.net/flashbots-protect/settings-guide#custom-read-rpc): reads proxy to `url`, while `eth_sendRawTransaction` stays private. Use the same public Sepolia RPC you trust for KH primary (Alchemy/Infura/publicnode).

Verify with `GET /api/chains` on the KeeperHub instance: for chainId `11155111`, `usePrivateMempoolRpc === true`. Chronicle boot should log capability OK.

### 6.2 Desk / org wallet gas

Private route **disables** gas sponsorship. Ensure:

- KeeperHub org / desk wallet has **Sepolia ETH**.
- Monitoring already surfaces low balance; extend copy to mention “private route requires gas balance.”

### 6.3 Workflow re-import

After JSON changes, re-import into KeeperHub (or patch nodes in UI: Network → “Sepolia (Flashbots)” / `usePrivateMempool`). Re-bind `KEEPERHUB_WORKFLOW_*` env vars if import creates new workflow IDs.

### 6.4 Verification smoke

1. Execute a dust `transfer-token` or registry write with private flag on Sepolia.
2. Confirm tx lands; optional best-effort check that public mempool scrapers did not see it pre-inclusion.
3. Confirm Activity shows private-route metadata (after Phase 2).

---

## 7. Implementation Phases

### Phase 0 — Documentation & policy defaults

**Objective:** Single source of truth for operators and builders.

| Task | Deliverable |
|------|-------------|
| 0.1 | This plan file under `docs/` |
| 0.2 | Extend `workflows/keeperhub/README.md` and `keeperhub-ready/` with private-routing section: flag, Sepolia Flashbots URL, gas sponsorship trade-off, re-import steps |
| 0.3 | Document env vars in `apps/api/.env.example` |
| 0.4 | Product note: private submission path on Sepolia via KeeperHub + Flashbots Protect; no mainnet claims |

**Exit criteria:** A new engineer can enable private routing end-to-end from README alone.

---

### Phase 1 — Workflow hard-enable (maximum immediate use of KH surface)

**Objective:** Every value-sensitive write node opts into private routing on Sepolia.

#### 1.1 Desk workflows (P0)

Add to **every write node** config in both `workflows/keeperhub/` and `workflows/keeperhub-ready/` (keep in sync):

```json
"usePrivateMempool": true
```

Optionally explicit:

```json
"strict": true
```

| File | Nodes to update |
|------|-----------------|
| `desk-rotate-yield.workflow.json` | all `web3/approve-token`, `uniswap/swap-exact-input`, `aave-v3/supply`, `aave-v3/withdraw` |
| `desk-oracle-arb.workflow.json` | approve + swap |
| `desk-defend.workflow.json` | approve + repay / withdraw |
| `desk-kill-switch.workflow.json` | withdraw + `web3/transfer-token` |
| `desk-sweep.workflow.json` | `web3/transfer-token` |

#### 1.2 Treasury / revenue workflows (P0)

| File | Nodes |
|------|--------|
| `chronicle-revenue-transfer.workflow.json` | `web3/transfer-token` |

#### 1.3 Registry / audit workflows (P1 — full-stack consistency)

| File | Nodes |
|------|--------|
| `chronicle-publish-alert.workflow.json` | `web3/write-contract` |
| `chronicle-publish-digest.workflow.json` | write-contract |
| `chronicle-create-sponsored-watch.workflow.json` | write-contract |
| `chronicle-publish-sponsored-report.workflow.json` | write-contract |
| `chronicle-publish-premium-receipt.workflow.json` | write-contract |
| `chronicle-record-payout.workflow.json` | write-contract |
| `chronicle-publish-trade-ticket.workflow.json` | write-contract |
| `chronicle-record-capital-move.workflow.json` | write-contract |

**Policy note:** If gas credits are critical on demo and KH has sponsorship, consider leaving registry on **public** and only private-routing **desk + revenue**. Document the choice in README. Maximum potential on Sepolia = private on all KH writes when the wallet is funded.

#### 1.4 Mirror package

Apply the same JSON edits to `workflows/keeperhub-ready/` so deploy and local templates match.

**Exit criteria:** `rg usePrivateMempool workflows` shows true on all intended write nodes; workflows re-imported; one live Sepolia run with private flag succeeds (or logs KH “chain does not support” if operator skipped Phase 0 config — must not silently ship as “protected” in UI).

---

### Phase 2 — Chronicle observability & product surface

**Objective:** Make private routing first-class in the newspaper / Activity product.

#### 2.1 Execution log metadata

When starting/succeeding KeeperHub desk or write operations (`withKeeperHubLog`, desk execution bridge, write client):

Write into `execution_logs.details` (and any desk intent / ticket detail JSON):

```json
{
  "routing": "private_mempool",
  "routingStrict": true,
  "routingProvider": "flashbots_protect",
  "chainId": 11155111
}
```

Derive from Chronicle policy + known workflow config (we control the JSON), not from scraping Flashbots.

Constants / helper:

- `apps/api/src/services/routing-metadata.ts` — `buildPrivateRoutingDetails(policy)`

#### 2.2 API surface

- Activity / agent activity DTOs expose `routing` (or nested under execution details).
- Desk intent / trade ticket public payloads include `routing` when executed.

#### 2.3 Web UI (use impeccable / PRODUCT.md principles)

| Location | Change |
|----------|--------|
| Activity execution table | Badge: **Private route** / **Public** (not color-only; icon + text) |
| Trade ticket detail | “Execution path: KeeperHub private mempool (Flashbots Protect · Sepolia)” |
| Treasury / payout rows | Show routing when KH transfer used |
| Desk status / policy panel | “Private routing: ON” when env enabled |
| Low-balance banner | Mention private route requires Sepolia ETH gas (no sponsorship) |

Copy must stay calm and precise — prefer “private submission path” over “MEV-proof.”

#### 2.4 Digest / alert optional line

When desk trades execute under private routing, optional one-liner in LLM context or structured digest field: `execution_routing: private_mempool`.

**Exit criteria:** A reader can open Activity after a desk rotate and see private-route proof without reading KeeperHub admin.

---

### Phase 3 — Policy engine & Para hole closure

**Objective:** Controllable routing + no large unprotected treasury moves on Sepolia.

#### 3.1 Env configuration (`apps/api`)

| Variable | Default | Meaning |
|----------|---------|---------|
| `DESK_USE_PRIVATE_MEMPOOL` | `true` | Prefer private routing for desk KH workflows |
| `DESK_PRIVATE_MEMPOOL_STRICT` | `true` | Documented expectation; workflows set `strict` |
| `TREASURY_PRIVATE_TRANSFER_THRESHOLD_USDC` | e.g. `50` | Above this, force KH private transfer (not Para) |
| `REGISTRY_USE_PRIVATE_MEMPOOL` | `true` | Registry full-stack vs sponsorship-friendly |
| `ROUTING_PROVIDER_LABEL` | `flashbots_protect` | For UI / logs |

Wire through server env schema / config loader used by desk and revenue services.

#### 3.2 Path selection for `sendTransfer`

In `web3-client-service` / capital-manager / revenue-routing / affiliate withdrawal:

```
if amountUsdc >= TREASURY_PRIVATE_TRANSFER_THRESHOLD_USDC
  AND KeeperHub transfer workflow configured
  → keeperHub.sendTransfer (workflow already usePrivateMempool)
else
  → existing Para or KH path
```

Never invent tx hashes; refuse soft-null receipts (existing production rules).

#### 3.3 Dual workflow variants (optional advanced)

If need both sponsored public registry and private desk without re-import thrash:

- `*-public.workflow.json` vs `*-private.workflow.json` with two env IDs, or  
- Single private-only set when wallet is always funded.

Prefer **one private set** for simplicity unless gas sponsorship is required for demos.

#### 3.4 Kill switch

Always private + strict (workflow JSON). Policy cannot disable for kill-switch residual transfer.

**Exit criteria:** Transfer of amount above threshold uses KH run id + private routing metadata; below threshold may use Para; kill-switch always private.

---

### Phase 4 — Maximum potential (Sepolia polish)

**Objective:** Fully exercise private routing on Sepolia with clear policy, ops, and product proof — without leaving the Sepolia desk rail.

#### 4.1 Control-plane routing enum

Inputs:

- Notional USDC  
- Strategy type (`oracle_amm`, `yield_rotation`, `risk_defend`, kill)  
- Env flags  

Outputs:

```ts
type ExecutionRouting =
  | { mode: "private_mempool"; strict: true }
  | { mode: "public_sponsored" };
```

Rules (suggested defaults):

1. Kill switch → private strict always  
2. Desk write → private strict if `DESK_USE_PRIVATE_MEMPOOL`  
3. Registry → per `REGISTRY_USE_PRIVATE_MEMPOOL`  
4. Small treasury → Para allowed; large → KH private  

#### 4.2 Startup capability check

On API boot (when KH configured + private policy on): call or cache KeeperHub chains capability for `11155111`. If private mempool not enabled on KH, log a clear warning so demos do not claim private routing while submitting publicly.

#### 4.3 Premium desk feed / OpenAPI

Surface routing policy in desk feed product description / OpenAPI: “Executions use KeeperHub private mempool submission (Flashbots Protect on Sepolia).”

#### 4.4 Optional Protect status UX

If Flashbots exposes a useful status URL for Sepolia hashes, link it from ticket/Activity; otherwise skip.

**Exit criteria:** All material KH writes request private routing per policy; Activity and docs tell a complete Sepolia private-routing story; Para hole closed for large transfers; no mainnet/CoW work required.

---

## 8. File / Code Touch Map

| Area | Paths |
|------|--------|
| Workflows | `workflows/keeperhub/*.workflow.json`, `workflows/keeperhub-ready/*.workflow.json` |
| Workflow docs | `workflows/keeperhub/README.md` |
| Env example | `apps/api/.env.example` |
| Routing helper | `apps/api/src/services/routing-metadata.ts` (new) |
| KH write / desk bridge | `apps/api/src/services/keeperhub-write-client.ts`, `apps/api/src/services/keeperhub-execution-log.ts`, `apps/api/src/desk/execution-bridge.ts` |
| Transfer policy | `apps/api/src/services/web3-client-service.ts`, `revenue-routing-service.ts`, `affiliate-withdrawal-service.ts`, `desk/capital-manager.ts` |
| Env schema | packages/config or API env loader (existing pattern) |
| Activity API | `apps/api/src/routes/activity-routes.ts`, `agent-activity-service.ts` |
| Web Activity UI | `apps/web/src/features/activity/*` |
| Desk ticket UI | any desk ticket detail components under `apps/web` |
| Tests | unit tests for routing policy; workflow JSON assertions optional; keep integration tests real (no mock tx hashes) |
| This plan | `docs/private-routing-implementation-plan.md` |

**Do not edit:** `keeperhub/` (read-only).

---

## 9. Testing Plan

| Layer | What |
|-------|------|
| Unit | Routing policy matrix (threshold, kill always private, registry flag) |
| Unit | `buildPrivateRoutingDetails` shape |
| Workflow lint | Script or test: all desk write nodes contain `usePrivateMempool: true` when policy requires |
| Integration | KH execute path still polls wait/status; receipt has run id + tx (existing patterns) |
| Manual Sepolia | Enable KH private RPC → dust transfer → Activity badge |
| Manual failure | Misconfigured chain → UI must not claim private if we only know “requested”; prefer `routingRequested` vs `routingApplied` if KH cannot confirm |
| Regression | Gas: ensure funded wallet; document sponsorship off |
| Typecheck / build | Full monorepo typecheck + build after API/web changes |

### Routing requested vs applied

If KeeperHub does not return routing confirmation in execution payload, Chronicle should store:

- `routingRequested: "private_mempool"`
- `routingApplied: "unknown" | "private_mempool" | "public_fallback"`

Only claim “applied” when KH response or operator-verified chain config allows high confidence. Phase 2 can start with `routingRequested` + badge “Private route (requested)” until verification is solid.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Sepolia private RPC down / flaky | Prefer Protect `?url=` read proxy (see §6.1); `strict: true` fails closed; monitor desk failures; optional non-strict only for non-critical registry |
| Protect RPC timeout on approve/swap (`code=TIMEOUT`) | Bare Protect used for all eth_calls; set `privateMempoolRpcUrl` to `https://rpc-sepolia.flashbots.net/?url=<fast public Sepolia RPC>`; re-run desk-oracle-arb |
| Out of gas without sponsorship | Fund desk wallet with Sepolia ETH; low-balance banner; treasury check already exists |
| Operator forgets KH chain config | README checklist; startup log warning if `DESK_USE_PRIVATE_MEMPOOL` but chains API reports no private capability |
| Re-import changes workflow IDs | Document re-bind of all `KEEPERHUB_WORKFLOW_*` |
| Over-claiming MEV on testnet | Product copy: “private submission path” / “Flashbots Protect routing,” not “MEV-proof markets” |
| Para still used for large moves | Phase 3 threshold enforcement |

---

## 11. Suggested Implementation Order (Execution Backlog)

### Sprint A — Wire the surface (1–2 days)

1. Phase 0 docs + `.env.example`  
2. Phase 1.1–1.2 desk + revenue JSON (`usePrivateMempool: true`)  
3. Operator: KH `CHAIN_RPC_CONFIG` Sepolia Protect URL  
4. Smoke transfer / desk tick on Sepolia  

### Sprint B — Product proof (2–3 days)

5. Phase 2 routing metadata + Activity badges  
6. Kill-switch / transfer threshold policy scaffolding  
7. Tests + typecheck/build  

### Sprint C — Hardening (2–3 days)

8. Phase 3 Para threshold + registry flag  
9. Startup capability check vs KeeperHub chains API (Sepolia)  
10. Digest/ticket copy polish (impeccable)  

### Sprint D — Maximum potential (Sepolia)

11. Phase 4 control-plane routing enum  
12. Premium feed / OpenAPI routing description  
13. Optional Protect status link; final acceptance pass  

---

## 12. Acceptance Criteria (Definition of Done — Maximum Potential)

- [ ] All desk write workflows request private mempool on every material node (Sepolia)  
- [ ] Revenue transfer workflow requests private mempool  
- [ ] Registry workflows either private or explicitly documented as public for sponsorship  
- [ ] KeeperHub Sepolia has Protect RPC configured (`https://rpc-sepolia.flashbots.net/`)  
- [ ] Desk wallet funded with Sepolia ETH for non-sponsored gas  
- [ ] Activity shows routing badge for executed desk/treasury KH writes  
- [ ] execution_logs include routing metadata  
- [ ] Transfers above threshold use KH private path, not Para alone  
- [ ] Kill-switch residual always private  
- [ ] README + env example document full Sepolia setup  
- [ ] Typecheck and build pass; no mock receipts  
- [ ] Product copy honest (private submission path on Sepolia; no mainnet/CoW scope)  

---

## 13. Quick Reference — Minimal Workflow Snippet

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

Same pattern for `web3/approve-token`, `web3/write-contract`, `uniswap/swap-exact-input`, `aave-v3/*`.

---

## 14. Summary

| Question | Answer |
|----------|--------|
| Target chain | **Ethereum Sepolia only** |
| Where does private RPC come from? | Flashbots Protect Sepolia URL in **KeeperHub** chain config |
| Where does Chronicle flip the switch? | Workflow node `usePrivateMempool` (+ policy env + Activity proof) |
| Mainnet? | **Out of scope** |
| CoW? | **Out of scope** (not a Sepolia desk venue) |
| Max potential on Sepolia? | Private mempool on all material KH writes + large transfers off Para + full Activity/audit story |

This plan is the blueprint. Implement in phase order; do not skip Phase 0 operator config or Phase 1 workflow flags if the goal is real private submission rather than UI-only.
