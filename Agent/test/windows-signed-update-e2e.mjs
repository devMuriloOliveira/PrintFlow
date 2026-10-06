import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream as readStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const [setupArgument, releaseDirectoryArgument] = process.argv.slice(2)
if (!setupArgument || !releaseDirectoryArgument) {
  throw new Error('Uso: node test/windows-signed-update-e2e.mjs <native-setup.exe> <release-directory>')
}

const setup = path.resolve(setupArgument)
const releaseDirectory = path.resolve(releaseDirectoryArgument)
const installRoot = path.resolve(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'PrintFlowAgent')
const appData = path.resolve(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PrintFlow Agent')
const releaseVersion = JSON.parse(await readFile(path.join(releaseDirectory, 'PrintFlow-Agent-Windows', 'package.json'), 'utf8')).version
const releaseTag = `agent-v${releaseVersion}`
const updateRoot = path.join(appData, 'updates', releaseVersion)
const updateHistory = path.join(appData, 'updates', 'update-history.jsonl')
const credentialsFile = path.join(appData, 'agent.json')
const healthUrl = 'http://127.0.0.1:17873/healthz'
const artifactNames = [
  'PrintFlow-Agent-Setup.exe',
  'PrintFlow-Agent-Dev-Certificate.cer',
  'RELEASE-METADATA.json',
  'SHA256SUMS.txt'
]
const files = new Map(artifactNames.slice(0, 2).map(name => [name, path.join(releaseDirectory, name)]))
const server = createServer()
let apiPort

assert.equal(path.basename(setup).toLowerCase(), 'printflowagentsetup.exe')
assert.equal(releaseVersion, '0.1.24', `test release must be the next local version, received ${releaseVersion}`)
assert.equal(installRoot, path.resolve(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'PrintFlowAgent'))
assert.ok(await exists(setup), `native Setup missing: ${setup}`)
for (const [name, file] of files) assert.ok(await exists(file), `release asset missing: ${name}`)

const before = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) }).then(response => response.json())
assert.equal(before.version, '0.1.23', `expected the installed pre-update version 0.1.23, received ${before.version}`)
assert.equal(before.paired, true)
assert.equal(before.cloudConnected, true)
assert.equal(before.activePrintJobs, 0)
const credentialHashBefore = await hashFile(credentialsFile)

const certificate = await readFile(files.get('PrintFlow-Agent-Dev-Certificate.cer'))
const metadata = {
  tag: releaseTag,
  version: releaseVersion,
  minimumSupportedVersion: '0.1.10',
  portableRuntime: true,
  nodeRuntimeVersion: '24.19.0',
  nodeRuntimeArchitecture: 'x64',
  signingMode: 'DEV_SELF_SIGNED',
  productionTrusted: false,
  certificateSha256: createHash('sha256').update(certificate).digest('hex').toUpperCase()
}
const metadataPath = path.join(releaseDirectory, 'RELEASE-METADATA.json')
const sumsPath = path.join(releaseDirectory, 'SHA256SUMS.txt')
await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
files.set('RELEASE-METADATA.json', metadataPath)
const checksums = []
for (const name of ['PrintFlow-Agent-Setup.exe', 'PrintFlow-Agent-Dev-Certificate.cer', 'RELEASE-METADATA.json']) {
  checksums.push(`${await hashFile(files.get(name))}  ${name}`)
}
await writeFile(sumsPath, `${checksums.join('\n')}\n`, 'utf8')
files.set('SHA256SUMS.txt', sumsPath)

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

  const history = (await readFile(updateHistory, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  assert.ok(history.some(entry => entry.previousVersion === '0.1.23' && entry.newVersion === releaseVersion && entry.result === 'succeeded' && entry.detail === 'health_verified'),
    'C# updater did not record succeeded after post-update health verification')
  assert.equal(await hashFile(credentialsFile), credentialHashBefore, 'updating changed the persisted Agent credential file')

  const task = spawnSync('schtasks.exe', ['/Query', '/TN', 'PrintFlowAgent', '/FO', 'LIST'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
  assert.equal(task.status, 0, `PrintFlowAgent task unavailable after update: ${task.stderr || task.stdout}`)
  const listener = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
  assert.match(listener.stdout, /127\.0\.0\.1:17873\s+.*LISTENING/i, 'local Agent port did not return after signed update')

  process.stdout.write(JSON.stringify({
    status: 'passed',
    version: releaseVersion,
    paired: after.paired,
    cloudConnected: after.cloudConnected,
    activePrintJobs: after.activePrintJobs,
    taskPresent: true,
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

async function exists(file) {
  try {
    await stat(file)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}
