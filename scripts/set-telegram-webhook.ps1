# OPTIONAL manual Telegram webhook registration.
#
# You normally do NOT need this after every deploy. On boot, the API calls
# setWebhook when TELEGRAM_INGEST_BOT_TOKEN (or TELEGRAM_BOT_TOKEN) +
# TELEGRAM_WEBHOOK_SECRET + PUBLIC_API_BASE_URL are set. Telegram stores the
# URL server-side across Heroku restarts.
#
# Use this script only to force-refresh, debug, or register before the first deploy.
#
# Prerequisites:
#   - TELEGRAM_INGEST_BOT_TOKEN (or legacy TELEGRAM_BOT_TOKEN) = *ingest* bot
#     (receives group messages; privacy mode OFF). Do NOT use the send bot token.
#   - TELEGRAM_WEBHOOK_SECRET = random secret (1-256 chars A-Za-z0-9_-)
#   - Public HTTPS API base (Heroku), e.g. https://chronicleai-xxx.herokuapp.com
#
# Usage:
#   .\scripts\set-telegram-webhook.ps1
#   .\scripts\set-telegram-webhook.ps1 -ApiBase "https://chronicleai-76fcd1c06def.herokuapp.com" -BotToken "..." -Secret "..."

param(
  [string]$ApiBase = $env:CHRONICLE_API_BASE,
  [string]$BotToken = $(if ($env:TELEGRAM_INGEST_BOT_TOKEN) { $env:TELEGRAM_INGEST_BOT_TOKEN } else { $env:TELEGRAM_BOT_TOKEN }),
  [string]$Secret = $env:TELEGRAM_WEBHOOK_SECRET
)

$ErrorActionPreference = "Stop"

if (-not $ApiBase) {
  $ApiBase = "https://chronicleai-76fcd1c06def.herokuapp.com"
}
if (-not $BotToken) {
  # Try apps/api/.env
  $envFile = Join-Path $PSScriptRoot "..\apps\api\.env"
  if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
      if ($_ -match '^\s*TELEGRAM_INGEST_BOT_TOKEN=(.+)$') { $BotToken = $Matches[1].Trim().Trim('"') }
      if (-not $BotToken -and $_ -match '^\s*TELEGRAM_BOT_TOKEN=(.+)$') { $BotToken = $Matches[1].Trim().Trim('"') }
      if ($_ -match '^\s*TELEGRAM_WEBHOOK_SECRET=(.+)$') { if (-not $Secret) { $Secret = $Matches[1].Trim().Trim('"') } }
    }
  }
}

if (-not $BotToken) { throw "TELEGRAM_INGEST_BOT_TOKEN (or TELEGRAM_BOT_TOKEN) is required (ingest bot)" }
if (-not $Secret) { throw "TELEGRAM_WEBHOOK_SECRET is required" }
if ($Secret -notmatch '^[A-Za-z0-9_-]{1,256}$') {
  throw "TELEGRAM_WEBHOOK_SECRET must be 1-256 chars of A-Za-z0-9_-"
}

$webhookUrl = ($ApiBase.TrimEnd('/')) + "/telegram/webhook"
$api = "https://api.telegram.org/bot$BotToken/setWebhook"

Write-Host "Setting webhook:"
Write-Host "  url    = $webhookUrl"
Write-Host "  secret = (set, length $($Secret.Length))"

$body = @{
  url = $webhookUrl
  secret_token = $Secret
  allowed_updates = @("message", "channel_post", "edited_message", "edited_channel_post")
  drop_pending_updates = $true
} | ConvertTo-Json -Depth 5

$response = Invoke-RestMethod -Method Post -Uri $api -ContentType "application/json" -Body $body
$response | ConvertTo-Json -Depth 5

if (-not $response.ok) {
  throw "setWebhook failed: $($response.description)"
}

Write-Host "OK — Telegram will POST updates to $webhookUrl"
Write-Host "Verify: https://api.telegram.org/bot$BotToken/getWebhookInfo"
