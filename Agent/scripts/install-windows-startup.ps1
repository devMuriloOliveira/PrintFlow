param(
  [string]$ApiUrl = "http://localhost:3333",
  [string]$TaskName = "PrintFlowAgent",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$scriptPath = Join-Path $agentRoot "scripts\start-windows-agent-tray.ps1"
$logPath = Join-Path $agentRoot "logs"

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -ApiUrl `"$ApiUrl`""

$trigger = New-ScheduledTaskTrigger `
  -AtLogOn `
  -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 0)

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
Write-Host "API: $ApiUrl"
Write-Host "Logs: $logPath"
