import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const projectPath = path.resolve('windows-release-tool/FilaAgent.ReleaseTool.csproj')
const dotnet = process.env.DOTNET_HOST_PATH || (process.platform === 'win32' ? 'dotnet.exe' : 'dotnet')
const runCase = scenario => spawnSync(dotnet, [
  'run', '--project', projectPath, '--configuration', 'Debug', '--no-restore', '--',
  'publish-release', '--tag', 'agent-v0.1.22', '--repository', 'example/repo', '--test-mode', '--test-case', scenario
], { encoding: 'utf8', windowsHide: true, timeout: 30000, cwd: process.cwd() })

test('publicacao cria a release quando ausente', () => {
  const result = runCase('missing')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /CREATE_CALLED/)
  assert.match(result.stdout, /Fila-Agent-Setup\.exe/)
  assert.match(result.stdout, /Fila-Agent-Transition-Setup\.exe/)
  assert.match(result.stdout, /PrintFlow-Agent-Setup\.exe/)
})

for (const [scenario, expected] of [
  ['draft', /nao esta publicada/],
  ['incomplete', /Release existente incompleta/],
  ['download_failure', /Nao foi possivel verificar/],
  ['lookup_failure', /Nao foi possivel consultar/]
]) {
  test(`publicacao recusa ${scenario} sem criar ou substituir release`, () => {
    const result = runCase(scenario)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, expected)
    assert.doesNotMatch(result.stdout, /CREATE_CALLED/)
  })
}
