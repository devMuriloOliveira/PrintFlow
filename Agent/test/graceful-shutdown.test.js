import assert from 'node:assert/strict'
import test from 'node:test'
import { createGracefulShutdown } from '../src/runtime/gracefulShutdown.js'

test('graceful shutdown ordena stop, drain, outbox e fechamento e ignora sinais duplicados', async () => {
  const calls = []
  const options = Object.fromEntries(['stopAccepting', 'stopBackgroundWork', 'drainCommands', 'flushOutbox', 'disconnectPrinters', 'closeServer', 'closeDatabase'].map(name => [name, async () => calls.push(name)]))
  const exits = []
  const shutdown = createGracefulShutdown({ ...options, exit: code => exits.push(code) })
  const first = shutdown.shutdown('SIGINT')
  const second = shutdown.shutdown('SIGTERM')
  await Promise.all([first, second])
  assert.deepEqual(calls, ['stopAccepting', 'stopBackgroundWork', 'drainCommands', 'flushOutbox', 'disconnectPrinters', 'closeServer', 'closeDatabase'])
  assert.deepEqual(exits, [0])
})

test('graceful shutdown termina no limite quando uma etapa trava', async () => {
  const exits = []
  const shutdown = createGracefulShutdown({ stopAccepting: () => new Promise(() => {}), timeoutMs: 10, exit: code => exits.push(code), log: () => {} })
  assert.equal(await shutdown.shutdown(), 'timeout')
  assert.deepEqual(exits, [1])
})
