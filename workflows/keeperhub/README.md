# ChronicleAI ↔ KeeperHub Monitoring Workflows

Import these JSON files into KeeperHub (Hub → Upload) to wire **Block Dispatcher** and **Event Tracker** into ChronicleAI’s real ingestion endpoints.

## Prerequisites

1. Chronicle API deployed with:
   - `KEEPERHUB_WEBHOOK_SECRET` (same value you put in webhook headers)
   - `RPC_URL` (JSON-RPC for gas/volume/deployment block analysis + Chainlink ETH/USD)
2. KeeperHub org with Event Tracker + Block Dispatcher running for your target chains
3. Replace placeholders in each file before import:
   - `https://YOUR_CHRONICLE_API_HOST` → your API base URL (must be `https://`)
   - `YOUR_KEEPERHUB_WEBHOOK_SECRET` → value of `KEEPERHUB_WEBHOOK_SECRET`

## Workflows

| File | Trigger | Chronicle endpoint | What it detects |
|------|---------|-------------------|-----------------|
| `gas-volume-block-monitor.workflow.json` | Block (every 1 block) | `POST /keeperhub/blocks` | Gas spikes + tx-volume anomalies + contract creates |
| `uniswap-v3-usdc-weth-swap.workflow.json` | Event `Swap` | `POST /keeperhub/events` | Large Uniswap V3 USDC/WETH swaps |
| `aave-v3-liquidation.workflow.json` | Event `LiquidationCall` | `POST /keeperhub/events` | Aave V3 liquidations |
| `cow-protocol-trade.workflow.json` | Event `Trade` | `POST /keeperhub/events` | CoW Protocol trades |
| `uniswap-v3-pool-created.workflow.json` | Event `PoolCreated` | `POST /keeperhub/events` | New Uniswap V3 pool deployments |

Default chain is **Ethereum Mainnet (`network: "1"`)**. For Base Sepolia, change `network` to `"84532"` and update contract addresses (see `@chronicleai/config` protocol registry).

## After import

1. Re-bind any credentials if KeeperHub prompts (webhook has none; Event/Block use chain WSS from KeeperHub).
2. Enable each workflow.
3. Confirm Event Tracker / Block Dispatcher logs show the workflows as tracked.
4. Smoke-test with:

```bash
# Classified event (existing contract)
curl -X POST "https://YOUR_HOST/keeperhub/events" \
  -H "Content-Type: application/json" \
  -H "X-ChronicleAI-Signature: $KEEPERHUB_WEBHOOK_SECRET" \
  -d '{"sourceEventId":"smoke-1","eventType":"gas_spike","chainId":1,"capturedAt":"2026-07-27T00:00:00Z","magnitude":{"value":600,"unit":"gwei"},"rawPayload":{}}'

# Block analysis (requires RPC_URL)
curl -X POST "https://YOUR_HOST/keeperhub/blocks" \
  -H "Content-Type: application/json" \
  -H "X-ChronicleAI-Signature: $KEEPERHUB_WEBHOOK_SECRET" \
  -d '{"chainId":1,"blockNumber":20000000}'
```

## How normalization works

- **Events**: raw Event Tracker payloads (`eventName`, `address`, `args`, …) are mapped server-side to `large_swap` / `liquidation` / `contract_deployment` with USD magnitudes when possible.
- **Blocks**: Chronicle fetches the block over RPC, measures `baseFeePerGas` and tx count, applies configured thresholds, and may emit `gas_spike`, `volume_anomaly`, and `contract_deployment`.
