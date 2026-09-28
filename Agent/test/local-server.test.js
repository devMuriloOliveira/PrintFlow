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
          activePrintJobs: 2
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
  }
)

test(
  'diagnostico local nao expoe credenciais e redige enderecos',
  async t => {
    const server = startLocalServer({
      port: 0,
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
    const payload = await response.json()

    assert.equal(response.status, 200)
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
