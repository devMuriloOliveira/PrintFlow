param(
  [string]$ProtocolUrl = "",
  [string]$ApiUrl = "http://localhost:3333",
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
