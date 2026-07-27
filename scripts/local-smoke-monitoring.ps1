# Local smoke tests for ChronicleAI monitoring (no deploy, no KeeperHub required).
# Simulates what KeeperHub workflows would POST to the API.
#
# Usage (from repo root, with API already running on PORT):
#   .\scripts\local-smoke-monitoring.ps1
#   .\scripts\local-smoke-monitoring.ps1 -BaseUrl "http://localhost:4000" -Secret "my-secret"
#
# Prerequisites:
#   1. apps/api/.env configured (SUPABASE_*, KEEPERHUB_WEBHOOK_SECRET, optional RPC_URL)
#   2. pnpm --filter @chronicleai/api dev

param(
  [string]$BaseUrl = "http://localhost:4000",
  [string]$Secret = $env:KEEPERHUB_WEBHOOK_SECRET
)

$ErrorActionPreference = "Stop"

if (-not $Secret) {
  # Fall back to common local default if user set it only in apps/api/.env
  $apiEnv = Join-Path $PSScriptRoot "..\apps\api\.env"
  if (Test-Path $apiEnv) {
    Get-Content $apiEnv | ForEach-Object {
      if ($_ -match '^\s*KEEPERHUB_WEBHOOK_SECRET\s*=\s*(.+)\s*$') {
        $Secret = $Matches[1].Trim().Trim('"').Trim("'")
      }
    }
  }
}

if (-not $Secret -or $Secret.Length -lt 8) {
  Write-Host "ERROR: Set KEEPERHUB_WEBHOOK_SECRET (env or apps/api/.env), then re-run." -ForegroundColor Red
  exit 1
}

$headers = @{
  "Content-Type"              = "application/json"
  "X-ChronicleAI-Signature"   = $Secret
}

function Invoke-Smoke {
  param(
    [string]$Name,
    [string]$Path,
    [hashtable]$Body
  )
  Write-Host ""
  Write-Host "=== $Name ===" -ForegroundColor Cyan
  Write-Host "POST $BaseUrl$Path"
  try {
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    $resp = Invoke-WebRequest -Method POST -Uri "$BaseUrl$Path" -Headers $headers -Body $json -UseBasicParsing
    Write-Host "Status: $($resp.StatusCode)" -ForegroundColor Green
    Write-Host $resp.Content
  }
  catch {
    $status = $_.Exception.Response.StatusCode.value__
    $reader = $null
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $text = $reader.ReadToEnd()
    }
    catch {
      $text = $_.Exception.Message
    }
    finally {
      if ($reader) { $reader.Dispose() }
    }
    Write-Host "Status: $status" -ForegroundColor Yellow
    Write-Host $text
  }
}

# 0) Health
Write-Host "Checking API at $BaseUrl ..." -ForegroundColor Cyan
try {
  $h = Invoke-WebRequest -Uri "$BaseUrl/health" -UseBasicParsing
  Write-Host "Health: $($h.StatusCode) $($h.Content)" -ForegroundColor Green
}
catch {
  Write-Host "API not reachable at $BaseUrl. Start it with:" -ForegroundColor Red
  Write-Host "  pnpm --filter @chronicleai/api dev"
  exit 1
}

# 1) Classified gas spike (what a fully-mapped workflow might send)
Invoke-Smoke -Name "Classified gas_spike event" -Path "/keeperhub/events" -Body @{
  sourceEventId = "local-smoke-gas-$(Get-Date -Format 'yyyyMMddHHmmss')"
  eventType     = "gas_spike"
  chainId       = 1
  capturedAt    = (Get-Date).ToUniversalTime().ToString("o")
  magnitude     = @{ value = 650; unit = "gwei" }
  rawPayload    = @{ source = "local-smoke" }
}

# 2) Raw Uniswap Swap (Event Tracker shape — server normalizes)
$amount0 = [string](2500000 * 1000000)  # 2.5M USDC (6 decimals)
Invoke-Smoke -Name "Raw Uniswap V3 Swap (normalized to large_swap)" -Path "/keeperhub/events" -Body @{
  chainId          = 1
  eventName        = "Swap"
  address          = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"
  transactionHash  = ("0x" + -join ((1..64) | ForEach-Object { "{0:x}" -f (Get-Random -Max 16) }))
  logIndex         = 0
  protocol         = "Uniswap V3"
  args             = @{
    amount0 = @{ value = $amount0; type = "int256" }
    amount1 = @{ value = "-1000000000000000000"; type = "int256" }
  }
}

# 3) Raw Aave liquidation
$debt = [string](800000 * 1000000)
Invoke-Smoke -Name "Raw Aave V3 LiquidationCall" -Path "/keeperhub/events" -Body @{
  chainId          = 1
  eventName        = "LiquidationCall"
  address          = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
  transactionHash  = ("0x" + -join ((1..64) | ForEach-Object { "{0:x}" -f (Get-Random -Max 16) }))
  logIndex         = 1
  protocol         = "Aave V3"
  args             = @{
    debtAsset      = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    collateralAsset = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
    debtToCover    = @{ value = $debt; type = "uint256" }
  }
}

# 4) Block analysis (needs RPC_URL on the API)
Invoke-Smoke -Name "Block analysis (gas/volume; needs RPC_URL)" -Path "/keeperhub/blocks" -Body @{
  chainId     = 84532
  blockNumber = 7000000
  sourceEventId = "local-smoke-block-$(Get-Date -Format 'yyyyMMddHHmmss')"
}

# 5) Public alerts list (no auth)
Write-Host ""
Write-Host "=== GET /alerts ===" -ForegroundColor Cyan
try {
  $alerts = Invoke-WebRequest -Uri "$BaseUrl/alerts?limit=5" -UseBasicParsing
  Write-Host "Status: $($alerts.StatusCode)" -ForegroundColor Green
  Write-Host $alerts.Content.Substring(0, [Math]::Min(800, $alerts.Content.Length))
}
catch {
  Write-Host "Could not list alerts: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done. Check Supabase monitored_events / public_alerts, or the API logs." -ForegroundColor Cyan
