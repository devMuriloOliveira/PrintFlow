import assert from 'node:assert/strict'
import test from 'node:test'

import { createCommandDispatcher, commandResourceKey } from '../src/commands/commandDispatcher.js'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const command = (id, printerId) => ({ id, type: 'printer_status', payload: { agentPrinterId: printerId } })

test('comandos em impressoras diferentes concorrem e comandos da mesma impressora mantem ordem', async () => {
  const started = []
  const done = []
  const dispatcher = createCommandDispatcher({ maxConcurrentPrinterCommands: 2, run: async item => {
    started.push(item.id)
    await wait(item.id === 'a1' ? 50 : 5)
    done.push(item.id)
  } })

  const a1 = dispatcher.enqueue(command('a1', 'A'))
  const a2 = dispatcher.enqueue(command('a2', 'A'))
  const b1 = dispatcher.enqueue(command('b1', 'B'))
  await Promise.all([a1, a2, b1])

  assert.deepEqual(started, ['a1', 'b1', 'a2'])
  assert.ok(done.indexOf('b1') < done.indexOf('a1'))
})

test('pool de comandos limita concorrencia e slicing usa limite separado', async () => {
  let activePrinter = 0
  let maxPrinter = 0
  let activeSlicing = 0
  let maxSlicing = 0
  const dispatcher = createCommandDispatcher({
    maxConcurrentPrinterCommands: 3,
    maxConcurrentSlicingJobs: 1,
    run: async item => {
      const slicing = item.type === 'slice_print_job'
      if (slicing) { activeSlicing += 1; maxSlicing = Math.max(maxSlicing, activeSlicing) }
      else { activePrinter += 1; maxPrinter = Math.max(maxPrinter, activePrinter) }
      await wait(4)
      if (slicing) activeSlicing -= 1
      else activePrinter -= 1
    }
  })

  await Promise.all(Array.from({ length: 10 }, (_, index) => dispatcher.enqueue(command(`p${index}`, `printer-${index}`))))
  await Promise.all(Array.from({ length: 6 }, (_, index) => dispatcher.enqueue({ id: `s${index}`, type: 'slice_print_job', payload: { job: { id: `job-${index}` } } })))
  assert.equal(maxPrinter, 3)
  assert.equal(maxSlicing, 1)
  assert.equal(commandResourceKey({ type: 'slice_print_job', id: 'fallback' }), 'slicer:fallback')
})

test('stress local processa 500 comandos com limite, erro individual e pools sem vazamento', async () => {
  let active = 0
  let peak = 0
  let completed = 0
  const dispatcher = createCommandDispatcher({ maxConcurrentPrinterCommands: 4, run: async item => {
    active += 1
    peak = Math.max(peak, active)
    await wait(1)
    active -= 1
    completed += 1
    if (Number(item.id.slice(1)) % 37 === 0) throw new Error('falha simulada')
  } })
  const results = await Promise.allSettled(Array.from({ length: 500 }, (_, index) => dispatcher.enqueue(command(`c${index}`, `printer-${index % 20}`))))
  assert.equal(results.length, 500)
  assert.ok(peak <= 4)
  assert.equal(completed, 500)
  assert.equal(dispatcher.getState().queued, 0)
  assert.equal(dispatcher.getState().resources, 0)
})

test('dispatcher propaga cancelamento ao comando em execucao e por tipo', async () => {
  let resolveStarted
  const started = new Promise(resolve => { resolveStarted = resolve })
  let observedAbort
  const dispatcher = createCommandDispatcher({ run: async (_item, { signal }) => {
    observedAbort = signal
    resolveStarted()
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
  } })

  const running = dispatcher.enqueue({ id: 'discovery-1', type: 'discover_printers' })
  await started
  assert.equal(dispatcher.cancelCommandsByType('printer_status'), 0)
  assert.equal(observedAbort.aborted, false)
  assert.equal(dispatcher.cancelCommandsByType('discover_printers'), 1)
  await running
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(observedAbort.aborted, true)
  assert.equal(dispatcher.getState().queued, 0)
  assert.equal(dispatcher.getState().resources, 0)
})

test('dispatcher nao inicia comando cancelado enquanto aguardava vaga no pool', async () => {
  let releaseFirst
  const firstGate = new Promise(resolve => { releaseFirst = resolve })
  const started = []
  const dispatcher = createCommandDispatcher({
    maxConcurrentPrinterCommands: 1,
    run: async item => {
      started.push(item.id)
      if (item.id === 'first') await firstGate
    }
  })

  const first = dispatcher.enqueue(command('first', 'A'))
  const queued = dispatcher.enqueue(command('queued', 'B'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(dispatcher.cancelCommand('queued'), true)
  releaseFirst()

  await Promise.allSettled([first, queued])
  assert.deepEqual(started, ['first'])
  assert.equal(dispatcher.getState().queued, 0)
  assert.equal(dispatcher.getState().resources, 0)
})
