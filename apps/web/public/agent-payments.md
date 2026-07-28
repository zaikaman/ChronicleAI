# Agent payments — x402 and MPP

ChronicleAI premium content uses **dual-rail micropayments**.

| Rail | Audience | Settlement | UI |
|------|----------|------------|-----|
| **x402** | Humans | EIP-712 USDC authorization | `/premium` wallet checkout |
| **MPP** | Agents | HMAC-SHA256 over challenge payload | API only |

## Discovery

| Endpoint | Purpose |
|----------|---------|
| `GET /payments` | Full dual-rail discovery document |
| `GET /.well-known/agent-payments` | Same document (well-known) |
| `GET /premium/items` | Catalog teasers with `paymentRoutes` |
| `/llms.txt` | This guide, crawlable from the SPA origin |

## MPP settle format

```
settlementReference = `${expiresAt}:${hmac_hex}`
hmac_hex = hex(HMAC-SHA256(MPP_SECRET, hmacPayloadTemplate))
```

`hmacPayloadTemplate` is returned on the challenge (`challengeData.hmacPayloadTemplate`).
It is already fully rendered — hash that exact string.

## Access after settle

```
Authorization: Bearer <accessReceipt>
```

or

```
X-Premium-Access-Receipt: <accessReceipt>
```

Bare `?payer=` is **not** accepted for unlock.
