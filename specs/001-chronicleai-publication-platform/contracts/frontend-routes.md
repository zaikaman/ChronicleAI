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

### `/premium`

Shows premium intelligence teasers and payment entry points.

**Must include**:
- Item title
- Public teaser
- Price
- Supported payment routes
- Payment-required state before premium content unlock

## Operator Routes

### `/operator`

Shows the operator audit dashboard.

**Must include**:
- Recent alerts
- Recent digests
- Payment activity
- Treasury status
- Execution logs
- Warning state when treasury falls below safety buffer

**Access**:
- Requires operator authentication.
- Unauthenticated users are redirected to sign-in or shown an authenticated route guard.

## UX Requirements

- Use shadcn/ui and Radix UI primitives for controls, dialogs, tabs, tables, and forms.
- Use Sonner toasts for transient success and error messages.
- Do not use native `alert()` or `confirm()` dialogs.
- Use premium glassmorphic styling tokens consistently.
- Never render premium-only content in public routes before payment verification.