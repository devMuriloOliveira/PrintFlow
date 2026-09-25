param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$PreviousVersion,
  [Parameter(Mandatory = $true)][string]$NewVersion,
  [int]$ParentProcessId = 0,
  [string]$InstallDir = "$env:LOCALAPPDATA\PrintFlowAgent",
  [string]$TaskName = 'PrintFlowAgent',
  [string]$LocalHealthUrl = 'http://127.0.0.1:17873/healthz'
)

$ErrorActionPreference = 'Stop'
$updatesRoot = Join-Path $env:APPDATA 'PrintFlow Agent\updates'
$historyPath = Join-Path $updatesRoot 'update-history.jsonl'
$rollbackRoot = Join-Path $updatesRoot ("rollback-$PreviousVersion-" + [guid]::NewGuid().ToString('N'))
$binaryItems = @('assets', 'node_modules', 'runtime', 'scripts', 'src', 'package.json', 'package-lock.json', 'README.md')
$rollbackSucceeded = $false

function Add-UpdateHistory {
  param([string]$Result, [string]$Detail = '')
  New-Item -ItemType Directory -Path $updatesRoot -Force | Out-Null
  [ordered]@{
    occurredAt = [DateTime]::UtcNow.ToString('o')
    previousVersion = $PreviousVersion
    newVersion = $NewVersion
    result = $Result
    detail = $Detail
  } | ConvertTo-Json -Compress | Add-Content -LiteralPath $historyPath -Encoding UTF8
}

function Get-HealthyVersion([string]$ExpectedVersion, [int]$TimeoutSeconds = 90) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $health = Invoke-RestMethod -Uri $LocalHealthUrl -Method Get -TimeoutSec 3
      if ($health.ok -and [string]$health.version -eq $ExpectedVersion) { return $true }
    } catch {
    }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Stop-InstalledAgent {
  try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
  try {
    $escapedInstallRoot = [regex]::Escape([System.IO.Path]::GetFullPath($InstallDir))
    Get-CimInstance Win32_Process |
      Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -match $escapedInstallRoot } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch {
  }
}

function Save-AgentBinaryBackup {
  if (-not (Test-Path -LiteralPath $InstallDir)) { throw 'Instalacao anterior do Agent nao encontrada para rollback.' }
  New-Item -ItemType Directory -Path $rollbackRoot -Force | Out-Null
  foreach ($item in $binaryItems) {
    $source = Join-Path $InstallDir $item
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $rollbackRoot -Recurse -Force }
  }
}

function Restore-AgentBinaryBackup {
  Stop-InstalledAgent
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  foreach ($item in $binaryItems) {
    $target = Join-Path $InstallDir $item
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    $backup = Join-Path $rollbackRoot $item
    if (Test-Path -LiteralPath $backup) { Copy-Item -LiteralPath $backup -Destination $InstallDir -Recurse -Force }
  }
  Start-ScheduledTask -TaskName $TaskName
}

try {
  if ($ParentProcessId -gt 0) {
    $parentDeadline = [DateTime]::UtcNow.AddSeconds(60)
    while (
      (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) -and
      [DateTime]::UtcNow -lt $parentDeadline
    ) {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not (Test-Path -LiteralPath $InstallerPath)) { throw 'Instalador baixado nao encontrado.' }
  Save-AgentBinaryBackup
  $installer = Start-Process -FilePath $InstallerPath -Wait -PassThru
  if ($installer.ExitCode -ne 0) { throw "O instalador retornou exit code $($installer.ExitCode)." }
  if (-not (Get-HealthyVersion -ExpectedVersion $NewVersion)) { throw 'A nova versao nao confirmou inicializacao saudavel no prazo.' }
  Add-UpdateHistory -Result 'succeeded'
  Remove-Item -LiteralPath $rollbackRoot -Recurse -Force -ErrorAction SilentlyContinue
  exit 0
} catch {
  $failure = $_.Exception.Message
  Add-UpdateHistory -Result 'failed' -Detail $failure
  try {
    Restore-AgentBinaryBackup
    if (-not (Get-HealthyVersion -ExpectedVersion $PreviousVersion -TimeoutSeconds 60)) { throw 'A versao anterior nao confirmou inicializacao depois do rollback.' }
    $rollbackSucceeded = $true
    Add-UpdateHistory -Result 'rolled_back' -Detail $failure
  } catch {
    Add-UpdateHistory -Result 'rollback_failed' -Detail $_.Exception.Message
  }
  if ($rollbackSucceeded) { Remove-Item -LiteralPath $rollbackRoot -Recurse -Force -ErrorAction SilentlyContinue }
  exit 1
}
