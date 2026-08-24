param(
  [string]$OutputDir = "dist",
  [string]$PackageName = "PrintFlow-Agent-Windows",
  [string]$InstallerName = "PrintFlow-Agent-Setup",
  [string]$ApiUrl = "http://localhost:3333",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$outputRoot = Join-Path $agentRoot $OutputDir
$stageRoot = Join-Path $outputRoot $PackageName
$zipPath = Join-Path $outputRoot "$PackageName.zip"
$installerSourceRoot = Join-Path $outputRoot "$InstallerName-source"
$installerPath = Join-Path $outputRoot "$InstallerName.exe"
$installerSedPath = Join-Path $outputRoot "$InstallerName.sed"

Set-Location $agentRoot

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
$installerZipName = "$PackageName.zip"

Copy-Item -LiteralPath $zipPath -Destination (Join-Path $installerSourceRoot $installerZipName) -Force
Copy-Item -LiteralPath $installerBootstrap -Destination (Join-Path $installerSourceRoot $installerBootstrapName) -Force

if (Test-Path $installerPath) {
  Remove-Item -LiteralPath $installerPath -Force
}

if (Test-Path $installerSedPath) {
  Remove-Item -LiteralPath $installerSedPath -Force
}

$escapedInstallerPath = $installerPath.Replace("\", "\\")
$escapedSourceRoot = $installerSourceRoot.Replace("\", "\\")
$appLaunched = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installerBootstrapName -ApiUrl `"$ApiUrl`""

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
FinishMessage=PrintFlow Agent instalado.
TargetName=$escapedInstallerPath
FriendlyName=PrintFlow Agent Setup
AppLaunched=$appLaunched
PostInstallCmd=<None>
FILE0=$installerZipName
FILE1=$installerBootstrapName
[SourceFiles]
SourceFiles0=$escapedSourceRoot
[SourceFiles0]
%FILE0%=
%FILE1%=
"@

Set-Content -LiteralPath $installerSedPath -Value $sed -Encoding ASCII

iexpress.exe /N /Q $installerSedPath | Out-Null

Write-Host "Pacote Windows gerado:"
Write-Host $zipPath
Write-Host "Instalador Windows gerado:"
Write-Host $installerPath
