import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream as readStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const [setupArgument, releaseDirectoryArgument, installRootArgument, testDataDirectoryArgument,
  agentApiUrl, localPortText, taskName, expectedPreviousVersion] = process.argv.slice(2)
if (![setupArgument, releaseDirectoryArgument, installRootArgument, testDataDirectoryArgument,
  agentApiUrl, localPortText, taskName].every(Boolean)) {
  throw new Error('Uso: node test/windows-signed-update-e2e.mjs <native-setup.exe> <release-directory> <isolated-install-root> <isolated-data-directory> <loopback-agent-api-url> <local-port> <isolated-task-name>')
}

const setup = path.resolve(setupArgument)
const releaseDirectory = path.resolve(releaseDirectoryArgument)
const localAppData = path.resolve(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
const installRoot = path.resolve(installRootArgument)
const appData = path.resolve(testDataDirectoryArgument)
const localPort = Number(localPortText)
const metadataPath = path.join(releaseDirectory, 'RELEASE-METADATA.json')
const sumsPath = path.join(releaseDirectory, 'SHA256SUMS.txt')
const releaseMetadata = JSON.parse(await readFile(metadataPath, 'utf8'))
const releaseVersion = releaseMetadata.version
const releaseTag = releaseMetadata.tag
const updateRoot = path.join(appData, 'updates', releaseVersion)
const updateHistory = path.join(appData, 'updates', 'update-history.jsonl')
const credentialsFile = path.join(appData, 'agent.json')
const healthUrl = 'http://127.0.0.1:' + localPort + '/healthz'
const artifactNames = [
  'Fila-Agent-Setup.exe',
  'Fila-Agent-Dev-Certificate.cer',
  'RELEASE-METADATA.json',
  'SHA256SUMS.txt'
]
const files = new Map(artifactNames.map(name => [name, path.join(releaseDirectory, name)]))
const server = createServer()
let apiPort

assert.ok(['fila-agent-setup.exe', 'fila-agent-test-setup.exe'].includes(path.basename(setup).toLowerCase()),
  'setup must use an official or isolated-test Fila Agent filename')
assert.equal(releaseTag, `agent-v${releaseVersion}`, 'release metadata tag and version must agree')
assert.equal(releaseMetadata.signingMode, 'DEV_SELF_SIGNED')
assert.equal(releaseMetadata.productionTrusted, false)
assert.ok(path.dirname(installRoot).toLowerCase() === localAppData.toLowerCase() &&
  path.basename(installRoot).startsWith('FilaAgent-E2E-'), 'install root must be an isolated direct child of LocalAppData')
assert.ok(path.dirname(appData).toLowerCase() === localAppData.toLowerCase() &&
  path.basename(appData).startsWith('FilaAgent-E2E-data-'), 'data root must be an isolated direct child of LocalAppData')
assert.ok(taskName.startsWith('FilaAgent_E2E_'), 'task must use the isolated E2E namespace')
assert.ok(Number.isInteger(localPort) && localPort > 0 && localPort < 65536)
const apiUri = new URL(agentApiUrl)
assert.equal(apiUri.protocol, 'http:')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(apiUri.hostname), 'test API must use loopback')
assert.ok(await exists(setup), `native Setup missing: ${setup}`)
for (const [name, file] of files) assert.ok(await exists(file), `release asset missing: ${name}`)

const before = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) }).then(response => response.json())
const previousVersion = expectedPreviousVersion || '0.1.24'
assert.equal(before.version, previousVersion, `expected installed version ${previousVersion}, received ${before.version}`)
assert.ok(compareVersions(releaseVersion, before.version) > 0, `release ${releaseVersion} must be newer than installed ${before.version}`)
assert.equal(before.paired, true)
assert.equal(before.cloudConnected, true)
assert.equal(before.activePrintJobs, 0)
const credentialHashBefore = await hashFile(credentialsFile)

const certificate = await readFile(files.get('Fila-Agent-Dev-Certificate.cer'))
assert.equal(releaseMetadata.certificateSha256, createHash('sha256').update(certificate).digest('hex').toUpperCase(),
  'release metadata certificate fingerprint must match the downloaded public certificate')
const officialChecksums = await readFile(sumsPath, 'utf8')
const officialChecksumEntries = new Map(officialChecksums.trim().split(/\r?\n/).map(line => {
  const match = /^([A-F0-9]{64})\s+\*?(.+)$/i.exec(line)
  assert.ok(match, `invalid official SHA256SUMS entry: ${line}`)
  return [path.basename(match[2].replaceAll('\\', '/')), match[1].toUpperCase()]
}))
for (const name of ['Fila-Agent-Setup.exe', 'Fila-Agent-Dev-Certificate.cer', 'RELEASE-METADATA.json']) {
  assert.equal(await hashFile(files.get(name)), officialChecksumEntries.get(name), `official SHA256SUMS mismatch for ${name}`)
}

server.on('request', (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
  if (request.method === 'GET' && url.pathname === '/releases/latest') {
    const assets = artifactNames.map(name => ({
      name,
      browser_download_url: `http://127.0.0.1:${apiPort}/assets/${encodeURIComponent(name)}`
    }))
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ tag_name: releaseTag, assets }))
    return
  }

  const assetName = decodeURIComponent(url.pathname.replace(/^\/assets\//, ''))
  const file = files.get(assetName)
  if (request.method !== 'GET' || !file) {
    response.writeHead(404)
    response.end()
    return
  }

  stat(file).then(info => {
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store'
    })
    readStream(file).pipe(response)
  }).catch(error => {
    response.writeHead(500)
    response.end(error.message)
  })
})

try {
  apiPort = await listen(server)
  process.stdout.write(`Running signed C# updater E2E for ${releaseTag}; approving the standard Windows UAC prompt may be required.\n`)
  const update = await run(setup, [
    '--check-updates',
    '--install-dir', installRoot,
    '--test-data-dir', appData,
    '--api-url', agentApiUrl,
    '--local-port', String(localPort),
    '--task-name', taskName,
    '--test-mode',
    '--test-release-api', `http://127.0.0.1:${apiPort}/releases/latest`
  ], 600_000)
  assert.equal(update.code, 0, `C# updater exited ${update.code}: ${update.stderr || update.stdout}`)

  const deadline = Date.now() + 120_000
  let after = null
  while (Date.now() < deadline) {
    try {
      after = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) }).then(response => response.json())
      if (after.version === releaseVersion && after.paired && after.cloudConnected && after.activePrintJobs === 0) break
    } catch {}
    await delay(500)
  }
  assert.ok(after?.ok && after.version === releaseVersion && after.paired && after.cloudConnected && after.activePrintJobs === 0,
    `post-update health did not reach the signed release: ${JSON.stringify(after)}`)

  const history = await waitForUpdateHistory(entry => entry.previousVersion === previousVersion &&
    entry.newVersion === releaseVersion && entry.result === 'succeeded' && entry.detail === 'health_verified')
  const updaterLog = await readFile(path.join(appData, 'installer.log'), 'utf8').catch(() => '')
  assert.ok(history.match,
    `C# updater did not record succeeded after post-update health verification; history: ${history.entries.map(entry => JSON.stringify(entry)).join(' | ') || '(empty)'}; installer log: ${updaterLog || '(empty)'}`)
  assert.equal(await hashFile(credentialsFile), credentialHashBefore, 'updating changed the persisted Agent credential file')

  const task = spawnSync('schtasks.exe', ['/Query', '/TN', taskName, '/V', '/FO', 'LIST'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
  assert.equal(task.status, 0, 'isolated Agent scheduled task must be present after update: ' + (task.stderr || task.stdout))
  assert.match(task.stdout, /FilaAgent\.exe/i, 'isolated task must launch the installed C# host')
  const listener = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
  assert.match(listener.stdout, new RegExp('127\\.0\\.0\\.1:' + localPort + '\\s+.*LISTENING', 'i'), 'local Agent port did not return after signed update')

  process.stdout.write(JSON.stringify({
    status: 'passed',
    previousVersion,
    version: releaseVersion,
    paired: after.paired,
    cloudConnected: after.cloudConnected,
    activePrintJobs: after.activePrintJobs,
    isolatedTaskPresent: true,
    localPortListening: true,
    updateHistorySucceeded: true,
    credentialsPreserved: true
  }, null, 2) + '\n')
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve))
}

function listen(target) {
  return new Promise((resolve, reject) => {
    target.once('error', reject)
    target.listen(0, '127.0.0.1', () => {
      target.removeListener('error', reject)
      resolve(target.address().port)
    })
  })
}

function run(file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Timed out running ${path.basename(file)} after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', code => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of readStream(file)) hash.update(chunk)
  return hash.digest('hex').toUpperCase()
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] || 0) - (b[index] || 0)
    if (difference) return Math.sign(difference)
  }
  return 0
}

async function exists(file) {
  try {
    await stat(file)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function waitForUpdateHistory(predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let entries = []
  do {
    try {
      entries = (await readFile(updateHistory, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (entries.some(predicate)) return { match: true, entries }
    await delay(100)
  } while (Date.now() < deadline)
  return { match: false, entries }
}
