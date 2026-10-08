param(
  [string]$ApiUrl = "https://printflow-api-4y5l.onrender.com",
  [string]$TaskName = "PrintFlowAgent",
  [string]$HostExecutable = "",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$logPath = Join-Path $agentRoot "logs"

if (-not $HostExecutable) {
  $HostExecutable = Join-Path $agentRoot "host\PrintFlowAgentHost.exe"
}

if (-not (Test-Path -LiteralPath $HostExecutable)) {
  throw "Host nativo do PrintFlow Agent nao encontrado: $HostExecutable"
}

$action = New-ScheduledTaskAction `
  -Execute $HostExecutable `
  -Argument "--api-url `"$ApiUrl`""

$trigger = New-ScheduledTaskTrigger `
  -AtLogOn `
  -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 0) `
  -StartWhenAvailable `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Force | Out-Null

if (-not $NoStart) {
  Start-ScheduledTask `
    -TaskName $TaskName
}

Write-Host "PrintFlow Agent instalado no login do Windows."
Write-Host "Task: $TaskName"
Write-Host "Logs: $logPath"
