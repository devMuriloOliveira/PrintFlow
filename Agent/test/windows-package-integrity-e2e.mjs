import assert from 'node:assert/strict'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const [setupArgument, zipArgument] = process.argv.slice(2)
if (!setupArgument || !zipArgument) {
  throw new Error('Uso: node test/windows-package-integrity-e2e.mjs <Fila-Agent-Test-Setup.exe> <agent.zip>')
}

const setup = path.resolve(setupArgument)
const zip = path.resolve(zipArgument)
const localAppData = path.resolve(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
const testId = `${process.pid}_${Date.now()}`
const installRoot = path.join(localAppData, `FilaAgent-E2E-package-integrity-${testId}`)
const testDataRoot = path.join(localAppData, `FilaAgent-E2E-data-package-integrity-${testId}`)
const tamperedZip = path.join(os.tmpdir(), `fila-agent-tampered-${testId}.zip`)
const sentinel = path.join(installRoot, 'preserve-me.txt')

assert.equal(path.dirname(installRoot), localAppData, 'test install must stay under LocalAppData')
assert.ok(!await exists(installRoot), 'unique isolated test install directory already exists')
assert.ok(!await exists(testDataRoot), 'unique isolated test data directory already exists')

try {
  const tamperedBytes = await readFile(zip)
  assert.ok(tamperedBytes.length > 0, 'package ZIP must not be empty')
  tamperedBytes[tamperedBytes.length - 1] ^= 0xff
  await mkdir(installRoot, { recursive: true })
  await writeFile(sentinel, 'existing installation sentinel', 'utf8')
  await writeFile(tamperedZip, tamperedBytes)

  const result = spawnSync(setup, [
    '--install-package', tamperedZip,
    '--api-url', 'http://127.0.0.1:57999',
    '--install-dir', installRoot,
    '--test-data-dir', testDataRoot,
    '--task-name', `FilaAgent_E2E_PackageIntegrity_${testId}`,
    '--local-port', '57998',
    '--test-mode', '--quiet'
  ], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })

  if (result.error) throw result.error
  assert.equal(result.status, 1, `setup must reject a modified package; stderr: ${result.stderr}`)
  const log = await readFile(path.join(testDataRoot, 'installer.log'), 'utf8')
  assert.match(log, /nao corresponde ao payload autenticado/)
  assert.equal(await readFile(sentinel, 'utf8'), 'existing installation sentinel', 'modified package must preserve the existing installation')
  console.log('Package integrity E2E passed: modified ZIP rejected and installation sentinel preserved.')
} finally {
  await rm(tamperedZip, { force: true })
  await rm(installRoot, { recursive: true, force: true })
  await rm(testDataRoot, { recursive: true, force: true })
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}
