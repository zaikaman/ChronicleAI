# ChronicleAI — KeeperHub Stack Maximization Implementation Plan

**Status:** Phase 1 complete — MCP for all material writes  
**Owner:** ChronicleAI  
**Scope:** Maximize use of KeeperHub surfaces for hackathon judging without weakening production write discipline  
**Depends on:** Existing workflow-only writes, MCP publication agent (alert/digest), private routing plan, execution audit plan  
**Last updated:** 2026-07-29  
**Related:**
- [`hackathon.md`](../hackathon.md) — judging criteria and stack checklist
- [`IDEA.md`](../IDEA.md) — product loops
- [`private-routing-implementation-plan.md`](./private-routing-implementation-plan.md)
- [`execution-audit-narrative-implementation-plan.md`](./execution-audit-narrative-implementation-plan.md)
- [`workflows/keeperhub/README.md`](../workflows/keeperhub/README.md)
- KeeperHub docs: `ai-tools/mcp-server`, `ai-tools/agentic-wallet`, `api/executions`, `api/direct-execution`

---

## 1. Goal

Raise ChronicleAI from **~75% KeeperHub stack usage** to **demo-max surface coverage** so judges can check every named surface without a scavenger hunt:

| Surface (hackathon) | Today | Target |
|---------------------|-------|--------|
| Onchain execution via KeeperHub | Strong | Keep |
| MCP server | Alert/digest only | All material writes + optional per-workflow MCP |
| CLI | Unused | Optional ops smoke script (not a product dependency) |
| x402 / MPP | Chronicle merchant rails | Merchant **plus** one agent-pays-KH path (stretch) |
| Smart gas estimation | Invisible (inside KH) | Visible in audit / Activity |
| Private routing | Strong (full private on Sepolia) | Keep — desk + registry + kill already private |
| Audit trail | Strong (A/B/C) | Keep + gas estimate/used narrative |
| Workflow builder | Static imported JSON | MCP discovery + optional validate; no runtime authoring required |

**Explicitly out of this plan:** KeeperHub **gas sponsorship** / Gas Station. Sepolia uses free faucet ETH on the execution wallet. Private routing already requires the wallet to hold Sepolia ETH; sponsorship is unnecessary for the demo and is not a build target.

**Success looks like (demo script, ~90 seconds):**

1. Agent publishes an alert **via KeeperHub MCP** (tool calls visible).
2. Desk intent fills with **private route** + full **execution audit** (preflight → submit → outcome, gas used).
3. Registry / desk txs show explorer links + KeeperHub run ids on Activity.
4. Premium access shows **x402 or MPP** settlement; discovery doc advertises dual-rail.
5. Optional stretch: side agent **pays a KeeperHub paid workflow** via agentic wallet / x402 and logs the receipt on Activity.
6. Submission artifacts: live tx link, GitHub, demo video walking the same path.

**Out of scope for this plan:**

- Editing KeeperHub core (`keeperhub/` is read-only).
- Switching production **broadcast** writes from workflows to Direct Execution.
- Mainnet promotion or CoW venues.
- Gas sponsorship / Turnkey Gas Station integration.
- Mock fills, fake gas, or invented MCP tool results.
- Replacing Para for balance reads / small treasury ops (hybrid treasury path policy already exists).
- Building a full Tempo L1 settlement stack if MPP already works as machine HMAC for the merchant product (stretch only for true Tempo USDC.e).

---

## 2. Strategic decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Production write path | **KeeperHub workflows only** | Unchanged — multi-leg desk, private flags, one run id, `/logs` |
| MCP role | **Preferred execute path** for all write classes when configured; REST remains fallback | Judges see agent-native discovery; ops still works headless |
| Direct Execution broadcast | **Never** | DE only for `simulate: true` (Layer A already) |
| Private routing | **Keep full private** on material writes (desk, registry, kill, large transfers) | Already implemented; Sepolia faucet ETH funds the wallet |
| Gas sponsorship | **Do not implement** | Not needed on Sepolia; conflicts with private mempool; out of scope |
| x402/MPP product role | Keep Chronicle as **merchant**; add optional **buyer** demo | Merchant is the product; buyer is an optional stack checkbox |
| Runtime workflow authoring | **No** `create_workflow` in production loops | Risk of runaway graphs mid-hackathon; use validate/discover only |
| CLI | **Thin ops script**, not runtime path | KH deprecates local MCP CLI; remote MCP is enough for agents |
| Honesty | Never claim private routing applied without evidence | Same standard as private-routing plan |

---

## 3. Current state (gap analysis)

### 3.1 What is already strong

| Area | Evidence |
|------|----------|
| Workflow-only writes | `keeperhub-write-client.ts`, `execution-bridge.ts`; fail hard without `KEEPERHUB_WORKFLOW_*` |
| 28 workflow JSONs | Registry, desk, monitors under `workflows/keeperhub/` |
| MCP publication | LangChain ReAct + deterministic MCP for `publishAlert` / `publishDigest` |
| Private routing | `usePrivateMempool: true` on write nodes; capability check; Activity metadata |
| Audit narrative | Layers A/B/C on desk tickets; execution_logs; KH `/logs` |
| Dual-rail merchant | x402 (EIP-712 USDC) + MPP (HMAC); `GET /payments`, `/.well-known/agent-payments` |
| Circular economy | Alerts, digests, sponsored watches, revenue routing, desk strategies |

### 3.2 Gaps vs maximum stack

| Gap ID | Gap | Impact on judging |
|--------|-----|-------------------|
| G1 | MCP limited to alert/digest; desk/revenue/sponsored use REST only | “Use of MCP” is partial |
| G2 | No `search_workflows` / `call_workflow` / per-workflow `/mcp/w/<slug>` | Agent discovery story is env-ID heavy |
| G3 | Smart gas / retries not surfaced in UI or audit summary | Reliability looks opaque |
| G4 | Payment route must be chosen by client; no auto dual-select | Dual-protocol story incomplete |
| G5 | Chronicle never **pays** KeeperHub (agentic wallet unused) | x402/MPP framed only as Chronicle revenue |
| G6 | CLI unused | Lowest priority; optional checkbox |
| G7 | Agent does not validate workflows via MCP | Nice-to-have for DX bounty |

### 3.3 Score snapshot (baseline)

```text
Execution onchain ████████████████████ 100%
Audit trail       ██████████████████░░  90%
Private routing   ██████████████████░░  90%
Workflows         █████████████████░░░  85%
MCP               ████████░░░░░░░░░░░░  40%
x402/MPP merchant ████████████████░░░░  80%
x402/MPP as KH pay ░░░░░░░░░░░░░░░░░░░░   0%
Smart gas visible ████░░░░░░░░░░░░░░░░  20%
CLI               ░░░░░░░░░░░░░░░░░░░░   0%
────────────────────────────────────────
Overall stack use ~75%
```

---

## 4. Architecture (target)

```text
┌─────────────────────────────────────────────────────────────────┐
│ ChronicleAI agents / desk / publication / revenue / payments    │
└─────────────┬───────────────────────────────┬───────────────────┘
              │                               │
              │ MCP (preferred)               │ REST fallback
              │ list/get/execute/get_execution│ POST /api/workflows/{id}/execute
              ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ KeeperHub org workflows (imported JSON, fixed IDs in env)       │
│   usePrivateMempool + strict on material write nodes            │
└─────────────────────────────┬───────────────────────────────────┘
                              │ private_mempool (Flashbots Protect)
                              ▼
                   Ethereum Sepolia (11155111)
                   Execution wallet pays gas with faucet ETH
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        Registry txs    Desk strategy    Revenue USDC
        + audit logs    + ticket audit   + Activity
```

### 4.1 Routing matrix (keep current private policy)

| Transaction class | Preferred route | Rationale |
|-------------------|-----------------|-----------|
| Desk Uniswap / Aave / approvals | **Private** strict | MEV-relevant path; show private surface |
| Kill-switch residual | **Private** strict | Always protect residual capital |
| Desk / revenue sweep ≥ threshold | **Private** KH transfer | Existing treasury policy |
| Desk / revenue sweep &lt; threshold | Public KH or Para | Ops simplicity for dust (existing) |
| Registry publish (alert/digest/ticket/…) | **Private** when `REGISTRY_USE_PRIVATE_MEMPOOL=true` | Current default / full-stack private |
| Sponsored watch create/report | Same as registry policy | Consistency |

**Ops note (Sepolia):** fund the KeeperHub execution / desk wallet with **faucet Sepolia ETH**. Private route has no free Gas Station bailout — that is fine on testnet.

**Demo env defaults:**

| Env | Demo default | Meaning |
|-----|--------------|---------|
| `DESK_USE_PRIVATE_MEMPOOL` | `true` | Desk private |
| `DESK_PRIVATE_MEMPOOL_STRICT` | `true` | Fail closed on private RPC |
| `REGISTRY_USE_PRIVATE_MEMPOOL` | `true` | Registry private (current full-stack) |
| `KEEPERHUB_MCP_ENABLED` | `true` | MCP preferred for all writes when client available |
| `KEEPERHUB_MCP_REST_FALLBACK` | `true` | REST if MCP fails |

### 4.2 MCP surface (target tool set)

| Tool | Use in Chronicle | Phase |
|------|------------------|-------|
| `list_workflows` | Discover by name/hint when preferred ID missing | 1 |
| `get_workflow` | Confirm route before execute | 1 |
| `execute_workflow` | All write classes | 1 |
| `get_execution` | Poll status + logs payload | 1 |
| `get_execution_status` / `get_execution_logs` | Compatibility aliases (already) | 1 |
| `search_workflows` | Optional marketplace / listed search | 2 |
| `call_workflow` | Optional slug-based execute | 2 |
| Per-workflow `/mcp/w/<slug>` | Optional single-tool MCP for alert publish | 2 |
| `validate_workflow` | CI / import smoke only | 4 |
| `create_workflow` | **Out of production loops** | — |

### 4.3 Dual payment roles (target)

```text
ROLE A — Chronicle merchant (existing, keep)
  Human  → x402 USDC → premium / newsletter / sponsored watch
  Agent  → MPP HMAC  → same products
  Revenue → treasury → KH revenue transfer workflow

ROLE B — Chronicle as KH client (new, stretch Phase 3)
  Chronicle side-agent or script
    → KeeperHub paid workflow (402)
    → agentic wallet or CDP signs x402
    → result + payment receipt on Activity
```

Role B is **not** required for core product loops. It is the cleanest way to check “x402/MPP as KeeperHub agentic payment” on the scorecard.

---

## 5. Non-goals (explicit)

1. Do not re-orchestrate multi-leg desk trades outside KeeperHub workflows.
2. Do not set `strict: false` on desk/kill to “fix” Protect timeouts (use Flashbots `url=` read proxy in KH chain config).
3. Do not implement gas sponsorship / Gas Station paths.
4. Do not store private keys for agentic wallet in the repo; use Turnkey/`@keeperhub/wallet` or documented test-only paths.
5. Do not make MCP mandatory when `KEEPERHUB_API_KEY` is set but MCP endpoint is down — REST fallback must keep loops alive.
6. Do not auto-create workflows in production on every publish (cost + drift).
7. Do not expand MPP to invent on-chain Tempo settlement without a real Tempo rail and tests.

---

## 6. Phased implementation

### Phase 0 — Lock plan + baseline metrics (½ day)

**Work**

1. Land this document under `docs/` (done when accepted).
2. Record baseline for demo checklist (env matrix, which workflows imported, one real tx link).
3. Confirm KH org: Sepolia private mempool RPC configured; execution wallet funded with faucet ETH.

**Exit criteria**

- [x] Plan reviewed; decisions in §2 accepted.
- [x] Operator confirmed private RPC on chain `11155111` and wallet has Sepolia ETH.
- [x] Baseline scorecard filled (section 3.3).

**Estimate:** 2–4 hours.

---

### Phase 1 — MCP for every material write path (2–3 days)

**Goal:** Every production write class can execute through KeeperHub MCP tools; REST remains fallback.

#### 1.1 Shared MCP execute core

Extract a single module used by publication agent **and** desk/revenue:

| File (proposed) | Responsibility |
|-----------------|----------------|
| `apps/api/src/services/keeperhub-mcp-client.ts` | Keep — connect / callTool |
| `apps/api/src/agents/langchain/keeperhub-mcp-tools.ts` | Keep — LangChain wrappers |
| `apps/api/src/services/keeperhub-mcp-execute.ts` **(new)** | Deterministic: resolve workflow → execute → poll → receipt |
| `apps/api/src/agents/langchain/keeperhub-mcp-publication-agent.ts` | Call shared execute; keep ReAct path for alert/digest |

`keeperhub-mcp-execute.ts` API sketch:

```ts
export type McpWriteAction =
  | "publishAlert"
  | "publishDigest"
  | "createSponsoredWatch"
  | "publishSponsoredReport"
  | "publishPremiumReceipt"
  | "recordPayout"
  | "publishTradeTicket"
  | "recordCapitalMove"
  | "transfer"
  | "deskSweep"
  | "deskDefend"
  | "deskRotate"
  | "deskOracleArb"
  | "deskKillSwitch";

export interface ExecuteViaKeeperHubMcpParams {
  action: McpWriteAction;
  workflowInput: Record<string, unknown>;
  preferredWorkflowId?: string;
  workflowHints?: string[];
  idempotencyKey?: string;
  mcp: { mcpUrl: string; apiKey: string };
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /** single-execute guard for registry contentHash actions */
  singleExecute?: boolean;
}

export interface KeeperHubMcpExecuteReceipt extends OnChainWriteReceipt {
  keeperHubRunId: string;
  txHash: string;
  explorerUrl: string;
  mode: "deterministic-mcp" | "langchain-mcp-agent";
  toolCalls: KeeperHubMcpToolCallRecord[];
  result?: unknown;
}
```

Rules:

- Prefer `preferredWorkflowId` from env when present (no accidental wrong workflow).
- If missing, score `list_workflows` by hints (existing publication scoring).
- Never double-submit registry contentHash actions (`singleExecute`).
- Map MCP errors to the same thrown shapes REST uses so callers need no dual error paths.

#### 1.2 Wire write client + desk bridge

| Caller | Change |
|--------|--------|
| `keeperhub-write-client.ts` | Extend `mcp` option beyond alert/digest to **all** methods |
| `execution-bridge.ts` | Optional `mcp` config; try MCP before REST when enabled |
| `app.ts` / env wiring | `KEEPERHUB_MCP_ENABLED`, `KEEPERHUB_MCP_URL`, rest fallback |

Receipt must still include `keeperHubRunId`, `txHash`, gas fields, routing metadata from policy.

#### 1.3 Audit / Activity

When mode is MCP:

- `execution_logs.details.executionPath: "mcp" | "rest"`
- Store truncated `toolCalls` summary (names + executionId only; no secrets)
- Desk `executionAudit.submit` may include `executionPath: "mcp"`

#### 1.4 Tests

| Test | Assert |
|------|--------|
| Unit: `keeperhub-mcp-execute` | Picks preferred ID; polls terminal; maps gas/tx |
| Unit: single-execute guard | Second execute_workflow not sent |
| Unit: write-client MCP path | Each method builds correct workflow input |
| Unit: bridge MCP path | Desk defend input shape unchanged vs REST |
| Integration (optional) | Against live KH only behind env flag |

**Exit criteria**

- [x] Alert, digest, sponsored watch, trade ticket, capital move, transfer, and all five desk actions can complete via MCP with REST fallback.
- [x] Activity / logs show `executionPath: mcp` on success path in tests.
- [x] Typecheck + unit tests green.
- [x] No production path uses Direct Execution broadcast.

**Estimate:** 2–3 days.

---

### Phase 2 — MCP discovery polish + private-routing ops clarity (1 day)

**Goal:** Stronger agent-discovery story and operator-ready private path (no new routing product).

#### 2.1 Optional MCP discovery tools

When useful for demos / scripts:

- Wire `search_workflows` / `call_workflow` as optional tools on the LangChain tool list (feature-flagged).
- Optional: document per-workflow MCP install for one listed publish workflow (`/mcp/w/<slug>`).

Not required for production loops if env workflow IDs are set.

#### 2.2 Private routing ops (documentation only unless bugs found)

Confirm and document (do not redesign):

1. Fund desk / KH execution wallet with **Sepolia faucet ETH**.
2. KH chain config: private mempool RPC for `11155111` (prefer Flashbots Protect with `url=` read proxy).
3. Boot log shows private capability when policy is on.
4. Activity / tickets already show Private route — fix only if copy is wrong or missing.

#### 2.3 Exit criteria

- [ ] Optional discovery tools behind flag **or** explicitly deferred in README with reason.
- [ ] `workflows/keeperhub/README.md` states: private path + faucet ETH; gas sponsorship not used.
- [ ] No code path introduces Gas Station / sponsorship flags.

**Estimate:** 1 day (less if discovery tools deferred).

---

### Phase 3 — Smart gas visibility + reliability narrative (1 day)

**Goal:** Make KeeperHub’s gas handling **legible** on the audit story (judging: reliability).

#### 3.1 Data already available

From KH execution status + `/logs` (Layer B):

- `gasUsed` / `gasUsedWei` / per-node gas
- Layer A dry-run `gasEstimate`
- Terminal status, errors, duration

#### 3.2 New audit fields (additive)

```ts
export interface DeskAuditGasNarrative {
  estimate?: string | null;       // from khSimulate when present
  used?: string | null;           // from outcome / logs
  usedWei?: string | null;
  regime?: "normal" | "elevated" | "critical" | null; // policy already has gasRegime
  attemptCount?: number | null;   // if KH exposes retries; else omit
  notes?: string | null;          // e.g. "estimate from DE dry-run; used from workflow logs"
}
```

Attach under `outcome.gasNarrative` or top-level `executionAudit.gas`.

#### 3.3 UI

On ticket timeline, one row:

```text
Gas — estimate 84_212 · used 91_004 · regime elevated
```

Omit estimate if Layer A skipped. Never invent numbers.

#### 3.4 Desk gas poll content link (optional)

Existing `desk-gas-poll` / `gas_spike` alerts already productize congestion. Cross-link in Activity: “Desk paused under critical gas regime” when policy blocks — already reason codes; ensure copy mentions KeeperHub execution adapts gas at submission (honest: “KeeperHub smart gas applies at submission; Chronicle policy gates intents”).

**Exit criteria**

- [ ] Filled ticket with Layer A on shows estimate vs used when both exist.
- [ ] No fabricated gas fields in tests or UI.
- [ ] Demo can point at gas row in under 10 seconds.

**Estimate:** 1 day.

---

### Phase 4 — Payment dual-select + agent-pays-KH (1–2 days + stretch)

#### 4.1 Merchant dual-protocol auto-select (must)

Today: `paymentRoute` required on challenge create.

Target:

```http
POST /payments/challenges
{ "premiumItemId": "...", "paymentRoute": "auto" }  // or omit route
```

Server logic:

1. If explicit `x402` | `mpp` → existing path.
2. If `auto` / omitted:
   - Prefer `x402` when `payerReference` looks like EVM address or client hint `wallet`.
   - Prefer `mpp` when `X-Chronicle-Client: agent` or body `clientType: "machine"`.
   - Default human web UI remains x402.
3. Response includes chosen `paymentRoute` and reason code: `auto_selected_x402` | `auto_selected_mpp`.

Update:

- `payment-routes.ts`, challenge service, discovery doc (`agent-payments.md`, `buildAgentPaymentsDiscovery`)
- Tests for auto selection matrix

#### 4.2 Agent-pays-KeeperHub (stretch)

**Minimal viable demo:**

1. Script or scheduled job: `apps/api/scripts/kh-paid-workflow-smoke.ts`
2. Calls a known free or low-cost listed KH workflow; if 402, settle via configured x402 signer (CDP / `@keeperhub/wallet` if available in env).
3. Writes `execution_logs` row: `action_type: "keeperhub_paid_call"`, payment rail, amount, workflow slug, result summary.
4. Activity shows “Paid KeeperHub workflow via x402”.

**Env (stretch):**

```text
KEEPERHUB_PAID_WORKFLOW_SLUG=mcp-test   # or listed dust workflow
KEEPERHUB_AGENTIC_PAY_ENABLED=false     # default off
# wallet / CDP credentials — never commit secrets
```

**Exit criteria (4.1 must / 4.2 stretch)**

- [ ] Auto route selection works with tests.
- [ ] Discovery documents auto behavior.
- [ ] Stretch: one Activity row from a real paid or free KH MCP call with receipt fields.

**Estimate:** 1 day (4.1) + 1 day (4.2 stretch).

---

### Phase 5 — Polish, CLI smoke, demo packaging (½–1 day)

#### 5.1 CLI / ops smoke (optional checkbox)

Not a runtime dependency. Add:

```text
apps/api/scripts/keeperhub-stack-smoke.ts
```

Steps the script runs:

1. `GET /api/chains` → private capability for 11155111  
2. MCP `list_workflows` (if enabled)  
3. Optional dry-run DE `simulate: true` for a harmless call  
4. Print MCP + private-routing env summary  

Document in README: `pnpm --filter api exec tsx scripts/keeperhub-stack-smoke.ts`

#### 5.2 Demo video shot list

| Shot | What to show | Surface |
|------|--------------|---------|
| 1 | Alert generated → MCP tool calls in logs | MCP |
| 2 | Explorer tx for registry publish | Onchain execute |
| 3 | Desk ticket audit timeline + private route | Audit + private |
| 4 | Gas estimate / used on ticket | Smart gas visibility |
| 5 | Premium pay x402 (or MPP curl) | x402/MPP |
| 6 | (Stretch) Paid KH workflow receipt | Agentic pay |

#### 5.3 Submission checklist

- [ ] GitHub source link  
- [ ] Demo video  
- [ ] At least one agent-executed tx via KeeperHub  
- [ ] This plan’s Phase 1 + 3 complete (Phase 4.1 preferred)

**Exit criteria**

- [ ] Smoke script runs against configured env.
- [ ] PRODUCT.md / workflows README align with MCP + private (no sponsorship claims).
- [ ] Typecheck + build green.

**Estimate:** ½–1 day.

---

## 7. File / module change map

| Path | Phase | Change |
|------|-------|--------|
| `docs/keeperhub-stack-maximization-implementation-plan.md` | 0 | This plan |
| `apps/api/src/services/keeperhub-mcp-execute.ts` | 1 | New shared MCP execute |
| `apps/api/src/agents/langchain/keeperhub-mcp-publication-agent.ts` | 1 | Delegate to shared execute |
| `apps/api/src/services/keeperhub-write-client.ts` | 1 | MCP all methods |
| `apps/api/src/desk/execution-bridge.ts` | 1 | MCP preferred path |
| `apps/api/.env.example` | 1–2 | MCP env docs |
| `workflows/keeperhub/README.md` | 2–5 | MCP + private ops; no sponsorship |
| `apps/api/src/desk/execution-audit.ts` | 3 | Gas narrative types |
| `apps/api/src/desk/execution-audit-builder.ts` | 3 | Populate gas narrative |
| `apps/web/src/features/desk/*` | 3 | Gas row on timeline |
| `apps/api/src/routes/payment-routes.ts` | 4 | Auto paymentRoute |
| `apps/api/src/services/agent-payments-discovery.ts` | 4 | Document auto |
| `apps/api/scripts/keeperhub-stack-smoke.ts` | 5 | Ops smoke |
| `apps/api/scripts/kh-paid-workflow-smoke.ts` | 4 stretch | Agentic pay demo |
| `apps/web/PRODUCT.md` | 5 | MCP + private product notes |
| Unit tests under `apps/api/src/test/*` | 1–4 | Cover new paths |

---

## 8. Env reference (additions)

```text
# ── MCP (Phase 1) ──────────────────────────────────────────
KEEPERHUB_MCP_ENABLED=true
# Optional override; default ${KEEPERHUB_API_BASE_URL}/mcp (strip trailing /api)
KEEPERHUB_MCP_URL=
KEEPERHUB_MCP_REST_FALLBACK=true
# Optional: use LangChain ReAct for alert/digest only (existing behavior)
KEEPERHUB_MCP_LANGCHAIN_AGENT=true

# ── Private routing (existing — keep) ──────────────────────
DESK_USE_PRIVATE_MEMPOOL=true
DESK_PRIVATE_MEMPOOL_STRICT=true
REGISTRY_USE_PRIVATE_MEMPOOL=true
TREASURY_PRIVATE_TRANSFER_THRESHOLD_USDC=50
ROUTING_PROVIDER_LABEL=flashbots_protect
# Fund DESK / KH execution wallet with Sepolia faucet ETH (private path pays its own gas)

# ── Smart gas / audit (Phase 3; mostly existing) ───────────
DESK_KH_SIMULATE_PREFLIGHT=true
DESK_KH_SIMULATE_STRICT=false

# ── Payments auto-select (Phase 4) ─────────────────────────
# No env required; behavior is API-level. Optional:
PAYMENTS_AUTO_ROUTE_DEFAULT=x402   # when client omits hints

# ── Agentic pay stretch (Phase 4) ──────────────────────────
KEEPERHUB_AGENTIC_PAY_ENABLED=false
KEEPERHUB_PAID_WORKFLOW_SLUG=
```

---

## 9. Testing strategy

| Layer | What | Command / note |
|-------|------|----------------|
| Unit | MCP execute, payment auto, gas narrative pure helpers | `pnpm --filter api test` (or monorepo vitest filter) |
| Contract | Schemas for new public fields on tickets / discovery | packages/schemas + web types |
| Integration | Live KH only with secrets; never in CI by default | scripts + explicit env |
| Manual | Demo shot list §5.2 | Staging Sepolia |
| Regression | Existing desk/private/audit tests must stay green | Do not weaken kill-switch private |

**Hard rules for tests**

- No mock onchain success presented as KeeperHub receipt in production code paths.
- MCP tests use fake client doubles; live tests gated.
- Do not assert gas sponsorship fields or UI copy.

---

## 10. Risk register

| Risk | Mitigation |
|------|------------|
| MCP latency / flakiness blocks publish loop | REST fallback default on; circuit-break after N failures per process |
| Wrong workflow matched by name hints | Always prefer env workflow ID; hints only if unset |
| Desk wallet out of Sepolia ETH | Faucet + treasury low-balance Activity warning (existing patterns) |
| Agentic wallet secrets leak | Stretch script only; secrets in env; no repo files |
| Protect timeouts on multi-leg desk | Keep Flashbots `url=` read proxy ops note; do not disable strict |
| Scope creep mid-hackathon | Ship Phase 1 + 3 first; 4.2/CLI optional |

---

## 11. Priority order (ADHD-friendly)

### Do now (must for stack max story)

1. **Phase 1** — MCP for all writes  
2. **Phase 3** — Gas estimate/used visible on audit  

### Then

3. **Phase 4.1** — Payment auto dual-select  
4. **Phase 2** — Discovery polish + ops docs (can shrink)  
5. **Phase 5** — Smoke + demo packaging  

### Nice / stretch

6. **Phase 4.2** — Agent pays KeeperHub  
7. Per-workflow MCP `/mcp/w/<slug>`  
8. `validate_workflow` in CI  
9. CLI-shaped smoke already covers “CLI” checkbox lightly  

**Total calendar estimate (one focused engineer):**  
Phases 1 + 3 ≈ **3–4 days**; +4.1/5 ≈ **1–2 days**; stretch 4.2 ≈ **+1 day**.

---

## 12. Definition of done (stack maximization)

ChronicleAI is **done** for this plan when:

1. A judge can see **MCP** tool-driven execution for at least one registry and one desk write (logs or demo).  
2. A judge can see **private routing** on a desk ticket.  
3. A judge can see **audit trail** with gas estimate and/or used on one ticket.  
4. A judge can see **x402 and/or MPP** merchant payment; auto-select documented.  
5. All material writes still go through **KeeperHub workflows** (no DE broadcast).  
6. No product path depends on or claims gas sponsorship.  
7. Typecheck and build pass; unit tests for new modules pass.  
8. Demo video + tx link ready for DoraHacks submission.

---

## 13. Implementation checklist (track progress)

### Phase 0
- [ ] Plan accepted
- [ ] Private RPC + faucet ETH on execution wallet verified

### Phase 1
- [x] `keeperhub-mcp-execute.ts` + tests
- [x] Write client all methods MCP-capable
- [x] Desk bridge MCP-capable
- [x] `executionPath` in logs
- [x] Env example updated

### Phase 2
- [ ] Optional discovery tools or explicit defer
- [ ] README: private + faucet ETH; no sponsorship

### Phase 3
- [x] Gas narrative types + builder
- [x] Ticket UI gas row
- [x] Tests for estimate/used merge

### Phase 4
- [x] Payment auto-select + discovery docs
- [ ] (Skipped by user) paid KH workflow smoke + Activity row

### Phase 5
- [ ] Stack smoke script
- [ ] PRODUCT.md aligned
- [ ] Demo shot list rehearsed
- [ ] Typecheck + build clean

---

## 14. Appendix — mapping to hackathon judging

| Criterion | Plan coverage |
|-----------|---------------|
| Executes onchain via KeeperHub | Unchanged foundation; MCP still ends in workflow execute |
| Use of surfaces (MCP, CLI, x402, MPP, workflow builder, audit) | Phases 1, 4, 5, 3 |
| Reliability / observability | Phase 3; existing audit + private routing |
| Originality / usefulness | Keep circular newspaper + desk; stack max is presentation of real system |
| Integration quality / DX | Shared MCP module, env docs, smoke script, honest copy |

**Note on gas sponsorship in hackathon copy:** listed as a KeeperHub capability. This plan **does not** build it. Sepolia faucet ETH + private routing is enough for a working, honest demo.

---

## 15. Next action after accepting this plan

Start **Phase 1.1**: add `apps/api/src/services/keeperhub-mcp-execute.ts` by extracting deterministic logic from `keeperhub-mcp-publication-agent.ts`, then wire one extra method (`publishTradeTicket` or `sendTransfer`) end-to-end before expanding to desk.
