# Research: ChronicleAI Publication Platform

## Decision: Use a pnpm TypeScript monorepo

**Rationale**: The frontend, backend, shared schemas, database migrations, and tests need one consistent type system and package manager. pnpm aligns with project instructions and supports workspace isolation without duplicating shared domain types.

**Alternatives considered**: Separate repositories were rejected because shared API contracts and payment-gating types would drift during a hackathon build. A single app folder was rejected because Vercel and Heroku deploy different runtime surfaces.

## Decision: Deploy the Vite React frontend from `apps/web` to Vercel

**Rationale**: Vercel provides preview deployments and production hosting for the public publication site and operator dashboard. In a monorepo, the Vercel project should be configured with `apps/web` as the root directory and should receive only browser-safe environment variables.

**Alternatives considered**: Hosting the frontend on Heroku was rejected because static frontend delivery and preview deployments are better separated from the backend process. Next.js was rejected for this feature because the user specified React and Vite.

## Decision: Deploy the Node.js Express backend from `apps/api` to Heroku

**Rationale**: Express provides a clear API boundary for KeeperHub webhooks, premium feed access, payment challenges, payment settlement callbacks, operator metrics, and background job endpoints. Heroku is suitable for a long-running web process with a single backend service and optional scheduled jobs.

**Alternatives considered**: Vercel serverless functions were rejected for the backend because the feature benefits from a dedicated API process and Heroku deployment was explicitly requested. A monolithic frontend/backend app was rejected because it would blur deployment and secret boundaries.

## Decision: Use Supabase for application data, identity, and optional assets

**Rationale**: Supabase Postgres fits auditable operational records such as monitored events, alerts, digests, payment records, treasury status, and execution logs. Supabase Auth can cover operator and subscriber identity, while Storage can hold generated report assets if the frontend needs durable media links.

**Alternatives considered**: Heroku Postgres was rejected because the user requested Supabase API and Supabase also provides auth/storage primitives. Direct KeeperHub storage was rejected because ChronicleAI needs its own product data model and premium access audit records.

## Decision: Treat KeeperHub as the automation and on-chain event execution layer

**Rationale**: KeeperHub provides scheduled, event, webhook, and manual triggers plus web3 and notification actions. ChronicleAI should use KeeperHub workflows to detect or relay relevant blockchain events and call the backend through authenticated webhooks for content generation, persistence, and paid feed availability.

**Alternatives considered**: Building custom block dispatchers and event indexers in the ChronicleAI backend was rejected for the first release because KeeperHub already supplies those automation surfaces. Manual-only ingestion was rejected because the product promise depends on autonomous monitoring.

## Decision: Use payment adapters for x402 and MPP behind a single premium access contract

**Rationale**: Premium consumers should see one paid access flow even though settlement can happen through different payment rails. A shared payment adapter contract lets the API issue challenges, verify settlement, and record revenue consistently for both human and machine clients.

**Alternatives considered**: Supporting only x402 was rejected because MPP machine-to-machine billing is part of the feature. Exposing payment-rail-specific premium endpoints was rejected because it would duplicate content authorization behavior.

## Decision: Store generated content with source references and confidence metadata

**Rationale**: The spec requires readers to distinguish verified event data from synthesized commentary. Storing citations, source event IDs, confidence labels, and audience classification supports public trust and prevents premium-only content from leaking into public summaries.

**Alternatives considered**: Storing only rendered markdown was rejected because it would make audits and source traceability difficult. Storing only raw event data was rejected because the publication product depends on durable generated outputs.

## Decision: Use file-based Supabase/Postgres migrations

**Rationale**: The constitution requires file-based migrations with monotonic timestamps. Supabase migrations can be committed and reviewed alongside schema and data-model changes.

**Alternatives considered**: Ad hoc dashboard edits and local-only schema pushes were rejected because they are not auditable and do not satisfy release gates.

## Decision: Validate with unit, integration, and contract tests, and manual verification for user flows

**Rationale**: Alert generation, payment gating, publication states, and operator audit views have meaningful domain and API failure modes. Vitest should cover domain logic and API integration boundaries, and contract tests should verify external interface behavior. Frontend flows can be verified manually.

**Alternatives considered**: Automated E2E testing (Playwright) was rejected because it introduces excessive setup overhead for a hackathon project; manual verification is sufficient for verifying the user interface.
