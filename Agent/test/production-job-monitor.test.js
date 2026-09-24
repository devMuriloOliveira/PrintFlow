import assert from 'node:assert/strict'
import test from 'node:test'
import { measuredMetricsFromStatus, monitorPrintJobCompletion, normalizeCompletionState } from '../src/printing/productionJobMonitor.js'

test('monitor de Production Job transforma estado terminal em conclusão idempotente', async () => {
  const calls = []
  const result = await monitorPrintJobCompletion({
    command: { id: 'cmd-7', payload: { printJobId: 'job-7', printer: { id: 'printer-7' }, startedAt: new Date(Date.now() - 120000).toISOString() } },
    context: { apiUrl: 'https://api.example.test', credentials: { agentId: 'agent-7', agentSecret: 'secret' } },
    getStatus: async () => ({ state: 'FINISH', actualPrintSeconds: 118, actualFilamentGrams: 4.25 }),
    report: async (...args) => { calls.push(args); return { idempotent: false } }
  })
  assert.deepEqual(result, { idempotent: false })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][2], 'job-7')
  assert.deepEqual(calls[0][3], { status: 'completed', idempotencyKey: 'agent-cmd-7-completion', attemptNo: 1, actualPrintSeconds: 118, actualFilamentGrams: 4.25, actualFilamentMillimeters: null })
})

test('monitor nao inventa filamento quando o adapter nao fornece telemetria', () => {
  assert.equal(normalizeCompletionState({ state: 'CANCELLED' }), 'cancelled')
  assert.deepEqual(measuredMetricsFromStatus({ status: { state: 'FINISH' }, startedAt: null }), { actualPrintSeconds: null, actualFilamentGrams: null, actualFilamentMillimeters: null })
})

test('monitor reconecta e continua depois de falha transitoria', async () => {
  let connections = 0
  let statusChecks = 0
  let waits = 0
  const result = await monitorPrintJobCompletion({
    command: { id: 'cmd-restart', payload: { printJobId: 'job-restart', printer: { id: 'printer-restart' } } },
    context: { apiUrl: 'https://api.example.test', credentials: { agentId: 'agent-7', agentSecret: 'secret' } },
    ensureConnection: async () => { connections += 1 },
    getStatus: async () => {
      statusChecks += 1
      if (statusChecks === 1) throw new Error('conexao ainda indisponivel')
      return { state: 'completed', elapsedSeconds: 20 }
    },
    wait: async () => { waits += 1 },
    maxPolls: 3,
    report: async () => ({ synchronized: true })
  })
  assert.deepEqual(result, { synchronized: true })
  assert.equal(connections, 2)
  assert.equal(statusChecks, 2)
  assert.equal(waits, 1)
})
