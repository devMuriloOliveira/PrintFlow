export const certificateStoreScript = `
$ErrorActionPreference = 'Stop'
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($env:FILA_AGENT_E2E_CERTIFICATE_FILE)
$storeNames = @('Root', 'TrustedPublisher')
$addedStores = [System.Collections.Generic.List[string]]::new()

if ($env:FILA_AGENT_E2E_CERTIFICATE_ACTION -eq 'add') {
  try {
    foreach ($storeName in $storeNames) {
      $store = [System.Security.Cryptography.X509Certificates.X509Store]::new($storeName, [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser)
      try {
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        $exists = $store.Certificates.Find([System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $certificate.Thumbprint, $false).Count -gt 0
        if (-not $exists) {
          $store.Add($certificate)
          $addedStores.Add($storeName)
        }
        $verified = $store.Certificates.Find([System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $certificate.Thumbprint, $false).Count -gt 0
        if (-not $verified) { throw "Certificate trust was not visible in CurrentUser\\$storeName after adding" }
      } finally {
        $store.Close()
      }
    }
  } catch {
    $addError = $_
    $rollbackErrors = [System.Collections.Generic.List[string]]::new()
    foreach ($storeName in $addedStores) {
      $store = [System.Security.Cryptography.X509Certificates.X509Store]::new($storeName, [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser)
      try {
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        $store.Remove($certificate)
      } catch {
        $rollbackErrors.Add($_.Exception.Message)
      } finally {
        $store.Close()
      }
    }
    if ($rollbackErrors.Count -gt 0) { throw "Certificate trust failed: $($addError.Exception.Message); rollback failed: $($rollbackErrors -join '; ')" }
    throw $addError
  }
  [Console]::Out.WriteLine($addedStores -join ',')
} elseif ($env:FILA_AGENT_E2E_CERTIFICATE_ACTION -eq 'remove') {
  $removeErrors = [System.Collections.Generic.List[string]]::new()
  foreach ($storeName in ($env:FILA_AGENT_E2E_ADDED_STORES -split ',')) {
    if (-not $storeName) { continue }
    $store = [System.Security.Cryptography.X509Certificates.X509Store]::new($storeName, [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser)
    try {
      $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
      $store.Remove($certificate)
    } catch {
      $removeErrors.Add($_.Exception.Message)
    } finally {
      $store.Close()
    }
  }
  if ($removeErrors.Count -gt 0) { throw ($removeErrors -join '; ') }
} else {
  throw 'Unknown E2E certificate store action'
}
`
