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
      if (sql.includes('select id, order_id, fulfillment_plan_id')) return { rowCount: 1, rows: [{ id: 88, order_id: null, fulfillment_plan_id: null }] }
      if (sql.includes('select id, quantity from print_jobs')) return { rowCount: 1, rows: [{ id: 88, quantity: 1 }] }
      if (sql.includes('insert into production_outputs')) return { rowCount: 1, rows: [{ id: 1, expected_quantity: 1, approved_quantity: 0, rejected_quantity: 0, status: 'pending_quality' }] }
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
  const first = await recordProductionJobMetrics({ client, tenantId: 'tenant-a', agentId: 7, printJobId: 88, payload, applyEffects: false })
  const retry = await recordProductionJobMetrics({ client, tenantId: 'tenant-a', agentId: 7, printJobId: 88, payload, applyEffects: false })
  assert.equal(first.idempotent, false)
  assert.equal(retry.idempotent, true)
  assert.equal(state.attempts.length, 1)
  assert.equal(state.updates, 1)
})

test('conclusão medida baixa estoque e horas uma única vez', async () => {
  const state = { attempts: [], movements: 0, printerUpdates: 0, effectUpdates: 0, jobStatus: 'printing' }
  const client = {
    async query(sql, params) {
      if (sql.includes('select id, order_id, fulfillment_plan_id')) return { rowCount: 1, rows: [{ id: 88, order_id: null, fulfillment_plan_id: null }] }
      if (/^(savepoint|release savepoint|rollback to savepoint)/i.test(sql.trim())) return { rowCount: 0, rows: [] }
      if (sql.includes('select id, quantity from print_jobs')) return { rowCount: 1, rows: [{ id: 88, quantity: 1 }] }
      if (sql.includes('insert into production_outputs')) return { rowCount: 1, rows: [{ id: 1, expected_quantity: 1, approved_quantity: 0, rejected_quantity: 0, status: 'pending_quality' }] }
      if (sql.includes('from print_jobs j') && sql.includes('left join products')) return { rowCount: 1, rows: [{ quantity: 1, printer_id: 9, filament_id: 4, weight: 10, cost_breakdown: { energyRate: 1 }, initial_weight: 1000, cost: 20, power_w: 100 }] }
      if (sql.includes('from print_jobs j')) return { rowCount: 1, rows: [{ id: 88, status: state.jobStatus }] }
      if (sql.includes('from print_job_attempts')) return { rowCount: 0, rows: [] }
      if (sql.includes('insert into print_job_attempts')) {
        const row = { id: 1, print_job_id: params[1], attempt_no: params[2], status: params[4], result: JSON.parse(params[5]) }
        state.attempts.push(row)
        return { rowCount: 1, rows: [row] }
      }
      if (sql.includes('from print_job_material_reservations')) return { rowCount: 0, rows: [] }
      if (sql.includes('select id, remaining_weight')) return { rowCount: 1, rows: [{ id: 4, remaining_weight: 100, min_stock_weight: 10 }] }
      if (sql.includes('insert into inventory_movements')) { state.movements += 1; return { rowCount: 1, rows: [{ id: 1 }] } }
      if (sql.includes('update filaments')) return { rowCount: 1, rows: [{ status: 'Em estoque' }] }
      if (sql.includes('actual_material_cost')) { state.effectUpdates += 1; return { rowCount: 1, rows: [] } }
      if (sql.includes('update printers')) { state.printerUpdates += 1; return { rowCount: 1, rows: [] } }
      if (sql.includes('update print_jobs')) return { rowCount: 1, rows: [] }
      throw new Error(`SQL inesperado: ${sql}`)
    }
  }
  const payload = { status: 'completed', idempotencyKey: 'agent-job-88-measured', actualPrintSeconds: 3600, actualFilamentGrams: 10 }
  const result = await recordProductionJobMetrics({ client, tenantId: 'tenant-a', agentId: 7, printJobId: 88, payload })
  assert.equal(result.effects.inventory, 'deducted')
  assert.equal(state.movements, 1)
  assert.equal(state.printerUpdates, 1)
  assert.equal(state.effectUpdates, 1)

  state.jobStatus = 'completed'
  const crossChannelReplay = await recordProductionJobMetrics({
    client, tenantId: 'tenant-a', agentId: 7, printJobId: 88,
    payload: { status: 'completed', idempotencyKey: 'manual-then-agent-88', actualFilamentGrams: 10 }
  })
  assert.equal(crossChannelReplay.effects.skipped, 'job_already_terminal')
  assert.equal(state.movements, 1)
  assert.equal(state.printerUpdates, 1)
  assert.equal(state.effectUpdates, 1)
})

test('conclusão sem telemetria baixa o consumo estimado pela receita', async () => {
  let consumedGrams = null
  let pendingError = null
  const client = { async query(sql, params) {
    if (sql.includes('select id, order_id, fulfillment_plan_id')) return { rowCount: 1, rows: [{ id: 90, order_id: null, fulfillment_plan_id: null }] }
    if (/^(savepoint|release savepoint|rollback to savepoint)/i.test(sql.trim())) return { rowCount: 0, rows: [] }
    if (sql.includes('select id, quantity from print_jobs')) return { rowCount: 1, rows: [{ id: 90, quantity: 2 }] }
    if (sql.includes('insert into production_outputs')) return { rowCount: 1, rows: [{ id: 2 }] }
    if (sql.includes('from print_jobs j') && sql.includes('left join products')) return { rowCount: 1, rows: [{ quantity: 2, printer_id: 9, filament_id: 4, weight: 10, cost_breakdown: { wastePercent: 10 }, initial_weight: 1000, cost: 20, power_w: 100 }] }
    if (sql.includes('from print_jobs j')) return { rowCount: 1, rows: [{ id: 90, status: 'printing' }] }
    if (sql.includes('from print_job_attempts')) return { rowCount: 0, rows: [] }
    if (sql.includes('insert into print_job_attempts')) return { rowCount: 1, rows: [{ id: 2, print_job_id: 90, attempt_no: 1, status: 'completed' }] }
    if (sql.includes('from print_job_material_reservations')) return { rowCount: 1, rows: [{ id: 3, filament_id: 4, reserved_grams: 22, status: 'active' }] }
    if (sql.includes('update print_job_material_reservations')) { if (sql.includes("status = 'consumed'")) consumedGrams = Number(params[2]); else pendingError = params[3]; return { rowCount: 1, rows: [] } }
    if (sql.includes('select id, remaining_weight')) return { rowCount: 1, rows: [{ id: 4, remaining_weight: 100, min_stock_weight: 10 }] }
    if (sql.includes('insert into inventory_movements')) return { rowCount: 1, rows: [{ id: 5 }] }
    if (sql.includes('update filaments')) return { rowCount: 1, rows: [{ status: 'Em estoque' }] }
    if (sql.includes('update printers') || sql.includes('update print_jobs')) return { rowCount: 1, rows: [] }
    throw new Error(`SQL inesperado: ${sql}`)
  } }
  const result = await recordProductionJobMetrics({ client, tenantId: 'tenant-a', agentId: 7, printJobId: 90, payload: { status: 'completed', idempotencyKey: 'agent-job-90-recipe' } })
  assert.equal(result.effects.inventory, 'deducted', pendingError || 'sem erro')
  assert.equal(consumedGrams, 22)
  assert.equal(pendingError, null)
})
