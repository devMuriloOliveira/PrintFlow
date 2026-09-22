param(
  [string]$OutputDir = "dist",
  [string]$PackageName = "PrintFlow-Agent-Windows",
  [string]$InstallerName = "PrintFlow-Agent-Setup",
  [string]$ApiUrl = "https://printflow-api-4y5l.onrender.com",
  [switch]$SignDev,
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
  -not $iexpressProcess.HasExited -and
  -not (Test-Path $installerPath) -and
  [DateTime]::UtcNow -lt $buildDeadline
) {
  Start-Sleep -Milliseconds 500
}

if (-not (Test-Path $installerPath)) {
  if (-not $iexpressProcess.HasExited) {
    Stop-Process -Id $iexpressProcess.Id -Force -ErrorAction SilentlyContinue
  }
  throw "IExpress nao gerou o instalador dentro do prazo."
}

# Algumas versoes do IExpress deixam o processo vivo depois de escrever o
# artefato. O processo foi iniciado por este script e pode ser encerrado com
# seguranca agora que o .exe existe.
if (-not $iexpressProcess.HasExited) {
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
    -ExportOnly:$SkipOuterSignature

  $unsignedSize = (Get-Item -LiteralPath $unsignedInstallerPath).Length
  $signedSize = (Get-Item -LiteralPath $installerPath).Length
  if ($signedSize -lt [Math]::Max(1048576, [Math]::Floor($unsignedSize * 0.8))) {
    Write-Warning "A assinatura truncou o payload do IExpress; mantendo o instalador completo sem assinatura externa."
    Copy-Item -LiteralPath $unsignedInstallerPath -Destination $installerPath -Force
  }
  Remove-Item -LiteralPath $unsignedInstallerPath -Force -ErrorAction SilentlyContinue

  Write-Host "Certificado publico de teste:"
  Write-Host $devCertificatePath
}

Write-Host "Pacote Windows gerado:"
Write-Host $zipPath
Write-Host "Instalador Windows gerado:"
Write-Host $installerPath
