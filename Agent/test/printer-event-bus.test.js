import assert from 'node:assert/strict'
import test from 'node:test'

import { publishPrinterEvent, subscribePrinterEvents, waitForPrinterStatusEvent } from '../src/printers/printerEventBus.js'

test('event bus normaliza status, progresso e omite campos privados/raw', () => {
  const events = []
  const printerKey = `bambu:test-${Date.now()}`
  const unsubscribe = subscribePrinterEvents(printerKey, event => events.push(event))
  publishPrinterEvent({ printerKey, protocol: 'bambu', status: { state: 'printing', progress: 1, ip: '192.168.1.20', serial: 'SECRET', raw: { token: 'secret' } } })
  publishPrinterEvent({ printerKey, protocol: 'bambu', status: { state: 'printing', progress: 2 } })
  unsubscribe()

  assert.equal(events[0].type, 'printer.started')
  assert.equal(events[1].type, 'printer.progress')
  assert.deepEqual(events[0].status, { state: 'printing', progress: 1 })
  assert.equal(events[0].printerKey, printerKey)
})

test('monitor consegue aguardar evento de status e retorna somente status normalizado', async () => {
  const printerKey = `moonraker:test-${Date.now()}`
  const pending = waitForPrinterStatusEvent(printerKey, 1000)
  publishPrinterEvent({ printerKey, protocol: 'moonraker', status: { state: 'paused', progress: 45, file: 'private.gcode' } })

  assert.deepEqual(await pending, { state: 'paused', progress: 45 })
})
