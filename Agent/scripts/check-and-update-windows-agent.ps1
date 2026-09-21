param(
  [string]$CurrentVersion = '',
  [string]$InstallDir = "$env:LOCALAPPDATA\PrintFlowAgent",
  [switch]$Interactive
)

$ErrorActionPreference = 'Stop'
$null = Add-Type -AssemblyName System.Windows.Forms
$releaseApi = 'https://api.github.com/repos/devMuriloOliveira/PrintFlow/releases/latest'
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('PrintFlowAgentUpdate-' + [guid]::NewGuid().ToString('N'))

function Compare-SemVer([string]$left, [string]$right) {
  return ([version]$left).CompareTo([version]$right)
}

try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
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

  $wanted = @('PrintFlow-Agent-Setup.exe', 'PrintFlow-Agent-Dev-Certificate.cer', 'RELEASE-METADATA.json', 'SHA256SUMS.txt')
  foreach ($name in $wanted) {
    $asset = @($release.assets | Where-Object { $_.name -eq $name })[0]
    if (-not $asset) { throw "Artefato ausente na release: $name" }
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile (Join-Path $tempRoot $name) -UseBasicParsing
  }

  $metadata = Get-Content (Join-Path $tempRoot 'RELEASE-METADATA.json') -Raw | ConvertFrom-Json
  if ([string]$metadata.version -ne $latestVersion -or $metadata.signingMode -notin @('DEV_SELF_SIGNED', 'PRODUCTION_TRUSTED')) { throw 'Manifesto da release invalido.' }
  $verifiedNames = @{}
  foreach ($line in Get-Content (Join-Path $tempRoot 'SHA256SUMS.txt')) {
    if ($line -notmatch '^([A-Fa-f0-9]{64})\s+(.+)$') { throw 'SHA256SUMS invalido.' }
    $name = Split-Path $Matches[2] -Leaf
    if ($name -notin $wanted) { continue }
    $actual = (Get-FileHash (Join-Path $tempRoot $name) -Algorithm SHA256).Hash
    if ($actual -ne $Matches[1]) { throw "Hash divergente: $name" }
    $verifiedNames[$name] = $true
  }
  foreach ($name in $wanted) {
    if (-not $verifiedNames.ContainsKey($name)) { throw "Hash ausente: $name" }
  }
  $signature = Get-AuthenticodeSignature (Join-Path $tempRoot 'PrintFlow-Agent-Setup.exe')
  if ($signature.Status -eq 'NotSigned' -or -not $signature.SignerCertificate) { throw 'Installer sem assinatura.' }
  if ($metadata.signingMode -eq 'PRODUCTION_TRUSTED' -and $signature.Status -ne 'Valid') { throw 'Assinatura Production Trusted invalida.' }
  $signerHash = [Convert]::ToHexString(([Security.Cryptography.SHA256]::Create().ComputeHash($signature.SignerCertificate.RawData)))
  $certificateHash = (Get-FileHash (Join-Path $tempRoot 'PrintFlow-Agent-Dev-Certificate.cer') -Algorithm SHA256).Hash
  if (($metadata.certificateSha256 -and $certificateHash -ne [string]$metadata.certificateSha256) -or $signerHash -ne $certificateHash) { throw 'Certificado do instalador nao corresponde ao manifesto.' }

  if ($Interactive) {
    $answer = [System.Windows.Forms.MessageBox]::Show("Nova versão do PrintFlow Agent disponível: $latestVersion`nVersão atual: $CurrentVersion`n`nDeseja atualizar agora?", 'PrintFlow Agent', 'YesNo', 'Information')
    if ($answer -ne 'Yes') { return [pscustomobject]@{ updateAvailable = $true; installed = $false; currentVersion = $CurrentVersion; latestVersion = $latestVersion } }
  }
  Start-Process -FilePath (Join-Path $tempRoot 'PrintFlow-Agent-Setup.exe')
  return [pscustomobject]@{ updateAvailable = $true; installed = $true; currentVersion = $CurrentVersion; latestVersion = $latestVersion }
} finally {
  if (Test-Path $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
