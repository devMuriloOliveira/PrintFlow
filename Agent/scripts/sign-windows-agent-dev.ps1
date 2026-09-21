param(
  [string]$FilePath = "dist\PrintFlow-Agent-Setup.exe",
  [string]$CertificateSubject = "CN=PrintFlow 3D Local Dev",
  # O signtool do Windows requer o endpoint RFC 3161 DigiCert neste formato
  # HTTP; isso se aplica somente ao serviço de timestamp, nao ao endpoint da
  # API, que continua obrigatoriamente HTTPS.
  [string]$TimestampUrl = "http://timestamp.digicert.com",
  [string]$ExportPublicCertificatePath = "",
  [string]$CertificatePfxPath = "certs\PrintFlow-Agent-Dev-CodeSigning.pfx"
)

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$targetPath = [System.IO.Path]::GetFullPath((Join-Path $agentRoot $FilePath))
$pfxPath = [System.IO.Path]::GetFullPath((Join-Path $agentRoot $CertificatePfxPath))
$pfxPasswordText = $env:PRINTFLOW_AGENT_DEV_CERT_PASSWORD

if (-not $pfxPasswordText) {
  $pfxPasswordText = "printflow-agent-local-dev-only"
}

$pfxPassword = ConvertTo-SecureString $pfxPasswordText -AsPlainText -Force

function Find-SignTool {
  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $kitsRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (-not (Test-Path $kitsRoot)) {
    return $null
  }

  $candidates = Get-ChildItem `
    -LiteralPath $kitsRoot `
    -Filter signtool.exe `
    -Recurse `
    -ErrorAction SilentlyContinue |
    Where-Object {
      $_.FullName -match "\\x64\\signtool\.exe$"
    } |
    Sort-Object FullName -Descending

  return $candidates[0].FullName
}

if (-not (Test-Path $targetPath)) {
  throw "Arquivo para assinatura nao encontrado: $targetPath"
}

$signTool = Find-SignTool

if (-not $signTool) {
  throw "signtool.exe nao encontrado. Instale o Windows SDK e selecione o componente Windows SDK Signing Tools for Desktop Apps."
}

$certificate = $null

if (Test-Path $pfxPath) {
  Import-PfxCertificate `
    -FilePath $pfxPath `
    -CertStoreLocation Cert:\CurrentUser\My `
    -Password $pfxPassword | Out-Null

  Write-Host "Certificado local de desenvolvimento importado do PFX persistido."
}

$certificate = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object {
    $_.Subject -eq $CertificateSubject -and
    $_.HasPrivateKey -and
    $_.NotAfter -gt (Get-Date)
  } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if (-not $certificate) {
  $certificate = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $CertificateSubject `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -NotAfter (Get-Date).AddYears(3)

  Write-Host "Certificado local de desenvolvimento criado."
}

$pfxDir = Split-Path -Parent $pfxPath
if (-not (Test-Path $pfxDir)) {
  New-Item -ItemType Directory -Path $pfxDir | Out-Null
}

if (-not (Test-Path $pfxPath)) {
  try {
    Export-PfxCertificate `
      -Cert $certificate `
      -FilePath $pfxPath `
      -Password $pfxPassword | Out-Null

    Write-Host "Certificado local de desenvolvimento persistido em PFX privado local:"
    Write-Host $pfxPath
  } catch {
    Write-Warning ("Nao foi possivel exportar o PFX local. Builds futuros podem criar outro certificado se este sair do Windows: " + $_.Exception.Message)
  }
}

if ($ExportPublicCertificatePath) {
  $exportPath = [System.IO.Path]::GetFullPath((Join-Path $agentRoot $ExportPublicCertificatePath))
  $exportDir = Split-Path -Parent $exportPath

  if (-not (Test-Path $exportDir)) {
    New-Item -ItemType Directory -Path $exportDir | Out-Null
  }

  Export-Certificate `
    -Cert $certificate `
    -FilePath $exportPath `
    -Type CERT | Out-Null

  Write-Host "Certificado publico exportado para:"
  Write-Host $exportPath
}

& $signTool sign `
  /sha1 $certificate.Thumbprint `
  /fd SHA256 `
  /tr $TimestampUrl `
  /td SHA256 `
  $targetPath

$signExitCode = $LASTEXITCODE
if ($signExitCode -ne 0) {
  throw "signtool nao conseguiu assinar o instalador (exit code $signExitCode)."
}

& $signTool verify `
  /pa `
  /v `
  $targetPath

if ($LASTEXITCODE -ne 0) {
  Write-Warning "A assinatura DEV_SELF_SIGNED foi criada, mas o Windows nao confia na cadeia self-signed sem uma acao explicita do usuario."
}

Write-Host "Instalador assinado para teste local:"
Write-Host $targetPath
Write-Host "Thumbprint:"
Write-Host $certificate.Thumbprint

# A verificacao /pa pode retornar != 0 apenas porque o certificado e
# self-signed; isso e esperado no Early Access. O pipeline ja confirmou que
# a operacao de assinatura em si terminou com sucesso acima.
exit 0
