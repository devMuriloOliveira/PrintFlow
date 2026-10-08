import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeAgentRuntimeHealth } from '../src/services/agentRuntimeHealth.js'
import { normalizeAgentCommandProgress } from '../src/services/agentCommandProgress.js'

test('normaliza snapshot de saude permitido e descarta campos inesperados', () => {
  const result = normalizeAgentRuntimeHealth({
    status: 'healthy',
    uptimeSeconds: 123,
    realtimeMode: 'websocket',
    backend: { connected: true, latencyMs: 42, token: 'do-not-store' },
    sqlite: { status: 'open', schemaVersion: 8 },
    outbox: { pending: 2, deadLetter: 1 },
    cache: { files: 3, bytes: 1000, pinnedFiles: 1, temporaryFiles: 0, path: 'private' },
    printers: { connected: 2, degraded: 1, offline: 0, serial: 'private' },
    metrics: [{ category: 'printer_status', key: 'moonraker', count: 10, failures: 1, avgMs: 70, maxMs: 120, payload: 'private' }],
    agentSecret: 'never-store'
  })

  assert.deepEqual(result, {
    status: 'healthy',
    uptimeSeconds: 123,
    realtimeMode: 'websocket',
    backend: { connected: true, latencyMs: 42 },
    sqlite: { status: 'open', schemaVersion: 8 },
    outbox: { pending: 2, deadLetter: 1 },
    cache: { files: 3, bytes: 1000, pinnedFiles: 1, temporaryFiles: 0 },
    printers: { connected: 2, degraded: 1, offline: 0 },
    metrics: [{ category: 'printer_status', key: 'moonraker', count: 10, failures: 1, avgMs: 70, maxMs: 120, histogramCount: 0, durationBuckets: [0, 0, 0, 0, 0, 0, 0, 0], p50Ms: null, p95Ms: null, p99Ms: null }]
  })
  assert.equal(JSON.stringify(result).includes('never-store'), false)
  assert.equal(JSON.stringify(result).includes('private'), false)
})

test('limita texto, contagens e tamanho do snapshot e rejeita entrada inválida', () => {
  assert.equal(normalizeAgentRuntimeHealth(null), null)
  const bounded = normalizeAgentRuntimeHealth({
    status: 'unexpected',
    uptimeSeconds: -5,
    realtimeMode: 'unexpected',
    backend: { latencyMs: Infinity },
    metrics: [{ category: 'bad field !', key: 'x'.repeat(100), count: -1 }]
  })
  assert.equal(bounded.status, 'degraded')
  assert.equal(bounded.uptimeSeconds, 0)
  assert.equal(bounded.realtimeMode, 'offline')
  assert.deepEqual(bounded.metrics, [{ category: 'badfield', key: 'x'.repeat(40), count: 0, failures: 0, avgMs: 0, maxMs: 0, histogramCount: 0, durationBuckets: [0, 0, 0, 0, 0, 0, 0, 0], p50Ms: null, p95Ms: null, p99Ms: null }])
  assert.equal(normalizeAgentRuntimeHealth({
    metrics: Array.from({ length: 50 }, () => ({ category: 'x'.repeat(80), key: 'y'.repeat(80) }))
  }).metrics.length, 20)
})

test('calcula percentis aproximados a partir de buckets sem inventar amostras antigas', () => {
  const result = normalizeAgentRuntimeHealth({ metrics: [{
    category: 'printer_status', key: 'bambu', count: 20, failures: 0, avgMs: 125, maxMs: 500,
    histogramCount: 20, durationBuckets: [5, 5, 5, 3, 2, 0, 0, 0]
  }] })
  assert.equal(result.metrics[0].p50Ms, 100)
  assert.equal(result.metrics[0].p95Ms, 1000)
  assert.equal(result.metrics[0].p99Ms, 1000)
})

test('normaliza progresso incremental de discovery e remove credenciais inesperadas', () => {
  const progress = normalizeAgentCommandProgress({
    type: 'discovery', discoveredCount: 4,
    printers: [{
      connectionType: 'network', protocol: 'bambu', ip: '192.168.1.50', port: 8883,
      serial: 'BAMBU-01', name: 'Printer', requiresCredentials: true,
      requiredCredentials: ['serial', 'accessCode', 'adminSecret'], accessCode: 'do-not-store', token: 'nope'
    }],
    agentSecret: 'nope'
  })

  assert.equal(progress.discoveredCount, 4)
  assert.deepEqual(progress.printers[0].requiredCredentials, ['serial', 'accessCode'])
  assert.equal(JSON.stringify(progress).includes('do-not-store'), false)
  assert.equal(JSON.stringify(progress).includes('adminSecret'), false)
  assert.equal(normalizeAgentCommandProgress({ printers: [{ protocol: 'bambu' }] }).printers.length, 0)
})
