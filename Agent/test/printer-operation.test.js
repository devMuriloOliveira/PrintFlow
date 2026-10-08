import assert from 'node:assert/strict'
import test from 'node:test'

import { createPrinterOperationRunner, PrinterOperationTimeoutError } from '../src/printers/printerOperation.js'
import { connectPrinter, disconnectPrinter, listActiveConnections } from '../src/printers/printerManager.js'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test('runner serializa por printerKey e permite execucao de outra impressora', async () => {
  const runner = createPrinterOperationRunner()
  const calls = []
  const first = runner.run({ printerKey: 'A', operation: 'status', timeoutMs: 500, execute: async () => { calls.push('A-start'); await wait(40); calls.push('A-end') } })
  const second = runner.run({ printerKey: 'A', operation: 'control', timeoutMs: 500, execute: async () => { calls.push('A2') } })
  const other = runner.run({ printerKey: 'B', operation: 'status', timeoutMs: 500, execute: async () => { calls.push('B') } })
  await Promise.all([first, second, other])
  assert.ok(calls.indexOf('A-end') < calls.indexOf('A2'))
  assert.ok(calls.indexOf('B') < calls.indexOf('A-end'))
})

test('timeout aborta o signal e registra degradação sem bloquear outra impressora', async () => {
  const runner = createPrinterOperationRunner()
  let aborted = false
  await assert.rejects(runner.run({
    printerKey: 'hung',
    operation: 'status',
    timeoutMs: 10,
    execute: signal => new Promise(() => { signal.addEventListener('abort', () => { aborted = true }, { once: true }) })
  }), PrinterOperationTimeoutError)
  assert.equal(aborted, true)
  assert.equal(runner.getHealth('hung').consecutiveFailures, 1)
  await runner.run({ printerKey: 'other', operation: 'status', timeoutMs: 100, execute: async () => 'ok' })
})

test('circuit breaker aplica backoff por impressora e recupera após connect bem-sucedido', async () => {
  let clock = 100_000
  const runner = createPrinterOperationRunner({ now: () => clock, random: () => 0.5 })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(runner.run({ printerKey: 'offline', operation: 'status', timeoutMs: 100, execute: async () => { throw new Error('offline') } }))
  }
  const offline = runner.getHealth('offline')
  assert.equal(offline.state, 'offline')
  assert.equal(offline.consecutiveFailures, 3)
  await assert.rejects(runner.run({ printerKey: 'offline', operation: 'connect', timeoutMs: 100, execute: async () => 'unexpected' }), { code: 'printer_circuit_open' })
  clock = offline.nextRetryAt + 1
  await runner.run({ printerKey: 'offline', operation: 'connect', timeoutMs: 100, execute: async () => 'connected' })
  assert.equal(runner.getHealth('offline').state, 'healthy')
  assert.equal(runner.getHealth('offline').consecutiveFailures, 0)
})

test('três connect simultâneos usam a mesma tentativa de conexão', async () => {
  const printer = { protocol: 'bambu', connectionType: 'network', ip: '192.0.2.10', serial: 'PFDEDUPTEST001', mock: true }
  const connected = await Promise.all([connectPrinter(printer), connectPrinter(printer), connectPrinter(printer)])
  assert.ok(connected.every(result => result.connected))
  assert.equal(listActiveConnections().filter(entry => entry.key === 'bambu:PFDEDUPTEST001').length, 1)
  await disconnectPrinter(printer)
})
