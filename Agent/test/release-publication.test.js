import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const scriptPath = path.resolve('scripts/publish-windows-agent-release.ps1').replaceAll("'", "''")
const runCase = scenario => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `
function gh {
  if ($args[1] -eq 'view') {
    if ($env:PRINTFLOW_RELEASE_CASE -eq 'missing') { $global:LASTEXITCODE = 1; Write-Output 'release not found'; return }
    if ($env:PRINTFLOW_RELEASE_CASE -eq 'lookup_failure') { $global:LASTEXITCODE = 1; Write-Output 'HTTP 403'; return }
    $global:LASTEXITCODE = 0
    $files = @('PrintFlow-Agent-Windows.zip','PrintFlow-Agent-Setup.exe','PrintFlow-Agent-Transition-Setup.exe','PrintFlow-Agent-Dev-Certificate.cer','RELEASE-METADATA.json','SHA256SUMS.txt')
    if ($env:PRINTFLOW_RELEASE_CASE -eq 'incomplete') { $files = @('PrintFlow-Agent-Windows.zip') }
    @{ tagName='agent-v0.1.22'; isDraft=($env:PRINTFLOW_RELEASE_CASE -eq 'draft'); assets=@($files | ForEach-Object { @{name=$_} }) } | ConvertTo-Json -Depth 4 -Compress
    return
  }
  if ($args[1] -eq 'create') { Write-Output 'CREATE_CALLED'; $global:LASTEXITCODE = 0; return }
  if ($args[1] -eq 'download') { Write-Output 'DOWNLOAD_FAILED'; $global:LASTEXITCODE = 1; return }
  throw 'Unexpected gh operation'
}
& '${scriptPath}' -Tag agent-v0.1.22 -Repository example/repo
`], { encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, PRINTFLOW_RELEASE_CASE: scenario } })

test('publicacao cria a release quando ausente', { skip: process.platform !== 'win32' }, () => {
  const result = runCase('missing')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /CREATE_CALLED/)
})

for (const [scenario, expected] of [
  ['draft', /nao esta publicada/],
  ['incomplete', /Release existente incompleta/],
  ['download_failure', /Nao foi possivel verificar/],
  ['lookup_failure', /Nao foi possivel consultar/]
]) {
  test(`publicacao recusa ${scenario} sem criar ou substituir release`, { skip: process.platform !== 'win32' }, () => {
    const result = runCase(scenario)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, expected)
    assert.doesNotMatch(result.stdout, /CREATE_CALLED/)
  })
}
