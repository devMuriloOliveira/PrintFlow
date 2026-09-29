import assert from 'node:assert/strict'
import test from 'node:test'

import { createFatalShutdownController } from '../src/runtime/fatalShutdown.js'

test('encerra apos fatal quando nao ha comando ou impressao ativa', () => {
  const exitCodes = []
  const logs = []
  const fatal = createFatalShutdownController({
    exit: code => exitCodes.push(code),
    log: (...args) => logs.push(args)
  })

  fatal.handle(new Error('unexpected'))
  fatal.handle(new Error('duplicate'))

  assert.equal(fatal.isShutdownRequested(), true)
  assert.deepEqual(exitCodes, [1])
  assert.equal(logs.length, 2)
})

test('espera comando e impressao ativos antes de solicitar reinicio', () => {
  let commandRunning = true
  let activePrintJobs = 1
  let scheduledCheck
  const exitCodes = []
  const fatal = createFatalShutdownController({
    isCommandRunning: () => commandRunning,
    getActivePrintJobs: () => activePrintJobs,
    exit: code => exitCodes.push(code),
    log: () => {},
    setTimer: callback => { scheduledCheck = callback; return 1 }
  })

  fatal.handle(new Error('unexpected during print'))
  assert.deepEqual(exitCodes, [])
  assert.equal(typeof scheduledCheck, 'function')

  commandRunning = false
  activePrintJobs = 0
  scheduledCheck()
  assert.deepEqual(exitCodes, [1])
})

test('mantem o processo ativo se o estado da impressora nao puder ser lido', () => {
  let scheduled = 0
  const exitCodes = []
  const fatal = createFatalShutdownController({
    getActivePrintJobs: () => { throw new Error('status unavailable') },
    exit: code => exitCodes.push(code),
    log: () => {},
    setTimer: () => { scheduled += 1; return 1 }
  })

  fatal.handle(new Error('unexpected'))
  assert.equal(scheduled, 1)
  assert.deepEqual(exitCodes, [])
})
