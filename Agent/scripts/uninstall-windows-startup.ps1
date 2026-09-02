param(
  [string]$TaskName = "PrintFlowAgent"
)

$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask `
  -TaskName $TaskName `
  -ErrorAction SilentlyContinue

if (-not $task) {
  Write-Host "PrintFlow Agent nao estava instalado no login."
  return
}

Stop-ScheduledTask `
  -TaskName $TaskName `
  -ErrorAction SilentlyContinue

Unregister-ScheduledTask `
  -TaskName $TaskName `
  -Confirm:$false

Write-Host "PrintFlow Agent removido do login do Windows."
