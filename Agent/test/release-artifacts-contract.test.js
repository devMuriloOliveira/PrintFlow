import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const validator = path.join(root, 'scripts', 'validate-agent-release-artifacts.mjs')
const digest = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase()

const releaseAssets = {
  'Fila-Agent-Windows.zip': Buffer.from('fila package'),
  'Fila-Agent-Setup.exe': Buffer.from('fila setup'),
  'Fila-Agent-Transition-Setup.exe': Buffer.from('fila setup'),
  'Fila-Agent-Dev-Certificate.cer': Buffer.from('synthetic public certificate'),
  'PrintFlow-Agent-Windows.zip': Buffer.from('fila package'),
  'PrintFlow-Agent-Setup.exe': Buffer.from('fila setup'),
  'PrintFlow-Agent-Transition-Setup.exe': Buffer.from('fila setup'),
  'PrintFlow-Agent-Dev-Certificate.cer': Buffer.from('synthetic public certificate')
}

const writeRelease = async (directory, names, divergeSetupAlias = false, minimumSupportedVersion = '0.1.10') => {
  const certificate = releaseAssets['Fila-Agent-Dev-Certificate.cer']
  const metadata = {
    version: '0.1.27',
    minimumSupportedVersion,
    runtime: '.NET 8 self-contained',
    selfContained: true,
    signingMode: 'PRODUCTION_TRUSTED',
    productionTrusted: true,
    certificateSha256: digest(certificate)
  }
  await writeFile(path.join(directory, 'RELEASE-METADATA.json'), JSON.stringify(metadata))
  for (const name of names) {
    const bytes = divergeSetupAlias && name === 'PrintFlow-Agent-Setup.exe'
      ? Buffer.from('different legacy setup')
      : releaseAssets[name]
    await writeFile(path.join(directory, name), bytes)
  }
  const hashNames = [...names, 'RELEASE-METADATA.json']
  const sums = await Promise.all(hashNames.map(async name => {
    const bytes = await readFile(path.join(directory, name))
    return `${digest(bytes)}  Agent/dist/${name}`
  }))
  await writeFile(path.join(directory, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`)
}

const runValidator = (directory, variables = {}) => spawnSync(process.execPath, [validator, `--dist=${directory}`], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, FILA_AGENT_MINIMUM_SUPPORTED_VERSION: '0.1.10', ...variables }
})

test('release nova aceita os nomes Fila Agent e aliases PrintFlow idênticos', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fila-release-artifacts-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeRelease(directory, [...Object.keys(releaseAssets)])

  const result = runValidator(directory)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Release artifacts valid/)
})

test('release historica só com nomes PrintFlow continua validável', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'printflow-release-artifacts-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const legacyNames = [
    'PrintFlow-Agent-Windows.zip',
    'PrintFlow-Agent-Setup.exe',
    'PrintFlow-Agent-Transition-Setup.exe',
    'PrintFlow-Agent-Dev-Certificate.cer'
  ]
  await writeRelease(directory, legacyNames)

  const result = runValidator(directory, {
    FILA_AGENT_MINIMUM_SUPPORTED_VERSION: '',
    PRINTFLOW_AGENT_MINIMUM_SUPPORTED_VERSION: '0.1.10'
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Release artifacts valid/)
})

test('release nova rejeita alias PrintFlow com conteúdo divergente', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fila-release-alias-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeRelease(directory, [...Object.keys(releaseAssets)], true)

  const result = runValidator(directory)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Alias legado diverge do artefato canonico/)
})

test('validacao de release prioriza FILA_AGENT sobre o alias PRINTFLOW', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fila-release-min-version-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeRelease(directory, [...Object.keys(releaseAssets)], false, '0.1.11')

  const result = runValidator(directory, {
    FILA_AGENT_MINIMUM_SUPPORTED_VERSION: '0.1.11',
    PRINTFLOW_AGENT_MINIMUM_SUPPORTED_VERSION: '0.1.10'
  })
  assert.equal(result.status, 0, result.stderr)
})
