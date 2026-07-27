# Implementation Plan: ChronicleAI Publication Platform

**Branch**: `master` | **Date**: 2026-07-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-chronicleai-publication-platform/spec.md`

## Summary

ChronicleAI will be built as a TypeScript monorepo with a Vite React frontend deployed to Vercel, a Node.js Express API deployed to Heroku, Supabase as the managed data/auth/storage platform, and KeeperHub workflows as the on-chain monitoring and automation layer. The implementation centers on five decoupled loops: public alerts and daily digests anchored as on-chain proofs-of-publication on the Chronicle Registry smart contract, a weekly refunding/maintenance loop monitoring the Para wallet reserve balance, a sponsored watch loop allowing protocols to pay for dedicated contract monitoring, and an autonomous revenue routing loop that distributes net earnings to the creator recovery wallet and referral affiliates.

## Technical Context

**Language/Version**: TypeScript 5.x across frontend, backend, shared packages, and tests; Node.js current LTS for local development, Heroku runtime, and CI

**Primary Dependencies**: React, Vite, Node.js, Express, Supabase client libraries for application data/auth/storage, shadcn/ui and Radix UI for frontend components, Sonner for toasts, KeeperHub workflows and webhook/API integrations, x402 and MPP payment verification adapters, ethers/viem for Web3/Ethers smart contract interactions, SMTP/Nodemailer for premium daily newsletter broadcasts, Gemini API, OpenAI API, Groq API, and native `fetch` for external HTTP integrations

**Storage**: Supabase Postgres for operational records (including monitored events, alerts, digests, payments, sponsored watch campaigns, payout records, treasury snapshots, and execution logs); Supabase Auth for operator and subscriber identity; smart contract state on Ethereum Sepolia for proofs-of-publication, sponsored watch acceptances, and recorded payouts
 
**Testing**: Vitest for unit and integration tests; contract tests for API payment gating, KeeperHub webhook ingestion, and premium feed responses; local validation via `pnpm type-check` and `pnpm check`/`pnpm fix`; manual verification for user flows
 
**Target Platform**: Vercel-hosted Vite frontend; Heroku-hosted Express backend; Supabase managed services; Chronicle Registry smart contract on Ethereum Sepolia; KeeperHub production or sandbox workflows for scheduled, event, webhook, and manual triggers

**Project Type**: Monorepo web application with separate frontend app, backend API service, shared TypeScript packages, Solidity smart contract package, database migrations, and feature documentation

**Performance Goals**: 95% of qualifying events produce public alerts within 2 minutes of detection, including LLM fallback attempts and registry contract writes when required; paid premium content unlock completes within 30 seconds during normal operation; operators can assess sustainability status in under 1 minute; critical backend request handlers target sub-200ms p95 excluding third-party settlement, blockchain execution, or LLM latency

**Constraints**: Strict typing with no `any`; no unnecessary SDK dependencies for external integrations where native `fetch` is practical; shadcn/ui and Radix UI for reusable frontend primitives; no native browser dialogs; file-based database migrations with monotonic journal timestamps; payment-gated premium content must never leak through public endpoints; LLM provider API keys remain backend-only secrets; alert/digest on-chain registry writes are gated by available Para wallet balance exceeding the safety buffer

**Scale/Scope**: Hackathon-ready first release with configurable thresholds, four monitored event categories, public alert publishing, daily digest generation, paid premium feed access, and operator audit dashboard; designed for hundreds of demo users and automated clients with clear extension points for production scale

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality & Technical Standards**: PASS. Plan uses TypeScript across the monorepo, requires strict typing, and limits external integration SDKs in favor of native `fetch` where practical.
- **Testing Standards & Verification Discipline**: PASS. Plan requires Vitest, contract tests, `pnpm type-check`, and `pnpm check`/`pnpm fix`.
- **User Experience & Theme Consistency**: PASS. Frontend plan uses shadcn/ui, Radix UI, Sonner, and a premium glassmorphic product identity without native dialogs.
- **Performance & On-Chain Reliability**: PASS. Plan carries forward the sub-200ms critical-path target, 2-minute alert outcome with LLM fallback, payment unlock timing, retries, audit logs, and KeeperHub workflow execution boundaries.
- **Database Schema & Migration Integrity**: PASS. Plan requires file-based Supabase/Postgres migrations tracked in the repo and avoids ad hoc schema pushes for shared environments.
- **Development and Branching Strategy**: PASS. Work remains on `master` as required by the constitution.

## Project Structure

### Documentation (this feature)

```text
specs/001-chronicleai-publication-platform/
|-- plan.md
|-- research.md
|-- data-model.md
|-- quickstart.md
|-- contracts/
|   |-- api.openapi.yaml
|   |-- keeperhub-webhooks.md
|   `-- frontend-routes.md
`-- tasks.md
```

### Source Code (repository root)

```text
apps/
|-- web/
|   |-- src/
|   |   |-- app/
|   |   |-- components/
|   |   |-- features/
|   |   |-- lib/
|   |   `-- test/
|   |-- public/
|   |-- index.html
|   |-- vite.config.ts
|   `-- vercel.json
`-- api/
    |-- src/
    |   |-- routes/
    |   |-- services/
    |   |-- repositories/
    |   |-- payments/
    |   |-- keeperhub/
    |   |-- jobs/
    |   `-- test/
    |-- Procfile
    `-- package.json

packages/
|-- config/
|-- db/
|-- schemas/
|-- testing/
`-- ui/

supabase/
|-- migrations/
`-- seed/

tests/
`-- contracts/
```

**Structure Decision**: Use a pnpm workspace monorepo. `apps/web` owns the Vite React interface and Vercel deployment settings. `apps/api` owns the Express API and Heroku deployment entrypoint. `packages/schemas` contains shared request/response and domain validation types, `packages/db` contains Supabase/Postgres migration and query boundaries, `packages/ui` contains shared shadcn/ui-compatible presentation primitives, and `tests` contains contract coverage.

## Complexity Tracking

No constitution violations require justification.

## Post-Design Constitution Check

- **Code Quality & Technical Standards**: PASS. Design artifacts preserve strict TypeScript boundaries and keep third-party HTTP integrations behind service adapters.
- **Testing Standards & Verification Discipline**: PASS. Quickstart and contracts require unit, integration, and contract verification.
- **User Experience & Theme Consistency**: PASS. Frontend routes and quickstart require shadcn/ui/Radix controls, glassmorphic styling tokens, semantic toasts/dialogs, and stable selectors.
- **Performance & On-Chain Reliability**: PASS. API contracts and quickstart include alert latency, payment gating, retry visibility, and sustainability checks.
- **Database Schema & Migration Integrity**: PASS. Data model maps to Supabase Postgres with committed migrations and lifecycle states suitable for auditable transitions.
