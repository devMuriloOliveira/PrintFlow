import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeAgentPrinterHeartbeat,
  syncAgentPrinterHeartbeat
} from '../src/services/agentPrinterHeartbeat.js'

test('heartbeat antigo sem printers preserva comportamento anterior', async () => {
  const calls = []
  const result = await syncAgentPrinterHeartbeat({
    client: { query: async (...args) => { calls.push(args); return { rowCount: 0 } } },
    tenantId: 'tenant-a',
    agentId: 'agent-a',
    printers: undefined
  })

  assert.deepEqual(result, { skipped: true, updated: 0 })
  assert.equal(calls.length, 0)
})

test('heartbeat marca impressora ausente ou desconectada como offline sem apagar cadastro', async () => {
  const calls = []
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params })
      return { rowCount: sql.includes('connection_key = $6') ? 1 : 2 }
    }
  }

  const result = await syncAgentPrinterHeartbeat({
    client,
    tenantId: 'tenant-a',
    agentId: 'agent-a',
    printers: [{
      connectionKey: 'bambu:SERIAL-A',
      status: 'disconnected',
      lastError: 'impressora fora da rede',
      lastStatus: { state: 'IDLE', progress: 0 }
    }]
  })

  assert.deepEqual(result, { skipped: false, updated: 1 })
  assert.match(calls[0].sql, /update agent_printers/)
  assert.doesNotMatch(calls[0].sql, /delete/i)
  assert.deepEqual(calls[0].params, ['tenant-a', 'agent-a', []])
  assert.deepEqual(calls[1].params, [
    'disconnected',
    'impressora fora da rede',
    JSON.stringify({ state: 'IDLE', progress: 0 }),
    'tenant-a',
    'agent-a',
    'bambu:SERIAL-A'
  ])
})

test('heartbeat reconectado limpa offline e limita dados recebidos', async () => {
  const normalized = normalizeAgentPrinterHeartbeat([
    {
      connectionKey: 'bambu:SERIAL-A',
      status: 'connected',
      lastError: '',
      lastStatus: { state: 'RUNNING', progress: 25 }
    },
    { connectionKey: '', status: 'connected' },
    { connectionKey: 'bambu:SERIAL-A', status: 'connected', lastError: 'novo' }
  ])

  assert.deepEqual(normalized, [{
    connectionKey: 'bambu:SERIAL-A',
    status: 'connected',
    lastError: 'novo',
    lastStatus: null
  }])

  const calls = []
  await syncAgentPrinterHeartbeat({
    client: {
      query: async (sql, params) => {
        calls.push({ sql, params })
        return { rowCount: 1 }
      }
    },
    tenantId: 'tenant-a',
    agentId: 'agent-a',
    printers: normalized
  })

  assert.deepEqual(calls[0].params, ['tenant-a', 'agent-a', ['bambu:SERIAL-A']])
  assert.equal(calls[1].params[0], 'connected')
  assert.match(calls[1].sql, /disconnected_at = case/)
})
