import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProductionMeasurements, normalizeAgentMetrics, recipeMaterialGrams, recordProductionJobMetrics } from '../src/services/productionJobMetrics.js'

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

test('simulação Agent -> Cloud persiste conclusão uma única vez', async () => {
  const state = { attempts: [], updates: 0 }
  const client = {
    async query(sql, params) {
      if (sql.includes('from print_jobs j')) return { rowCount: 1, rows: [{ id: 88, status: 'printing' }] }
      if (sql.includes('from print_job_attempts')) {
        const row = state.attempts.find((item) => item.idempotencyKey === params[1])
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] }
      }
      if (sql.includes('insert into print_job_attempts')) {
        const row = { id: 1, print_job_id: params[1], attempt_no: params[2], idempotencyKey: params[3], status: params[4], result: JSON.parse(params[5]) }
        state.attempts.push(row)
        return { rowCount: 1, rows: [row] }
      }
      if (sql.includes('update print_jobs')) {
        state.updates += 1
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`SQL inesperado: ${sql}`)
    }
  }
  const payload = { status: 'completed', idempotencyKey: 'agent-job-88-complete', attemptNo: 1, actualPrintSeconds: 120, actualFilamentGrams: 4.2 }
  const first = await recordProductionJobMetrics({ client, tenantId: 'tenant-a', agentId: 7, printJobId: 88, payload })
  const retry = await recordProductionJobMetrics({ client, tenantId: 'tenant-a', agentId: 7, printJobId: 88, payload })
  assert.equal(first.idempotent, false)
  assert.equal(retry.idempotent, true)
  assert.equal(state.attempts.length, 1)
  assert.equal(state.updates, 1)
})
