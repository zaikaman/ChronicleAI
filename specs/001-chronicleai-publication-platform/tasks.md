# Tasks: ChronicleAI Publication Platform

**Input**: Design documents from `specs/001-chronicleai-publication-platform/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Required by the project constitution and quickstart. Unit, integration, and contract tasks are included and should be written before the corresponding implementation.

**Organization**: Tasks are grouped by user story so each story can be independently implemented, tested, and demonstrated.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and does not depend on an incomplete task in the same phase
- **[Story]**: User story label for story-phase tasks only
- Every task includes an exact target file path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize the pnpm TypeScript monorepo, app shells, shared packages, and local tooling required by all stories.

- [X] T001 Create pnpm workspace manifest with `apps/*` and `packages/*` entries in `pnpm-workspace.yaml`
- [X] T002 Create root package scripts for `dev`, `build`, `type-check`, `check`, `fix`, `test`, `db:migrate`, and `db:seed` in `./package.json`
- [X] T003 Create root TypeScript base configuration with strict mode and no implicit any in `./tsconfig.base.json`
- [X] T004 Create frontend TypeScript configuration extending the base config in `apps/web/tsconfig.json`
- [X] T005 Create backend TypeScript configuration extending the base config in `apps/api/tsconfig.json`
- [X] T006 [P] Create shared schemas package manifest in `packages/schemas/package.json`
- [X] T007 [P] Create shared database package manifest in `packages/db/package.json`
- [X] T008 [P] Create shared config package manifest in `packages/config/package.json`
- [X] T009 [P] Create shared testing package manifest in `packages/testing/package.json`
- [X] T010 [P] Create shared UI package manifest in `packages/ui/package.json`
- [X] T011 Initialize Vite React application entry files in `apps/web/index.html`, `apps/web/src/main.tsx`, and `apps/web/src/app/App.tsx`
- [X] T012 Initialize Express API application entry files in `apps/api/src/server.ts` and `apps/api/src/app.ts`
- [X] T013 Create Heroku process declaration for the backend API in `apps/api/Procfile`
- [X] T014 Create Vercel frontend project configuration with SPA fallback in `apps/web/vercel.json`
- [X] T015 Configure Vitest workspace coverage for app and package tests in `./vitest.config.ts`
- [X] T017 Configure linting and formatting commands for the monorepo in `./biome.jsonc`
- [X] T018 Create root environment example documenting all backend and frontend variables in `./.env.example`
- [X] T019 Create frontend environment example for browser-safe variables in `apps/web/.env.example`
- [X] T020 Create backend environment example for server-only variables in `apps/api/.env.example`
- [X] T021 Create Git ignore rules for local env files, build outputs, and Supabase temp files in `./.gitignore`
- [X] T022 Create shared path aliases for packages in `./tsconfig.base.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build core types, configuration, persistence, API infrastructure, and UI shell that all user stories depend on.

**Critical**: No user story implementation should begin until this phase is complete.

- [X] T023 Define domain enums and branded ID helpers for events, alerts, digests, payments, treasury snapshots, and logs in `packages/schemas/src/domain.ts`
- [X] T024 Define API request and response schemas matching the OpenAPI contract in `packages/schemas/src/api.ts`
- [X] T025 Define KeeperHub webhook payload schemas in `packages/schemas/src/keeperhub.ts`
- [X] T026 Define frontend route and view model schemas in `packages/schemas/src/frontend.ts`
- [X] T027 Export package schemas without barrel indirection conflicts in `packages/schemas/src/index.ts`
- [X] T028 Create typed environment loader for backend server-only variables in `packages/config/src/server-env.ts`
- [X] T029 Create typed environment loader for frontend browser-safe variables in `packages/config/src/client-env.ts`
- [X] T030 Create shared constants for event thresholds, dedupe windows, payment defaults, and dashboard limits in `packages/config/src/defaults.ts`
- [X] T031 Create Supabase server client factory with typed configuration in `packages/db/src/supabase-server.ts`
- [X] T032 Create Supabase browser client factory for authenticated frontend flows in `packages/db/src/supabase-browser.ts`
- [X] T033 Create first Supabase migration for `monitored_events`, `public_alerts`, `daily_digests`, `premium_intelligence_items`, `payment_records`, `treasury_snapshots`, and `execution_logs` in `supabase/migrations/202607060001_create_chronicleai_core.sql`
- [X] T034 Create Supabase migration for indexes, dedupe uniqueness, reporting window uniqueness, and payment lookup constraints in `supabase/migrations/202607060002_add_chronicleai_indexes.sql`
- [X] T035 Create Supabase seed data for demo alerts, digests, premium items, payments, treasury snapshots, and logs in `supabase/seed/chronicleai_demo.sql`
- [X] T036 Create TypeScript database row and insert types for all core tables in `packages/db/src/types.ts`
- [X] T037 Create shared repository error types and result helpers in `packages/db/src/errors.ts`
- [X] T038 Create base repository utilities for Supabase select, insert, update, pagination, and single-row handling in `packages/db/src/repository-utils.ts`
- [X] T039 Create Express middleware for JSON parsing, request IDs, CORS, timing headers, and secure error responses in `apps/api/src/middleware/core.ts`
- [X] T040 Create Express middleware for KeeperHub webhook signature verification in `apps/api/src/middleware/keeperhub-signature.ts`
- [X] T041 Create Express middleware for operator bearer authentication in `apps/api/src/middleware/operator-auth.ts`
- [X] T042 Create centralized API error classes and response mapping in `apps/api/src/errors.ts`
- [X] T043 Create structured execution logger service that writes to `execution_logs` in `apps/api/src/services/execution-log-service.ts`
- [X] T044 Create health route and route registration shell in `apps/api/src/routes/health-routes.ts` and `apps/api/src/routes/index.ts`
- [X] T045 Create frontend API client with typed fetch wrapper and error mapping in `apps/web/src/lib/api-client.ts`
- [X] T046 Create frontend app router with routes `/`, `/alerts`, `/digests/latest`, `/premium`, and `/operator` in `apps/web/src/app/router.tsx`
- [X] T047 Create app-level layout, navigation, responsive shell, and Sonner provider in `apps/web/src/app/App.tsx`
- [X] T048 Create shared glassmorphic design tokens and base styles in `apps/web/src/app/styles.css`
- [X] T049 Create accessible loading, empty, error, and retry state components in `apps/web/src/components/state-views.tsx`
- [X] T050 Create reusable metric, status badge, source reference, and timestamp components in `apps/web/src/components/data-primitives.tsx`
- [X] T051 Create test server bootstrap helpers for API integration tests in `packages/testing/src/api-test-server.ts`
- [X] T052 Create Supabase test fixture helpers for seed, cleanup, and deterministic timestamps in `packages/testing/src/db-fixtures.ts`
- [X] T054 Create contract test utilities for validating JSON responses against shared schemas in `tests/contracts/schema-assertions.ts`
- [X] T055 Verify the empty scaffold builds and type-checks by wiring package exports in `./package.json`

**Checkpoint**: Foundation ready. User stories can now be implemented in priority order or by parallel teams.

---

## Phase 3: User Story 1 - Receive Timely Public Market Alerts (Priority: P1) MVP

**Goal**: Public readers receive deduplicated, sourced, plain-language alerts when KeeperHub sends significant on-chain events.

**Independent Test**: Submit a signed qualifying KeeperHub event, confirm the API accepts it, records it, generates one public alert with source references, rejects duplicate replay, and shows the alert on `/alerts`.

### Tests for User Story 1

- [X] T056 [P] [US1] Write contract tests for `POST /keeperhub/events` success, invalid payload, invalid signature, and duplicate replay in `tests/contracts/keeperhub-events.contract.test.ts`
- [X] T057 [P] [US1] Write contract tests for `GET /alerts` pagination and public alert response shape in `tests/contracts/alerts.contract.test.ts`
- [X] T058 [P] [US1] Write unit tests for event qualification thresholds and ignored-event behavior in `apps/api/src/test/event-qualification-service.test.ts`
- [X] T059 [P] [US1] Write unit tests for alert dedupe key generation and duplicate-window matching in `apps/api/src/test/alert-dedupe-service.test.ts`
- [X] T060 [P] [US1] Write unit tests for LLM-generated public alert content safety to prevent premium-only analysis leakage in `apps/api/src/test/public-alert-content-service.test.ts`
- [X] T061 [P] [US1] Write integration tests for event ingestion, event persistence, alert generation, execution logs, and duplicate replay in `apps/api/src/test/keeperhub-events.integration.test.ts`
- [X] T062 [P] [US1] Write unit tests for Gemini -> OpenAI -> Groq alert-generation fallback, provider attempt logging, and all-providers-failed behavior in `apps/api/src/test/llm-alert-generation-service.test.ts`

### Implementation for User Story 1

- [X] T063 [P] [US1] Implement monitored event repository create, find-by-source, qualify update, and list methods in `packages/db/src/monitored-event-repository.ts`
- [X] T064 [P] [US1] Implement public alert repository create, find-by-dedupe-key, list, and delivery status methods in `packages/db/src/public-alert-repository.ts`
- [X] T065 [P] [US1] Implement execution log repository append and list-by-entity methods in `packages/db/src/execution-log-repository.ts`
- [X] T066 [P] [US1] Add Gemini, OpenAI, and Groq server environment variables, fallback order defaults, `llm_generation_attempts` migration, and related database types in `packages/config/src/server-env.ts`, `packages/config/src/defaults.ts`, `supabase/migrations/202607060003_add_llm_generation_attempts.sql`, and `packages/db/src/types.ts`
- [X] T067 [US1] Implement event qualification service for supported event types and configurable thresholds in `apps/api/src/services/event-qualification-service.ts`
- [X] T068 [US1] Implement alert deduplication service using source event identifiers and dedupe keys in `apps/api/src/services/alert-dedupe-service.ts`
- [X] T069 [US1] Implement LLM-backed public alert content generator with Gemini -> OpenAI -> Groq fallback, source references, event magnitude, confidence, provider metadata, and no premium-only content in `apps/api/src/services/public-alert-content-service.ts`
- [X] T070 [US1] Implement alert publication service with destination result tracking and partial failure states in `apps/api/src/services/alert-publication-service.ts`
- [X] T071 [US1] Implement KeeperHub event ingestion orchestrator that records raw payloads before generation in `apps/api/src/keeperhub/event-ingestion-handler.ts`
- [X] T072 [US1] Implement `POST /keeperhub/events` route with signature middleware and idempotent responses in `apps/api/src/routes/keeperhub-event-routes.ts`
- [X] T073 [US1] Implement `GET /alerts` route with limit validation and newest-first ordering in `apps/api/src/routes/alert-routes.ts`
- [X] T074 [US1] Register KeeperHub event and alert routes in `apps/api/src/routes/index.ts`
- [X] T075 [P] [US1] Create qualifying, ignored, malformed, unsigned, duplicate, Gemini-failure, OpenAI-failure, Groq-failure, and all-providers-failed KeeperHub event fixtures in `apps/api/src/test/fixtures/keeperhub-events.ts`
- [X] T076 [P] [US1] Create frontend alert query hook with loading, retry, and schema validation in `apps/web/src/features/alerts/use-alerts.ts`
- [X] T077 [P] [US1] Create public alert card component with event type, magnitude, confidence, generation provider, source references, and timestamp in `apps/web/src/features/alerts/AlertCard.tsx`
- [X] T078 [P] [US1] Create alert filter controls for event type and chain with stable test IDs in `apps/web/src/features/alerts/AlertFilters.tsx`
- [X] T079 [US1] Create `/alerts` page with empty, error, loading, filtered, and populated states in `apps/web/src/features/alerts/AlertsPage.tsx`
- [X] T080 [US1] Add latest alerts preview to the home page in `apps/web/src/features/home/HomePage.tsx`
- [X] T081 [US1] Add public alert route wiring to the app router in `apps/web/src/app/router.tsx`
- [X] T082 [US1] Add execution logs for event received, event ignored, Gemini attempt failed, OpenAI attempt failed, Groq attempt failed, alert generated, alert generation failed, alert published, duplicate skipped, and publication failed in `apps/api/src/keeperhub/event-ingestion-handler.ts`
- [X] T083 [US1] Add API documentation comments for `POST /keeperhub/events` and `GET /alerts` in `apps/api/src/routes/keeperhub-event-routes.ts` and `apps/api/src/routes/alert-routes.ts`
- [X] T084 [US1] Run US1 contract, integration, and unit tests and fix failures in `tests/contracts/keeperhub-events.contract.test.ts`, `tests/contracts/alerts.contract.test.ts`, `apps/api/src/test/keeperhub-events.integration.test.ts`, and `apps/api/src/test/llm-alert-generation-service.test.ts`

**Checkpoint**: User Story 1 is a complete MVP and can be demonstrated independently.

---

### Phase 4: User Story 2 - Read Daily Intelligence Digest (Priority: P2)

**Goal**: Readers and operators can view a scheduled daily digest that summarizes the reporting period (including no-major-events periods), anchored on-chain with a verifiable proof-of-publication.

**Independent Test**: Seed a 24-hour reporting period, trigger digest generation, verify one digest exists with highlights, Merkle root, and source references, calls the registry contract, updates Webflow, sends email bulletins via SMTP, and displays the registry transaction hash on the frontend.

### Tests for User Story 2

- [x] T085 [P] [US2] Write contract tests for `POST /keeperhub/digests/run` valid, invalid, duplicate, and unsigned requests in `tests/contracts/digest-run.contract.test.ts`
- [x] T086 [P] [US2] Write contract tests for `GET /digests/latest` success and not-found responses in `tests/contracts/latest-digest.contract.test.ts`
- [x] T087 [P] [US2] Write unit tests for reporting window validation and duplicate window detection in `apps/api/src/test/digest-window-service.test.ts`
- [x] T088 [P] [US2] Write unit tests for digest generation with ranked highlights, no-major-events output, source references, and fact-versus-analysis separation in `apps/api/src/test/digest-generation-service.test.ts`
- [x] T089 [P] [US2] Write integration tests for scheduled digest trigger, persistence, publication status, Web3 publish transaction, Webflow update, SMTP email dispatch, and execution logs in `apps/api/src/test/digest-run.integration.test.ts`
- [x] T090a [P] [US2] Write unit tests for Chronicle Registry publishDigest contract call in `apps/api/src/test/registry-digest-service.test.ts`
- [x] T090b [P] [US2] Write unit tests for Webflow collection publishing in `apps/api/src/test/webflow-publishing-service.test.ts`
- [x] T090c [P] [US2] Write unit tests for SMTP email subscriber delivery in `apps/api/src/test/smtp-email-service.test.ts`

### Implementation for User Story 2

- [x] T090d [US2] Create Chronicle Registry Solidity contract defining `publishAlert`, `publishDigest`, `createSponsoredWatch`, `publishSponsoredReport`, and `recordPayout` in `packages/contracts/contracts/ChronicleRegistry.sol`
- [x] T090e [US2] Create compilation and deployment scripts for the Chronicle Registry contract in `packages/contracts/scripts/deploy.ts`
- [x] T090f [US2] Create Supabase migration to add `registry_tx_hash`, `source_event_hash`, `source_event_root`, and `content_uri` columns to core tables in `supabase/migrations/202607270001_add_registry_fields.sql`
- [x] T091 [P] [US2] Implement daily digest repository create, find-by-window, latest-public, and publication status methods with new columns in `packages/db/src/daily-digest-repository.ts`
- [x] T091a [US2] Implement Web3/Ethers helper for contract connection and transaction execution in `apps/api/src/services/web3-client-service.ts`
- [x] T091b [US2] Implement Chronicle Registry publish service that writes alert and digest metadata on-chain in `apps/api/src/services/chronicle-registry-service.ts`
- [x] T091c [US2] Implement Webflow collection update plugin in `apps/api/src/services/webflow-publishing-service.ts`
- [x] T091d [US2] Implement SMTP email subscription dispatch plugin in `apps/api/src/services/smtp-email-service.ts`
- [x] T092 [US2] Implement reporting window validation and idempotency service in `apps/api/src/services/digest-window-service.ts`
- [x] T093 [US2] Implement digest event selection service for top monitored events in a reporting period in `apps/api/src/services/digest-event-selection-service.ts`
- [x] T094 [US2] Implement digest generation service for highlights, no-major-events reports, source references, and analysis separation in `apps/api/src/services/digest-generation-service.ts`
- [x] T095 [US2] Implement digest publication service sequencing: 1. Chronicle Registry `publishDigest`, 2. Webflow publish, 3. SMTP email broadcast, and record results/execution logs in `apps/api/src/services/digest-publication-service.ts`
- [x] T096 [US2] Implement KeeperHub digest trigger handler with signed request validation and duplicate-window handling in `apps/api/src/keeperhub/digest-run-handler.ts`
- [x] T097 [US2] Implement `POST /keeperhub/digests/run` route in `apps/api/src/routes/keeperhub-digest-routes.ts`
- [x] T098 [US2] Implement `GET /digests/latest` route in `apps/api/src/routes/digest-routes.ts`
- [x] T099 [US2] Register digest routes in `apps/api/src/routes/index.ts`
- [x] T100 [P] [US2] Create digest fixtures for populated reporting windows, empty windows, invalid windows, and duplicates in `apps/api/src/test/fixtures/digests.ts`
- [x] T101 [P] [US2] Create frontend latest digest query hook with 404, loading, error, and retry handling in `apps/web/src/features/digests/use-latest-digest.ts`
- [x] T102 [P] [US2] Create digest highlight list and source reference components with registry transaction links in `apps/web/src/features/digests/DigestHighlights.tsx`
- [x] T103 [P] [US2] Create fact-versus-analysis digest section component in `apps/web/src/features/digests/DigestAnalysisSections.tsx`
- [x] T104 [US2] Create `/digests/latest` page displaying the clickable registry transaction hash linking to the explorer in `apps/web/src/features/digests/LatestDigestPage.tsx`
- [x] T105 [US2] Add latest digest preview to the home page in `apps/web/src/features/home/HomePage.tsx`
- [x] T106 [US2] Add digest route wiring to the app router in `apps/web/src/app/router.tsx`
- [x] T107 [US2] Add execution logs for digest trigger received, digest generated, no-events digest generated, duplicate skipped, publication failed, and publication completed in `apps/api/src/keeperhub/digest-run-handler.ts`
- [x] T108 [US2] Run US2 contract, integration, and unit tests and fix failures in `tests/contracts/digest-run.contract.test.ts`, `tests/contracts/latest-digest.contract.test.ts`, and `apps/api/src/test/digest-run.integration.test.ts`

**Checkpoint**: User Story 2 is independently functional, publishes digests to Chronicle Registry on-chain, Webflow, and SMTP.

---

## Phase 5: User Story 3 - Purchase Premium Intelligence Access & Sponsor Contracts (Priority: P3)

**Goal**: Human users and automated clients can purchase premium access via x402 (Base) or MPP (Tempo) and sponsor monitoring campaigns (Loop 4) on target contracts, executing on-chain registry transactions.

**Independent Test**: Request premium content without payment, receive a `402` challenge, complete a subscription (x402) or pay-per-call (MPP) challenge, retry to receive content; pay for a sponsored monitoring task, verifying that KeeperHub executes `createSponsoredWatch` and `publishSponsoredReport` on-chain.

### Tests for User Story 3

- [X] T109 [P] [US3] Write contract tests for `GET /premium/items` teaser list response shape in `tests/contracts/premium-items.contract.test.ts`
- [X] T110 [P] [US3] Write contract tests for `GET /premium/items/{id}` payment required, settled, expired, forbidden, and not-found responses in `tests/contracts/premium-item-access.contract.test.ts`
- [X] T111 [P] [US3] Write contract tests for `POST /payments/challenges` for x402, MPP, unsupported route, and missing premium item in `tests/contracts/payment-challenges.contract.test.ts`
- [X] T112 [P] [US3] Write contract tests for `POST /payments/settlements` settled, underpaid, expired, failed, and malformed settlement paths in `tests/contracts/payment-settlements.contract.test.ts`
- [X] T113 [P] [US3] Write unit tests for x402 challenge creation, referral attributes, and settlement verification adapter behavior in `apps/api/src/test/x402-payment-adapter.test.ts`
- [X] T114 [P] [US3] Write unit tests for MPP challenge creation and settlement verification adapter behavior in `apps/api/src/test/mpp-payment-adapter.test.ts`
- [X] T115 [P] [US3] Write unit tests proving premium private content never appears in teaser or public alert responses in `apps/api/src/test/premium-content-visibility.test.ts`
- [X] T116 [P] [US3] Write integration tests for complete premium purchase flow and revenue recording in `apps/api/src/test/premium-access.integration.test.ts`
- [X] T116a [P] [US3] Write unit tests for Sponsored Watch campaign lifecycle, contract event monitoring, and registry `createSponsoredWatch`/`publishSponsoredReport` execution in `apps/api/src/test/sponsored-watch-service.test.ts`
- [X] T116b [P] [US3] Write contract tests for `POST /payments/settlements` triggering sponsored watch creation in `tests/contracts/sponsored-watch.contract.test.ts`

### Implementation for User Story 3

- [X] T117a [US3] Create Supabase migration for the `sponsored_watches` table (tracking target contract, campaign window, registry tx hashes, status) in `supabase/migrations/202607270002_create_sponsored_watches.sql`
- [X] T118 [P] [US3] Implement premium intelligence repository list-teasers, find-available, find-private-content, and create methods in `packages/db/src/premium-intelligence-repository.ts`
- [X] T118a [P] [US3] Implement sponsored watch repository create, update status, associate tx hashes, and list in `packages/db/src/sponsored-watch-repository.ts`
- [X] T119 [P] [US3] Implement payment record repository create-challenge, find-by-challenge, mark-settled, mark-underpaid, mark-expired, and list methods in `packages/db/src/payment-record-repository.ts`
- [X] T120 [US3] Implement premium content visibility service that strips private content from public responses in `apps/api/src/services/premium-content-visibility-service.ts`
- [X] T121 [US3] Implement payment route abstraction shared by x402 and MPP adapters in `apps/api/src/payments/payment-adapter.ts`
- [X] T122 [US3] Implement x402 payment adapter handling affiliate referral wallet attributes in `apps/api/src/payments/x402-payment-adapter.ts`
- [X] T123 [US3] Implement MPP payment adapter using HMAC challenge verification and deterministic local test mode in `apps/api/src/payments/mpp-payment-adapter.ts`
- [X] T124 [US3] Implement payment challenge service for route validation, pricing, challenge expiry, and record creation in `apps/api/src/services/payment-challenge-service.ts`
- [X] T125 [US3] Implement payment settlement service executing route-specific verification, underpayment detection, settlement recording, and triggering sponsored watches when applicable in `apps/api/src/services/payment-settlement-service.ts`
- [X] T125a [US3] Implement sponsored watch service executing `createSponsoredWatch` transaction on-chain via KeeperHub, running contract monitoring during the campaign window, and calling `publishSponsoredReport` on completion in `apps/api/src/services/sponsored-watch-service.ts`
- [X] T126 [US3] Implement premium access service that returns `402` challenges unless a settled payment record unlocks content in `apps/api/src/services/premium-access-service.ts`
- [X] T127 [US3] Implement `GET /premium/items` and `GET /premium/items/:id` routes in `apps/api/src/routes/premium-routes.ts`
- [X] T128 [US3] Implement `POST /payments/challenges` and `POST /payments/settlements` routes in `apps/api/src/routes/payment-routes.ts`
- [X] T129 [US3] Register premium and payment routes in `apps/api/src/routes/index.ts`
- [X] T130 [P] [US3] Create premium item and payment fixtures for x402, MPP, underpaid, expired, and failed cases in `apps/api/src/test/fixtures/payments.ts`
- [X] T131 [P] [US3] Create frontend premium teaser query hook and item access mutation hook in `apps/web/src/features/premium/use-premium.ts`
- [X] T132 [P] [US3] Create premium teaser card with price, route badges, and source summary in `apps/web/src/features/premium/PremiumTeaserCard.tsx`
- [X] T133 [P] [US3] Create payment challenge panel for x402 and MPP route selection and settlement feedback in `apps/web/src/features/premium/PaymentChallengePanel.tsx`
- [X] T134 [P] [US3] Create premium unlocked content view that renders only after settled access in `apps/web/src/features/premium/PremiumContentView.tsx`
- [X] T134a [P] [US3] Create frontend sponsored watch status and transaction hash list component in `apps/web/src/features/premium/SponsoredWatchList.tsx`
- [X] T135 [US3] Create `/premium` page displaying active sponsored campaigns and transaction hash metrics in `apps/web/src/features/premium/PremiumPage.tsx`
- [X] T136 [US3] Add premium teaser preview and call-to-action to the home page in `apps/web/src/features/home/HomePage.tsx`
- [X] T137 [US3] Add premium route wiring to the app router in `apps/web/src/app/router.tsx`
- [X] T138 [US3] Add execution logs for challenge issued, settlement pending, settlement succeeded, underpayment, expiry, failure, and premium content unlocked in `apps/api/src/services/payment-settlement-service.ts`
- [X] T139 [US3] Run US3 contract, integration, and unit tests and fix failures in `tests/contracts/premium-item-access.contract.test.ts`, `tests/contracts/payment-challenges.contract.test.ts`, and `apps/api/src/test/premium-access.integration.test.ts`

**Checkpoint**: User Story 3 gates premium items, accepts x402/MPP payments, attributes referrals, and executes on-chain sponsored watch campaigns.

---

## Phase 6: User Story 4 - Monitor Agent Sustainability & Revenue Payouts (Priority: P4)

**Goal**: Operators can inspect ChronicleAI operating health, treasury status, Refunding Loop low-balance warning logs (Loop 3), and view details of the weekly autonomous Revenue Routing payouts (Loop 5).

**Independent Test**: Seed payments, trigger treasury checks and revenue routing webhooks, verify batched token transfers are executed from the Para wallet, verify registry `recordPayout` runs, and confirm `/operator` displays payout history.

### Tests for User Story 4

- [ ] T140 [P] [US4] Write contract tests for `POST /keeperhub/treasury/check` valid, invalid, and unsigned requests in `tests/contracts/treasury-check.contract.test.ts`
- [ ] T140a [P] [US4] Write contract tests for `POST /keeperhub/revenue/route` valid, invalid, and unsigned requests in `tests/contracts/revenue-route.contract.test.ts`
- [ ] T141 [P] [US4] Write contract tests for `GET /operator/audit` authenticated, unauthenticated, and response-shape cases in `tests/contracts/operator-audit.contract.test.ts`
- [ ] T142 [P] [US4] Write unit tests for treasury status calculation, safety-buffer warning transitions, and Para wallet balance checking (Loop 3) in `apps/api/src/test/treasury-status-service.test.ts`
- [ ] T142a [P] [US4] Write unit tests for autonomous revenue routing, creator recovery calculations, referral reward capping, batched transfers, and registry payout logging (Loop 5) in `apps/api/src/test/revenue-routing-service.test.ts`
- [ ] T143 [P] [US4] Write unit tests for operator audit aggregation across alerts, digests, payments, treasury snapshots, active sponsored campaigns, payout records, and logs in `apps/api/src/test/operator-audit-service.test.ts`
- [ ] T144 [P] [US4] Write integration tests for treasury check webhook, warning log creation, operator audit data, and revenue routing in `apps/api/src/test/operator-audit.integration.test.ts`

### Implementation for User Story 4

- [ ] T145a [US4] Create Supabase migration for the `payout_records` table (tracking payout period, recipient address, amount, reason hash, transfer tx hash, registry tx hash, status) in `supabase/migrations/202607270003_create_payout_records.sql`
- [ ] T146 [P] [US4] Implement treasury snapshot repository create, latest, status history, and aggregate methods in `packages/db/src/treasury-snapshot-repository.ts`
- [ ] T146a [P] [US4] Implement payout record repository create, find-by-period, and list methods in `packages/db/src/payout-record-repository.ts`
- [ ] T147 [P] [US4] Implement operator audit repository queries for recent alerts, digests, payments, treasury snapshots, active sponsored campaigns, payout records, and logs in `packages/db/src/operator-audit-repository.ts`
- [ ] T148 [US4] Implement treasury status service for healthy, warning, and critical transitions based on Para wallet balance in `apps/api/src/services/treasury-status-service.ts`
- [ ] T148a [US4] Implement revenue routing service performing revenue aggregation, subtracting reserve buffers, triggering batched payout transfers via Para MPC wallet, and calling `recordPayout` on the registry in `apps/api/src/services/revenue-routing-service.ts`
- [ ] T149 [US4] Implement operator notification service for low-balance warnings using configurable notification destinations in `apps/api/src/services/operator-notification-service.ts`
- [ ] T150 [US4] Implement KeeperHub treasury check handler that records snapshots and creates warning logs in `apps/api/src/keeperhub/treasury-check-handler.ts`
- [ ] T150a [US4] Implement KeeperHub revenue routing handler with signed request validation, idempotency checks, and execution logging in `apps/api/src/keeperhub/revenue-routing-handler.ts`
- [ ] T151 [US4] Implement operator audit service that aggregates dashboard data under one typed response in `apps/api/src/services/operator-audit-service.ts`
- [ ] T152 [US4] Implement `POST /keeperhub/treasury/check` route in `apps/api/src/routes/keeperhub-treasury-routes.ts`
- [ ] T152a [US4] Implement `POST /keeperhub/revenue/route` route in `apps/api/src/routes/keeperhub-revenue-routes.ts`
- [ ] T153 [US4] Implement `GET /operator/audit` route with bearer auth in `apps/api/src/routes/operator-routes.ts`
- [ ] T154 [US4] Register treasury, revenue routing, and operator routes in `apps/api/src/routes/index.ts`
- [ ] T155 [P] [US4] Create treasury, audit, payout, sponsored watch, and operator auth fixtures in `apps/api/src/test/fixtures/operator-audit.ts`
- [ ] T156 [P] [US4] Create frontend operator audit query hook with authenticated error handling in `apps/web/src/features/operator/use-operator-audit.ts`
- [ ] T157 [P] [US4] Create treasury status panel with healthy, warning, and critical visual states in `apps/web/src/features/operator/TreasuryStatusPanel.tsx`
- [ ] T158 [P] [US4] Create operator metric grid for revenue, costs, paid requests, alert count, and digest count in `apps/web/src/features/operator/OperatorMetricGrid.tsx`
- [ ] T159 [P] [US4] Create execution log table with action type, status, entity reference, timestamp, and retry visibility in `apps/web/src/features/operator/ExecutionLogTable.tsx`
- [ ] T160 [P] [US4] Create recent publications and payment activity panels in `apps/web/src/features/operator/RecentActivityPanels.tsx`
- [ ] T160a [P] [US4] Create frontend payout logs table showing payout period, recipient, amount, reason, and transaction hashes in `apps/web/src/features/operator/PayoutLogsTable.tsx`
- [ ] T161 [US4] Create `/operator` page with route guard, loading, error, populated, warning, sponsored watches list, and payout history tables in `apps/web/src/features/operator/OperatorDashboardPage.tsx`
- [ ] T162 [US4] Add operator route wiring and authenticated guard behavior to the app router in `apps/web/src/app/router.tsx`
- [ ] T163 [US4] Add execution logs for treasury check received, snapshot recorded, routing triggered, payout transferred, payout recorded on-chain, and warning emitted in `apps/api/src/keeperhub/treasury-check-handler.ts`
- [ ] T164 [US4] Run US4 contract, integration, and unit tests and fix failures in `tests/contracts/treasury-check.contract.test.ts`, `tests/contracts/operator-audit.contract.test.ts`, and `apps/api/src/test/operator-audit.integration.test.ts`

**Checkpoint**: User Story 4 displays operator audit, runs balance checks, and routes batched creator recovery and referral transfers with registry records.

---

## Phase 7: Polish, Deployment, and Cross-Cutting Completion

**Purpose**: Finalize the complete app, harden edge cases, prepare deployment targets, and run full-story validation.

- [ ] T165 [P] Add OpenAPI contract validation script for `specs/001-chronicleai-publication-platform/contracts/api.openapi.yaml` in `tests/contracts/openapi-contract.test.ts`
- [ ] T166 [P] Add KeeperHub webhook replay fixtures for all webhook contracts in `tests/contracts/fixtures/keeperhub-webhooks.ts`
- [ ] T167 [P] Add full homepage composition with alerts, digest, premium teasers, and audit credibility signals in `apps/web/src/features/home/HomePage.tsx`
- [ ] T168 Add final route navigation polish, active states, and mobile responsive behavior in `apps/web/src/app/App.tsx`
- [ ] T169 Add global API timeout, retry, and user-facing error copy behavior in `apps/web/src/lib/api-client.ts`
- [ ] T170 Add backend request timeout handling and third-party integration failure mapping in `apps/api/src/middleware/core.ts`
- [ ] T171 Add no-leak regression tests across public endpoints for premium content fields in `tests/contracts/public-content-no-leak.contract.test.ts`
- [ ] T172 Add performance timing tests for critical API handlers excluding third-party settlement and LLM latency in `apps/api/src/test/performance-critical-paths.test.ts`
- [ ] T175 Create Supabase migration verification test for required tables, indexes, uniqueness constraints, and status enums (including sponsored watches and payouts) in `packages/db/src/test/migration-shape.test.ts`
- [ ] T176 Create demo seed verification test proving quickstart scenarios have usable data in `packages/db/src/test/demo-seed.test.ts`
- [ ] T177 Configure Vercel build and output settings for the Vite frontend in `apps/web/vercel.json`
- [ ] T178 Configure Heroku start, build, and health-check expectations for Express API in `apps/api/package.json` and `apps/api/Procfile`
- [ ] T179 Create deployment checklist for required Vercel, Heroku, Supabase, KeeperHub, smart contract compiling, Webflow collections, SMTP credentials, x402, MPP, and Para MPC credentials in `specs/001-chronicleai-publication-platform/deployment-checklist.md`
- [ ] T180 Update quickstart commands and expected validation results after implementation in `specs/001-chronicleai-publication-platform/quickstart.md`
- [ ] T181 Run full unit and integration suite with `pnpm test` and fix failures in `apps/api/src/test/`, `packages/db/src/test/`, and `tests/contracts/`
- [ ] T183 Run full TypeScript validation with `pnpm type-check` and fix failures in `apps/web/src/`, `apps/api/src/`, and `packages/schemas/src/`
- [ ] T184 Run lint and formatting validation with `pnpm check`, then `pnpm fix` if needed, and fix remaining issues in `apps/web/src/`, `apps/api/src/`, and `packages/`
- [ ] T185 Execute quickstart Scenario 1 manually and record pass/fail notes in `specs/001-chronicleai-publication-platform/quickstart.md`
- [ ] T186 Execute quickstart Scenario 2 (digest generation and publication) manually and record pass/fail notes in `specs/001-chronicleai-publication-platform/quickstart.md`
- [ ] T187 Execute quickstart Scenario 3 manually and record pass/fail notes in `specs/001-chronicleai-publication-platform/quickstart.md`
- [ ] T188 Execute quickstart Scenario 4 and 4A (sponsored monitoring campaign) manually and record pass/fail notes in `specs/001-chronicleai-publication-platform/quickstart.md`
- [ ] T189 Execute quickstart Scenario 5 (operator dashboard and autonomous payouts) manually and record pass/fail notes in `specs/001-chronicleai-publication-platform/quickstart.md`
- [ ] T190 Review all source files for `any`, dead code, unnecessary SDK dependencies, native dialogs, missing stable selectors, and server secret exposure in `apps/web/src/`, `apps/api/src/`, and `packages/`
- [ ] T191 Verify KeeperHub folder remains read-only and ChronicleAI implementation files do not modify `keeperhub/AGENTS.md` or any file under `keeperhub/`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1: Setup** has no dependencies and can begin immediately.
- **Phase 2: Foundational** depends on Phase 1 and blocks all user stories.
- **Phase 3: US1 Public Alerts** depends on Phase 2 and is the MVP.
- **Phase 4: US2 Daily Digest** depends on Phase 2; it can run in parallel with US1 after the foundation, but benefits from US1 monitored event fixtures.
- **Phase 5: US3 Premium Access** depends on Phase 2; it can run in parallel with US1 and US2 after the foundation.
- **Phase 6: US4 Operator Sustainability** depends on Phase 2; it can run in parallel after foundation but has the richest demo after US1-US3 generate data.
- **Phase 7: Polish and Deployment** depends on all selected user stories.

### User Story Dependencies

- **US1 (P1)**: No dependency on other stories after foundation. Recommended MVP scope.
- **US2 (P2)**: Can be independently tested with seeded monitored events; production-quality digest value improves after US1.
- **US3 (P3)**: Can be independently tested with seeded premium items and payment fixtures.
- **US4 (P4)**: Can be independently tested with seeded audit data; full value improves after US1-US3.

### Within Each User Story

- Contract, unit, and integration tests should be written before implementation and confirmed failing where practical.
- Repositories and schema fixtures precede services.
- Services precede route handlers and frontend hooks.
- Route handlers precede frontend page integration.
- Manual validation comes after backend and frontend pieces for the story are wired.

---

## Parallel Opportunities

- Setup tasks T006-T010 can run in parallel after root workspace files are established.
- Foundational schema/config tasks T023-T030 can run in parallel with frontend shell tasks T045-T050 and test helper tasks T051-T054.
- US1 tests T056-T062 can run in parallel, then repositories T063-T066 and frontend components T076-T078 can run in parallel.
- US2 tests T085-T089 can run in parallel, then backend repository/service work T091-T095 can run alongside frontend components T101-T103.
- US3 tests T109-T116 can run in parallel, then payment adapters T121-T123 can run alongside frontend premium components T131-T134.
- US4 tests T140-T144 can run in parallel, then repositories T146-T147 can run alongside dashboard components T156-T160.
- Polish tasks T165-T167, T171-T176, and T177-T179 can be split across developers after all story phases are stable.

## Parallel Example: User Story 1

```text
Task: "T057 [P] [US1] Write contract tests for POST /keeperhub/events in tests/contracts/keeperhub-events.contract.test.ts"
Task: "T058 [P] [US1] Write contract tests for GET /alerts in tests/contracts/alerts.contract.test.ts"
Task: "T059 [P] [US1] Write unit tests for event qualification thresholds in apps/api/src/test/event-qualification-service.test.ts"
```

## Parallel Example: User Story 3

```text
Task: "T121 [US3] Implement payment route abstraction in apps/api/src/payments/payment-adapter.ts"
Task: "T122 [US3] Implement x402 payment adapter in apps/api/src/payments/x402-payment-adapter.ts"
Task: "T123 [US3] Implement MPP payment adapter in apps/api/src/payments/mpp-payment-adapter.ts"
Task: "T132 [P] [US3] Create premium teaser card in apps/web/src/features/premium/PremiumTeaserCard.tsx"
Task: "T133 [P] [US3] Create payment challenge panel in apps/web/src/features/premium/PaymentChallengePanel.tsx"
```

---

## Implementation Strategy

### MVP First

1. Complete Phase 1 setup.
2. Complete Phase 2 foundation.
3. Complete Phase 3 US1 public alerts.
4. Validate `POST /keeperhub/events`, `GET /alerts`, `/alerts`, and duplicate replay.
5. Deploy or demo the MVP if time is constrained.

### Incremental Delivery

1. Add US1 public alerts and verify end to end.
2. Add US2 daily digest and verify scheduled/no-major-events flows.
3. Add US3 premium access and verify payment gating.
4. Add US4 operator sustainability and verify audit dashboard.
5. Complete Phase 7 hardening and deployment readiness.

### Completion Bar

The app is not complete until:
- All user story checkpoints pass independently.
- All quickstart scenarios pass.
- `pnpm type-check`, `pnpm check`, and `pnpm test` pass.
- Premium content is proven not to leak into public routes.
- KeeperHub webhook endpoints are idempotent and signed.
- Vercel, Heroku, Supabase, KeeperHub, x402, and MPP configuration requirements are documented and validated.
