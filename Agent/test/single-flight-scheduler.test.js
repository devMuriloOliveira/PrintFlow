import assert from 'node:assert/strict'
import test from 'node:test'

import { createSingleFlightScheduler } from '../src/cloud/singleFlightScheduler.js'

const createFakeTimers = () => {
  let nextId = 1
  const callbacks = new Map()
  return {
    setTimer: callback => {
      const id = nextId
      nextId += 1
      callbacks.set(id, callback)
      return id
    },
    clearTimer: id => callbacks.delete(id),
    count: () => callbacks.size,
    runNext: async () => {
      const [id, callback] = callbacks.entries().next().value || []
      if (!callback) return
      callbacks.delete(id)
      await callback()
    }
  }
}

test('agendamentos SSE e WebSocket convergem para um unico polling', async () => {
  const timers = createFakeTimers()
  let executions = 0
  const scheduler = createSingleFlightScheduler({
    run: async () => { executions += 1 },
    getDefaultDelay: () => 5_000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  })

  scheduler.schedule(5_000)
  scheduler.schedule(0)
  scheduler.schedule(0)
  assert.equal(timers.count(), 1)

  await timers.runNext()
  assert.equal(executions, 1)
  assert.equal(timers.count(), 1)
})

test('evento recebido durante execucao gera somente uma nova verificacao', async () => {
  const timers = createFakeTimers()
  let release
  let executions = 0
  const scheduler = createSingleFlightScheduler({
    run: async () => {
      executions += 1
      await new Promise(resolve => { release = resolve })
    },
    getDefaultDelay: () => 5_000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  })

  scheduler.schedule(0)
  const running = timers.runNext()
  await new Promise(resolve => setImmediate(resolve))
  scheduler.schedule(0)
  scheduler.schedule(0)
  assert.equal(scheduler.getState().requested, true)
  assert.equal(timers.count(), 0)

  release()
  await running
  assert.equal(executions, 1)
  assert.equal(timers.count(), 1)
})
