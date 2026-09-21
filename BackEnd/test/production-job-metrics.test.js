import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProductionMeasurements, normalizeAgentMetrics, recipeMaterialGrams } from '../src/services/productionJobMetrics.js'

test('production metrics prefer measurement and calculate material/energy cost', () => {
  const result = buildProductionMeasurements({
    job: { quantity: 2 },
    product: { weight: 20, costBreakdown: { wastePercent: 10 } },
    filament: { initialWeight: 1000, cost: 80 },
    printer: { power: 200 },
    energyPricePerKwh: 1.2,
    metrics: { actualFilamentGrams: 42.5, actualPrintSeconds: 3600, estimatedFilamentGrams: 50 }
  })
  assert.equal(result.source, 'agent_measured')
  assert.equal(result.consumptionGrams, 42.5)
  assert.equal(result.materialCost, 3.4)
  assert.equal(result.energyCost, 0.24)
  assert.equal(result.maintenanceHours, 1)
})

test('production metrics fall back to recipe estimate without inventing actuals', () => {
  assert.equal(recipeMaterialGrams({ weight: 20, cost_breakdown: { wastePercent: 10 } }, 2), 44)
  const result = buildProductionMeasurements({ job: { quantity: 2 }, product: { weight: 20, costBreakdown: { wastePercent: 10 } } })
  assert.equal(result.source, 'recipe_estimate')
  assert.equal(result.consumptionGrams, 44)
  assert.equal(result.actual.filamentGrams, null)
})

test('Agent metrics require idempotency and reject invalid status or bounds', () => {
  assert.deepEqual(normalizeAgentMetrics({
    status: 'completed', idempotencyKey: 'cmd-1', attemptNo: 2,
    actualPrintSeconds: 10, actualFilamentGrams: 2.5
  }), {
    status: 'completed', idempotencyKey: 'cmd-1', attemptNo: 2,
    actualPrintSeconds: 10, actualFilamentGrams: 2.5, actualFilamentMillimeters: null
  })
  assert.throws(() => normalizeAgentMetrics({ status: 'running', idempotencyKey: 'cmd-2' }), /Status de Production Job invalido/)
  assert.equal(normalizeAgentMetrics({ idempotencyKey: 'cmd-3', actualPrintSeconds: 999999999 }).actualPrintSeconds, null)
})
