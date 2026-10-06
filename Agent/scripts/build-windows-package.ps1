param(
  [string]$OutputDir = "dist",
  [string]$PackageName = "PrintFlow-Agent-Windows",
  [string]$InstallerName = "PrintFlow-Agent-Setup",
  [string]$ApiUrl = "https://printflow-api-4y5l.onrender.com",
  [string]$NodeRuntimeVersion = "24.19.0",
  [switch]$SignDev,
  [switch]$RequirePersistedCertificate,
  [switch]$SkipOuterSignature,
  [switch]$SkipInstall,
  [switch]$TestPackage
)

$ErrorActionPreference = "Stop"

$apiUri = [Uri]$ApiUrl
if ($apiUri.Scheme -ne "https" -or $apiUri.Host -in @("localhost", "127.0.0.1", "0.0.0.0", "::1")) {
  throw "O pacote Windows exige PRINTFLOW_API_URL HTTPS publico; localhost nao pode ser empacotado como Production."
}

$agentRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$outputRoot = Join-Path $agentRoot $OutputDir
$stageRoot = Join-Path $outputRoot $PackageName
$zipPath = Join-Path $outputRoot "$PackageName.zip"
$installerSourceRoot = Join-Path $outputRoot "$InstallerName-source"
$installerPath = Join-Path $outputRoot "$InstallerName.exe"
$installerSedPath = Join-Path $outputRoot "$InstallerName.sed"
$devCertificatePath = Join-Path $outputRoot "PrintFlow-Agent-Dev-Certificate.cer"
$packageVersion = [string]((Get-Content -LiteralPath (Join-Path $agentRoot "package.json") -Raw | ConvertFrom-Json).version)
$devCertificateSha256 = ""

if ($TestPackage -and ($PackageName -notmatch '(?i)test' -or $InstallerName -notmatch '(?i)test')) {
  throw "Pacotes sem validacao OrcaSlicer precisam usar nomes explicitos de teste."
}

if ($packageVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "Versao do Agent invalida no package.json."
}

Set-Location $agentRoot

if ($SignDev) {
  & (Join-Path $agentRoot "scripts\sign-windows-agent-dev.ps1") `
    -FilePath "package.json" `
    -ExportPublicCertificatePath (Join-Path $OutputDir "PrintFlow-Agent-Dev-Certificate.cer") `
    -RequirePersistedCertificate:$RequirePersistedCertificate `
    -ExportOnly
  $devCertificateSha256 = (Get-FileHash -LiteralPath $devCertificatePath -Algorithm SHA256).Hash.ToUpperInvariant()
}

$buildNodeCommand = Get-Command "node.exe" -ErrorAction Stop
$buildNodeExecutable = $buildNodeCommand.Source
$buildNodeVersion = (& $buildNodeExecutable --version).Trim().TrimStart('v')
$buildNodeArchitecture = (& $buildNodeExecutable -p "process.arch").Trim()

if ($buildNodeVersion -ne $NodeRuntimeVersion) {
  throw "O build exige Node.js $NodeRuntimeVersion; encontrado $buildNodeVersion."
}

if ($buildNodeArchitecture -ne "x64") {
  throw "O pacote Windows atual exige runtime Node.js x64; encontrado $buildNodeArchitecture."
}

if (-not $SkipInstall) {
  npm ci --omit=dev
}

node scripts/generate-windows-icon.js
& (Join-Path $agentRoot "scripts\build-windows-host.ps1")
& (Join-Path $agentRoot "scripts\build-windows-setup.ps1")

$hostBuildRoot = Join-Path $agentRoot "artifacts\windows-host"
$hostExecutable = Join-Path $hostBuildRoot "PrintFlowAgentHost.exe"
$hostManifest = Join-Path $hostBuildRoot "host-version.json"
if (-not (Test-Path -LiteralPath $hostExecutable) -or -not (Test-Path -LiteralPath $hostManifest)) {
  throw "O host Windows nativo nao foi gerado."
}

$hostMetadata = Get-Content -LiteralPath $hostManifest -Raw | ConvertFrom-Json
if ([string]$hostMetadata.agentVersion -ne $packageVersion -or [string]$hostMetadata.hostVersion -ne $packageVersion) {
  throw "A versao do host Windows nao corresponde a versao do Agent."
}

if (Test-Path $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $stageRoot | Out-Null

$items = @(
  "assets",
  "node_modules",
  "scripts",
  "src",
  "legal",
  "package.json",
  "package-lock.json",
  "README.md"
)

foreach ($item in $items) {
  $source = Join-Path $agentRoot $item
  if (Test-Path $source) {
    Copy-Item -LiteralPath $source -Destination $stageRoot -Recurse -Force
  }
}

$runtimeRoot = Join-Path $stageRoot "runtime"
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$runtimeNodePath = Join-Path $runtimeRoot "node.exe"
Copy-Item -LiteralPath $buildNodeExecutable -Destination $runtimeNodePath -Force

$runtimeLicensePath = Join-Path $runtimeRoot "LICENSE.node.txt"
$nodeRuntimeDirectory = Split-Path $buildNodeExecutable -Parent
$localLicenseCandidates = @(
  (Join-Path $nodeRuntimeDirectory "LICENSE.node.txt"),
  (Join-Path $nodeRuntimeDirectory "LICENSE"),
  (Join-Path $nodeRuntimeDirectory "LICENSE.txt"),
  (Join-Path $agentRoot "licenses\NODE-LICENSE.txt")
)
$localLicense = $localLicenseCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $localLicense) {
  $cachedRuntimeRoot = Join-Path $agentRoot "dist\PrintFlow-Agent-Windows\runtime"
  $cachedRuntimeMetadataPath = Join-Path $cachedRuntimeRoot "runtime.json"
  $cachedRuntimeNodePath = Join-Path $cachedRuntimeRoot "node.exe"
  $cachedRuntimeLicensePath = Join-Path $cachedRuntimeRoot "LICENSE.node.txt"

  if (
    (Test-Path -LiteralPath $cachedRuntimeMetadataPath) -and
    (Test-Path -LiteralPath $cachedRuntimeNodePath) -and
    (Test-Path -LiteralPath $cachedRuntimeLicensePath)
  ) {
    $cachedRuntimeMetadata = Get-Content -LiteralPath $cachedRuntimeMetadataPath -Raw | ConvertFrom-Json
    $cachedRuntimeHash = (Get-FileHash -LiteralPath $cachedRuntimeNodePath -Algorithm SHA256).Hash.ToUpperInvariant()
    $cachedLicenseLength = (Get-Item -LiteralPath $cachedRuntimeLicensePath).Length

    if (
      [string]$cachedRuntimeMetadata.version -eq $buildNodeVersion -and
      [string]$cachedRuntimeMetadata.sha256 -eq $cachedRuntimeHash -and
      $cachedLicenseLength -ge 1000
    ) {
      $localLicense = $cachedRuntimeLicensePath
      Write-Host "Usando a licenca Node.js do pacote local validado ($buildNodeVersion)."
    }
  }
}

Copy-Item -LiteralPath $hostBuildRoot -Destination (Join-Path $stageRoot "host") -Recurse -Force

if ($localLicense) {
  Copy-Item -LiteralPath $localLicense -Destination $runtimeLicensePath -Force
} else {
  Invoke-WebRequest `
    -Uri "https://raw.githubusercontent.com/nodejs/node/v$NodeRuntimeVersion/LICENSE" `
    -OutFile $runtimeLicensePath `
    -UseBasicParsing
}

if (-not (Test-Path -LiteralPath $runtimeLicensePath) -or (Get-Item -LiteralPath $runtimeLicensePath).Length -lt 1000) {
  throw "Licenca do runtime Node.js nao foi incluida no pacote."
}

$runtimeHash = (Get-FileHash -LiteralPath $runtimeNodePath -Algorithm SHA256).Hash.ToUpperInvariant()
[ordered]@{
  version = $buildNodeVersion
  architecture = $buildNodeArchitecture
  sha256 = $runtimeHash
  source = "actions/setup-node"
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot "runtime.json") -Encoding UTF8

Push-Location $stageRoot
try {
  & $runtimeNodePath --check "src/index.js"
  if ($LASTEXITCODE -ne 0) {
    throw "O entrypoint falhou no runtime Node.js empacotado."
  }

  & $runtimeNodePath -e "Promise.all([import('node:sqlite'), import('serialport')]).catch(error => { console.error(error); process.exit(1) })"
  if ($LASTEXITCODE -ne 0) {
    throw "Dependencias nativas falharam no runtime Node.js empacotado."
  }
  if (-not $TestPackage) {
    & (Join-Path $agentRoot "scripts\ensure-orca-slicer.ps1")
    & $runtimeNodePath "scripts/verify-orca-runtime.mjs"
    if ($LASTEXITCODE -ne 0) {
      throw "OrcaSlicer oficial Store nao passou no fatiamento real; release bloqueada."
    }
  }
} finally {
  Pop-Location
}

Get-ChildItem -LiteralPath $stageRoot -Recurse -File |
  Where-Object { $_.Extension -in @('.ps1', '.psm1', '.vbs') } |
  Remove-Item -Force

if ($SignDev) {
  $testSigner = Join-Path $agentRoot "scripts\sign-windows-agent-dev.ps1"
  $windowsRuntimeBinaries = @(
    (Join-Path $stageRoot "host\PrintFlowAgentHost.exe"),
    (Join-Path $stageRoot "node_modules\@serialport\bindings-cpp\prebuilds\win32-x64\@serialport+bindings-cpp.node")
  )
  foreach ($binary in $windowsRuntimeBinaries) {
    if (-not (Test-Path -LiteralPath $binary)) { throw "Binario nativo do Agent ausente: $binary" }
    $relativeBinaryPath = $binary.Substring($agentRoot.Path.TrimEnd('\').Length + 1)
    & $testSigner -FilePath $relativeBinaryPath -RequirePersistedCertificate
  }
}

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $zipPath -Force

if (Test-Path $installerSourceRoot) {
  Remove-Item -LiteralPath $installerSourceRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $installerSourceRoot | Out-Null

$nativeSetup = Join-Path $agentRoot "artifacts\windows-setup\PrintFlowAgentSetup.exe"
$nativeSetupName = "PrintFlowAgentSetup.exe"
$installerZipName = "$PackageName.zip"
$installerIcon = Join-Path $agentRoot "assets\printflow-agent-icon.ico"
$installerIconName = "printflow-agent-icon.ico"

if ($SignDev) {
  & (Join-Path $agentRoot "scripts\sign-windows-agent-dev.ps1") `
    -FilePath "artifacts\windows-setup\PrintFlowAgentSetup.exe" `
    -RequirePersistedCertificate
}

Copy-Item -LiteralPath $zipPath -Destination (Join-Path $installerSourceRoot $installerZipName) -Force
Copy-Item -LiteralPath $nativeSetup -Destination (Join-Path $installerSourceRoot $nativeSetupName) -Force
Copy-Item -LiteralPath $installerIcon -Destination (Join-Path $installerSourceRoot $installerIconName) -Force
if ($SignDev) {
  Copy-Item -LiteralPath $devCertificatePath -Destination (Join-Path $installerSourceRoot "PrintFlow-Agent-Dev-Certificate.cer") -Force
}

if (Test-Path $installerPath) {
  Remove-Item -LiteralPath $installerPath -Force
}

if (Test-Path $installerSedPath) {
  Remove-Item -LiteralPath $installerSedPath -Force
}

# SED paths use normal Windows separators; escaping them doubles the path and
# can make IExpress wait indefinitely while resolving the target/source.
$escapedInstallerPath = $installerPath
$escapedSourceRoot = $installerSourceRoot
$appLaunched = "$nativeSetupName --install-package $installerZipName --api-url $ApiUrl"
$certificateSedFile = if ($SignDev) { "FILE5=PrintFlow-Agent-Dev-Certificate.cer" } else { "" }
$certificateSedSource = if ($SignDev) { "%FILE5%=" } else { "" }

$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AppLaunched%
UserQuietInstCmd=%AppLaunched%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$escapedInstallerPath
FriendlyName=PrintFlow Agent Setup
AppLaunched=$appLaunched
PostInstallCmd=<None>
FILE0=$installerZipName
FILE1=$installerIconName
FILE2=$nativeSetupName
$certificateSedFile
[SourceFiles]
SourceFiles0=$escapedSourceRoot
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
$certificateSedSource
"@

Set-Content -LiteralPath $installerSedPath -Value $sed -Encoding ASCII

$iexpressPath = Join-Path $env:WINDIR "System32\iexpress.exe"
$iexpressProcess = Start-Process `
  -FilePath $iexpressPath `
  -ArgumentList @('/N', '/Q', $installerSedPath) `
  -WindowStyle Hidden `
  -PassThru

$buildDeadline = [DateTime]::UtcNow.AddMinutes(15)
while (
  [DateTime]::UtcNow -lt $buildDeadline -and
  (
    -not (Test-Path $installerPath) -or
    (Get-Item -LiteralPath $installerPath -ErrorAction SilentlyContinue).Length -lt 1048576
  )
) {
  Start-Sleep -Milliseconds 500
}

if (-not (Test-Path $installerPath) -or (Get-Item -LiteralPath $installerPath).Length -lt 1048576) {
  if (-not $iexpressProcess.HasExited) {
    Stop-Process -Id $iexpressProcess.Id -Force -ErrorAction SilentlyContinue
  }
  throw "IExpress nao concluiu o payload do instalador dentro do prazo."
}

if (-not $iexpressProcess.HasExited) {
  # O arquivo ja atingiu o tamanho esperado; o IExpress pode permanecer vivo
  # depois de escrever o artefato, entao encerramos apenas agora.
  Stop-Process -Id $iexpressProcess.Id -Force -ErrorAction SilentlyContinue
}

$installerSizeBeforeIcon = (Get-Item -LiteralPath $installerPath).Length
& (Join-Path $agentRoot 'scripts\set-windows-executable-icon.ps1') `
  -ExecutablePath $installerPath `
  -IconPath $installerIcon
$installerSizeAfterIcon = (Get-Item -LiteralPath $installerPath).Length
if ($installerSizeAfterIcon -lt [Math]::Max(1048576, [Math]::Floor($installerSizeBeforeIcon * 0.8))) {
  throw 'A aplicacao do icone truncou o payload do instalador.'
}

if ($SignDev) {
  # IExpress stores the payload in an overlay. Some signtool versions
  # truncate that overlay when signing the outer self-extracting executable.
  # Keep the complete unsigned package if signing would destroy the payload.
  $unsignedInstallerPath = "$installerPath.unsigned"
  Copy-Item -LiteralPath $installerPath -Destination $unsignedInstallerPath -Force
  & (Join-Path $agentRoot "scripts\sign-windows-agent-dev.ps1") `
    -FilePath (Join-Path $OutputDir "$InstallerName.exe") `
    -ExportPublicCertificatePath (Join-Path $OutputDir "PrintFlow-Agent-Dev-Certificate.cer") `
    -RequirePersistedCertificate:$RequirePersistedCertificate `
    -ExportOnly:$SkipOuterSignature

  $unsignedSize = (Get-Item -LiteralPath $unsignedInstallerPath).Length
  $signedSize = (Get-Item -LiteralPath $installerPath).Length
  if ($signedSize -lt [Math]::Max(1048576, [Math]::Floor($unsignedSize * 0.8))) {
    Copy-Item -LiteralPath $unsignedInstallerPath -Destination $installerPath -Force
    Remove-Item -LiteralPath $unsignedInstallerPath -Force -ErrorAction SilentlyContinue
    throw "A assinatura truncou o payload do IExpress; a release sem assinatura foi bloqueada."
  }
  Remove-Item -LiteralPath $unsignedInstallerPath -Force -ErrorAction SilentlyContinue

  if (-not $SkipOuterSignature) {
    $signature = Get-AuthenticodeSignature -LiteralPath $installerPath
    $publicCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($devCertificatePath)
    if (-not $signature.SignerCertificate) {
      throw "Instalador permaneceu sem assinatura Authenticode."
    }
    if ($signature.SignerCertificate.Thumbprint -ne $publicCertificate.Thumbprint) {
      throw "Assinatura do instalador nao corresponde ao certificado publico exportado."
    }
    if ($signature.Status -in @('HashMismatch', 'NotSigned')) {
      throw "Assinatura Authenticode invalida: $($signature.Status)."
    }
  }

  Write-Host "Certificado publico de teste:"
  Write-Host $devCertificatePath
}

Write-Host "Pacote Windows gerado:"
Write-Host $zipPath
Write-Host "Instalador Windows gerado:"
Write-Host $installerPath
