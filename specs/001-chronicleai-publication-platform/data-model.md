# Data Model: ChronicleAI Publication Platform

## MonitoredEvent

Represents a captured on-chain signal from KeeperHub or another approved source.

**Fields**:
- `id`: Stable internal identifier
- `source`: Origin of the event, such as KeeperHub workflow, replay fixture, or manual test source
- `sourceEventId`: External event or execution identifier
- `eventType`: `large_swap`, `liquidation`, `gas_spike`, `volume_anomaly`, or `contract_deployment`
- `chainId`: Blockchain network identifier
- `protocol`: Related protocol when known
- `assetSymbols`: Assets involved when known
- `magnitude`: Numeric event value and unit when available
- `transactionHash`: Transaction reference when available
- `observedAt`: Time the event occurred on-chain
- `capturedAt`: Time ChronicleAI received the event
- `significanceScore`: Normalized score used for threshold decisions
- `rawPayload`: Original source payload for audit
- `status`: `received`, `qualified`, `ignored`, `failed`

**Relationships**:
- Can produce zero or one `PublicAlert`
- Can be referenced by many `DailyDigest` and `PremiumIntelligenceItem` records
- Has many `ExecutionLog` entries

**Validation rules**:
- `source`, `eventType`, `capturedAt`, and `rawPayload` are required
- `sourceEventId` plus `source` must be unique when provided
- Qualified events require a `significanceScore`

## PublicAlert

Represents a public bulletin generated from a qualifying monitored event.

**Fields**:
- `id`: Stable internal identifier
- `monitoredEventId`: Related event
- `title`: Public alert headline
- `summary`: Plain-language alert body
- `sourceReferences`: Event, transaction, or workflow references
- `audience`: Always `public`
- `destinations`: Public content and notification targets
- `deliveryStatus`: `draft`, `queued`, `published`, `partial_failure`, `failed`
- `publishedAt`: Public publication time
- `dedupeKey`: Event-derived duplicate prevention key
- `confidence`: `high`, `medium`, or `low`
- `generationProvider`: Provider that produced the final alert content, such as `gemini`, `openai`, or `groq`
- `generationAttemptIds`: References to provider attempts made while generating the alert

**Relationships**:
- Belongs to one `MonitoredEvent`
- Has many `ExecutionLog` entries
- Has many `LLMGenerationAttempt` entries

**Validation rules**:
- Published alerts require title, summary, source references, and at least one destination result
- `dedupeKey` must be unique within the deduplication window
- Public alerts must not contain premium-only analysis
- Published alerts require a successful `generationProvider`

## LLMGenerationAttempt

Represents one provider attempt during alert or report generation.

**Fields**:
- `id`: Stable internal identifier
- `entityType`: Related generated entity type, initially `public_alert`
- `entityId`: Related entity identifier when available
- `monitoredEventId`: Source monitored event for alert generation
- `provider`: `gemini`, `openai`, or `groq`
- `attemptOrder`: Numeric order in the fallback chain
- `status`: `succeeded`, `failed`, or `invalid_response`
- `latencyMs`: Provider request duration
- `failureReason`: Safe failure category or message when the attempt fails
- `responseMetadata`: Provider response metadata that is safe to store
- `createdAt`: Attempt time

**Relationships**:
- Belongs to one `MonitoredEvent`
- Can attach to one `PublicAlert` after successful generation
- Has many `ExecutionLog` entries through the related generated entity

**Validation rules**:
- Provider attempts must follow the configured fallback order: Gemini first, OpenAI second, Groq third
- A successful public alert may have only one successful provider attempt
- Failure reasons must not store API keys, prompts containing secrets, or sensitive provider credentials

## DailyDigest

Represents a scheduled report covering a reporting period.

**Fields**:
- `id`: Stable internal identifier
- `reportDate`: Date represented by the digest
- `periodStart`: Reporting window start
- `periodEnd`: Reporting window end
- `title`: Report title
- `summary`: Executive summary
- `highlights`: Ranked list of notable events or no-major-events message
- `analysis`: Generated interpretation separated from observed facts
- `sourceEventIds`: Referenced monitored events
- `audience`: `public`, `premium`, or `operator`
- `publicationStatus`: `draft`, `queued`, `published`, `partial_failure`, `failed`
- `publishedAt`: Publication time

**Relationships**:
- References many `MonitoredEvent` records
- Can be linked to one or more `PremiumIntelligenceItem` records
- Has many `ExecutionLog` entries

**Validation rules**:
- Every scheduled reporting period must produce one digest
- Reports must include either highlights or a no-major-events statement
- Analytical claims require source references or confidence labels

## PremiumIntelligenceItem

Represents paid content or structured premium feed data.

**Fields**:
- `id`: Stable internal identifier
- `slug`: Human-readable lookup key
- `title`: Premium item title
- `contentType`: `deep_dive`, `historical_feed`, `structured_feed`, or `sponsored_monitor`
- `summaryPublic`: Public teaser text
- `contentPrivate`: Gated premium content or structured payload reference
- `sourceEventIds`: Referenced monitored events
- `priceAmount`: Required payment amount
- `priceCurrency`: Payment currency or unit
- `paymentRoutes`: Supported routes such as x402 and MPP
- `status`: `draft`, `available`, `archived`
- `createdAt`: Creation time

**Relationships**:
- Has many `PaymentRecord` entries
- Can reference many `MonitoredEvent` and `DailyDigest` records

**Validation rules**:
- Available premium items require price, at least one payment route, and private content
- Public teaser text must not expose private analysis
- Archived items cannot be newly purchased unless explicitly reactivated

## PaymentRecord

Represents a payment attempt or settlement for premium access.

**Fields**:
- `id`: Stable internal identifier
- `premiumItemId`: Requested premium content
- `paymentRoute`: `x402` or `mpp`
- `payerReference`: Wallet, machine client, or subscriber reference when available
- `amountRequested`: Expected amount
- `amountSettled`: Settled amount
- `currency`: Payment currency or unit
- `status`: `challenge_issued`, `pending`, `settled`, `underpaid`, `expired`, `failed`
- `challengeReference`: Payment challenge identifier
- `settlementReference`: Settlement transaction or receipt identifier
- `requestedAt`: Request time
- `settledAt`: Settlement time

**Relationships**:
- Belongs to one `PremiumIntelligenceItem`
- Can create one or more `ExecutionLog` entries
- Contributes to `TreasurySnapshot` revenue totals

**Validation rules**:
- Premium content can be returned only when status is `settled`
- Settled records require amount, currency, route, and settlement reference
- Underpaid, expired, and failed records must not unlock content

## TreasurySnapshot

Represents ChronicleAI's operational funding state at a point in time.

**Fields**:
- `id`: Stable internal identifier
- `availableBalance`: Current available operating funds
- `currency`: Treasury currency
- `safetyBuffer`: Minimum desired balance
- `revenueTotal`: Revenue counted for the reporting window
- `estimatedGenerationCost`: Estimated AI/content cost
- `estimatedTransactionCost`: Estimated transaction or workflow execution cost
- `paidRequestCount`: Paid access volume
- `status`: `healthy`, `warning`, or `critical`
- `capturedAt`: Snapshot time

**Relationships**:
- Summarizes many `PaymentRecord` and `ExecutionLog` entries
- Can trigger an operator notification

**Validation rules**:
- Status is `warning` or `critical` when available balance is below the configured safety buffer
- Snapshot values must include their currency or unit

## ExecutionLog

Represents an auditable action or failure across monitoring, generation, publication, payment, or maintenance.

**Fields**:
- `id`: Stable internal identifier
- `actionType`: `monitor`, `generate_alert`, `publish_alert`, `generate_digest`, `publish_digest`, `payment`, `treasury_check`, `operator_notification`
- `entityType`: Related domain entity type
- `entityId`: Related domain entity identifier
- `status`: `started`, `succeeded`, `retrying`, `failed`
- `message`: Human-readable result
- `details`: Structured diagnostic data
- `startedAt`: Start time
- `completedAt`: Completion time

**Relationships**:
- Can attach to any primary domain entity

**Validation rules**:
- Failed logs require a diagnostic message
- Retrying logs require enough detail for operators to understand the next attempt
- Logs must preserve chronological ordering for dashboard audit views

## State Transitions

### PublicAlert

`draft` -> `queued` -> `published`

`queued` -> `partial_failure` -> `published`

`queued` -> `failed`

### LLMGenerationAttempt

`failed`

`invalid_response`

`succeeded`

### DailyDigest

`draft` -> `queued` -> `published`

`queued` -> `partial_failure` -> `published`

`queued` -> `failed`

### PaymentRecord

`challenge_issued` -> `pending` -> `settled`

`challenge_issued` -> `expired`

`pending` -> `underpaid`

`pending` -> `failed`

### TreasurySnapshot

`healthy` -> `warning` -> `critical`

`critical` -> `warning` -> `healthy`
