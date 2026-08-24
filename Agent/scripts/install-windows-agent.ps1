param(
  [string]$ApiUrl = "http://localhost:3333",
  [string]$InstallDir = "$env:LOCALAPPDATA\PrintFlowAgent",
  [string]$TaskName = "PrintFlowAgent",
  [switch]$NoDesktopShortcut,
  [switch]$NoStartMenuShortcut
)

$ErrorActionPreference = "Stop"

$sourceRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$installRoot = [System.IO.Path]::GetFullPath($InstallDir)

if (-not (Test-Path $installRoot)) {
  New-Item -ItemType Directory -Path $installRoot | Out-Null
}

$items = @("assets", "node_modules", "scripts", "src", "package.json", "package-lock.json", "README.md")
foreach ($item in $items) {
  $source = Join-Path $sourceRoot $item
  if (Test-Path $source) {
    Copy-Item -LiteralPath $source -Destination $installRoot -Recurse -Force
  }
}

$iconPath = Join-Path $installRoot "assets\printflow-agent-icon.ico"
$openScript = Join-Path $installRoot "scripts\open-windows-agent.ps1"
$startScript = Join-Path $installRoot "scripts\start-windows-agent-tray.ps1"
$uninstallScript = Join-Path $installRoot "scripts\uninstall-windows-agent.ps1"
$openWrapper = Join-Path $installRoot "scripts\open-windows-agent.vbs"
$startWrapper = Join-Path $installRoot "scripts\start-windows-agent-tray.vbs"
$uninstallWrapper = Join-Path $installRoot "scripts\uninstall-windows-agent.vbs"
$packagePath = Join-Path $installRoot "package.json"

if (-not (Test-Path (Join-Path $installRoot "node_modules"))) {
  Set-Location $installRoot
  npm ci --omit=dev
}

$version = "0.1.0"
if (Test-Path $packagePath) {
  try {
    $package = Get-Content -Raw $packagePath | ConvertFrom-Json
    if ($package.version) {
      $version = $package.version
    }
  } catch {
    $version = "0.1.0"
  }
}

& (Join-Path $installRoot "scripts\install-windows-startup.ps1") `
  -ApiUrl $ApiUrl `
  -TaskName $TaskName `
  -NoStart

function ConvertTo-VbsLiteral {
  param(
    [string]$Value
  )

  return $Value.Replace("""", """""")
}

function New-PowerShellWrapper {
  param(
    [string]$WrapperPath,
    [string]$ScriptPath,
    [string]$Arguments = "",
    [bool]$AppendIncomingArguments = $false,
    [bool]$Wait = $false
  )

  $scriptLiteral = ConvertTo-VbsLiteral $ScriptPath
  $argumentsLiteral = ConvertTo-VbsLiteral $Arguments
  $appendBlock = ""

  if ($AppendIncomingArguments) {
    $appendBlock = @"
For Each arg In WScript.Arguments
  cmd = cmd & " """ & Replace(arg, """", """""") & """"
Next
"@
  }

  $waitLiteral = if ($Wait) { "True" } else { "False" }

  $content = @"
Set shell = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$scriptLiteral"" $argumentsLiteral"
$appendBlock
code = shell.Run(cmd, 0, $waitLiteral)
WScript.Quit code
"@

  Set-Content -LiteralPath $WrapperPath -Value $content -Encoding ASCII
}

New-PowerShellWrapper `
  -WrapperPath $startWrapper `
  -ScriptPath $startScript `
  -Arguments "-ApiUrl `"$ApiUrl`""

New-PowerShellWrapper `
  -WrapperPath $uninstallWrapper `
  -ScriptPath $uninstallScript `
  -Wait $true

$openScriptLiteral = ConvertTo-VbsLiteral $openScript
$openApiUrlLiteral = ConvertTo-VbsLiteral $ApiUrl
$openTaskNameLiteral = ConvertTo-VbsLiteral $TaskName
$openWrapperContent = @"
Set shell = CreateObject("WScript.Shell")
protocolUrl = ""
If WScript.Arguments.Count > 0 Then
  protocolUrl = WScript.Arguments(0)
End If
protocolUrl = Replace(protocolUrl, """", """""")
cmd = "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$openScriptLiteral"" -ProtocolUrl """ & protocolUrl & """ -ApiUrl ""$openApiUrlLiteral"" -TaskName ""$openTaskNameLiteral"""
code = shell.Run(cmd, 0, False)
WScript.Quit code
"@
Set-Content -LiteralPath $openWrapper -Value $openWrapperContent -Encoding ASCII

$protocolKey = "HKCU:\Software\Classes\printflow-agent"
$protocolCommandKey = Join-Path $protocolKey "shell\open\command"
$protocolCommand = "wscript.exe `"$openWrapper`" `"%1`""

New-Item -Path $protocolCommandKey -Force | Out-Null
Set-Item -Path $protocolKey -Value "URL:PrintFlow Agent Protocol"
Set-ItemProperty -Path $protocolKey -Name "URL Protocol" -Value ""
Set-Item -Path $protocolCommandKey -Value $protocolCommand

function New-AgentShortcut {
  param(
    [string]$Path,
    [string]$TargetScript,
    [string]$Description,
    [string]$Arguments
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = "wscript.exe"
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $installRoot
  $shortcut.Description = $Description
  if (Test-Path $iconPath) {
    $shortcut.IconLocation = $iconPath
  }
  $shortcut.Save()
}

if (-not $NoDesktopShortcut) {
  $desktop = [Environment]::GetFolderPath("DesktopDirectory")
  New-AgentShortcut `
    -Path (Join-Path $desktop "PrintFlow Agent.lnk") `
    -TargetScript $startScript `
    -Description "Iniciar PrintFlow Agent" `
    -Arguments "`"$startWrapper`""
}

if (-not $NoStartMenuShortcut) {
  $programs = [Environment]::GetFolderPath("Programs")
  $folder = Join-Path $programs "PrintFlow 3D"
  if (-not (Test-Path $folder)) {
    New-Item -ItemType Directory -Path $folder | Out-Null
  }
  New-AgentShortcut `
    -Path (Join-Path $folder "PrintFlow Agent.lnk") `
    -TargetScript $startScript `
    -Description "Iniciar PrintFlow Agent" `
    -Arguments "`"$startWrapper`""
  New-AgentShortcut `
    -Path (Join-Path $folder "Desinstalar PrintFlow Agent.lnk") `
    -TargetScript $uninstallScript `
    -Description "Desinstalar PrintFlow Agent" `
    -Arguments "`"$uninstallWrapper`""
}

$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintFlowAgent"
$uninstallCommand = "wscript.exe `"$uninstallWrapper`""
$quietUninstallCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$uninstallScript`" -Quiet"
$estimatedSizeKb = 0

try {
  $estimatedSizeKb = [int](
    (
      Get-ChildItem -LiteralPath $installRoot -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum
    ).Sum / 1KB
  )
} catch {
  $estimatedSizeKb = 0
}

New-Item -Path $uninstallKey -Force | Out-Null
Set-ItemProperty -Path $uninstallKey -Name "DisplayName" -Value "PrintFlow Agent"
Set-ItemProperty -Path $uninstallKey -Name "DisplayVersion" -Value $version
Set-ItemProperty -Path $uninstallKey -Name "Publisher" -Value "PrintFlow 3D"
Set-ItemProperty -Path $uninstallKey -Name "InstallLocation" -Value $installRoot
Set-ItemProperty -Path $uninstallKey -Name "DisplayIcon" -Value $iconPath
Set-ItemProperty -Path $uninstallKey -Name "UninstallString" -Value $uninstallCommand
Set-ItemProperty -Path $uninstallKey -Name "QuietUninstallString" -Value $quietUninstallCommand
New-ItemProperty -Path $uninstallKey -Name "NoModify" -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "NoRepair" -Value 1 -PropertyType DWord -Force | Out-Null

if ($estimatedSizeKb -gt 0) {
  New-ItemProperty -Path $uninstallKey -Name "EstimatedSize" -Value $estimatedSizeKb -PropertyType DWord -Force | Out-Null
}

Start-ScheduledTask `
  -TaskName $TaskName

Write-Host "PrintFlow Agent instalado."
Write-Host "Diretorio: $installRoot"
Write-Host "API: $ApiUrl"
Write-Host "Protocolo: printflow-agent://"
