import assert from 'node:assert/strict'
import test from 'node:test'

import { createAgentHealthSnapshot } from '../src/runtime/healthSnapshot.js'

test('agrega health de Agent sem enviar identificadores de impressoras ou payloads', () => {
  const snapshot = createAgentHealthSnapshot({
    uptimeSeconds: 120,
    backend: { connected: true, lastLatencyMs: 25, url: 'private' },
    realtimeMode: 'websocket',
    sqlite: { status: 'open', schemaVersion: 8 },
    outbox: { pending: 2, deadLetter: 1 },
    cache: { files: 3, bytes: 100, pinnedFiles: 1, temporaryFiles: 0, path: 'private' },
    printerHealth: [{ key: 'secret-printer-id', state: 'degraded' }, { state: 'offline' }],
    connections: [{ key: 'private-ip', connected: true }],
    metrics: [{ state: { category: 'printer_status', key: 'moonraker', count: 4, failures: 1, totalDurationMs: 80, maxDurationMs: 50, histogramCount: 2, durationBuckets: [1, 1], password: 'secret' } }]
  })

  assert.deepEqual(snapshot, {
    status: 'degraded',
    uptimeSeconds: 120,
    realtimeMode: 'websocket',
    backend: { connected: true, latencyMs: 25 },
    sqlite: { status: 'open', schemaVersion: 8 },
    outbox: { pending: 2, deadLetter: 1 },
    cache: { files: 3, bytes: 100, pinnedFiles: 1, temporaryFiles: 0 },
    printers: { connected: 1, degraded: 1, offline: 1 },
    metrics: [{ category: 'printer_status', key: 'moonraker', count: 4, failures: 1, avgMs: 20, maxMs: 50, histogramCount: 2, durationBuckets: [1, 1, 0, 0, 0, 0, 0, 0] }]
  })
  assert.equal(JSON.stringify(snapshot).includes('secret-printer-id'), false)
  assert.equal(JSON.stringify(snapshot).includes('private'), false)
  assert.equal(JSON.stringify(snapshot).includes('secret'), false)
})

test('marca agente offline/degradado de acordo com conectividade e sqlite', () => {
  assert.equal(createAgentHealthSnapshot().status, 'offline')
  assert.equal(createAgentHealthSnapshot({ backend: { connected: true } }).status, 'degraded')
  assert.equal(createAgentHealthSnapshot({ backend: { connected: true }, sqlite: { status: 'open' } }).status, 'healthy')
})
