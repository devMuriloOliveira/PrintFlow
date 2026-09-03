param(
  [string]$ApiUrl = "https://printflow-api-4y5l.onrender.com",
  [string]$PairingCode = ""
)

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$logPath = Join-Path $agentRoot "logs"

$env:PRINTFLOW_API_URL = $ApiUrl
$env:PRINTFLOW_AGENT_LOG_DIR = $logPath

if ($PairingCode) {
  $env:PRINTFLOW_PAIRING_CODE = $PairingCode
} else {
  Remove-Item Env:\PRINTFLOW_PAIRING_CODE -ErrorAction SilentlyContinue
}

Set-Location $agentRoot
node src/index.js
