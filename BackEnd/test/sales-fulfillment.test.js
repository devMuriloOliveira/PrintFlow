import test from 'node:test'
import assert from 'node:assert/strict'
import { createSalesFulfillmentPlan } from '../src/services/salesFulfillment.js'

test('plano reserva estoque pronto e cria job somente para a falta no mesmo tenant', async () => {
  const calls = []
  const client = { async query(sql, params = []) {
    calls.push({ sql, params })
    if (sql.includes('from sales_fulfillment_plans')) return { rowCount: 0, rows: [] }
    if (sql.includes('from products p')) return { rowCount: 1, rows: [{ id: 4, name: 'Peca', printer_id: 2, quantity: 3, reserved_quantity: 1 }] }
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
  assert.ok(calls.every((call) => !call.params.length || call.params[0] === 'tenant-a'))
})
