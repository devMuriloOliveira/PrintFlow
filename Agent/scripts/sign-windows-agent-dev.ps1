param(
  [string]$FilePath = "dist\PrintFlow-Agent-Setup.exe",
  [string]$CertificateSubject = "CN=PrintFlow 3D Local Dev",
  [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$targetPath = [System.IO.Path]::GetFullPath((Join-Path $agentRoot $FilePath))

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
    -NotAfter (Get-Date).AddYears(3)

  $rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store(
    "Root",
    "CurrentUser"
  )
  $rootStore.Open("ReadWrite")
  $rootStore.Add($certificate)
  $rootStore.Close()

  $publisherStore = New-Object System.Security.Cryptography.X509Certificates.X509Store(
    "TrustedPublisher",
    "CurrentUser"
  )
  $publisherStore.Open("ReadWrite")
  $publisherStore.Add($certificate)
  $publisherStore.Close()

  Write-Host "Certificado local de desenvolvimento criado e confiado no usuario atual."
}

& $signTool sign `
  /sha1 $certificate.Thumbprint `
  /fd SHA256 `
  /tr $TimestampUrl `
  /td SHA256 `
  $targetPath

& $signTool verify `
  /pa `
  /v `
  $targetPath

Write-Host "Instalador assinado para teste local:"
Write-Host $targetPath
Write-Host "Thumbprint:"
Write-Host $certificate.Thumbprint
