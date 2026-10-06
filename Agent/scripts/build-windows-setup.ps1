param([string]$OutputDir = 'artifacts\windows-setup')

$ErrorActionPreference = 'Stop'
$agentRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$project = Join-Path $agentRoot 'windows-setup\PrintFlowAgentSetup.csproj'
$output = Join-Path $agentRoot $OutputDir
$dotnet = (Get-Command 'dotnet.exe' -ErrorAction SilentlyContinue).Source
if (-not $dotnet) {
  $candidate = Join-Path ${env:ProgramFiles} 'dotnet\dotnet.exe'
  if (Test-Path -LiteralPath $candidate) { $dotnet = $candidate }
}
if (-not $dotnet) { throw '.NET 8 SDK nao encontrado para compilar o instalador nativo.' }
& $dotnet publish $project --configuration Release --runtime win-x64 --self-contained true --output $output
if ($LASTEXITCODE -ne 0) { throw 'Falha ao publicar o instalador C# do Agent.' }
if (-not (Test-Path -LiteralPath (Join-Path $output 'PrintFlowAgentSetup.exe'))) { throw 'Executavel do instalador nao foi gerado.' }
