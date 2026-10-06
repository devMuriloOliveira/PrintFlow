param(
  [string]$OutputDir = 'artifacts\windows-host'
)

$ErrorActionPreference = 'Stop'
$agentRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$package = Get-Content -LiteralPath (Join-Path $agentRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
$project = Join-Path $agentRoot 'windows-host\PrintFlowAgentHost.csproj'
$output = Join-Path $agentRoot $OutputDir
$dotnet = (Get-Command 'dotnet.exe' -ErrorAction SilentlyContinue).Source
if (-not $dotnet) {
  $candidate = Join-Path ${env:ProgramFiles} 'dotnet\dotnet.exe'
  if (Test-Path -LiteralPath $candidate) { $dotnet = $candidate }
}
if (-not $dotnet) { throw '.NET 8 SDK nao encontrado para compilar o host Windows.' }

& $dotnet publish $project --configuration Release --runtime win-x64 --self-contained true --output $output "/p:Version=$version" "/p:InformationalVersion=$version"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao publicar o host C# do Agent.' }

$hostExecutable = Join-Path $output 'PrintFlowAgentHost.exe'
if (-not (Test-Path -LiteralPath $hostExecutable)) { throw 'Executavel do host Windows nao foi gerado.' }

@{ agentVersion = $version; hostVersion = $version; executable = 'PrintFlowAgentHost.exe' } |
  ConvertTo-Json |
  Set-Content -LiteralPath (Join-Path $output 'host-version.json') -Encoding UTF8

Write-Host "Host Windows gerado: $hostExecutable"
