param(
  [string]$ApiUrl = "http://localhost:3333"
)

$ErrorActionPreference = "Stop"

$packageRoot = $PSScriptRoot
$zipPath = Join-Path $packageRoot "PrintFlow-Agent-Windows.zip"

if (-not (Test-Path $zipPath)) {
  throw "Pacote PrintFlow-Agent-Windows.zip nao encontrado."
}

$extractRoot = Join-Path $env:TEMP ("PrintFlowAgentSetup-" + [guid]::NewGuid().ToString("N"))

New-Item -ItemType Directory -Path $extractRoot | Out-Null

try {
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force

  $installScript = Join-Path $extractRoot "scripts\install-windows-agent.ps1"

  if (-not (Test-Path $installScript)) {
    throw "Instalador interno do PrintFlow Agent nao encontrado."
  }

  powershell.exe `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $installScript `
    -ApiUrl $ApiUrl
} finally {
  Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
}
