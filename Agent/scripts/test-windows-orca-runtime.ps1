param(
  [string]$SourceRoot = (Join-Path $PSScriptRoot '..'),
  [string]$NodePath = '',
  [string]$DiagnosticLogPath = (Join-Path $env:LOCALAPPDATA ('PrintFlowAgentSetup\logs\orca-' + [guid]::NewGuid().ToString('N') + '.log'))
)

$ErrorActionPreference = 'Stop'
if (-not $NodePath) { $NodePath = Join-Path $SourceRoot 'runtime\node.exe' }
$verifierPath = Join-Path $SourceRoot 'scripts\verify-orca-runtime.mjs'
New-Item -ItemType Directory -Path (Split-Path -Parent $DiagnosticLogPath) -Force | Out-Null
@("PrintFlow OrcaSlicer installation check", "UTC: $([DateTime]::UtcNow.ToString('o'))", "Windows: $([Environment]::OSVersion.VersionString)") |
  Set-Content -LiteralPath $DiagnosticLogPath -Encoding UTF8

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $nodePath
$startInfo.Arguments = '"' + $verifierPath + '"'
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
$startInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
$checkProcess = $null
try {
  $checkProcess = [Diagnostics.Process]::Start($startInfo)
  $stdoutTask = $checkProcess.StandardOutput.ReadToEndAsync()
  $stderrTask = $checkProcess.StandardError.ReadToEndAsync()
  if (-not $checkProcess.WaitForExit(180000)) {
    $checkProcess.Kill()
    throw 'Verificacao do OrcaSlicer excedeu 3 minutos.'
  }
  @("Exit code: $($checkProcess.ExitCode)", 'stdout:', $stdoutTask.Result, 'stderr:', $stderrTask.Result) |
    Add-Content -LiteralPath $DiagnosticLogPath -Encoding UTF8
  if ($checkProcess.ExitCode -ne 0) {
    throw 'OrcaSlicer nao conseguiu gerar G-code.'
  }
  Write-Host "Fatiamento local validado. Diagnostico: $DiagnosticLogPath"
} catch {
  $_.Exception.Message | Add-Content -LiteralPath $DiagnosticLogPath -Encoding UTF8
  throw "Instalacao cancelada: OrcaSlicer nao conseguiu gerar G-code. A instalacao existente foi preservada. Diagnostico: $DiagnosticLogPath"
} finally {
  if ($checkProcess) { $checkProcess.Dispose() }
}
