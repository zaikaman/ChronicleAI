# ChronicleAI — Simulation → Submit → Outcome Audit Narrative Implementation Plan

**Status:** Phase 0–4 implemented (Layer C spine + Layer B run logs + Layer A optional KH dry-run + polish/demo)  
**Owner:** ChronicleAI  
**Scope:** Desk trade tickets first; registry / capital / Activity secondary  
**Depends on:** KeeperHub workflow execute + executions status/logs APIs; existing desk execution bridge  
**Last updated:** 2026-07-29  
**Related:** [Private routing plan](./private-routing-implementation-plan.md), `hackathon.md`, KeeperHub docs (`intro/overview`, `api/executions`, `api/direct-execution`)

---

## 1. Goal

Make KeeperHub’s last-mile execution legible as **one continuous audit story** that judges, readers, and operators can follow on **a single screen** (desk trade ticket):

```text
preflight  →  submit  →  outcome
(sim / policy)  (run started)  (txs · gas · terminal status)
```

Hackathon and product framing (KeeperHub audit trail):

> Every action logged: **trigger**, **simulation result**, **submitted transaction**, **gas used**, **outcome**, **timestamp**.

**Success looks like:**

1. A filled (or failed) desk intent produces a structured `executionAudit` object with ordered stages and real timestamps.
2. `GET /desk/tickets/:id` returns that object (public-safe fields) so the ticket page can render a vertical timeline without opening Activity, Explorer, and KeeperHub separately.
3. The timeline always includes at least **policy preflight → workflow submit → outcome** (layer C), even when deeper evidence is missing.
4. After a successful run, node-level gas / tx / duration from KeeperHub **execution logs** enrich the outcome (layer B).
5. Optional: before workflow execute, a KeeperHub **dry-run only** (`simulate: true` on Direct Execution) enriches preflight (layer A) — **without** switching production writes to Direct Execution.
6. CIO ticket narrative (LLM + deterministic fallback) mentions the same three beats; never invents hashes, gas, or sim results.
7. Demo video can open one ticket URL and walk preflight → submit → outcome in under 30 seconds.

**Out of scope for this plan:**

- Switching desk / registry **broadcast** writes from workflows to Direct Execution.
- Editing KeeperHub core (`keeperhub/` is read-only).
- Mock fills, fake gas, or fabricated `wouldRevert: false`.
- Mainnet promotion or new strategies.

---

## 2. Strategic decision (locked for this plan)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Production write path | **KeeperHub workflows only** | Multi-leg desk graphs, private mempool node flags, one run id, `/logs` |
| Direct Execution for broadcast | **No** | Would re-orchestrate multi-leg in Chronicle; private routing surface weaker; high rewrite risk mid-hackathon |
| Direct Execution `simulate: true` | **Optional Phase 3 only** | Dry-run does not sign/send; compatible with “workflows only for writes” |
| Primary UI surface | **Desk ticket detail** (`/desk/tickets/:id`) | Editorial, public, judge-facing; Activity stays operational |
| Layers | **C first, then B, then A** | C alone is shippable; B is high ROI; A is stretch |

### Layer definitions (A / B / C)

| Layer | Name | Source | When captured |
|-------|------|--------|----------------|
| **C** | Audit spine | Policy HF/gas regime + execution bridge start/poll + receipt | Always, every intent execute |
| **B** | Run node trace | `GET /api/workflows/executions/{id}/logs` (+ status already polled) | After terminal success or failure |
| **A** | KH dry-run preflight | `POST /api/execute/contract-call` or `/transfer` with `"simulate": true` **only** | Before workflow execute (optional, best-effort) |

These are **evidence sources on one story**, not alternate execution products.

```text
executionAudit
  ├─ preflight
  │    ├─ policy (C)           ← simulatedHfAfter, gasRegime, reasonCodes
  │    └─ khSimulate (A)       ← wouldRevert, gasEstimate   [optional]
  ├─ submit (C)                ← runId, workflowId, routing, idempotency, startedAt
  └─ outcome
       ├─ receipt (C)          ← status, txHashes, gasUsed, error, completedAt
       └─ runNodes (B)         ← per-node name, gas, tx, duration from /logs
```

---

## 3. Background: What KeeperHub provides

### 3.1 Product audit contract

From KeeperHub intro / hackathon brief:

| Beat | KeeperHub meaning |
|------|-------------------|
| Trigger | Workflow/API start of an execution |
| Simulation | Dry-run or in-engine preflight before broadcast |
| Submitted transaction | On-chain hash(es) from write steps |
| Gas used | Units and/or wei cost |
| Outcome | Terminal status success/error + result |
| Timestamp | Start / complete / per-node timing |

### 3.2 Workflow path (Chronicle production)

| API | Role today |
|-----|------------|
| `POST /api/workflows/{workflowId}/execute` | Start run; returns `executionId` |
| `GET /api/workflows/executions/{id}/wait` | Long-poll terminal receipt |
| `GET /api/workflows/executions/{id}/status` | Status, `transactionHashes[]`, progress, errors |
| `GET /api/workflows/executions/{id}/logs` | **Per-node** input/output/gas/tx/duration (**not used by desk yet**) |

Status/logs already document multi-tx `transactionHashes` with `nodeId` / `nodeName`, and log rows with `gasUsed` / `gasUsedUnits` for web3 writes.

### 3.3 Direct Execution path (optional A only)

| API | Role if used |
|-----|----------------|
| `POST /api/execute/contract-call` + `"simulate": true` | eth_call + estimateGas; no sign, no row, no broadcast |
| `POST /api/execute/transfer` + `"simulate": true` | Same for transfers |
| Response | `status: "simulated"`, `wouldRevert`, `gasEstimate`, `revertReason` |

**Do not** use DE for desk/registry broadcast in this plan.

### 3.4 Two different “simulations” (must stay labeled)

| Kind | Where | Meaning | UI label |
|------|-------|---------|----------|
| **Policy sim** | `strategy-risk` / `policy-engine` | e.g. `simulatedHfAfter` vs `hfWarn` | “Policy preflight” |
| **Chain / KH sim** | DE `simulate: true` or workflow-internal | Call would revert? gas estimate? | “KeeperHub dry-run” or “Workflow step preflight (from logs)” |

Never call policy HF alone “KeeperHub simulation.”

---

## 4. Current ChronicleAI state (gap analysis)

| Area | Today | Gap |
|------|--------|-----|
| Policy | `simulatedHfAfter`, gas regime, reason codes | Not shown as a dated **preflight stage** on the ticket |
| Execution bridge | Start workflow → poll wait/status → gas extract | Stages collapsed into one terminal receipt; no mid-flight “submitted” story row |
| `execution_logs` | `desk_intent` / `desk_workflow` started/succeeded/failed + gas on success | Flat Activity table; not a continuous ticket narrative |
| Ticket payload | signal, legs, fills, policy, routing | No `executionAudit` |
| Public ticket API | `toPublicTicketNarrative` | No audit stages, no gas on ticket |
| Ticket UI | Signal → thesis → decision → legs → execution path → proofs | Jumps from decision to hashes; no preflight/submit/outcome timeline |
| CIO narrative | Strategy / legs / fills only | Does not mention KH run lifecycle or gas |
| KH `/logs` | Documented; MCP publication agent can call it | Desk bridge never fetches or stores node logs |
| DE simulate | Explicitly disabled for writes | Dry-run also unused (A not started) |
| Gas on public ticket | Often only in logs / registry publication proofs | Fill gas not first-class on desk ticket |

**Root cause:** Execution machinery exists; **presentation + staged capture** of KeeperHub’s audit contract does not.

---

## 5. Non-goals

- Replacing workflow execute with Direct Execution for production writes.
- Editing files under `keeperhub/` (read-only reference only).
- Inventing simulation or gas when KH returns nothing — use `skipped` / `unknown` with reason.
- Turning the ticket page into a raw blockchain explorer (PRODUCT.md / DESIGN.md reject pure explorer UX).
- Requiring A for a ticket to be “complete” for judging (C + B is the bar).
- New DB tables unless payload JSON proves insufficient (prefer ticket `payload.executionAudit` first).
- Changing on-chain `ticketHash` semantics mid-flight without a versioning note (see §8.4).

---

## 6. Architecture (target)

```text
Desk control plane / strategy-runner
        │
        │  1. Policy evaluate (HF sim, gas regime, size)
        │     → record preflight.policy (C)
        │
        │  2. [Optional] DE simulate:true for primary leg(s) (A)
        │     → record preflight.khSimulate or skipped
        │
        ▼
Execution bridge
        │  3. POST workflow execute
        │     → record submit (C): runId, workflowId, routing, idempotency, at
        │  4. poll wait/status
        │     → record outcome.receipt (C): status, txs, gas, error, at
        │  5. GET .../logs (B)
        │     → record outcome.runNodes[]
        ▼
Ticket publish / intent log
        │  payload.executionAudit = full story
        │  execution_logs.details mirror key fields
        │  narrative service consumes audit for summary line
        ▼
Public API  GET /desk/tickets/:id
        │  toPublicTicketNarrative includes executionAudit (public-safe)
        ▼
Web  DeskTicketPage
        │  “Execution audit” section: vertical timeline ① ② ③
        │  Proofs remain; gas + run id also appear in timeline
        ▼
Judges / demo video
```

### 6.1 Data model (canonical)

Store on desk ticket `payload` (and optionally intent `policy_snapshot` / fill metadata) as:

```ts
/** Versioned audit story attached to a desk ticket / intent. */
export interface DeskExecutionAuditV1 {
  version: 1;
  /** One-line editorial summary for cards and CIO fallback. */
  summaryLine: string;
  stages: {
    preflight: DeskAuditPreflightStage;
    submit: DeskAuditSubmitStage;
    outcome: DeskAuditOutcomeStage;
  };
}

export interface DeskAuditPreflightStage {
  id: "preflight";
  at: string; // ISO
  status: "passed" | "failed" | "skipped" | "partial";
  policy?: {
    allow: boolean;
    reasonCodes: string[];
    simulatedHfAfter?: number | null;
    gasRegime?: "normal" | "elevated" | "critical" | null;
    notionalUsdc?: number | null;
    strategy?: string | null;
  };
  /** Layer A — only when dry-run attempted. */
  khSimulate?: {
    attempted: boolean;
    status: "passed" | "failed" | "skipped" | "error";
    wouldRevert?: boolean;
    gasEstimate?: string;
    revertReason?: string | null;
    from?: string;
    to?: string;
    endpoint?: "contract-call" | "transfer";
    errorMessage?: string | null;
  };
  notes?: string | null;
}

export interface DeskAuditSubmitStage {
  id: "submit";
  at: string;
  status: "started" | "skipped" | "failed";
  keeperHubRunId?: string | null;
  workflowId?: string | null;
  workflowAction?: string | null; // defend | rotate | oracle_arb | ...
  idempotencyKey?: string | null;
  routing?: "private_mempool" | "public" | null;
  routingStrict?: boolean | null;
  routingProvider?: string | null;
  network?: string | null;
  chainId?: number | null;
  errorMessage?: string | null;
}

export interface DeskAuditOutcomeStage {
  id: "outcome";
  at: string;
  status: "filled" | "failed" | "timeout" | "unknown";
  terminalKhStatus?: string | null;
  txHashes: string[];
  explorerUrls?: string[];
  gasUsed?: string | null;       // units preferred
  gasUsedWei?: string | null;
  gasEstimateVsUsed?: {
    estimate?: string | null;
    used?: string | null;
  } | null;
  errorMessage?: string | null;
  /** Layer B */
  runNodes?: DeskAuditRunNode[];
  logsFetched?: boolean;
  logsFetchError?: string | null;
}

export interface DeskAuditRunNode {
  nodeId: string;
  nodeName?: string | null;
  nodeType?: string | null;
  status: string;
  durationMs?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  txHash?: string | null;
  explorerUrl?: string | null;
  gasUsed?: string | null;
  gasUsedUnits?: string | null;
  error?: string | null;
}
```

**Rules:**

- Never invent `txHash`, `gasUsed`, or `wouldRevert`.
- Missing optional evidence → omit field or set stage sub-status `skipped` with `notes` / `errorMessage`.
- `summaryLine` is deterministic from stages (see §9); LLM may paraphrase but must not add facts.

### 6.2 Public DTO (ticket narrative)

Extend `PublicDeskTicketNarrative` / web `DeskTicketNarrative`:

```ts
executionAudit?: DeskExecutionAuditV1 | null;
/** Convenience for list cards */
executionAuditSummary?: string | null;
gasUsed?: string | null;
gasUsedWei?: string | null;
```

Strip secrets from run node `input` if any log fields are ever mirrored publicly (prefer **not** exposing full node input on public ticket — only name, status, gas, tx, duration, error).

### 6.3 Execution log mirror

On intent success/fail and bridge complete, continue writing `execution_logs` but enrich `details`:

```json
{
  "execution_audit_version": 1,
  "execution_audit_summary": "Preflight passed → private submit → filled · 61234 gas",
  "keeper_hub_run_id": "...",
  "preflight_status": "passed",
  "submit_at": "...",
  "outcome_status": "filled",
  "gas_used": "61234",
  "gas_used_wei": "...",
  "tx_hashes": ["0x..."],
  "logs_node_count": 4,
  "kh_simulate_status": "skipped"
}
```

Activity table can later show summary column; Phase 1–2 do not require a full Activity redesign.

---

## 7. Implementation phases

### Phase 0 — Spec lock & shared types

**Objective:** Single source of truth for the audit object and product copy.

| Task | Deliverable |
|------|-------------|
| 0.1 | This plan under `docs/execution-audit-narrative-implementation-plan.md` |
| 0.2 | Shared TypeScript types (prefer `packages/schemas` or `apps/api/src/desk/execution-audit.ts` + re-export to web types) |
| 0.3 | Pure helpers: `buildSummaryLine(audit)`, `emptyAuditSkeleton()`, stage builders |
| 0.4 | Unit tests for summary line + public redaction (no raw node inputs) |
| 0.5 | Product copy glossary (see §11) in plan + short comment in `PRODUCT.md` only if needed |

**Exit criteria:** Types compile; tests pass; engineers agree A is optional DE dry-run only.

---

### Phase 1 — Layer C (audit spine) end-to-end

**Objective:** Every desk execute records preflight → submit → outcome from data already available; ticket + API + UI show it.

#### 1.1 Capture points

| Step | File(s) | Action |
|------|---------|--------|
| Policy decision | `strategy-runner.ts` / control plane | When proposing/executing, snapshot policy preflight fields into an in-memory `ExecutionAuditBuilder` |
| Bridge start | `execution-bridge.ts` | Immediately after `startWorkflow` returns `executionId`, record **submit** stage (do not wait for terminal) |
| Bridge terminal | `execution-bridge.ts` | On success/fail/timeout, record **outcome.receipt** with gas + txs via existing `receiptFromStatus` / `extractKeeperHubError` |
| Intent logging | `strategy-runner.ts` `logIntent` | Attach audit snapshot (or partial) to details |
| Ticket publish | `ticket-service.ts` / `strategy-runner` publish input | Embed `executionAudit` in ticket payload (and policy if useful) |

**Builder pattern (recommended):**

```ts
// apps/api/src/desk/execution-audit-builder.ts
class ExecutionAuditBuilder {
  recordPolicyPreflight(...)
  recordSubmit(...)
  recordOutcome(...)
  // Phase 2/3:
  recordRunNodes(...)
  recordKhSimulate(...)
  build(): DeskExecutionAuditV1
}
```

Pass builder through `executeIntent` → bridge callbacks, or return enriched receipt:

```ts
interface DeskWorkflowReceipt {
  // existing fields...
  executionAuditPartial?: Partial<DeskExecutionAuditV1>;
}
```

Prefer **builder owned by strategy-runner** so policy fields stay in one place; bridge returns submit/outcome fragments to merge.

#### 1.2 Failed and blocked paths

| Path | Expected story |
|------|----------------|
| Policy deny (no execute) | preflight `failed` or `passed` with `allow: false`; submit `skipped`; outcome `skipped`/`unknown` — **optional** ticket only if product publishes declined intents (default: log only) |
| Bridge not configured | preflight passed; submit `failed`; outcome `failed` with clear message |
| KH terminal error | submit `started` with runId if any; outcome `failed` + error |
| Poll timeout | outcome `timeout`; runId still shown |
| Partial multi-tx | outcome `filled` or `failed` per existing fill rules; list all real hashes only |

#### 1.3 API

- `toPublicTicketNarrative` maps `payload.executionAudit` → public fields.
- List endpoints may include `executionAuditSummary` only (avoid huge payloads).
- Detail endpoint includes full public audit.

#### 1.4 Web UI — `DeskTicketPage`

New section **between Legs and Execution path** (or between Execution path and Proofs):

**Title:** Execution audit  
**Description:** KeeperHub last mile: preflight, submit, and outcome for this intent.

UI structure (editorial, not explorer):

```text
① Preflight     [passed]  ·  HF preflight OK  ·  gas regime normal  ·  12:04:01
② Submit        [started] ·  run abc…  ·  private mempool  ·  12:04:02
③ Outcome       [filled]  ·  0xdef…  ·  61,234 gas  ·  12:04:18

summaryLine as calm subhead
```

Use existing chrome: `PageSection`, `Surface`, `StatusBadge`, `ProofMonoLink`, `TimestampDisplay`, `RoutingBadge`. Follow impeccable / PRODUCT.md: proof-first, no glassmorphism, no raw JSON dump.

**Gas:** show on outcome row using `formatGasUsed` (same as publication proofs).

**Empty/legacy tickets:** if no `executionAudit`, hide section or show one-line “Execution audit not recorded for this ticket” — do not fabricate.

#### 1.5 Narrative service

Extend `NarrativeInput` with optional `executionAudit` / stage summary fields. Deterministic fallback:

```text
Desk risk_defend filled · 100 USDC · preflight passed → submit run… → outcome filled · 61234 gas
```

LLM system rules: only use provided audit facts; never invent stages.

#### 1.6 Tests

| Test | Assert |
|------|--------|
| Unit: summary line | Stage statuses produce stable string |
| Unit: public mapper | Strips internal-only fields |
| Integration-ish: bridge mock | Submit recorded with runId before poll completes (unit with fake clock/fetch) |
| strategy-runner | On fill, ticket payload contains `executionAudit.version === 1` |
| Web | Ticket page renders three stages when fixture present (`data-testid` hooks) |

**Exit criteria:** One real or fixture ticket shows three stages with real run id + gas + tx on the public page; typecheck + build green.

---

### Phase 2 — Layer B (KeeperHub run logs)

**Objective:** After terminal workflow status, fetch per-node logs and attach to outcome.

#### 2.1 Client

In `execution-bridge.ts` (or small `keeperhub-execution-logs.ts` helper):

```http
GET /api/workflows/executions/{executionId}/logs
Authorization: Bearer kh_...
```

Normalize KH log rows → `DeskAuditRunNode[]`:

- Sort by `startedAt` ascending for narrative (API returns descending — reverse).
- Map web3 success output: `transactionHash`, `gasUsed`, `gasUsedUnits`, `transactionLink`.
- Cap public list (e.g. max 20 nodes) to keep payload small.
- On fetch failure: `logsFetched: false`, `logsFetchError`, still keep receipt-level outcome.

#### 2.2 Timing

Call **after** terminal success or failure (and optionally on timeout if runId exists). Do not block start. Soft-fail: never fail the trade solely because logs failed.

#### 2.3 UI

Under outcome stage, expandable **Run steps** list:

| Node | Status | Duration | Gas | Tx |
|------|--------|----------|-----|-----|
| Approve USDC | success | 1.2s | … | 0x… |
| Swap | success | … | … | … |

Default collapsed on mobile; expanded on desktop detail if ≤ 6 nodes.

#### 2.4 Gas aggregation

If receipt-level `gasUsed` missing, optionally sum `gasUsedUnits` from successful web3 nodes (document as derived). Prefer KH wait payload totals when present.

#### 2.5 Tests

- Parser fixtures from KH docs sample log JSON.
- Bridge test: after poll success, logs endpoint called once; nodes attached.
- Failure: logs 500 → outcome still filled, `logsFetched: false`.

**Exit criteria:** Live desk fill shows node steps on ticket matching KeeperHub run UI; demo can point at step gas.

---

### Phase 3 — Layer A (optional KH dry-run)

**Objective:** Best-effort KeeperHub simulate before workflow broadcast for stronger “sim → submit” proof.

#### 3.1 Constraints (non-negotiable)

- `"simulate": true` only — **no** DE broadcast.
- Workflows remain the only write path.
- Fail-open vs fail-closed:
  - **Default:** soft — sim error → `khSimulate.status: "error"` or `"skipped"`, still execute if policy C passed.
  - **Optional strict env:** `DESK_KH_SIMULATE_STRICT=true` blocks risk-increasing executes when sim would revert or transport fails.

#### 3.2 Scope (hackathon-pragmatic)

| Strategy | What to simulate | Why |
|----------|------------------|-----|
| `oracle_amm` | Primary swap or transfer shape | Single material write |
| `risk_defend` | Repay or withdraw contract-call | One primary leg |
| `yield_rotation` | **Primary** leg only (e.g. swap *or* supply), not full multi-leg | Full multi-leg DE chain is out of scope |
| kill / sweep | Optional transfer simulate | Nice-to-have |

Document that multi-leg workflows still rely on **in-run** preflight + Phase B logs for full fidelity.

#### 3.3 Implementation sketch

```ts
// apps/api/src/desk/kh-simulate-preflight.ts
async function simulatePrimaryLeg(leg, config): Promise<KhSimulateResult>
```

- Build ABI/args from real leg data (Aave/Uniswap addresses already known in desk code) — **production-ready, no mocks**.
- `POST ${KEEPERHUB_API_BASE_URL}/api/execute/contract-call` with body + `simulate: true`.
- Map response into `preflight.khSimulate`.
- If `wouldRevert: true` and strict: abort execute; record preflight failed; mark intent failed with reason `kh_simulate_would_revert`.

#### 3.4 UI

Preflight row shows two lines when A present:

- Policy: …
- KeeperHub dry-run: passed · est. 65,000 gas · wouldRevert false

Honest subtitle: dry-run uses org wallet `from` path; Safe/msg.sender caveats per KH docs if applicable.

#### 3.5 Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `DESK_KH_SIMULATE_PREFLIGHT` | `true` | Enable layer A (hackathon default on; soft fail-open) |
| `DESK_KH_SIMULATE_STRICT` | `false` | Block execute on revert/error |
| `DESK_KH_SIMULATE_TIMEOUT_MS` | `15000` | Abort sim wait |

#### 3.6 Tests

- Mock KH simulate success/revert/HTTP error.
- Strict vs soft behavior.
- Ensure **no** non-simulate DE execute is ever called (assert URL/body in tests).

**Exit criteria:** With flag on, a ticket shows KH dry-run evidence; with flag off, C+B unchanged. No production DE writes.

---

### Phase 4 — Polish, Activity, demo readiness

**Objective:** Judge- and operator-facing completeness.

| Task | Detail |
|------|--------|
| 4.1 | List cards / `DeskTicketsPanel`: show `executionAuditSummary` one-liner |
| 4.2 | Activity: optional column or subtitle from `execution_audit_summary` for `desk_intent` / `desk_workflow` |
| 4.3 | Deep link from ticket to Activity filtered by intent id (if filter exists; else skip) |
| 4.4 | Protect status URLs remain under Execution path; timeline can link “Protect →” when private |
| 4.5 | Demo script section in this doc (§12) |
| 4.6 | Typecheck + build; fix errors; completion sound per project Agents.md when implementing |
| 4.7 | Optional: capital move / registry publication reuse same audit type for consistency (P2) |

**Exit criteria:** Demo path documented; one Sepolia ticket URL sufficient for video; no type/build failures.

---

## 8. File-level change map

### 8.1 API (primary)

| Path | Change |
|------|--------|
| `apps/api/src/desk/execution-audit.ts` | **New** — types, summary line, redaction |
| `apps/api/src/desk/execution-audit-builder.ts` | **New** — mutable builder |
| `apps/api/src/desk/execution-bridge.ts` | Record submit at start; outcome at end; fetch logs (P2); return fragments |
| `apps/api/src/desk/strategy-runner.ts` | Own builder; policy preflight; merge bridge; pass to ticket + logs |
| `apps/api/src/desk/ticket-service.ts` / types | Accept `executionAudit` in publish/build input |
| `apps/api/src/desk/control-plane.ts` | `toPublicTicketNarrative` exposes audit |
| `apps/api/src/desk/agent/narrative.ts` | Consume audit for summary |
| `apps/api/src/desk/kh-simulate-preflight.ts` | **New** Phase 3 only |
| `apps/api/src/routes/desk-routes.ts` | Ensure detail returns audit |
| `apps/api/src/test/*` | New unit tests for audit + bridge logs + simulate |

### 8.2 DB / packages

| Path | Change |
|------|--------|
| `packages/db/src/desk-ticket.ts` | Optional: document `executionAudit` on payload; **no migration required** if JSON payload |
| `packages/schemas` | Optional shared zod schema for audit v1 |
| Migrations | **None required** for Phase 1–2 if audit lives in `desk_tickets.payload` and `execution_logs.details` |

### 8.3 Web

| Path | Change |
|------|--------|
| `apps/web/src/features/desk/types.ts` | `executionAudit` fields |
| `apps/web/src/features/desk/DeskTicketPage.tsx` | Execution audit section |
| `apps/web/src/features/desk/ExecutionAuditTimeline.tsx` | **New** presentational component |
| `apps/web/src/features/desk/DeskTicketsPanel.tsx` | Summary line on cards (Phase 4) |
| `apps/web/src/features/activity/*` | Optional summary (Phase 4) |
| Tests / fixtures | Storybook-less: component tests or route fixtures if present |

### 8.4 Ticket hash / canonical payload caution

`ticketHash` is keccak of canonical ticket JSON. Adding `executionAudit` **into hashed body** changes hashes for the same economic intent if included before hash.

**Recommendation:**

- Store `executionAudit` on the **DB row payload** used for API/UI.
- Prefer **excluding** `executionAudit` from the **on-chain hashed** canonical ticket body **or** add it only under a clearly versioned extension that is documented.
- Practical approach: keep `DeskTicketV1` hash fields as today; attach `executionAudit` as a sibling key on persisted payload **after** hash computation, e.g. `payload = { ...canonical, executionAudit }` where hash is over canonical only — **verify** current `buildDeskTicketV1` / publish flow and implement without breaking existing ticket verification.

If product requires audit inside canonical hash, bump ticket version and document — do not silently change v1.

---

## 9. Summary line algorithm (deterministic)

```text
parts = []
parts += "Preflight " + preflight.status
if khSimulate?.status → parts += "· KH sim " + khSimulate.status
parts += "→ Submit " + (submit.keeperHubRunId ? "run" : submit.status)
if routing == private_mempool → parts += "· private"
parts += "→ " + capitalize(outcome.status)
if gasUsed → parts += "· " + formatGas(gasUsed) + " gas"
if outcome.errorMessage && failed → parts += "· " + truncate(error, 60)
summaryLine = join(parts) capped 240 chars
```

Examples:

- `Preflight passed → Submit run · private → filled · 61234 gas`
- `Preflight passed · KH sim passed → Submit run → failed · insufficient allowance`
- `Preflight failed → Submit skipped → unknown · simulated_hf_below_warn`

---

## 10. Observability & failure matrix

| Event | preflight | submit | outcome | User-visible |
|-------|-----------|--------|---------|--------------|
| Policy block | failed / allow false | skipped | skipped | Reason codes; optional no ticket |
| Sim would revert (strict A) | failed (khSimulate) | skipped | skipped | Clear sim reason |
| Sim transport error (soft A) | partial + khSimulate error | started | filled/failed | Note sim skipped |
| Workflow start OK, run fails | passed | started + runId | failed + error + nodes? | Full story |
| Success multi-leg | passed | started | filled + N txs + nodes | Timeline + steps |
| Logs fetch fail | passed | started | filled, logsFetched false | Receipt only |
| Timeout | passed | started | timeout | Run id for manual KH check |

---

## 11. Product copy glossary

| Prefer | Avoid |
|--------|--------|
| Execution audit | “MEV-proof log” |
| Policy preflight | “KeeperHub simulation” (for HF-only) |
| KeeperHub dry-run | “We simulated on DE” in user-facing marketing without context |
| Workflow run / KeeperHub run | “Job id” alone |
| Private submission path | “MEV-protected” as absolute claim |
| Gas used | Fake precision / made-up estimates presented as fact |
| Outcome filled / failed | “Probably landed” |

Tone: calm, editorial, proof-first — matches desk ticket and newspaper product.

---

## 12. Demo script (judges)

**Target runtime:** under 30 seconds on one ticket URL.

### Prep (before recording)

1. Confirm a real Sepolia fill exists with `payload.executionAudit` (Phases 1–3).
2. Copy the public ticket URL: `/desk/tickets/<ticketId>`.
3. Optional: note the intent id for Activity deep link (`?entityId=<intentId>&entityType=desk_intent`).

### On camera

1. **Open desk status** (optional, 3s) — agent/policy live; private route note if shown.
2. **Open the trade ticket URL** — headline = strategy · notional; proofs visible in chrome.
3. **Scroll to Execution audit** (the continuous story):
   - **① Preflight** — Policy preflight (HF / gas regime / reason codes). If Phase 3 ran: **KeeperHub dry-run** line (wouldRevert + est. gas).
   - **② Submit** — KeeperHub run id + private route badge when applicable.
   - **③ Outcome** — terminal status, tx link(s), gas used.
4. **Expand Run steps** (Phase 2) — pick one web3 node; open its explorer tx.
5. **Protect →** (when private) — Flashbots Protect status from the outcome row (and/or Execution path section).
6. **Optional 5s:** click **Activity logs for this intent →** — filtered KeeperHub log rows with the same audit summary one-liner.
7. **Close line:** “Chronicle decides under policy; KeeperHub is the last mile; this ticket is the full audit trail.”

### List surface (optional cutaway)

- Activity **Trade tickets** cards show `executionAuditSummary` under the title.
- KeeperHub execution log **Message** column shows the audit subtitle for `desk_intent` / `desk_workflow` when `details.execution_audit_summary` is present.

### Submit package checklist

| Item | Notes |
|------|--------|
| GitHub link | Public ChronicleAI repo |
| Demo video | One ticket URL walkthrough above |
| Tx link | On-chain fill/registry tx executed via **KeeperHub** (hackathon rules) |
| Ticket URL | `/desk/tickets/:id` with execution audit visible |

---

## 13. Testing strategy

| Level | Coverage |
|-------|----------|
| Unit | Summary line, builders, log parser, public redaction, gas format |
| API | `toPublicTicketNarrative` with/without audit; legacy tickets |
| Bridge | Mock fetch sequence: execute → wait → logs; simulate optional |
| Runner | Policy deny / fill / fail audit shapes |
| Web | Timeline renders stages; a11y labels not color-only |
| Manual Sepolia | One defend or oracle_arb path; screenshot ticket audit |
| Regression | typecheck + build (mandatory per Agents.md when implementing) |

No mocks for production paths; tests may mock **HTTP to KeeperHub** only.

---

## 14. Rollout order & estimates

| Phase | Depends | Rough effort | Judge impact |
|-------|---------|--------------|--------------|
| 0 Spec/types | — | S | Foundation |
| 1 Layer C + UI | 0 | **M (priority)** | **Critical** — one-screen story |
| 2 Layer B logs | 1 | M | High — KH surface depth |
| 3 Layer A simulate | 1 | M–L | Medium — nice “sim” checkbox |
| 4 Polish/demo | 1–2 | S | Demo conversion |

**Hackathon recommendation:** Ship **0 → 1 → 2 → 4**; do **3** only if time remains.

---

## 15. Exit criteria (definition of done)

- [x] `DeskExecutionAuditV1` defined and tested  
- [x] Desk execute always attempts to record C stages (no invented data)  
- [x] Public ticket detail API returns audit when present  
- [x] `DeskTicketPage` shows continuous preflight → submit → outcome  
- [x] Gas used and KeeperHub run id visible in the story (not only buried in proofs)  
- [x] Phase 2: run nodes from `/logs` on success path  
- [x] Phase 3 (optional): dry-run only; zero DE broadcasts in code paths  
- [x] Narrative/fallback mentions audit beats  
- [x] Legacy tickets without audit do not crash  
- [x] Phase 4: list cards + Activity summary + intent deep link + Protect on timeline  
- [x] `pnpm` typecheck + build pass  

- [x] Demo script documented for one real ticket URL  

---

## 16. Open questions (resolve during Phase 0–1)

1. **Hash boundary:** Confirm `executionAudit` is outside on-chain `ticketHash` canonical body (§8.4).  
2. **Declined intents:** Publish ticket for policy-blocked intents or execution_logs only?  
3. **Capital moves / registry:** Same audit type in this hackathon or desk-only?  
4. **Phase 3 default:** `DESK_KH_SIMULATE_PREFLIGHT` default **true** for hackathon audit trail (sim → submit → outcome); `DESK_KH_SIMULATE_STRICT` stays **false** (fail-open).  
5. **Premium feed:** Full node inputs premium-only vs never store publicly (recommend never on public).  

---

## 17. References

| Resource | Location |
|----------|----------|
| Hackathon brief | `hackathon.md` |
| Private routing plan | `docs/private-routing-implementation-plan.md` |
| Desk bridge | `apps/api/src/desk/execution-bridge.ts` |
| Strategy runner | `apps/api/src/desk/strategy-runner.ts` |
| Ticket UI | `apps/web/src/features/desk/DeskTicketPage.tsx` |
| Narrative | `apps/api/src/desk/agent/narrative.ts` |
| Workflows README | `workflows/keeperhub/README.md` |
| KH executions API | `keeperhub/docs/api/executions.md` |
| KH direct execution / simulate | `keeperhub/docs/api/direct-execution.md` |
| KH intro audit trail | `keeperhub/docs/intro/overview.md` |

---

## 18. One-line summary

**Keep workflow writes; capture KeeperHub’s preflight → submit → outcome as a first-class `executionAudit` on desk tickets; render it as one editorial timeline; enrich with `/logs` (B) and optional DE dry-run (A) — never switch broadcast to Direct Execution for this hackathon.**
