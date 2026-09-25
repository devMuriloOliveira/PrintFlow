param(
  [string]$CurrentVersion = '',
  [string]$InstallDir = "$env:LOCALAPPDATA\PrintFlowAgent",
  [string]$LocalHealthUrl = 'http://127.0.0.1:17873/healthz',
  [switch]$VerifyOnly,
  [switch]$Interactive
)

$ErrorActionPreference = 'Stop'
$null = Add-Type -AssemblyName System.Windows.Forms
$releaseApi = 'https://api.github.com/repos/devMuriloOliveira/PrintFlow/releases/latest'
$updatesRoot = Join-Path $env:APPDATA 'PrintFlow Agent\updates'
$historyPath = Join-Path $updatesRoot 'update-history.jsonl'

function Compare-SemVer([string]$left, [string]$right) {
  return ([version]$left).CompareTo([version]$right)
}

function Add-UpdateHistory {
  param(
    [string]$PreviousVersion,
    [string]$NewVersion,
    [string]$Result,
    [string]$Detail = '',
    [switch]$Deduplicate
  )
  New-Item -ItemType Directory -Path $updatesRoot -Force | Out-Null
  if ($Deduplicate -and (Test-Path -LiteralPath $historyPath)) {
    $lastLine = Get-Content -LiteralPath $historyPath -Tail 1 -ErrorAction SilentlyContinue
    if ($lastLine) {
      try {
        $last = $lastLine | ConvertFrom-Json
        if ($last.previousVersion -eq $PreviousVersion -and $last.newVersion -eq $NewVersion -and $last.result -eq $Result) { return }
      } catch {
      }
    }
  }
  [ordered]@{
    occurredAt = [DateTime]::UtcNow.ToString('o')
    previousVersion = $PreviousVersion
    newVersion = $NewVersion
    result = $Result
    detail = $Detail
  } | ConvertTo-Json -Compress | Add-Content -LiteralPath $historyPath -Encoding UTF8
}

function Get-AgentHealth {
  try {
    return Invoke-RestMethod -Uri $LocalHealthUrl -Method Get -TimeoutSec 3
  } catch {
    return $null
  }
}

$release = Invoke-RestMethod -Uri $releaseApi -Headers @{ 'User-Agent' = 'PrintFlow-Agent-Updater' }
$tag = [string]$release.tag_name
if ($tag -notmatch '^agent-v(\d+\.\d+\.\d+)$') { throw 'Release do Agent invalida.' }
$latestVersion = $Matches[1]
if (-not $CurrentVersion) {
  $CurrentVersion = (Get-Content (Join-Path $InstallDir 'package.json') -Raw | ConvertFrom-Json).version
}
if ((Compare-SemVer $latestVersion $CurrentVersion) -le 0) {
  return [pscustomobject]@{ updateAvailable = $false; currentVersion = $CurrentVersion; latestVersion = $latestVersion }
}

function Get-DeferredResult {
  param([object]$Health)
  $reason = if ($Health -and $Health.updateBlockedReason) { [string]$Health.updateBlockedReason } else { 'health_unavailable' }
  Add-UpdateHistory -PreviousVersion $CurrentVersion -NewVersion $latestVersion -Result 'deferred' -Detail $reason -Deduplicate
  return [pscustomobject]@{
    updateAvailable = $true
    installed = $false
    deferred = $true
    reason = $reason
    currentVersion = $CurrentVersion
    latestVersion = $latestVersion
  }
}

if (-not $VerifyOnly) {
  $health = Get-AgentHealth
  if (-not $health -or $health.updateBlocked) { return Get-DeferredResult -Health $health }
}

if ($Interactive -and -not $VerifyOnly) {
  $answer = [System.Windows.Forms.MessageBox]::Show("Nova versão do PrintFlow Agent disponível: $latestVersion`nVersão atual: $CurrentVersion`n`nDeseja atualizar agora?", 'PrintFlow Agent', 'YesNo', 'Information')
  if ($answer -ne 'Yes') {
    Add-UpdateHistory -PreviousVersion $CurrentVersion -NewVersion $latestVersion -Result 'declined' -Deduplicate
    return [pscustomobject]@{ updateAvailable = $true; installed = $false; currentVersion = $CurrentVersion; latestVersion = $latestVersion }
  }
}

if (-not $VerifyOnly) {
  $health = Get-AgentHealth
  if (-not $health -or $health.updateBlocked) { return Get-DeferredResult -Health $health }
}

$packageRoot = Join-Path $updatesRoot $latestVersion
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
$wanted = @('PrintFlow-Agent-Setup.exe', 'PrintFlow-Agent-Dev-Certificate.cer', 'RELEASE-METADATA.json', 'SHA256SUMS.txt')
$hashedArtifacts = @('PrintFlow-Agent-Setup.exe', 'PrintFlow-Agent-Dev-Certificate.cer', 'RELEASE-METADATA.json')
foreach ($name in $wanted) {
  $asset = @($release.assets | Where-Object { $_.name -eq $name })[0]
  if (-not $asset) { throw "Artefato ausente na release: $name" }
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile (Join-Path $packageRoot $name) -UseBasicParsing
}

$metadata = Get-Content (Join-Path $packageRoot 'RELEASE-METADATA.json') -Raw | ConvertFrom-Json
if (
  [string]$metadata.version -ne $latestVersion -or
  [string]$metadata.minimumSupportedVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or
  $metadata.signingMode -notin @('DEV_SELF_SIGNED', 'PRODUCTION_TRUSTED') -or
  $metadata.portableRuntime -ne $true -or
  [string]$metadata.nodeRuntimeVersion -notmatch '^24\.\d+\.\d+$' -or
  [string]$metadata.nodeRuntimeArchitecture -ne 'x64'
) { throw 'Manifesto da release invalido.' }
$verifiedNames = @{}
foreach ($line in Get-Content (Join-Path $packageRoot 'SHA256SUMS.txt')) {
  if ($line -notmatch '^([A-Fa-f0-9]{64})\s+(.+)$') { throw 'SHA256SUMS invalido.' }
  $name = Split-Path $Matches[2] -Leaf
  if ($name -notin $hashedArtifacts) { continue }
  $actual = (Get-FileHash (Join-Path $packageRoot $name) -Algorithm SHA256).Hash
  if ($actual -ne $Matches[1]) { throw "Hash divergente: $name" }
  $verifiedNames[$name] = $true
}
foreach ($name in $hashedArtifacts) {
  if (-not $verifiedNames.ContainsKey($name)) { throw "Hash ausente: $name" }
}
$signature = Get-AuthenticodeSignature (Join-Path $packageRoot 'PrintFlow-Agent-Setup.exe')
if (-not $signature.SignerCertificate) { throw 'Installer sem assinatura.' }
if ($signature.Status -ne 'Valid') { throw 'Assinatura do installer nao e confiavel neste computador. Instale o certificado oficial do Early Access.' }
$certificateHash = (Get-FileHash (Join-Path $packageRoot 'PrintFlow-Agent-Dev-Certificate.cer') -Algorithm SHA256).Hash
if ($metadata.certificateSha256 -and $certificateHash -ne [string]$metadata.certificateSha256) { throw 'Certificado do instalador nao corresponde ao manifesto.' }
$signerHash = ([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create().ComputeHash($signature.SignerCertificate.RawData)))).Replace('-', '')
if ($signerHash -ne $certificateHash) { throw 'Certificado do instalador nao corresponde ao manifesto.' }

if ($VerifyOnly) {
  return [pscustomobject]@{ updateAvailable = $true; verified = $true; installed = $false; currentVersion = $CurrentVersion; latestVersion = $latestVersion }
}

$applySource = Join-Path $PSScriptRoot 'apply-windows-agent-update.ps1'
if (-not (Test-Path -LiteralPath $applySource)) { throw 'Aplicador seguro da atualizacao nao encontrado.' }
$applyScript = Join-Path $packageRoot 'apply-windows-agent-update.ps1'
Copy-Item -LiteralPath $applySource -Destination $applyScript -Force
Add-UpdateHistory -PreviousVersion $CurrentVersion -NewVersion $latestVersion -Result 'started'

$installerPath = Join-Path $packageRoot 'PrintFlow-Agent-Setup.exe'
$arguments = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-WindowStyle', 'Hidden',
  '-File', "`"$applyScript`"",
  '-InstallerPath', "`"$installerPath`"",
  '-PreviousVersion', $CurrentVersion,
  '-NewVersion', $latestVersion,
  '-ParentProcessId', $PID
)
Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden

return [pscustomobject]@{ updateAvailable = $true; installed = $true; updateStarted = $true; currentVersion = $CurrentVersion; latestVersion = $latestVersion }
