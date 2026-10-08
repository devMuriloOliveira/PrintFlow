param(
  [Parameter(Mandatory = $true)][string]$Tag,
  [string]$Repository = $env:GITHUB_REPOSITORY
)

$ErrorActionPreference = 'Stop'
if ($Tag -notmatch '^agent-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Tag do Agent invalida.' }
if (-not $Repository) { throw 'Repositorio GitHub obrigatorio.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$dist = Join-Path $projectRoot 'Agent\dist'
$files = @('PrintFlow-Agent-Windows.zip', 'PrintFlow-Agent-Setup.exe', 'PrintFlow-Agent-Transition-Setup.exe', 'PrintFlow-Agent-Dev-Certificate.cer', 'RELEASE-METADATA.json', 'SHA256SUMS.txt')

try {
  # Windows PowerShell converts native stderr into errors even for an expected 404.
  $ErrorActionPreference = 'Continue'
  $releaseOutput = & gh release view $Tag --repo $Repository --json tagName,isDraft,assets 2>&1
  $queryExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = 'Stop'
}
if ($queryExitCode -eq 0) {
  $release = ($releaseOutput -join "`n") | ConvertFrom-Json
  if ($release.tagName -ne $Tag -or $release.isDraft) { throw 'Release existente nao esta publicada com a tag esperada.' }
  foreach ($file in $files) {
    if (-not @($release.assets | Where-Object name -eq $file).Count) { throw "Release existente incompleta: $file ausente." }
  }
  $temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $downloadRoot = Join-Path $temporaryBase ('PrintFlow-existing-release-' + [guid]::NewGuid().ToString('N'))
  try {
    $downloadArgs = @('release', 'download', $Tag, '--repo', $Repository, '--dir', $downloadRoot)
    foreach ($file in $files) { $downloadArgs += @('--pattern', $file) }
    & gh @downloadArgs
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel verificar os artefatos da release existente.' }
    $metadata = Get-Content -LiteralPath (Join-Path $downloadRoot 'RELEASE-METADATA.json') -Raw | ConvertFrom-Json
    if ($metadata.tag -ne $Tag -or $metadata.version -ne $Tag.Substring(7)) { throw 'Manifesto da release existente diverge da tag.' }
    & node (Join-Path $projectRoot 'scripts\validate-agent-release-artifacts.mjs') "--dist=$downloadRoot"
    if ($LASTEXITCODE -ne 0) { throw 'Release existente falhou na verificacao de integridade.' }
    $signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $downloadRoot 'PrintFlow-Agent-Setup.exe')
    if (-not $signature.SignerCertificate -or $signature.Status -in @('HashMismatch', 'NotSigned')) { throw 'Assinatura da release existente invalida.' }
    $certificateHash = (Get-FileHash -LiteralPath (Join-Path $downloadRoot 'PrintFlow-Agent-Dev-Certificate.cer') -Algorithm SHA256).Hash
    $signerHash = [BitConverter]::ToString(([Security.Cryptography.SHA256]::Create().ComputeHash($signature.SignerCertificate.RawData))).Replace('-', '')
    if ($signerHash -ne $certificateHash) { throw 'Assinante da release existente diverge do certificado publicado.' }
    Write-Host "Release $Tag ja publicada e validada; artefatos preservados."
  } finally {
    if (-not ([IO.Path]::GetFullPath($downloadRoot)).StartsWith($temporaryBase.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Diretorio temporario inesperado.' }
    if (Test-Path -LiteralPath $downloadRoot) { Remove-Item -LiteralPath $downloadRoot -Recurse -Force }
  }
  return
}

if (($releaseOutput -join "`n") -notmatch 'release not found') {
  throw 'Nao foi possivel consultar a release; publicacao cancelada.'
}

$artifactPaths = @($files | ForEach-Object { Join-Path $dist $_ })
& gh release create $Tag @artifactPaths --repo $Repository --verify-tag `
  --title "PrintFlow Agent $Tag - Early Access / Pilot" `
  --notes 'signingMode=DEV_SELF_SIGNED. Instale conscientemente PrintFlow-Agent-Dev-Certificate.cer em Trusted Root e Trusted Publishers antes do instalador. O certificado permanece o mesmo entre atualizacoes Early Access. PRODUCTION_TRUSTED permanece pendente de certificado Code Signing confiavel.'
if ($LASTEXITCODE -ne 0) { throw 'Publicacao da release falhou.' }
