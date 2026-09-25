param(
  [string]$OutputDir = "dist",
  [string]$PackageName = "PrintFlow-Agent-Windows",
  [string]$InstallerName = "PrintFlow-Agent-Setup",
  [string]$ApiUrl = "https://printflow-api-4y5l.onrender.com",
  [string]$NodeRuntimeVersion = "24.19.0",
  [switch]$SignDev,
  [switch]$RequirePersistedCertificate,
  [switch]$SkipOuterSignature,
  [switch]$SkipInstall
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

Set-Location $agentRoot

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

if (Test-Path $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $stageRoot | Out-Null

$items = @(
  "assets",
  "node_modules",
  "scripts",
  "src",
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
$localLicenseCandidates = @(
  (Join-Path (Split-Path $buildNodeExecutable -Parent) "LICENSE"),
  (Join-Path (Split-Path $buildNodeExecutable -Parent) "LICENSE.txt")
)
$localLicense = $localLicenseCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

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
} finally {
  Pop-Location
}

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $zipPath -Force

if (Test-Path $installerSourceRoot) {
  Remove-Item -LiteralPath $installerSourceRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $installerSourceRoot | Out-Null

$installerBootstrap = Join-Path $agentRoot "scripts\install-windows-agent-from-package.ps1"
$installerBootstrapName = "install-windows-agent-from-package.ps1"
$installerLauncherName = "install-windows-agent.vbs"
$installerZipName = "$PackageName.zip"
$installerIcon = Join-Path $agentRoot "assets\printflow-agent-icon.ico"
$installerIconName = "printflow-agent-icon.ico"

Copy-Item -LiteralPath $zipPath -Destination (Join-Path $installerSourceRoot $installerZipName) -Force
Copy-Item -LiteralPath $installerBootstrap -Destination (Join-Path $installerSourceRoot $installerBootstrapName) -Force
Copy-Item -LiteralPath $installerIcon -Destination (Join-Path $installerSourceRoot $installerIconName) -Force

$escapedApiUrlForVbs = $ApiUrl.Replace("""", """""")
$launcher = @"
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & root & "\$installerBootstrapName" & """ -ApiUrl ""$escapedApiUrlForVbs"""
code = shell.Run(cmd, 0, True)
WScript.Quit code
"@

Set-Content `
  -LiteralPath (Join-Path $installerSourceRoot $installerLauncherName) `
  -Value $launcher `
  -Encoding ASCII

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
$appLaunched = "wscript.exe $installerLauncherName"

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
FILE1=$installerBootstrapName
FILE2=$installerIconName
FILE3=$installerLauncherName
[SourceFiles]
SourceFiles0=$escapedSourceRoot
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
%FILE3%=
"@

Set-Content -LiteralPath $installerSedPath -Value $sed -Encoding ASCII

$iexpressPath = Join-Path $env:WINDIR "System32\iexpress.exe"
$iexpressProcess = Start-Process `
  -FilePath $iexpressPath `
  -ArgumentList @('/N', '/Q', $installerSedPath) `
  -PassThru

$buildDeadline = [DateTime]::UtcNow.AddMinutes(3)
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
