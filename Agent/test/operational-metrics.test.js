import assert from 'node:assert/strict'
import test from 'node:test'
import { recordOperationalMetric } from '../src/runtime/operationalMetrics.js'

test('metricas locais agregam duracao e falhas sem registrar payload sensivel', () => {
  const states = new Map()
  const operations = {
    getLocalState: (type, id) => states.get(`${type}:${id}`) || null,
    upsertLocalState: (type, id, state) => states.set(`${type}:${id}`, { state })
  }
  recordOperationalMetric({ operations, category: 'printer_status', key: 'bambu', durationMs: 42 })
  const result = recordOperationalMetric({ operations, category: 'printer_status', key: 'bambu', durationMs: 75, failed: true })
  assert.deepEqual(result.category, 'printer_status')
  assert.equal(result.key, 'bambu')
  assert.equal(result.count, 2)
  assert.equal(result.failures, 1)
  assert.equal(result.consecutiveFailures, 1)
  assert.equal(result.totalDurationMs, 117)
  assert.equal(result.maxDurationMs, 75)
  assert.equal(JSON.stringify(result).includes('secret'), false)

  const secondFailure = recordOperationalMetric({
    operations,
    category: 'printer_status',
    key: 'bambu',
    durationMs: 20,
    failed: true
  })
  assert.equal(secondFailure.consecutiveFailures, 2)

  const recovered = recordOperationalMetric({
    operations,
    category: 'printer_status',
    key: 'bambu',
    durationMs: 10
  })
  assert.equal(recovered.consecutiveFailures, 0)
})

test('falha ao persistir metrica nao afeta o fluxo do Agent', () => {
  assert.equal(recordOperationalMetric({
    operations: {
      getLocalState: () => { throw new Error('sqlite indisponivel') },
      upsertLocalState: () => {}
    },
    category: 'discovery',
    key: 'network'
  }), null)
})
