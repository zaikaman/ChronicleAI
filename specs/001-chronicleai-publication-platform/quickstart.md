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
4. Confirm a public alert is generated for a qualifying event.
5. Open the frontend alerts view and verify the alert shows title, summary, event type, source reference, confidence, and published time.

**Expected outcome**: A qualifying event creates exactly one public alert within the target alert window, and duplicate fixture replay does not publish a second alert.

### Scenario 2: Daily digest generation

1. Seed monitored events for a 24-hour reporting period.
2. Trigger `POST /keeperhub/digests/run` with the reporting window.
3. Open the latest digest route.

**Expected outcome**: The digest includes a report date, ranked highlights, source references, and clear separation between observed facts and analysis.

### Scenario 3: No-major-events digest

1. Trigger digest generation for an empty reporting period.
2. Open the latest digest route.

**Expected outcome**: ChronicleAI publishes a concise no-major-events digest instead of failing silently.

### Scenario 4: Premium payment gate

1. Request `GET /premium/items/{id}` without settlement evidence.
2. Confirm the response is `402` with payment challenge details.
3. Complete or simulate a valid x402 or MPP settlement.
4. Retry the premium item request.

**Expected outcome**: Premium content is withheld before settlement and returned only after a settled payment record exists.

### Scenario 5: Operator sustainability view

1. Create sample alerts, digests, payment records, and a treasury snapshot.
2. Sign in as an operator.
3. Open `/operator`.

**Expected outcome**: The dashboard shows recent publications, payment activity, treasury status, estimated costs, execution logs, and warning state when the balance is below the safety buffer.

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
