param(
  [Parameter(Mandatory = $true)]
  [string]$PackageDirectory,
  [string]$ExpectedVersion = "",
  [string]$ExpectedCertificateSha256 = "",
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
$packageRoot = (Resolve-Path -LiteralPath $PackageDirectory).Path
$verifier = Join-Path $PSScriptRoot "verify-agent-update.mjs"
if (-not (Test-Path -LiteralPath $verifier)) {
  throw "Verificador da atualizacao nao encontrado no pacote."
}

$arguments = @(
  $verifier,
  "--dist=$packageRoot"
)
if ($ExpectedVersion) { $arguments += "--expected-version=$ExpectedVersion" }
if ($ExpectedCertificateSha256) { $arguments += "--expected-certificate-sha256=$ExpectedCertificateSha256" }

& node @arguments
if ($LASTEXITCODE -ne 0) {
  throw "O pacote de atualizacao nao passou na verificacao de integridade."
}

if (-not $Apply) {
  Write-Host "Pacote validado. Nenhuma instalacao foi executada. Use -Apply e confirme explicitamente para iniciar o instalador."
  exit 0
}

$installer = Join-Path $packageRoot "PrintFlow-Agent-Setup.exe"
if (-not (Test-Path -LiteralPath $installer)) {
  throw "Instalador Windows nao encontrado no pacote."
}

$metadata = Get-Content -LiteralPath (Join-Path $packageRoot "RELEASE-METADATA.json") -Raw | ConvertFrom-Json
$signature = Get-AuthenticodeSignature -FilePath $installer
if ($signature.Status -eq "NotSigned" -or -not $signature.SignerCertificate) {
  throw "O instalador nao possui assinatura Authenticode verificavel."
}
if ($metadata.signingMode -eq "PRODUCTION_TRUSTED" -and $signature.Status -ne "Valid") {
  throw "A release PRODUCTION_TRUSTED nao possui assinatura confiavel."
}
$certificatePath = Join-Path $packageRoot "PrintFlow-Agent-Dev-Certificate.cer"
if (-not (Test-Path -LiteralPath $certificatePath)) {
  throw "Certificado publico da release nao encontrado."
}
$certificateHash = (Get-FileHash -LiteralPath $certificatePath -Algorithm SHA256).Hash.ToUpperInvariant()
$signerHash = [Convert]::ToHexString(([Security.Cryptography.SHA256]::Create().ComputeHash($signature.SignerCertificate.RawData)))
if ($certificateHash -ne $signerHash) {
  throw "O certificado do instalador nao corresponde ao certificado publicado."
}

$confirmation = Read-Host "Digite INSTALAR para abrir o instalador validado"
if ($confirmation -cne "INSTALAR") {
  throw "Instalacao cancelada pelo operador."
}

Start-Process -FilePath $installer -Wait
Write-Host "Instalador concluido. O estado local do Agent nao foi removido por este script."
