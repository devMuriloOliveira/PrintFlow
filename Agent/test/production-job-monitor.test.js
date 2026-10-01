import assert from 'node:assert/strict'
import test from 'node:test'
import { getNextPollDelay, measuredMetricsFromStatus, monitorPrintJobCompletion, normalizeCompletionState } from '../src/printing/productionJobMonitor.js'
import { getPrinterStatus } from '../src/printers/printerManager.js'

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

test('monitor reduz polling em impressao estavel e preserva resposta rapida perto do fim ou em pausa', () => {
  assert.equal(getNextPollDelay({ status: { state: 'RUNNING', progress: 42 }, pollMs: 5000, stablePollMs: 15000 }), 15000)
  assert.equal(getNextPollDelay({ status: { state: 'RUNNING', progress: 95 }, pollMs: 5000, stablePollMs: 15000 }), 5000)
  assert.equal(getNextPollDelay({ status: { state: 'PAUSED' }, pollMs: 5000, stablePollMs: 15000 }), 5000)
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

test('monitor consome evento normalizado terminal sem chamar polling de reserva', async () => {
  let reported
  const result = await monitorPrintJobCompletion({
    command: { id: 'cmd-event', payload: { printJobId: 'job-event', printer: { id: 'printer-event', protocol: 'moonraker', connectionType: 'network', ip: '127.0.0.1', port: 7125 } } },
    context: { apiUrl: 'https://api.example.test', credentials: { agentId: 'agent-event', agentSecret: 'secret' } },
    getStatus: getPrinterStatus,
    ensureConnection: async () => {},
    waitForStatusEvent: async () => ({ state: 'completed', actualPrintSeconds: 36 }),
    eventWaitMs: 1000,
    report: async (_url, _credentials, _id, payload) => { reported = payload; return { synchronized: true } }
  })

  assert.deepEqual(result, { synchronized: true })
  assert.equal(reported.status, 'completed')
})
