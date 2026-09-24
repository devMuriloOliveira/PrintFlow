import test from 'node:test'
import assert from 'node:assert/strict'
import { createSalesFulfillmentPlan, fulfillSalesFulfillmentPlan, reduceSalesFulfillmentPlan, releaseSalesFulfillmentPlan } from '../src/services/salesFulfillment.js'
import { approveProductionOutput } from '../src/services/productionOutput.js'

test('plano reserva estoque pronto e cria job somente para a falta no mesmo tenant', async () => {
  const calls = []
  const client = { async query(sql, params = []) {
    calls.push({ sql, params })
    if (sql.includes('from sales_fulfillment_plans')) return { rowCount: 0, rows: [] }
    if (sql.includes('from products p')) return { rowCount: 1, rows: [{ id: 4, name: 'Peca', printer_id: 2, agent_printer_id: 7, quantity: 3, reserved_quantity: 1 }] }
    if (sql.includes('insert into product_inventory')) return { rowCount: 1, rows: [] }
    if (sql.includes('insert into sales_fulfillment_plans')) return { rowCount: 1, rows: [{ id: 9, reserved_quantity: 2, production_quantity: 3, status: 'partial_production' }] }
    if (sql.includes('max(priority)')) return { rowCount: 1, rows: [{ next_priority: 1 }] }
    if (sql.includes('insert into print_jobs')) return { rowCount: 1, rows: [{ id: 44 }] }
    if (sql.includes('from print_job_material_reservations')) return { rowCount: 0, rows: [] }
    if (sql.includes('from products where')) return { rowCount: 1, rows: [{ filament_id: null, weight: 0, cost_breakdown: {} }] }
    throw new Error(`SQL inesperado: ${sql}`)
  } }
  const result = await createSalesFulfillmentPlan({ client, tenantId: 'tenant-a', sourceType: 'order', sourceId: 10, productId: 4, requestedQuantity: 5 })
  assert.equal(result.plan.reserved_quantity, 2)
  assert.equal(result.productionJobId, 44)
  const productionJob = calls.find((call) => call.sql.includes('insert into print_jobs'))
  assert.equal(productionJob.params[4], 7)
  assert.ok(calls.every((call) => !call.params.length || call.params[0] === 'tenant-a'))
})

test('conferencia de lote reserva somente as pecas aprovadas para a venda vinculada', async () => {
  const calls = []
  const client = { async query(sql, params = []) {
    calls.push({ sql, params })
    if (sql.includes('from production_outputs o')) return { rowCount: 1, rows: [{ expected_quantity: 3, status: 'pending_quality', product_id: 4, fulfillment_plan_id: 9 }] }
    if (sql.includes('from products p')) return { rowCount: 1, rows: [{ id: 4, quantity: 2, reserved_quantity: 2 }] }
    if (sql.includes('from sales_fulfillment_plans')) return { rowCount: 1, rows: [{ id: 9, requested_quantity: 5, reserved_quantity: 2, production_quantity: 3 }] }
    return { rowCount: 1, rows: [] }
  } }

  const result = await approveProductionOutput({ client, tenantId: 'tenant-a', printJobId: 44, approvedQuantity: 3, rejectedQuantity: 0 })
  assert.deepEqual(result, { approvedQuantity: 3, rejectedQuantity: 0 })
  const inventory = calls.find((call) => call.sql.includes('insert into product_inventory'))
  assert.deepEqual(inventory.params, ['tenant-a', 4, 5, 5, 'Reservado'])
  const plan = calls.find((call) => call.sql.includes('update sales_fulfillment_plans'))
  assert.deepEqual(plan.params, ['tenant-a', 9, 3])
  assert.ok(calls.every((call) => !call.params.length || call.params[0] === 'tenant-a'))
})

test('receita com varias pecas cria uma execucao fisica por lote e preserva excedente', async () => {
  const calls = []
  let jobId = 40
  const client = { async query(sql, params = []) {
    calls.push({ sql, params })
    if (sql.includes('from sales_fulfillment_plans')) return { rowCount: 0, rows: [] }
    if (sql.includes('from products p')) return { rowCount: 1, rows: [{ id: 4, name: 'Kit', printer_id: 2, agent_printer_id: 7, quantity: 0, reserved_quantity: 0, cost_breakdown: { batchQuantity: 2 } }] }
    if (sql.includes('insert into sales_fulfillment_plans')) return { rowCount: 1, rows: [{ id: 9, reserved_quantity: 0, production_quantity: 5, status: 'partial_production' }] }
    if (sql.includes('max(priority)')) return { rowCount: 1, rows: [{ next_priority: 1 }] }
    if (sql.includes('insert into print_jobs')) return { rowCount: 1, rows: [{ id: ++jobId }] }
    if (sql.includes('from print_job_material_reservations')) return { rowCount: 0, rows: [] }
    if (sql.includes('from products where')) return { rowCount: 1, rows: [{ filament_id: null, weight: 0, cost_breakdown: {} }] }
    return { rowCount: 1, rows: [] }
  } }
  const result = await createSalesFulfillmentPlan({ client, tenantId: 'tenant-a', sourceType: 'order', sourceId: 10, productId: 4, requestedQuantity: 5 })
  assert.deepEqual(result.productionJobIds, [41, 42, 43])
  assert.equal(result.unitsPerRun, 2)
  assert.equal(result.runsRequired, 3)
  const jobs = calls.filter((call) => call.sql.includes('insert into print_jobs'))
  assert.deepEqual(jobs.map((call) => call.params[7]), [2, 2, 2])
  assert.match(jobs[2].params[10], /Execucao 3\/3/)
})

test('cancelamento da venda vinculada libera a reserva sem cruzar tenant', async () => {
  const calls = []
  const client = { async query(sql, params = []) {
    calls.push({ sql, params })
    if (sql.includes('from sales_fulfillment_plans')) return { rowCount: 1, rows: [{ id: 9, product_id: 4, reserved_quantity: 5, status: 'reserved' }] }
    if (sql.includes('from products p')) return { rowCount: 1, rows: [{ id: 4, quantity: 5, reserved_quantity: 5 }] }
    return { rowCount: 1, rows: [] }
  } }

  const result = await releaseSalesFulfillmentPlan({ client, tenantId: 'tenant-a', sourceType: 'tracked_sale', sourceId: 'sale-1' })
  assert.deepEqual(result, { released: true })
  const inventory = calls.find((call) => call.sql.includes('update product_inventory'))
  assert.deepEqual(inventory.params, ['tenant-a', 4, 0])
  assert.ok(calls.every((call) => !call.params.length || call.params[0] === 'tenant-a'))
})

test('expedicao da venda vinculada baixa uma vez o estoque reservado', async () => {
  const calls = []
  let productLocks = 0
  const client = { async query(sql, params = []) {
    calls.push({ sql, params })
    if (sql.includes('from sales_fulfillment_plans')) return { rowCount: 1, rows: [{ id: 9, product_id: 4, requested_quantity: 5, reserved_quantity: 5, status: 'reserved' }] }
    if (sql.includes('from products p')) {
      productLocks += 1
      return { rowCount: 1, rows: [{ id: 4, quantity: 5, reserved_quantity: productLocks === 1 ? 5 : 0 }] }
    }
    if (sql.includes('insert into inventory_movements')) return { rowCount: 1, rows: [{ id: 99 }] }
    return { rowCount: 1, rows: [] }
  } }

  const result = await fulfillSalesFulfillmentPlan({ client, tenantId: 'tenant-a', sourceType: 'tracked_sale', sourceId: 'sale-1' })
  assert.equal(result.movementId, '99')
  assert.equal(result.quantity, 5)
  const completed = calls.find((call) => call.sql.includes("set status = 'fulfilled'"))
  assert.deepEqual(completed.params, ['tenant-a', 9])
  assert.ok(calls.every((call) => !call.params.length || call.params[0] === 'tenant-a'))
})

test('redução parcial do marketplace libera somente a reserva devolvida', async () => {
  const calls = []
  const client = { async query(sql, params = []) {
    calls.push({ sql, params })
    if (sql.includes('from sales_fulfillment_plans')) return { rowCount: 1, rows: [{ id: 9, product_id: 4, requested_quantity: 5, reserved_quantity: 3, production_quantity: 2, status: 'partial_production' }] }
    if (sql.includes('from products p')) return { rowCount: 1, rows: [{ id: 4, quantity: 5, reserved_quantity: 3 }] }
    if (sql.includes('from print_jobs')) return { rowCount: 1, rows: [{ id: 44, product_id: 4, quantity: 2, status: 'queued' }] }
    if (sql.includes('from print_job_material_reservations')) return { rowCount: 0, rows: [] }
    if (sql.includes('from products where')) return { rowCount: 1, rows: [{ filament_id: null, weight: 0, cost_breakdown: {} }] }
    return { rowCount: 1, rows: [] }
  } }

  const result = await reduceSalesFulfillmentPlan({ client, tenantId: 'tenant-a', sourceType: 'tracked_sale', sourceId: 10, requestedQuantity: 2 })
  assert.deepEqual(result, { reduced: true, requestedQuantity: 2, releasedQuantity: 1, productionQuantity: 0 })
  const inventory = calls.find((call) => call.sql.includes('update product_inventory'))
  assert.deepEqual(inventory.params, ['tenant-a', 4, 2])
  const plan = calls.find((call) => call.sql.includes('update sales_fulfillment_plans'))
  assert.deepEqual(plan.params, ['tenant-a', 9, 2, 2, 0])
  assert.ok(calls.every((call) => !call.params.length || call.params[0] === 'tenant-a'))
})
