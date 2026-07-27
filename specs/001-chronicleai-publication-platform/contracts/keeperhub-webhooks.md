# KeeperHub Webhook Contracts

## Event Ingestion Webhook

**Endpoint**: `POST /keeperhub/events`

**Purpose**: Accept qualifying or potentially qualifying on-chain events from KeeperHub workflows. The backend evaluates thresholds, deduplicates events, records the raw payload, and queues alert generation when appropriate.

**Authentication**: Requests must include a shared webhook signature in `X-ChronicleAI-Signature`. Invalid signatures return `401`.

### Classified payload (workflow pre-maps the event)

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

### Raw Event Tracker payload (server-side normalization)

When `eventType` is omitted, Chronicle accepts KeeperHub Event Tracker shapes and normalizes them using the protocol registry:

- `eventName` + `chainId` (required)
- `address` / `contractAddress`, `transactionHash`, `blockNumber`, `logIndex`, `args`
- Supported events: `Swap` (Uniswap V3), `Trade` (CoW Protocol), `LiquidationCall` (Aave V3), `PoolCreated` / `ContractCreated` (deployments)
- USD magnitudes use stablecoin decimals and/or Chainlink ETH/USD when `RPC_URL` is configured

**Expected responses**:
- `202`: Event accepted for processing
- `400`: Required fields missing or invalid / unmappable event
- `401`: Signature invalid
- `409`: Duplicate `sourceEventId` already received

## Block Analysis Webhook

**Endpoint**: `POST /keeperhub/blocks`

**Purpose**: Accept Block Dispatcher triggers. Chronicle fetches the block via `RPC_URL`, measures base fee (gwei) and transaction count, computes a rolling z-score for volume anomalies, optionally scans receipts for contract creations, and feeds any threshold crossings into the same alert pipeline as `/keeperhub/events`.

**Authentication**: `X-ChronicleAI-Signature` (same secret as other KeeperHub webhooks).

**Required payload fields**:
- `chainId`: EVM chain ID
- `blockNumber`: Block height to analyze

**Optional payload fields**:
- `sourceEventId` / `executionId`
- `blockHash`
- `timestamp`
- `capturedAt`
- Nested `triggerData.{chainId,blockNumber,blockHash,timestamp}` (workflow expansion shape)

**Expected responses**:
- `202`: Block accepted (zero or more events emitted)
- `400`: Invalid payload
- `401`: Signature invalid
- `502`: RPC failure or block not found

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

## Revenue Routing Webhook

**Endpoint**: `POST /keeperhub/revenue/route`

**Purpose**: Trigger the weekly autonomous revenue routing payout calculations, batch token transfers, and registry payout logging.

**Authentication**: Requests must include a shared webhook signature in `X-ChronicleAI-Signature`.

**Required payload fields**:
- `periodStart`: Start timestamp of the payout period
- `periodEnd`: End timestamp of the payout period

**Expected responses**:
- `202`: Revenue routing calculation initiated
- `400`: Invalid payout period
- `401`: Signature invalid
- `409`: Revenue routing for this period has already been processed

## Delivery Guarantees

- KeeperHub webhook calls must be idempotent using the source event, reporting-window, or payout-period identifier.
- The API must record the raw accepted payload before content generation or transaction processing begins.
- Failures must create execution logs visible on the public Activity page.
- Retries must not publish duplicate public alerts, duplicate daily digests, or execute duplicate payout transfers.
