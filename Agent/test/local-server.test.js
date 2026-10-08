import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const dataDirectory =
  await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      'printflow-agent-local-server-'
    )
  )

process.env.PRINTFLOW_AGENT_DATA_DIR =
  dataDirectory

const {
  startLocalServer
} = await import(
  '../src/localServer.js'
)
const {
  createDiagnosticsToken,
  readDiagnosticsToken,
  removeDiagnosticsToken
} = await import('../src/storage/diagnosticsToken.js')

test(
  'health local bloqueia atualizacao durante impressao monitorada',
  async t => {
    const server =
      startLocalServer({
        port: 0,
        getRuntimeStatus: () => ({
          updateBlocked: true,
        updateBlockedReason:
            'active_print',
          activePrintJobs: 2,
          cloudConnected: true
        })
      })

    await new Promise((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })

    t.after(
      () =>
        new Promise(resolve =>
          server.close(resolve)
        )
    )

    const address = server.address()
    const response = await fetch(
      `http://127.0.0.1:${address.port}/healthz`
    )
    const payload = await response.json()

    assert.equal(response.status, 200)
    assert.equal(payload.updateBlocked, true)
    assert.equal(
      payload.updateBlockedReason,
      'active_print'
    )
    assert.equal(payload.activePrintJobs, 2)
    assert.equal(payload.cloudConnected, true)
    const diagnostics = await fetch(`http://127.0.0.1:${address.port}/diagnostics`)
    assert.equal(diagnostics.status, 503)
  }
)

test(
  'diagnostico local nao expoe credenciais e redige enderecos',
  async t => {
    const server = startLocalServer({
      port: 0,
      diagnosticsToken: 'diagnostics-test-token-0123456789abcdef',
      getRuntimeStatus: () => ({
        updateBlocked: false,
        activePrintJobs: 0
      }),
      getDiagnostics: () => ({
        connections: [{
          protocol: 'bambu',
          printer: {
            ip: '192.168.10.25',
            serial: 'SERIAL-TESTE'
          },
          accessCode: 'NAO-DEVE-APARECER'
        }]
      })
    })

    await new Promise((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })

    t.after(
      () =>
        new Promise(resolve =>
          server.close(resolve)
        )
    )

    const address = server.address()
    const response = await fetch(
      `http://127.0.0.1:${address.port}/diagnostics`
    )
    assert.equal(response.status, 401)

    const unauthorized = await fetch(`http://127.0.0.1:${address.port}/diagnostics`, {
      headers: { 'x-printflow-diagnostics-token': 'wrong-token' }
    })
    assert.equal(unauthorized.status, 401)

    const authorized = await fetch(`http://127.0.0.1:${address.port}/diagnostics`, {
      headers: { 'x-printflow-diagnostics-token': 'diagnostics-test-token-0123456789abcdef' }
    })
    const payload = await authorized.json()

    assert.equal(authorized.status, 200)
    assert.equal(payload.ok, true)
    assert.equal(
      payload.connections[0].printer.ip,
      '192.168.10.x'
    )
    assert.equal(payload.connections[0].printer.serial, '***ESTE')
    assert.equal(
      JSON.stringify(payload).includes('NAO-DEVE-APARECER'),
      false
    )
    assert.ok(
      payload.network.interfaces.every(item =>
        !/^\d+\.\d+\.\d+\.\d+$/.test(item.address) ||
        item.address.endsWith('.x')
      )
    )
  }
)

test(
  'servidor local restringe origem, diagnostico web e novo pareamento',
  async t => {
    const server = startLocalServer({
      port: 0,
      diagnosticsToken: 'diagnostics-test-token-0123456789abcdef',
      allowedOrigins: ['https://app.example.com'],
      canAcceptPairing: () => false
    })

    await new Promise((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    t.after(() => new Promise(resolve => server.close(resolve)))

    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const rejected = await fetch(`${baseUrl}/healthz`, {
      headers: { Origin: 'https://malicious.example' }
    })
    assert.equal(rejected.status, 403)
    assert.equal(rejected.headers.get('access-control-allow-origin'), null)

    const allowed = await fetch(`${baseUrl}/healthz`, {
      headers: { Origin: 'https://app.example.com' }
    })
    assert.equal(allowed.status, 200)
    assert.equal(
      allowed.headers.get('access-control-allow-origin'),
      'https://app.example.com'
    )

    const diagnostics = await fetch(`${baseUrl}/diagnostics`, {
      headers: { Origin: 'https://app.example.com' }
    })
    assert.equal(diagnostics.status, 403)

    const pairing = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.example.com',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code: 'PF-ABCD-EFGH' })
    })
    assert.equal(pairing.status, 409)
  }
)

test('token de diagnostico e rotacionado no armazenamento local', async () => {
  const first = await createDiagnosticsToken()
  assert.match(first.token, /^[A-Za-z0-9_-]{40,64}$/)
  assert.equal(await readDiagnosticsToken(), first.token)
  const stored = await fs.readFile(first.tokenPath, 'utf8')
  assert.equal(stored.includes(first.token), false)
  assert.match(stored, /windows-dpapi/)
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(first.tokenPath)).mode & 0o777, 0o600)
  }

  const second = await createDiagnosticsToken()
  assert.notEqual(second.token, first.token)
  assert.equal(await readDiagnosticsToken(), second.token)
  removeDiagnosticsToken()
})

test('server informa falha de bind para impedir uma segunda instancia do Agent', async () => {
  const first = startLocalServer({ port: 0 })
  await first.ready
  const port = first.address().port
  const duplicate = startLocalServer({ port })
  await assert.rejects(duplicate.ready, /EADDRINUSE/)
  await new Promise(resolve => first.close(resolve))
})
