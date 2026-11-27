export const certificateStoreScript = `
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Temporary certificate trust is restricted to a disposable GitHub-hosted runner' }
$expectedCertificateSha256 = 'AC55382179B1B6FF5D7642083ED1E674DC92793FF83B55F151C0F8DA0F9C7DBB'
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($env:FILA_AGENT_E2E_CERTIFICATE_FILE)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $certificateSha256 = [BitConverter]::ToString($sha256.ComputeHash($certificate.RawData)).Replace('-', '')
} finally {
  $sha256.Dispose()
}
if ($certificateSha256 -ne $expectedCertificateSha256) { throw 'E2E certificate does not match the pinned Early Access SHA-256 identity' }
$storeNames = @('Root', 'TrustedPublisher')
$addedStores = [System.Collections.Generic.List[string]]::new()

function assertAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Temporary LocalMachine certificate trust requires an elevated disposable runner'
  }
}

if ($env:FILA_AGENT_E2E_CERTIFICATE_ACTION -eq 'add') {
  assertAdministrator
  try {
    foreach ($storeName in $storeNames) {
      $storePath = "Cert:\\LocalMachine\\$storeName"
      $certificatePath = Join-Path $storePath $certificate.Thumbprint
      [Console]::Error.WriteLine("certificate-store: inspect $storePath")
      if (-not (Test-Path -LiteralPath $certificatePath)) {
        [Console]::Error.WriteLine("certificate-store: import $storeName")
        Import-Certificate -FilePath $env:FILA_AGENT_E2E_CERTIFICATE_FILE -CertStoreLocation $storePath -ErrorAction Stop | Out-Null
        $addedStores.Add($storeName)
      }
      if (-not (Test-Path -LiteralPath $certificatePath)) { throw "Certificate trust was not visible in LocalMachine\\$storeName after import" }
    }
  } catch {
    $addError = $_
    foreach ($storeName in $addedStores) {
      $certificatePath = "Cert:\\LocalMachine\\$storeName\\$($certificate.Thumbprint)"
      if (Test-Path -LiteralPath $certificatePath) { Remove-Item -LiteralPath $certificatePath -Force -ErrorAction SilentlyContinue }
    }
    throw $addError
  }
  [Console]::Out.WriteLine($addedStores -join ',')
} elseif ($env:FILA_AGENT_E2E_CERTIFICATE_ACTION -eq 'remove') {
  assertAdministrator
  foreach ($storeName in ($env:FILA_AGENT_E2E_ADDED_STORES -split ',')) {
    if (-not $storeName) { continue }
    if ($storeNames -notcontains $storeName) { throw "Refusing to remove an unapproved certificate store: $storeName" }
    $certificatePath = "Cert:\\LocalMachine\\$storeName\\$($certificate.Thumbprint)"
    [Console]::Error.WriteLine("certificate-store: remove $certificatePath")
    if (Test-Path -LiteralPath $certificatePath) { Remove-Item -LiteralPath $certificatePath -Force -ErrorAction Stop }
  }
} else {
  throw 'Unknown E2E certificate store action'
}
`
