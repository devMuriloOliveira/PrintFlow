param(
  [Parameter(Mandatory = $true)]
  [string]$PackageDirectory,
  [string]$ExpectedVersion = "",
  [string]$ExpectedCertificateSha256 = "",
  [string]$InstallDir = "$env:LOCALAPPDATA\PrintFlowAgent",
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
$packageRoot = (Resolve-Path -LiteralPath $PackageDirectory).Path
$verifier = Join-Path $PSScriptRoot "verify-agent-update.mjs"
$installRoot = [System.IO.Path]::GetFullPath($InstallDir)
$rollbackRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("PrintFlowAgent-Rollback-" + [guid]::NewGuid().ToString("N"))
$binaryItems = @(
  "assets",
  "node_modules",
  "scripts",
  "src",
  "package.json",
  "package-lock.json",
  "README.md"
)

function Save-AgentBinaryBackup {
  if (-not (Test-Path -LiteralPath $installRoot)) {
    return $false
  }

  New-Item -ItemType Directory -Path $rollbackRoot -Force | Out-Null
  foreach ($item in $binaryItems) {
    $source = Join-Path $installRoot $item
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination $rollbackRoot -Recurse -Force
    }
  }

  return $true
}

function Restore-AgentBinaryBackup {
  if (-not (Test-Path -LiteralPath $rollbackRoot)) {
    return
  }

  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  foreach ($item in $binaryItems) {
    $target = Join-Path $installRoot $item
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Recurse -Force
    }

    $backup = Join-Path $rollbackRoot $item
    if (Test-Path -LiteralPath $backup) {
      Copy-Item -LiteralPath $backup -Destination $installRoot -Recurse -Force
    }
  }
}

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
$signerHash = ([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create().ComputeHash($signature.SignerCertificate.RawData)))).Replace('-', '')
if ($certificateHash -ne $signerHash) {
  throw "O certificado do instalador nao corresponde ao certificado publicado."
}

$confirmation = Read-Host "Digite INSTALAR para abrir o instalador validado"
if ($confirmation -cne "INSTALAR") {
  throw "Instalacao cancelada pelo operador."
}

$backupCreated = Save-AgentBinaryBackup
try {
  $installerProcess = Start-Process -FilePath $installer -Wait -PassThru
  if ($installerProcess.ExitCode -ne 0) {
    throw "O instalador retornou exit code $($installerProcess.ExitCode)."
  }

  Write-Host "Instalador concluido. O estado local do Agent nao foi removido por este script."
} catch {
  if ($backupCreated) {
    Write-Warning "Falha no upgrade; restaurando os binarios anteriores."
    Restore-AgentBinaryBackup
    Write-Host "Rollback dos binarios concluido. Dados locais nao foram tocados."
  }

  throw
} finally {
  if (Test-Path -LiteralPath $rollbackRoot) {
    Remove-Item -LiteralPath $rollbackRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
