# Quickstart: ChronicleAI Publication Platform

## Prerequisites

- Node.js current LTS
- pnpm
- Supabase project or local Supabase-compatible development environment
- KeeperHub access for scheduled, event, webhook, and manual workflow testing
- Vercel project configured with `apps/web` as the project root
- Heroku app configured for `apps/api`

## Environment

Create local environment files for the frontend and backend without committing secrets.

Backend environment must include:
- Supabase URL and service credentials required by the API
- Operator auth configuration
- KeeperHub webhook signature secret
- Gemini API key and model for primary alert generation
- OpenAI API key and model for secondary alert generation
- Groq API key and model for tertiary alert generation
- x402 facilitator or settlement configuration
- MPP challenge and settlement configuration
- Treasury wallet or balance source configuration
- Public frontend origin for CORS

Frontend environment must include:
- Public API base URL
- Browser-safe Supabase URL or anonymous key if client-side auth is used

## Install

```powershell
pnpm install
```

## Database Setup

Apply committed Supabase/Postgres migrations for local development.

```powershell
pnpm db:migrate
```

For local-only iteration, schema push commands may be used only against disposable development data. Shared environments must use committed migrations.

## Run Locally

Start the backend API.

```powershell
pnpm --filter @chronicleai/api dev
```

Start the frontend.

```powershell
pnpm --filter @chronicleai/web dev
```

## Validation Scenarios

### Scenario 1: Public alert generation

1. Send a valid KeeperHub event fixture to `POST /keeperhub/events`.
2. Confirm the API returns `202`.
3. Confirm a monitored event record is stored.
4. Confirm a public alert is generated for a qualifying event using Gemini when available.
5. Confirm the alert stores LLM provider metadata and generation attempt history.
6. Open the frontend alerts view and verify the alert shows title, summary, event type, source reference, confidence, provider indicator, and published time.

**Expected outcome**: A qualifying event creates exactly one public alert within the target alert window, records the successful LLM provider, and duplicate fixture replay does not publish a second alert.

### Scenario 1A: Public alert LLM fallback

1. Configure the Gemini test adapter to fail.
2. Send a valid qualifying KeeperHub event fixture to `POST /keeperhub/events`.
3. Confirm ChronicleAI attempts Gemini first, then OpenAI.
4. Configure both Gemini and OpenAI test adapters to fail.
5. Send another valid qualifying KeeperHub event fixture.
6. Confirm ChronicleAI attempts Gemini, OpenAI, and Groq in order.

**Expected outcome**: ChronicleAI uses the first successful provider in the configured fallback order and records each failed and successful provider attempt.

### Scenario 1B: All LLM providers fail

1. Configure Gemini, OpenAI, and Groq test adapters to fail.
2. Send a valid qualifying KeeperHub event fixture to `POST /keeperhub/events`.
3. Review the stored monitored event and execution logs.

**Expected outcome**: ChronicleAI records a retryable generation failure with provider attempt details and does not publish fabricated alert content.

### Scenario 2: Daily digest generation and publication

1. Seed monitored events for a 24-hour reporting period.
2. Trigger `POST /keeperhub/digests/run` with the reporting window.
3. Verify that KeeperHub executes the `publishDigest` registry transaction.
4. Confirm the digest updates the public Webflow site.
5. Confirm premium subscribers receive the daily newsletter via SMTP.
6. Open the latest digest on the frontend `/digests/latest` and verify that the registry transaction hash is displayed.

**Expected outcome**: The digest includes a report date, highlights, references, a clickable registry transaction hash linking to the explorer, and is distributed to Webflow and SMTP email recipients.

### Scenario 3: No-major-events digest

1. Trigger digest generation for an empty reporting period.
2. Open the latest digest route.

**Expected outcome**: ChronicleAI publishes a concise no-major-events digest on-chain, updates Webflow/SMTP email delivery, and displays the registry transaction hash.

### Scenario 4: Premium payment gate (x402 & MPP)

1. Request `GET /premium/items/{id}` without settlement evidence.
2. Confirm the response is `402` with payment challenge details.
3. Settle a subscription challenge via x402 on Base or a machine-billing challenge via MPP on Tempo.
4. Retry the premium item request.

**Expected outcome**: Premium content remains locked until settlement and is returned in under 30 seconds once a settled payment record exists.

### Scenario 4A: Sponsored contract monitoring campaign

1. A protocol pays for a sponsored monitoring campaign through the payment endpoints.
2. Verify that KeeperHub executes the `createSponsoredWatch` transaction on the Chronicle Registry.
3. Replay event logs within the campaign window to trigger monitoring.
4. Trigger the campaign completion workflow and verify that the final report is published on-chain via `publishSponsoredReport`.
5. Verify the dashboard lists the sponsored campaign, showing both registry transaction hashes.

**Expected outcome**: The sponsored campaign is successfully initialized, tracked, published on-chain, and audited on the UI dashboard.

### Scenario 5: Operator sustainability & autonomous payouts

1. Trigger the weekly revenue routing webhook `POST /keeperhub/revenue/route`.
2. Confirm that when Para wallet funds exceed the safety buffer, KeeperHub executes token payout transfers to allowlisted creator recovery wallets and referral partners.
3. Confirm that KeeperHub executes `recordPayout` on the Chronicle Registry contract.
4. Trigger a treasury check when available balance is below the safety buffer and verify the Refunding Loop issues warnings.
5. Sign in as an operator and open `/operator`.

**Expected outcome**: The dashboard shows total revenue, cost estimates, Para wallet balance, low-balance warnings, payout receipts with calculation basis and on-chain tx hashes, and execution logs.

## Required Checks

```powershell
pnpm type-check
pnpm check
pnpm test
```

If `pnpm check` reports fixable issues, run:

```powershell
pnpm fix
```

Then rerun the required checks.

## Deployment Validation

### Frontend on Vercel

- Configure the Vercel project root as `apps/web`.
- Keep server-only secrets out of Vercel frontend environment variables.
- Use preview deployments for validation before production promotion.

### Backend on Heroku

- Configure the Heroku app to run the Express service from `apps/api`.
- Set all backend secrets in Heroku config vars.
- Confirm `/health` returns `200`.
- Confirm KeeperHub webhook endpoints accept signed test payloads and reject unsigned payloads.

## References

- API contract: [contracts/api.openapi.yaml](./contracts/api.openapi.yaml)
- KeeperHub webhook contract: [contracts/keeperhub-webhooks.md](./contracts/keeperhub-webhooks.md)
- Frontend route contract: [contracts/frontend-routes.md](./contracts/frontend-routes.md)
- Data model: [data-model.md](./data-model.md)
