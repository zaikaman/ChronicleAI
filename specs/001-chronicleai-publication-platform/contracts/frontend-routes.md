# Frontend Route Contract

## Public Routes

### `/`

Shows the ChronicleAI public publication experience.

**Must include**:
- Latest public alerts
- Latest daily digest summary
- Premium intelligence teasers
- Clear source references for public claims
- Link or action to view premium access options

**States**:
- Loading
- Empty alerts
- Empty digest
- Partial API failure with retry action

### `/alerts`

Lists public alerts with filtering by event type and chain where available.

**Must include**:
- Alert title, summary, event type, magnitude, confidence, and published time
- Source reference link or copyable reference
- Stable `data-testid` selectors for list, filter controls, and alert rows

### `/digests/latest`

Shows the latest public daily digest.

**Must include**:
- Report date
- Highlights
- Observed facts separated from analysis
- Source event references
- Clickable registry transaction hash (`publishDigest`) linking to block explorer

### `/premium`

Shows premium intelligence teasers, payment entry points, and active sponsored monitoring contract dashboards.

**Must include**:
- Item title
- Public teaser
- Price
- Supported payment routes (x402 on Base, MPP on Tempo)
- Payment-required state before premium content unlock
- List of active sponsored monitoring contracts with their campaign windows and on-chain setup (`createSponsoredWatch`) and completion (`publishSponsoredReport`) transaction links

## Activity Routes

### `/activity`

Shows the public Live Agent Activity page (no login).

**Must include**:
- Recent alerts with registry transaction hashes
- Recent digests with registry transaction hashes
- Payment activity (settlements and challenges)
- Treasury status (Para MPC wallet balance, safety buffer status, and low-balance warnings)
- Autonomous Revenue Routing payout logs (payout periods, recipient addresses, basis calculations, transfer transaction hashes, and registry `recordPayout` transaction hashes)
- Execution logs
- Warning state when treasury falls below safety buffer

**Access**:
- Fully public. No authentication required.

## UX Requirements

- Use shadcn/ui and Radix UI primitives for controls, dialogs, tabs, tables, and forms.
- Use Sonner toasts for transient success and error messages.
- Do not use native `alert()` or `confirm()` dialogs.
- Use premium glassmorphic styling tokens consistently.
- Never render premium-only content in public routes before payment verification.
