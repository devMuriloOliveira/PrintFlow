param(
  [string]$InstallDir = "$env:LOCALAPPDATA\PrintFlowAgent",
  [string]$TaskName = "PrintFlowAgent"
)

$ErrorActionPreference = "Stop"

$installRoot = [System.IO.Path]::GetFullPath($InstallDir)

if (Test-Path (Join-Path $installRoot "scripts\uninstall-windows-startup.ps1")) {
  & (Join-Path $installRoot "scripts\uninstall-windows-startup.ps1") -TaskName $TaskName
}

try {
  $escapedInstallRoot = [regex]::Escape($installRoot)
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -and
      $_.CommandLine -match $escapedInstallRoot
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
} catch {
}

$desktopShortcut = Join-Path ([Environment]::GetFolderPath("DesktopDirectory")) "PrintFlow Agent.lnk"
$startMenuFolder = Join-Path ([Environment]::GetFolderPath("Programs")) "PrintFlow 3D"
$startMenuShortcut = Join-Path $startMenuFolder "PrintFlow Agent.lnk"
$uninstallShortcut = Join-Path $startMenuFolder "Desinstalar PrintFlow Agent.lnk"

foreach ($shortcut in @($desktopShortcut, $startMenuShortcut, $uninstallShortcut)) {
  if (Test-Path $shortcut) {
    Remove-Item -LiteralPath $shortcut -Force
  }
}

if ((Test-Path $startMenuFolder) -and -not (Get-ChildItem -LiteralPath $startMenuFolder -Force)) {
  Remove-Item -LiteralPath $startMenuFolder -Force
}

$protocolKey = "HKCU:\Software\Classes\printflow-agent"
if (Test-Path $protocolKey) {
  Remove-Item -LiteralPath $protocolKey -Recurse -Force
}

$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintFlowAgent"
if (Test-Path $uninstallKey) {
  Remove-Item -LiteralPath $uninstallKey -Recurse -Force
}

if (Test-Path $installRoot) {
  Remove-Item -LiteralPath $installRoot -Recurse -Force
}

Write-Host "PrintFlow Agent desinstalado."
