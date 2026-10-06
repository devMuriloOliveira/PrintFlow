param(
  [string]$ApiUrl = "https://printflow-api-4y5l.onrender.com",
  [string]$InstallDir = "$env:LOCALAPPDATA\PrintFlowAgent",
  [string]$TaskName = "PrintFlowAgent",
  [switch]$NoDesktopShortcut,
  [switch]$NoStartMenuShortcut,
  [string]$DiagnosticLogPath = (Join-Path $env:LOCALAPPDATA ('PrintFlowAgentSetup\logs\orca-' + [guid]::NewGuid().ToString('N') + '.log'))
)

$ErrorActionPreference = "Stop"

$sourceRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$installRoot = [System.IO.Path]::GetFullPath($InstallDir)

function Stop-ExistingAgentInstall {
  if (-not (Test-Path $installRoot)) {
    return
  }

  try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  } catch {
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

  Start-Sleep -Milliseconds 1200
}

function Assert-BundledNodeRuntime {
  $runtimeRoot = Join-Path $sourceRoot "runtime"
  $runtimeNode = Join-Path $runtimeRoot "node.exe"
  $runtimeMetadataPath = Join-Path $runtimeRoot "runtime.json"
  $runtimeLicensePath = Join-Path $runtimeRoot "LICENSE.node.txt"

  if (
    -not (Test-Path -LiteralPath $runtimeNode) -or
    -not (Test-Path -LiteralPath $runtimeMetadataPath) -or
    -not (Test-Path -LiteralPath $runtimeLicensePath)
  ) {
    throw "Pacote do Agent incompleto: runtime Node.js portatil ausente."
  }

  $metadata = Get-Content -LiteralPath $runtimeMetadataPath -Raw | ConvertFrom-Json
  $actualHash = (Get-FileHash -LiteralPath $runtimeNode -Algorithm SHA256).Hash.ToUpperInvariant()
  if (-not $metadata.sha256 -or $actualHash -ne ([string]$metadata.sha256).ToUpperInvariant()) {
    throw "Runtime Node.js do Agent falhou na verificacao SHA-256."
  }

  $actualVersion = (& $runtimeNode --version 2>$null).Trim().TrimStart('v')
  $actualArchitecture = (& $runtimeNode -p "process.arch" 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualVersion -ne [string]$metadata.version) {
    throw "Runtime Node.js do Agent possui versao inesperada."
  }
  if ($actualArchitecture -ne "x64" -or [string]$metadata.architecture -ne "x64") {
    throw "Este instalador do PrintFlow Agent exige Windows x64."
  }
}

Assert-BundledNodeRuntime
# Provision and exercise the Store-signed slicer before stopping the working Agent.
& (Join-Path $sourceRoot 'scripts\ensure-orca-slicer.ps1')
& (Join-Path $sourceRoot 'scripts\test-windows-orca-runtime.ps1') -SourceRoot $sourceRoot -DiagnosticLogPath $DiagnosticLogPath
Stop-ExistingAgentInstall

if (-not (Test-Path $installRoot)) {
  New-Item -ItemType Directory -Path $installRoot | Out-Null
}

$items = @("assets", "host", "node_modules", "runtime", "scripts", "src", "package.json", "package-lock.json", "README.md")
foreach ($item in $items) {
  $source = Join-Path $sourceRoot $item
  if (Test-Path $source) {
    Copy-Item -LiteralPath $source -Destination $installRoot -Recurse -Force
  }
}

$iconPath = Join-Path $installRoot "assets\printflow-agent-icon.ico"
$openScript = Join-Path $installRoot "scripts\open-windows-agent.ps1"
$uninstallScript = Join-Path $installRoot "scripts\uninstall-windows-agent.ps1"
$openWrapper = Join-Path $installRoot "scripts\open-windows-agent.vbs"
$uninstallWrapper = Join-Path $installRoot "scripts\uninstall-windows-agent.vbs"
$packagePath = Join-Path $installRoot "package.json"
$hostExecutable = Join-Path $installRoot "host\PrintFlowAgentHost.exe"
$hostManifestPath = Join-Path $installRoot "host\host-version.json"

if (-not (Test-Path (Join-Path $installRoot "node_modules"))) {
  throw "Pacote do Agent incompleto: dependencias de producao ausentes."
}

if (-not (Test-Path -LiteralPath $hostExecutable) -or -not (Test-Path -LiteralPath $hostManifestPath)) {
  throw "Pacote do Agent incompleto: host Windows nativo ausente."
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

$hostMetadata = Get-Content -LiteralPath $hostManifestPath -Raw | ConvertFrom-Json
if ([string]$hostMetadata.agentVersion -ne [string]$version -or [string]$hostMetadata.hostVersion -ne [string]$version) {
  throw "Pacote do Agent inconsistente: host Windows e Agent possuem versoes diferentes."
}

& (Join-Path $installRoot "scripts\install-windows-startup.ps1") `
  -ApiUrl $ApiUrl `
  -TaskName $TaskName `
  -HostExecutable $hostExecutable `
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
$protocolIconKey = Join-Path $protocolKey "DefaultIcon"
$protocolCommand = "`"$hostExecutable`" --protocol `"%1`""

New-Item -Path $protocolCommandKey -Force | Out-Null
New-Item -Path $protocolIconKey -Force | Out-Null
Set-Item -Path $protocolKey -Value "URL:PrintFlow Agent Protocol"
Set-ItemProperty -Path $protocolKey -Name "URL Protocol" -Value ""
Set-Item -Path $protocolIconKey -Value "`"$iconPath`",0"
Set-Item -Path $protocolCommandKey -Value $protocolCommand

function New-AgentShortcut {
  param(
    [string]$Path,
    [string]$TargetPath,
    [string]$Description,
    [string]$Arguments
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $TargetPath
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $installRoot
  $shortcut.Description = $Description
  if (Test-Path $iconPath) {
    $shortcut.IconLocation = "$iconPath,0"
  }
  $shortcut.Save()
}

if (-not $NoDesktopShortcut) {
  $desktop = [Environment]::GetFolderPath("DesktopDirectory")
  New-AgentShortcut `
    -Path (Join-Path $desktop "PrintFlow Agent.lnk") `
    -TargetPath $hostExecutable `
    -Description "Iniciar PrintFlow Agent" `
    -Arguments "--api-url `"$ApiUrl`""
}

if (-not $NoStartMenuShortcut) {
  $programs = [Environment]::GetFolderPath("Programs")
  $folder = Join-Path $programs "PrintFlow 3D"
  if (-not (Test-Path $folder)) {
    New-Item -ItemType Directory -Path $folder | Out-Null
  }
  New-AgentShortcut `
    -Path (Join-Path $folder "PrintFlow Agent.lnk") `
    -TargetPath $hostExecutable `
    -Description "Iniciar PrintFlow Agent" `
    -Arguments "--api-url `"$ApiUrl`""
  New-AgentShortcut `
    -Path (Join-Path $folder "Desinstalar PrintFlow Agent.lnk") `
    -TargetPath "wscript.exe" `
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
Set-ItemProperty -Path $uninstallKey -Name "DisplayIcon" -Value "$iconPath,0"
Set-ItemProperty -Path $uninstallKey -Name "UninstallString" -Value $uninstallCommand
Set-ItemProperty -Path $uninstallKey -Name "QuietUninstallString" -Value $quietUninstallCommand
Set-ItemProperty -Path $uninstallKey -Name "InstallDate" -Value (Get-Date -Format "yyyyMMdd")
Set-ItemProperty -Path $uninstallKey -Name "Comments" -Value "Conector local do PrintFlow para impressoras 3D. Inclui runtime proprio e inicia no login deste usuario."
New-ItemProperty -Path $uninstallKey -Name "NoModify" -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "NoRepair" -Value 1 -PropertyType DWord -Force | Out-Null

if ($version -match '^(\d+)\.(\d+)\.(\d+)') {
  New-ItemProperty -Path $uninstallKey -Name "VersionMajor" -Value ([int]$Matches[1]) -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name "VersionMinor" -Value ([int]$Matches[2]) -PropertyType DWord -Force | Out-Null
}

if ($estimatedSizeKb -gt 0) {
  New-ItemProperty -Path $uninstallKey -Name "EstimatedSize" -Value $estimatedSizeKb -PropertyType DWord -Force | Out-Null
}

Start-ScheduledTask `
  -TaskName $TaskName

function Wait-ForLocalAgent {
  param(
    [int]$TimeoutSeconds = 15
  )

  $healthUrl = "http://127.0.0.1:17873/healthz"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  do {
    try {
      $health = Invoke-RestMethod `
        -Uri $healthUrl `
        -Method Get `
        -TimeoutSec 2 `
        -ErrorAction Stop

      if ($health.ok -eq $true -and $health.app -eq 'printflow-agent') {
        return $health
      }
    } catch {
    }

    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  return $null
}

$localHealth = Wait-ForLocalAgent
if (-not $localHealth) {
  Write-Warning "O Agent foi instalado, mas o healthz local ainda nao respondeu. O Windows tentara inicia-lo novamente no proximo login."
} elseif (-not $localHealth.paired) {
  Write-Host "Agent iniciado e aguardando pareamento pelo PrintFlow."
}

Write-Host "PrintFlow Agent instalado."
Write-Host "Diretorio: $installRoot"
Write-Host "Protocolo: printflow-agent://"
