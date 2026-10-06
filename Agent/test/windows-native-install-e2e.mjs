import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const [setupArgument, zipArgument] = process.argv.slice(2)
if (!setupArgument || !zipArgument) {
  throw new Error('Uso: node test/windows-native-install-e2e.mjs <setup.exe> <agent.zip>')
}

const setup = path.resolve(setupArgument)
const zip = path.resolve(zipArgument)
const localAppData = path.resolve(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
const testId = `${process.pid}_${Date.now()}`
const installRoot = path.join(localAppData, `PrintFlowAgent-E2E-${testId}`)
const testDataRoot = path.join(localAppData, `PrintFlowAgent-E2E-data-${testId}`)
const taskName = `PF_Agent_E2E_${testId}`
const pairCode = `E2E-${String(process.pid).padStart(6, '0')}`
const pairCalls = []
let heartbeatCount = 0
let verifyDelayMs = 0
let delayNextVerify = false
let apiServer
let apiPort
let agentPort
let installed = false

assert.equal(path.dirname(installRoot), localAppData, 'test install must stay under LocalAppData')
assert.equal(path.dirname(testDataRoot), localAppData, 'test data must stay under LocalAppData')
assert.ok(!await exists(installRoot), 'unique test install path already exists')
assert.ok(!await exists(testDataRoot), 'unique test data path already exists')
assert.equal(path.basename(setup).toLowerCase(), 'printflowagentsetup.exe', 'Pass the native C# PrintFlowAgentSetup.exe, not the IExpress release wrapper; IExpress does not accept the test CLI options')

const json = (response, status, value) => {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  })
  response.end(JSON.stringify(value))
}

const readBody = async request => {
  let body = ''
  for await (const chunk of request) body += chunk
  return body ? JSON.parse(body) : {}
}

apiServer = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return json(response, 200, { status: 'ok' })
    }
    if (request.method === 'POST' && url.pathname === '/api/agents/pair') {
      const body = await readBody(request)
      pairCalls.push({ code: body.code, version: body.version, machineName: body.machineName })
      if (body.code !== pairCode) return json(response, 400, { error: 'invalid_test_code' })
      return json(response, 200, {
        agentId: `e2e-agent-${testId}`,
        agentSecret: 'e2e-only-secret',
        tenantId: 'e2e-tenant',
        tenantName: 'Isolated install test',
        machineName: body.machineName
      })
    }
    if (request.method === 'POST' && url.pathname === '/api/agents/verify') {
      if (delayNextVerify && verifyDelayMs > 0) {
        delayNextVerify = false
        await delay(verifyDelayMs)
      }
      return json(response, 200, { status: 'ok' })
    }
    if (request.method === 'POST' && url.pathname === '/api/agents/credential/rotate') {
      return json(response, 409, { error: 'rotation_not_needed_in_test' })
    }
    if (request.method === 'GET' && url.pathname === '/api/agents/printers/reconnect') {
      return json(response, 200, { printers: [] })
    }
    if (request.method === 'GET' && url.pathname === '/api/agents/commands/pending') {
      return json(response, 200, { command: null })
    }
    if (request.method === 'POST' && url.pathname === '/api/agents/heartbeat') {
      heartbeatCount += 1
      return json(response, 200, { ok: true })
    }
    if (request.method === 'POST' && url.pathname === '/api/agents/sync-events') {
      const body = await readBody(request)
      return json(response, 200, { accepted: Array.isArray(body.events) ? body.events.length : 0 })
    }
    if (request.method === 'POST' && url.pathname === '/api/agents/commands') {
      return json(response, 200, { ok: true })
    }
    return json(response, 200, {})
  } catch (error) {
    return json(response, 500, { error: error.message })
  }
})

apiServer.on('upgrade', (_request, socket) => socket.destroy())

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    server.removeListener('error', reject)
    resolve(server.address().port)
  })
})

const getFreePort = async () => {
  const server = createServer()
  const port = await listen(server)
  await new Promise(resolve => server.close(resolve))
  return port
}

const run = (file, args, timeoutMs = 180_000) => new Promise((resolve, reject) => {
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
    reject(Object.assign(new Error(`Could not start ${path.basename(file)}: ${error.message}`), { cause: error }))
  })
  child.once('close', code => {
    clearTimeout(timer)
    resolve({ code, stdout, stderr })
  })
})

const task = (operation, required = true) => {
  const result = spawnSync('schtasks.exe', [operation, '/TN', taskName, ...(operation === '/Delete' ? ['/F'] : [])], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000
  })
  if (required && result.status !== 0) {
    throw new Error(`schtasks ${operation} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`)
  }
  return result
}

const healthUrl = () => `http://127.0.0.1:${agentPort}/healthz`

const waitForHealth = async (predicate, timeoutMs = 90_000) => {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    try {
      last = await fetch(healthUrl(), { signal: AbortSignal.timeout(1500) }).then(response => response.json())
      if (predicate(last)) return last
    } catch {}
    await delay(500)
  }
  throw new Error(`Agent health timeout; last response: ${JSON.stringify(last)}`)
}

const waitUntilUnavailable = async (timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(healthUrl(), { signal: AbortSignal.timeout(500) })
    } catch {
      return
    }
    await delay(250)
  }
  throw new Error('Agent listener remained active after ending the isolated scheduled task')
}

const installerArgs = (extra = []) => [
  '--install-package', zip,
  '--api-url', `http://127.0.0.1:${apiPort}`,
  '--install-dir', installRoot,
  '--test-data-dir', testDataRoot,
  '--task-name', taskName,
  '--local-port', String(agentPort),
  '--test-mode',
  '--quiet',
  ...extra
]

const install = async extra => {
  let finished = false
  const observations = []
  const running = run(setup, installerArgs(extra)).finally(() => { finished = true })
  while (!finished) {
    await delay(1500)
    const taskQuery = spawnSync('schtasks.exe', ['/Query', '/TN', taskName, '/V', '/FO', 'LIST'], { encoding: 'utf8', windowsHide: true, timeout: 5_000 })
    const processes = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq PrintFlowAgentHost.exe', '/FO', 'CSV'], { encoding: 'utf8', windowsHide: true, timeout: 5_000 })
    const healthProbe = await fetch(healthUrl(), { signal: AbortSignal.timeout(750) }).then(response => `health=${response.status}`).catch(() => 'health=offline')
    const log = await readFile(path.join(installRoot, 'logs', 'host.log'), 'utf8').catch(() => '')
    observations.push([`at=${new Date().toISOString()}`, healthProbe, `task=${(taskQuery.stdout || taskQuery.stderr || '').trim()}`, `host-process=${(processes.stdout || '').trim()}`, `host-log=${log.trim()}`].join('\n'))
    if (observations.length > 6) observations.shift()
  }
  const result = await running
  result.observations = observations.join('\n\n')
  if (result.code !== 0) {
    try {
      result.installerLog = await readFile(path.join(testDataRoot, 'installer.log'), 'utf8')
    } catch {}
  }
  return result
}

const cleanup = async () => {
  const ended = spawnSync('schtasks.exe', ['/End', '/TN', taskName], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
  void ended
  await delay(500)
  const removed = spawnSync('schtasks.exe', ['/Delete', '/TN', taskName, '/F'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
  void removed
  const listeners = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
  for (const line of String(listeners.stdout || '').split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/)
    if (!columns[1]?.endsWith(`:${agentPort}`) || columns[3]?.toUpperCase() !== 'LISTENING') continue
    const pid = Number(columns.at(-1))
    if (Number.isInteger(pid) && pid > 0) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
  }
  await delay(300)
  await rm(installRoot, { recursive: true, force: true })
  await rm(testDataRoot, { recursive: true, force: true })
}

try {
  assert.ok(await exists(setup), `native setup is missing: ${setup}`)
  assert.ok(await exists(zip), `Agent package ZIP is missing: ${zip}`)
  apiPort = await listen(apiServer)
  agentPort = await getFreePort()

  const firstInstall = await install()
  if (firstInstall.code !== 0) {
    const diagnostics = []
    for (const file of [
      path.join(installRoot, 'logs', 'host.log'),
      path.join(installRoot, 'logs', 'agent.log'),
      path.join(installRoot, 'logs', 'error.log'),
      path.join(testDataRoot, 'logs', 'agent.log')
    ]) {
      try { diagnostics.push(`${file}:\n${await readFile(file, 'utf8')}`) } catch {}
    }
    const taskQuery = spawnSync('schtasks.exe', ['/Query', '/TN', taskName, '/V', '/FO', 'LIST'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
    if (taskQuery.stdout || taskQuery.stderr) diagnostics.push(`scheduled task:\n${taskQuery.stdout || taskQuery.stderr}`)
    const healthProbe = await fetch(healthUrl(), { signal: AbortSignal.timeout(1500) }).then(async response => `${response.status} ${await response.text()}`).catch(error => error.message)
    diagnostics.push(`health probe: ${healthProbe}`)
    firstInstall.diagnostics = diagnostics.join('\n\n')
  }
  assert.equal(firstInstall.code, 0, `initial install failed (${firstInstall.code}): ${firstInstall.installerLog || firstInstall.stderr}\n${firstInstall.diagnostics || ''}\n${firstInstall.observations || ''}`)
  installed = true
  task('/Query')
  assert.equal(await readFile(path.join(installRoot, 'package.json'), 'utf8').then(value => JSON.parse(value).version), '0.1.25')
  await waitForHealth(health => health.ok && health.version === '0.1.25' && health.activePrintJobs === 0)

  const queuedPairing = await fetch(`http://127.0.0.1:${agentPort}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: pairCode })
  })
  assert.equal(queuedPairing.status, 202)
  const pairedHealth = await waitForHealth(health => health.paired && health.cloudConnected && health.activePrintJobs === 0)
  assert.equal(pairedHealth.version, '0.1.25')
  assert.ok(pairCalls.some(call => call.code === pairCode && call.version === '0.1.25'))
  await waitForHealth(() => heartbeatCount > 0)

  verifyDelayMs = 15_000
  delayNextVerify = true
  task('/End')
  await waitUntilUnavailable()
  const delayedCloudUpdate = await install()
  assert.equal(delayedCloudUpdate.code, 0, `update waited for Cloud reconnect (${delayedCloudUpdate.code}): ${delayedCloudUpdate.installerLog || delayedCloudUpdate.stderr}\n${delayedCloudUpdate.observations || ''}`)
  task('/Query')
  await waitForHealth(health => health.paired && health.cloudConnected && health.version === '0.1.25', 90_000)
  verifyDelayMs = 0

  const sentinel = path.join(installRoot, 'rollback-sentinel.txt')
  await writeFile(sentinel, 'prior isolated installation must survive a failed upgrade\n', 'utf8')
  task('/End')
  await waitUntilUnavailable()
  const failedUpgrade = await install(['--test-fail-after-copy'])
  assert.equal(failedUpgrade.code, 1, `injected upgrade unexpectedly succeeded: ${failedUpgrade.installerLog || failedUpgrade.stderr}`)
  assert.equal(await readFile(sentinel, 'utf8'), 'prior isolated installation must survive a failed upgrade\n')
  task('/Query')
  const rolledBackHealth = await waitForHealth(health => health.paired && health.cloudConnected && health.version === '0.1.25')
  assert.equal(rolledBackHealth.activePrintJobs, 0)

  task('/End')
  await waitUntilUnavailable()
  task('/Run')
  const heartbeatsBeforeRestart = heartbeatCount
  const restartedHealth = await waitForHealth(health => health.paired && health.cloudConnected && health.version === '0.1.25')
  assert.equal(restartedHealth.activePrintJobs, 0)
  await waitForHealth(() => heartbeatCount > heartbeatsBeforeRestart)

  const uninstall = await run(setup, [
    '--uninstall', '--install-dir', installRoot, '--task-name', taskName, '--test-mode'
  ])
  if (uninstall.code !== 0) {
    try {
      uninstall.installerLog = await readFile(path.join(testDataRoot, 'installer.log'), 'utf8')
    } catch {}
  }
  assert.equal(uninstall.code, 0, `uninstall failed (${uninstall.code}): ${uninstall.installerLog || uninstall.stderr}`)
  const deleteDeadline = Date.now() + 30_000
  while (Date.now() < deleteDeadline && await exists(installRoot)) await delay(250)
  assert.equal(await exists(installRoot), false, 'test install directory remains after uninstall')
  assert.notEqual(task('/Query', false).status, 0, 'isolated scheduled task remains after uninstall')
  installed = false

  process.stdout.write(JSON.stringify({
    status: 'passed',
    version: '0.1.25',
    installRoot,
    taskName,
    agentPort,
    apiPort,
    paired: true,
    cloudConnected: true,
    heartbeatCount,
    rollbackMarkerRestored: true,
    taskRemoved: true,
    installRemoved: true
  }, null, 2) + '\n')
} finally {
  if (apiServer?.listening) await new Promise(resolve => apiServer.close(resolve))
  if (installed || await exists(installRoot) || await exists(testDataRoot)) await cleanup()
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
