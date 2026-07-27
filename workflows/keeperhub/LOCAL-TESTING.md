# Local testing (no production deploy)

You do **not** need to import workflows into cloud KeeperHub or deploy Heroku/Vercel to validate monitoring.

Chronicle’s monitoring is HTTP-in: anything that POSTs the right JSON + signature exercises the same path as KeeperHub.

---

## Three levels (pick how deep you go)

| Level | What you test | Needs KeeperHub? | Needs public URL? |
|-------|----------------|------------------|-------------------|
| **1. Automated tests** | Normalizer, block math, HTTP contracts | No | No |
| **2. Local API + curl/script** | Full ingest → DB → alerts | No (you fake KeeperHub) | No (`localhost`) |
| **3. Real KeeperHub → local API** | True Event Tracker / Block Dispatcher | Yes | Yes (HTTPS tunnel) |

Most of the time **Level 1 + 2** is enough before deploy.

---

## Level 1 — automated tests (fastest)

From repo root:

```powershell
pnpm install
pnpm exec vitest run apps/api/src/test/arg-utils.test.ts apps/api/src/test/block-analyzer.test.ts apps/api/src/test/event-normalizer.test.ts tests/contracts/keeperhub-blocks.contract.test.ts tests/contracts/keeperhub-events.contract.test.ts
```

This proves:

- Uniswap/Aave/CoW raw payloads normalize correctly  
- Gas / volume z-score logic works  
- `/keeperhub/events` and `/keeperhub/blocks` respond with auth + validation  

No database required for the unit tests; contract tests may hit a configured Supabase if env is loaded.

---

## Level 2 — run API locally and pretend to be KeeperHub (recommended)

### 1. Configure `apps/api/.env`

Minimum for monitoring smoke:

```env
PORT=4000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
KEEPERHUB_WEBHOOK_SECRET=local-dev-secret-at-least-16
FRONTEND_ORIGIN=http://localhost:5173

# Optional but needed for /keeperhub/blocks + ETH USD on swaps:
RPC_URL=https://base-sepolia-rpc.publicnode.com

# Optional: real LLM alerts (else generation may fail after qualify)
GEMINI_API_KEY=
OPENAI_API_KEY=
GROQ_API_KEY=
```

Use the same `KEEPERHUB_WEBHOOK_SECRET` value in every manual request header.

Apply migrations / seed if tables are empty (Supabase SQL editor or your usual migrate path):

- `supabase/migrations/*.sql`
- optional: `supabase/seed/chronicleai_demo.sql` for UI demo data only

### 2. Start the API

```powershell
cd D:\KeeperHubHackathon
pnpm --filter @chronicleai/api dev
```

Optional frontend:

```powershell
pnpm --filter @chronicleai/web dev
# apps/web .env: VITE_API_BASE_URL=http://localhost:4000
```

### 3. Run the smoke script (simulates KeeperHub POSTs)

```powershell
cd D:\KeeperHubHackathon
$env:KEEPERHUB_WEBHOOK_SECRET = "local-dev-secret-at-least-16"   # must match apps/api/.env
.\scripts\local-smoke-monitoring.ps1
```

Or pass flags:

```powershell
.\scripts\local-smoke-monitoring.ps1 -BaseUrl "http://localhost:4000" -Secret "local-dev-secret-at-least-16"
```

What the script hits:

1. `POST /keeperhub/events` — classified `gas_spike`  
2. `POST /keeperhub/events` — **raw** Uniswap `Swap` (normalization path)  
3. `POST /keeperhub/events` — **raw** Aave `LiquidationCall`  
4. `POST /keeperhub/blocks` — block analysis via `RPC_URL`  
5. `GET /alerts` — see published items if LLM + DB succeeded  

### 4. Manual curl equivalents (PowerShell)

```powershell
$secret = "local-dev-secret-at-least-16"
$base = "http://localhost:4000"
$h = @{ "Content-Type"="application/json"; "X-ChronicleAI-Signature"=$secret }

# Classified event
Invoke-RestMethod -Method POST -Uri "$base/keeperhub/events" -Headers $h -Body (@{
  sourceEventId = "manual-1"
  eventType = "large_swap"
  chainId = 1
  capturedAt = (Get-Date).ToUniversalTime().ToString("o")
  magnitude = @{ value = 2000000; unit = "USD" }
  protocol = "Uniswap"
  rawPayload = @{}
} | ConvertTo-Json)

# Block (needs RPC_URL)
Invoke-RestMethod -Method POST -Uri "$base/keeperhub/blocks" -Headers $h -Body (@{
  chainId = 84532
  blockNumber = 7000000
} | ConvertTo-Json)
```

### 5. What “success” looks like

| Call | Good result |
|------|-------------|
| Events | `202` + `accepted: true` (may say did not qualify, or alert generated) |
| Events bad signature | `401` |
| Events bad body | `400` |
| Blocks without `RPC_URL` | `502` mentioning RPC |
| Blocks with `RPC_URL` | `202` (may emit 0 events if gas/volume below thresholds) |
| `GET /alerts` | JSON list (empty until a qualifying event + LLM succeeds) |

You are **not** importing workflow JSON into KeeperHub at this level. The smoke script **is** the stand-in for those workflows.

---

## Level 3 — optional: real KeeperHub hitting your laptop

Only if you need to prove Event Tracker / Block Dispatcher end-to-end.

### Why a tunnel?

KeeperHub cloud cannot call `http://localhost:4000`. You expose HTTPS:

```powershell
# Example with ngrok (install separately)
ngrok http 4000
# Copy the https://xxxx.ngrok-free.app URL
```

### Then

1. Keep local API running with the same `KEEPERHUB_WEBHOOK_SECRET`.  
2. Edit `workflows/keeperhub/*.workflow.json`:
   - `YOUR_CHRONICLE_API_HOST` → `xxxx.ngrok-free.app` (no `https://` in the placeholder if the file already has `https://…`)  
   - `YOUR_KEEPERHUB_WEBHOOK_SECRET` → same secret as local `.env`  
3. Import those **edited** JSONs into KeeperHub and enable them.  
4. Wait for chain activity (or use a busy mainnet pool) and watch local API logs.

**Do not** point production KeeperHub at a temporary ngrok URL long-term; this is for pre-deploy verification only.

KeeperHub export rules require **https** webhook URLs, so plain `http://localhost` imports will be rejected or unsafe for cloud runners.

---

## What you can skip until “100% complete”

- Heroku / Vercel deploy  
- Importing workflows into production KeeperHub  
- Replacing placeholders for a production API host  
- Mainnet paid RPC (public Base Sepolia RPC is fine for block smoke)

---

## Suggested order before any deploy

1. Level 1 tests green  
2. Level 2 smoke script green with your Supabase  
3. (Optional) Level 3 with ngrok once  
4. Only then: production env + real host in workflow JSON + import/enable in KeeperHub  
