param(
  [string]$CertificatePath = "",
  [ValidateSet("CurrentUser", "LocalMachine")]
  [string]$Scope = "CurrentUser"
)

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

if (-not $CertificatePath) {
  $CertificatePath = Join-Path $agentRoot "dist\PrintFlow-Agent-Dev-Certificate.cer"
}

$resolvedCertificatePath = [System.IO.Path]::GetFullPath($CertificatePath)

if (-not (Test-Path $resolvedCertificatePath)) {
  throw "Certificado nao encontrado: $resolvedCertificatePath"
}

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)

  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Use -Scope CurrentUser ou execute o PowerShell como administrador para usar -Scope LocalMachine."
  }
}

if ($Scope -eq "LocalMachine") {
  Assert-Administrator
}

$certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
  $resolvedCertificatePath
)

$rootStore = [System.Security.Cryptography.X509Certificates.X509Store]::new(
  "Root",
  $Scope
)
$publisherStore = [System.Security.Cryptography.X509Certificates.X509Store]::new(
  "TrustedPublisher",
  $Scope
)

try {
  $rootStore.Open("ReadWrite")
  $rootStore.Add($certificate)
} finally {
  $rootStore.Close()
}

try {
  $publisherStore.Open("ReadWrite")
  $publisherStore.Add($certificate)
} finally {
  $publisherStore.Close()
}

Write-Host "Certificado de teste do PrintFlow Agent confiado em $Scope."
Write-Host "Thumbprint:"
Write-Host $certificate.Thumbprint
