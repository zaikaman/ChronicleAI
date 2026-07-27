# KeeperHub Webhook Contracts

## Event Ingestion Webhook

**Endpoint**: `POST /keeperhub/events`

**Purpose**: Accept qualifying or potentially qualifying on-chain events from KeeperHub workflows. The backend evaluates thresholds, deduplicates events, records the raw payload, and queues alert generation when appropriate.

**Authentication**: Requests must include a shared webhook signature in `X-ChronicleAI-Signature`. Invalid signatures return `401`.

**Required payload fields**:
- `sourceEventId`: KeeperHub workflow execution or event identifier
- `eventType`: `large_swap`, `liquidation`, `gas_spike`, `volume_anomaly`, or `contract_deployment`
- `chainId`: Network identifier
- `capturedAt`: Timestamp when KeeperHub captured or emitted the event
- `rawPayload`: Original event payload for audit

**Optional payload fields**:
- `protocol`
- `transactionHash`
- `assetSymbols`
- `magnitude`
- `sourceReferences`

**Expected responses**:
- `202`: Event accepted for processing
- `400`: Required fields missing or invalid
- `401`: Signature invalid
- `409`: Duplicate `sourceEventId` already received

## Digest Trigger Webhook

**Endpoint**: `POST /keeperhub/digests/run`

**Purpose**: Trigger daily digest generation for a reporting period from a KeeperHub scheduled workflow.

**Authentication**: Requests must include a shared webhook signature in `X-ChronicleAI-Signature`.

**Required payload fields**:
- `periodStart`: Reporting window start timestamp
- `periodEnd`: Reporting window end timestamp

**Expected responses**:
- `202`: Digest generation accepted
- `400`: Reporting window invalid
- `401`: Signature invalid
- `409`: Digest for the reporting window already exists

## Treasury Check Webhook

**Endpoint**: `POST /keeperhub/treasury/check`

**Purpose**: Trigger a maintenance check that records the agent's available balance, cost estimates, revenue totals, and safety-buffer status.

**Authentication**: Requests must include a shared webhook signature in `X-ChronicleAI-Signature`.

**Required payload fields**:
- `capturedAt`: Timestamp of the maintenance check
- `availableBalance`: Available operating funds
- `currency`: Treasury currency or unit
- `safetyBuffer`: Minimum desired balance

**Expected responses**:
- `202`: Treasury snapshot accepted
- `400`: Snapshot invalid
- `401`: Signature invalid

## Delivery Guarantees

- KeeperHub webhook calls must be idempotent using the source event or reporting-window identifier.
- The API must record the raw accepted payload before content generation begins.
- Failures must create execution logs visible in the operator audit view.
- Retries must not publish duplicate public alerts or duplicate daily digests.