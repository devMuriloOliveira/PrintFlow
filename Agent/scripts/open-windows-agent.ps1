param(
  [string]$ProtocolUrl = "",
  [string]$ApiUrl = "https://printflow-api-4y5l.onrender.com",
  [string]$TaskName = "PrintFlowAgent"
)

$ErrorActionPreference = "Stop"

$pairingCode = ""

if ($ProtocolUrl) {
  try {
    Add-Type -AssemblyName System.Web
    $uri = [System.Uri]$ProtocolUrl
    $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
    $pairingCode = $query.Get("code")
  } catch {
    $pairingCode = ""
  }
}

if ($pairingCode) {
  $dataRoot = $env:APPDATA
  if (-not $dataRoot) {
    $dataRoot = Join-Path $env:USERPROFILE "AppData\Roaming"
  }

  $agentDataDir = Join-Path $dataRoot "PrintFlow Agent"
  $pendingPairingFile = Join-Path $agentDataDir "pending-pairing.json"

  if (-not (Test-Path $agentDataDir)) {
    New-Item -ItemType Directory -Path $agentDataDir | Out-Null
  }

  @{
    code = $pairingCode.ToUpperInvariant()
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath $pendingPairingFile -Encoding UTF8

  & (Join-Path $PSScriptRoot "start-windows-agent-tray.ps1") `
    -ApiUrl $ApiUrl `
    -PairingCode $pairingCode

  return
}

$task = Get-ScheduledTask `
  -TaskName $TaskName `
  -ErrorAction SilentlyContinue

if ($task) {
  try {
    Start-ScheduledTask `
      -TaskName $TaskName `
      -ErrorAction Stop
  } catch {
    Write-Host "PrintFlow Agent ja estava em execucao ou nao pode ser reiniciado pela tarefa."
  }

  Write-Host "PrintFlow Agent iniciado pela tarefa do Windows."
  return
}

& (Join-Path $PSScriptRoot "start-windows-agent-tray.ps1") `
  -ApiUrl $ApiUrl
