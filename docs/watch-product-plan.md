# ChronicleAI — Watch Product Plan (watch → alert → proof)

**Status:** Approved (scope 1+2 — watch page + wallets/Telegram/visibility; no guardian actions)
**Author:** Buffy · **Date:** 2026-08-06 · **Deadline:** 2026-08-13
**Estimate:** ~3–4 days build + 1 day demo/ship

---

## 0. One-sentence story

> **"Tell ChronicleAI what to watch — a wallet, a contract, a protocol. It watches, alerts you on
> Telegram with proof it's real, and publishes the final report onchain."**

The Watch page becomes the primary demo front door. Everything else stays: alerts, digests, desk,
activity, affiliates, publications, premium content, all workflows, all tests. **Nothing is deleted —
the story gets reordered.**

---

## 1. Locked decisions

| Decision | Choice |
|---|---|
| Scope | Extract Watch page (1) + wallets/Telegram/visibility (2). **No approved-actions / guardian layer** — this is a watch service, not a guardian. |
| Privacy depth | **Alerts private, proof stays onchain.** Private watch = alert goes to owner's Telegram only; create + report txs stay onchain (execution proof). Public watch = alert published to registry (onchain tx) + Telegram. |
| Detail route | `/premium/watches/:watchId` stays **exactly where it is** — it is the HTTPS content-URI target baked into onchain `publishSponsoredReport` proofs. We add `/watch/:watchId` as a friendly alias. |
| Demo mode | Watch page runs **public** mode by default (full 3-tx proof); privacy toggle is the product decision that proves "people would use this." |
| Telegram delivery | **Reuse an existing bot — no new @BotFather bot.** The configured send bot (`TELEGRAM_SEND_BOT_TOKEN`) delivers; the existing `POST /telegram/webhook` (ingest bot) receives `/start` + bind codes. A connect flow is required: Telegram only allows a bot to message a user *after* the user messages the bot first. |

---

## 2. Current state (reuse map — this is a move + polish, not a rebuild)

| Piece | Where it lives today | Reuse |
|---|---|---|
| Watch request form (address, event sig, duration, x402 pay) | `apps/web/src/features/premium/SponsoredWatchRequestForm.tsx` | Move → `features/watch/` |
| Watch list | `apps/web/src/features/premium/SponsoredWatchList.tsx` | Move → `features/watch/` |
| Watch detail / audit trail page | `apps/web/src/features/premium/SponsoredWatchDetailPage.tsx` | Keep path; add `/watch/:watchId` alias |
| Data hooks (`useSponsoredWatches`, `settlePayment`) | `apps/web/src/features/premium/use-premium.ts` | Keep; import from watch feature |
| Campaign creation + payment challenge | `apps/api/src/routes/payment-routes.ts` → `POST /payments/sponsored-watch/challenges` | Extend request body only |
| Product factory (premium item + watch spec hash) | `apps/api/src/services/sponsored-watch-product-service.ts` | Add fields to spec |
| Full lifecycle (create → monitor → report onchain) | `apps/api/src/services/sponsored-watch-service.ts` | Extend monitoring for wallets + alert delivery |
| Event→target matching | `apps/api/src/services/sponsored-watch-report-service.ts` (`eventMatchesTargetContract`, `extractEventContractAddresses`) | Add wallet-topic matching |
| Telegram fan-out of published alerts | `apps/api/src/services/notification-service.ts` (`sendAlertBroadcast`, `buildTelegramAlertText`, `deliverTelegram`) | Reuse; add per-watch chat target |
| Telegram webhook + ingest (receives bot updates) | `apps/api/src/routes/telegram-webhook-routes.ts`, `apps/api/src/services/telegram-ingest-service.ts` | Extend: handle `/start` + `CHRONICLE_BIND <code>` to link chat_id |
| Public watch listing routes | `apps/api/src/routes/premium-routes.ts` (`GET /premium/watches`) | Gate by visibility |
| Public activity listing | `apps/web/src/features/activity/SponsoredWatchesPanel.tsx` | Gate by visibility |
| DB repository | `packages/db/src/sponsored-watch-repository.ts` | Extend types only |
| Nav + router | `apps/web/src/components/app-shell/nav-items.ts`, `apps/web/src/app/router.tsx` | Add Watch item + route |

---

## 3. Phase 1 — Extract Watch into its own page (1 day, frontend only)

**Goal:** `/watch` becomes the demo front door; Premium loses the watch sections; zero backend change.

1. **New page** `apps/web/src/features/watch/WatchPage.tsx`
   - Hero headline: *"Watch any wallet, contract, or protocol. Get alerts on Telegram — provably real, onchain."*
   - Hosts the moved form + list, plus a 3-step strip: **Watch → Alert (Telegram + proof) → Report (published onchain)**.
2. **Move** `SponsoredWatchRequestForm.tsx` → `features/watch/WatchRequestForm.tsx` (rename component `WatchRequestForm`; **keep all data-testids** so tests survive). Keep `onSettled` callback; link to `/watch/:watchId`.
3. **Move** `SponsoredWatchList.tsx` → `features/watch/WatchList.tsx`.
4. **Router** (`apps/web/src/app/router.tsx`): add lazy `WatchPage`, route `watch`, `watch/:watchId` (alias rendering `SponsoredWatchDetailPage`), and `routeDefinitions` entry.
5. **Nav** (`apps/web/src/components/app-shell/nav-items.ts`): add `{ id: "watch", label: "Watch", href: "/watch", group: "Core flow", icon: Eye }` as the **first item**. Update `isActiveNavPath` so `/watch/*` highlights Watch; `resolveActiveNavLabel` falls back gracefully.
6. **PremiumPage** (`apps/web/src/features/premium/PremiumPage.tsx`): remove the two watch sections (form + list + pagination + `useSponsoredWatches`). Keep teasers, AgentPaymentsPanel, PaymentRequiredModal flow.
7. **HomePage** (optional, same day): add a primary CTA to `/watch` ("Watch an address — free to try").

**Acceptance:** `/watch` renders; Premium shows only intelligence; nav highlights Watch first; `pnpm typecheck` + web tests green.

---

## 4. Phase 2 — Wallets, Telegram delivery, visibility (1.5–2 days)

### 4a. DB (migration `054_watch_fields.sql`)

```sql
ALTER TABLE public.sponsored_watches
  ADD COLUMN IF NOT EXISTS target_kind TEXT NOT NULL DEFAULT 'contract'
    CHECK (target_kind IN ('contract', 'wallet')),
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private')),
  ADD COLUMN IF NOT EXISTS last_alert_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sponsored_watches_visibility
  ON public.sponsored_watches (visibility, status);

-- Telegram bindings: links a one-time code (given by the bot on /start) to a chat_id
-- so the bot may DM that user for watch alerts. Telegram requires user-initiated contact.
CREATE TABLE IF NOT EXISTS telegram_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL,
  username TEXT,
  wallet_address TEXT,
  source TEXT NOT NULL DEFAULT 'watch',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 minutes',
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_telegram_bindings_code ON telegram_bindings (code);
CREATE INDEX IF NOT EXISTS idx_telegram_bindings_chat_id ON telegram_bindings (chat_id);
```

Update `packages/db/src/types.ts` (SponsoredWatchRow/Insert/Update) + regenerate/extend
`packages/db/src/database.types.ts`.

### 4b. Product factory (backend, ~small)

`apps/api/src/services/sponsored-watch-product-service.ts`:
- Extend `SponsoredWatchCampaignRequest` with `targetKind?: "contract" | "wallet"`,
  `telegramBindingCode?: string`, `visibility?: "public" | "private"`.
- Validate: wallet targets still require a valid EVM address (same `isAddress` check); private
  visibility requires a **used** `telegramBindingCode` (resolved to a real chat_id via
  `telegram_bindings`).
- Fold all new fields into the `watchSpec` object → they are committed via `deriveWatchSpecHash`
  (keccak) at create time. **Privacy with commitment**: the registry proves the watch's exact spec
  without revealing it.

`apps/api/src/routes/payment-routes.ts`:
- Pass the new body fields through to `prepareCampaign` (whitelist, same pattern as existing fields).

`packages/db/src/telegram-binding-repository.ts` *(new, same pattern as `sponsored-watch-repository.ts`)*:
- `create`, `findByCode` (unused + not expired), `markUsed`, `findByChatId`.

### 4c. Wallet-mode monitoring (backend, core new work)

`apps/api/src/services/sponsored-watch-service.ts` → `collectRpcLogsForWindow`:
- When `target_kind = 'wallet'`, do **not** query `getLogs({ address })` (wallets emit nothing).
  Instead fetch **Transfer events involving the wallet**:
  - **Etherscan V2** (primary): `topic0=0xddf252ad…` (Transfer sig) with `topic1=<wallet>` (from)
    and a second query with `topic2=<wallet>` (to); dedupe by tx hash.
  - **RPC fallback**: `getLogs({ topics: [[TransferSig], [wallet], []] })` and
    `[[TransferSig], [], [wallet]]`, same dedupe + bounded chunking as today.
- Encode `from`/`to` into each row's `raw_payload` (decode `topics[1]`/`topics[2]`).

`apps/api/src/services/sponsored-watch-report-service.ts`:
- Add `eventMatchesWallet(event, walletAddress)`: matches Transfer rows whose decoded
  `from`/`to` equals the wallet (the existing `extractEventContractAddresses` already picks up
  `from`/`to` fields — extend it to also decode Transfer topics in `raw_payload`).
- Watch matching path: contract watches use `eventMatchesTargetContract`; wallet watches use the
  wallet matcher.

### 4d. Alert delivery + visibility (backend)

**Cadence (be explicit):** delivery is **near-realtime polling, not push**. The campaign cycle
runs every 60s (`SPONSORED_WATCH_CYCLE_MS`), and alerts fire when a cycle tick finds **new**
matched events (diff against prior `source_event_ids`). So an alert lands within ~60s of the
event. A signed KeeperHub webhook route (`POST /keeperhub/sponsored-watch/cycle`) can force a
cycle on demand — used by the demo. Fully push-based delivery (alert on ingestion, no tick) is
possible but deliberately out of scope.

New helper in `sponsored-watch-service.ts` (`deliverWatchAlert`), invoked from `refreshMonitoring`
when **new** matched events appear:
- **Public watch:** publish alert through the existing alert pipeline
  (`alert-publication-service` — registry tx + `notificationService.sendAlertBroadcast` → Telegram
  community channel with tx hash). This is the "provably real alert" story.
- **Private watch:** `notificationService` send to the watch's `telegram_chat_id` only — **no
  registry write**. Create/report txs remain onchain.
- Log an `action_type: "monitor"` / `"alert"` exec-log entry per delivery (audit trail).

### 4e. Telegram connect flow (backend) — required, reuses existing bot

1. **Webhook extension** (`telegram-ingest-service.ts`): when an update has no `CHRONICLE_INGEST`
   envelope, check for a **direct message** (from a private chat) and reply via Bot API
   (`sendMessage` on the ingest/send bot):
   - `/start` (or any first message) → generate a one-time code, persist a `telegram_bindings`
     row, reply: *"Your ChronicleAI binding code is `ABCD12`. Paste it in the Watch form."*
   - Message containing `CHRONICLE_BIND <code>` → validate code, mark used, reply *"Linked ✓"*.
   - All other messages → ignore (return 200 as today).
2. **Code → chat_id resolution** at watch settle: `payment-routes.ts` resolves the submitted
   `telegramBindingCode` against `telegram_bindings` (unused + unexpired), marks it used, and
   stores the resolved `chat_id` on the watch row. Invalid/used/expired code → 400.
3. **Delivery** (`sponsored-watch-service.ts`): private watches send to the watch's resolved
   `chat_id` via the existing `notification-service.deliverTelegram` (send bot token).

### 4f. Visibility-gated listings (backend + frontend)

- `apps/api/src/routes/premium-routes.ts` `GET /premium/watches`: default lists **public** watches
  only. Owner-facing reads (watch detail by id) unchanged — the row is still fetchable via the
  direct URL (pseudonymous product; link is the proof of ownership for the demo).
- `apps/web/src/features/activity/SponsoredWatchesPanel.tsx`: unchanged hook, but the API now
  excludes private watches, so the public trail never leaks them.

### 4g. Watch page UI (frontend)

`apps/web/src/features/watch/WatchRequestForm.tsx`:
- **Target type toggle**: Wallet / Contract (protocol = contract + label in description).
- **Connect Telegram panel**: button *"Open @ChronicleAIBot"* (`t.me/<bot>`) + a
  **binding-code input** (required when Private). Caption: *"Send /start to the bot, then paste
  the code it replies with."*
- **Alert visibility** (Public / Private).
- Public badge vs Private badge on `WatchList` rows; link to `/watch/:watchId`.

**Acceptance:** create a wallet watch → Transfer event during the window appears in the matched
list → public watch shows a registry tx on the alert; private watch shows Telegram-only delivery
and no extra registry tx. Existing contract watches behave exactly as before.

---

## 5. Phase 3 — Demo, ship (1 day)

1. **Nav order:** Watch first, then Alerts, Activity, Digest, Archive, Premium, Desk, Affiliates.
2. **Demo script (90s):**
   1. Open `/watch` → choose **Wallet** → paste a live Sepolia address → Public + Telegram bind.
   2. Pay (x402) → watch created → **onchain create tx** shown.
   3. Address moves → **Telegram alert with tx hash** (public: registry tx on Etherscan).
   4. End of window → **report tx** → full dual audit trail.
3. **Validation:** typecheck (web + api + db), run full test suite, production build. Fix any
   errors. Play completion sound (AGENTS.md).

---

## 6. Full change list

**Frontend (web)**
- `apps/web/src/features/watch/WatchPage.tsx` *(new)*
- `apps/web/src/features/watch/WatchRequestForm.tsx` *(moved + extended)*
- `apps/web/src/features/watch/WatchList.tsx` *(moved)*
- `apps/web/src/features/watch/WatchDetailPage.tsx` *(new thin wrapper, or reuse existing)*
- `apps/web/src/app/router.tsx` — `/watch`, `/watch/:watchId`
- `apps/web/src/components/app-shell/nav-items.ts` — Watch item (first, Core flow)
- `apps/web/src/features/premium/PremiumPage.tsx` — remove watch sections
- `apps/web/src/features/premium/use-premium.ts` — extend `SponsoredWatchSummary` with new fields
- `apps/web/src/features/activity/ActivityPage.tsx` / `SponsoredWatchesPanel.tsx` — read-only (API gates)

**Backend (api)**
- `apps/api/src/services/telegram-ingest-service.ts` — handle `/start` + `CHRONICLE_BIND` (reply with code, link chat_id)
- `apps/api/src/routes/telegram-webhook-routes.ts` — pass non-ingest DMs through to binding handler
- `apps/api/src/routes/payment-routes.ts` — new body fields → `prepareCampaign`; resolve binding code at settle
- `apps/api/src/services/sponsored-watch-product-service.ts` — request/spec fields
- `apps/api/src/services/sponsored-watch-service.ts` — wallet monitoring, alert delivery, visibility
- `apps/api/src/services/sponsored-watch-report-service.ts` — wallet event matcher
- `apps/api/src/services/watch-spec-hash.ts` — spec types pick up new fields
- `apps/api/src/routes/premium-routes.ts` — visibility-gated listing

**DB / packages**
- `supabase/migrations/054_watch_fields.sql` *(new)* — watch columns + `telegram_bindings` table
- `packages/db/src/types.ts`, `packages/db/src/database.types.ts` — new columns
- `packages/db/src/telegram-binding-repository.ts` *(new)*

**Tests (add)**
- Product service: new fields flow into spec + hash; validation errors (private w/o binding code).
- Telegram binding: `/start` reply issues code; `CHRONICLE_BIND <code>` links chat_id; used/expired code rejected; watch settle resolves chat_id from code.
- Report service: wallet topic matching (`Transfer` from/to).
- Watch service: visibility delivery (public → registry path; private → chat-only, no registry call).
- Routes: `/premium/watches` excludes private watches.

---

## 7. Timeline (to Aug 13)

| Day | Work |
|---|---|
| 1 | Phase 1 — Watch page extraction + nav + router |
| 2 | Phase 1b/4a — migration + db types + product factory fields |
| 3–4 | Phase 2 — wallet monitoring, alert delivery, Telegram bind, visibility gating, form UI |
| 5 | Phase 3 — demo video, submission package, buffer |

---

## 8. Explicitly unchanged (do not touch)

Alerts, digests, desk (incl. kill switch / CCTP / treasury), affiliates, publications, premium
intelligence content, all 33 KeeperHub workflows, all 1,146 existing tests, `/premium/watches/:watchId`
detail route, existing contract-watch behavior.
