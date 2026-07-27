<!--
Sync Impact Report:
- Version change: None (Initial) -> 1.0.0
- List of modified principles:
  - [PRINCIPLE_1_NAME] -> I. Code Quality & Technical Standards
  - [PRINCIPLE_2_NAME] -> II. Testing Standards & Verification Discipline
  - [PRINCIPLE_3_NAME] -> III. User Experience & Theme Consistency
  - [PRINCIPLE_4_NAME] -> IV. Performance & On-Chain Reliability
  - [PRINCIPLE_5_NAME] -> V. Database Schema & Migration Integrity
- Added sections:
  - Development and Branching Strategy
  - Public Documentation & Release Gates
- Removed sections: None
- Templates requiring updates:
  - .specify/templates/plan-template.md (✅ updated - verified aligned)
  - .specify/templates/spec-template.md (✅ updated - verified aligned)
  - .specify/templates/tasks-template.md (✅ updated - verified aligned)
- Follow-up TODOs: None
-->

# ChronicleAI Constitution

## Core Principles

### I. Code Quality & Technical Standards
Every line of code written MUST be clean, explicit, and typed. Strictly avoid using the `any` type in favor of `unknown` or specific interfaces. Remove all dead or unused code prior to commits. To minimize security vulnerability surface area, utilize native `fetch` rather than adding unnecessary external SDK dependencies for API integrations. Never use emojis in code, commit messages, or developer-facing documentation.

### II. Testing Standards & Verification Discipline
All new features and user journeys MUST be covered by corresponding automated tests. Use Vitest for unit and integration testing, and Playwright for E2E user-flow verification. Write E2E selectors targeting stable semantic elements (e.g., `data-testid`) rather than unstable CSS structures. Before every commit, locally run `pnpm type-check` and `pnpm check`/`pnpm fix` to ensure all checks pass without error.

### III. User Experience & Theme Consistency
All visual elements MUST present a premium, cohesive glassmorphic design that utilizes consistent styling tokens. Standardize on shadcn/ui and Radix UI components; custom duplicate implementations are prohibited. Never use native browser dialogs like `alert()` or `confirm()`; use semantic dialogs or Sonner toasts instead. Maintain typographical pairing consistency and high-contrast color palettes defined in CSS variables.

### IV. Performance & On-Chain Reliability
Every integration must satisfy strict latency guidelines, targeting sub-200ms response times for critical paths. Transaction execution MUST utilize intelligent gas estimation with exponential backoff and private MEV-safe routing to guarantee on-chain delivery. Keep LLM calls token-efficient and optimize query operations to ensure financial sustainability and prevent operational cost overrun.

### V. Database Schema & Migration Integrity
All database schema updates MUST use file-based migrations tracked via monotonic journal timestamps. Any heavy DDL schema migration that cannot run inside a transaction block (e.g., creating indexes concurrently) MUST include the `-- @requires-db-prep` directive on the first line of the migration file. This triggers mandatory out-of-band application by operators prior to PR merge.

## Development and Branching Strategy
All development takes place in feature branches named `feature/KEEP-XXXX-description`. All pull requests MUST target the `staging` branch. Commit messages and pull request titles MUST strictly adhere to the Conventional Commits specification. No ticket IDs or phase numbers should be referenced in public-facing documentation.

## Public Documentation & Release Gates
Public-facing documentation in the `docs/` folder is published directly and MUST contain no internal references, ticket IDs, or version tags. Release gates require complete automated test suite validation, zero linter or type-checker errors, and explicit confirmation of pre-requisite database migration steps on staging and production before code deployment.

## Governance
This constitution serves as the source of truth for engineering practices in ChronicleAI. Any amendment to this constitution requires:
1. A pull request modifying this file with a detailed rationale for the change.
2. Alignment and approval from core maintainers.
3. Propagation of changes to all dependent specification, plan, and task templates.
All code reviews and automated workflows must enforce compliance with these principles.

**Version**: 1.0.0 | **Ratified**: 2026-07-27 | **Last Amended**: 2026-07-27