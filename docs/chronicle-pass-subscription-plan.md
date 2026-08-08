# Chronicle Pass Subscription + Subscription Management — Implementation Plan

Status: **in progress** (execution mode permits file changes as of this plan).

## Goal

Move human monetization from per-item payments to a **Chronicle Pass** subscription at
**$4.99 USDC/month** while preserving the existing `x402_newsletter_subscriptions` tables,
item-payment routes for agents/legacy, and sponsored-watch / machine-feed products as separate
revenue lines.

## Product model

| Audience | Free | Chronicle Pass ($4.99/mo) | Separate products |
| --- | --- | --- | --- |
| Human readers | public alerts, digest highlights, archive previews, one editorially selected deep dive per month | all human-facing deep dives, historical premium items, full archive, premium digest delivery | — |
| Machines / agents | — | not included | per-item x402/MPP payments, structured feeds, desk feeds |
| Monitoring | — | not included | sponsored watches (paid campaigns) |

## Design decisions

- **Do not rename** `x402_newsletter_subscriptions` or the `monthly_newsletter` content type in v1.
  The existing recurring-newsletter infrastructure *is* the Chronicle Pass entitlement store.
- **Price:** canonical env `CHRONICLE_PASS_PRICE_USDC` (default `4.99`), compatibility alias
  `NEWSLETTER_MONTHLY_PRICE_USDC` retained (takes precedence when set explicitly).
- **Wallet auth:** short-lived signed-message sessions. Challenge message embeds wallet, nonce,
  issued-at, expiry, and chain id. Nonce is single-use, persisted in a new
  `chronicle_pass_sessions` table, and consumed when the session activates. Session is a random
  bearer token stored **only as SHA-256** server-side and delivered as an HttpOnly cookie.
- **Entitlement on every request:** `/premium/items` (archive expansion) and
  `/premium/items/:id` resolve the session cookie → wallet → `isNewsletterEntitled()` check.
  Cancellation completion, expiry, and failed renewal revoke access at the entitlement layer.
- **Pass coverage:** editorial human intelligence only — `deep_dive` and `historical_feed`
  (including `archived` items). Excluded: `structured_feed`, `sponsored_monitor`,
  `monthly_newsletter`, and desk-feed products (machine/agent rails).
- **402 response** for pass-covered items carries `passRequired: true` + `upgradePath: "/subscription"`
  so browser clients render the Pass CTA; machine clients keep the per-item challenge flow.

## Implementation steps

1. **Config** (`packages/config/src/server-env.ts`): default monthly price `4.99`, alias env.
2. **Schema + DB**
   - Migration `056_chronicle_pass_sessions.sql`: single table storing challenge nonces and
     active session token hashes (single-use nonce semantics).
   - `chronicle-pass-session-repository.ts` + row types.
3. **Schemas** (`packages/schemas`): `CHRONICLE_PASS_PRICE_USDC`, pass status mapping,
   auth challenge/verify, status/preferences/payment-history API types.
4. **Services**
   - `chronicle-pass-auth-service.ts`: challenge issuance, EIP-191 signature verification (viem
     `verifyMessage`), session activation/lookup/logout, cookie helpers.
   - `chronicle-pass-service.ts`: wallet-scoped status, preference updates (with email subscriber
     re-link), cancel-at-period-end, resume, wallet renew + settle (reusing the newsletter x402
     challenge/settlement service), bounded payment history, entitlement resolver.
   - `newsletter-subscription-service.ts`: add wallet-based renewal challenge issuance.
5. **Routes** `subscription-routes.ts`: `/subscriptions/auth/{challenge,verify,logout,session}` +
   `/subscriptions/me/*`. Wired in `setupUS2Routes` (has x402 adapter + settlement service);
   registered module-wide so US3 premium routes can resolve entitlement.
6. **Premium entitlement** (`premium-access-service.ts`, `premium-routes.ts`): pass-covered items
   unlock for entitled session wallets; archived editorial items appear in the catalog for pass
   holders only; 402 signals `passRequired`.
7. **Web**
   - `use-subscription.ts` + lazy `/subscription` page (wallet gate, status, period/renewal,
     actions, preferences, payment history, empty/error/loading/past-due/expired/rejected states).
   - Header/footer links, Premium page pass-first cards + upgrade CTA + archive section.
   - Homepage copy: Hero, How It Works, Features Bento, FAQ, Footer.
8. **README / Earn** narrative rewrite after entitlement behavior is stable.
9. **Tests**: auth (expired/replay/malformed/wrong-wallet), service (states, cancel/resume/renew,
   prefs, payments, entitlement), price default. Typecheck + test + production build.

## API surface

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /subscriptions/auth/challenge` | public | issue signed-message challenge |
| `POST /subscriptions/auth/verify` | public | verify signature → HttpOnly session cookie |
| `POST /subscriptions/auth/logout` | public | destroy session |
| `GET /subscriptions/auth/session` | cookie | current session summary |
| `GET /subscriptions/me` | session | pass status + period + prefs |
| `PATCH /subscriptions/me` | session | delivery email / digest / alert prefs |
| `POST /subscriptions/me/cancel` | session | cancel at period end |
| `POST /subscriptions/me/resume` | session | clear cancel-at-period-end |
| `POST /subscriptions/me/renew` | session | issue new x402 renewal challenge |
| `POST /subscriptions/me/settle` | session | activate renewed period |
| `GET /subscriptions/me/payments` | session | recent payment history (bounded) |

## State model

`none → pending → active → (canceling) → cancelled`; `active → past_due → expired` on billing
sweep. `entitled` is derived from status + period window + grace, never stored.

## Compatibility guarantees

- `x402_newsletter_subscriptions` and `monthly_newsletter` content type unchanged.
- Existing payment records and legacy access receipts stay valid until normal expiry.
- Sponsored watches, machine feeds, desk products keep their own gates.
- Renewals are wallet-authorized and user initiated; no silent automatic wallet charges.
