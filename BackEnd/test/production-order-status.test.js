import test from 'node:test'
import assert from 'node:assert/strict'
import { syncOrderStatusFromProductionJob } from '../src/services/productionOrderStatus.js'

test('pedido so avanca para Impresso quando todas as execucoes do lote terminam', async () => {
  let pending = true
  let updates = 0
  const client = { async query(sql) {
    if (sql.includes('select id, order_id, fulfillment_plan_id')) return { rowCount: 1, rows: [{ id: 41, order_id: 10, fulfillment_plan_id: 9 }] }
    if (sql.includes('status not in')) return { rowCount: pending ? 1 : 0, rows: pending ? [{ '?column?': 1 }] : [] }
    if (sql.includes('update orders')) { updates += 1; return { rowCount: 1, rows: [{ id: 10 }] } }
    throw new Error(`SQL inesperado: ${sql}`)
  } }

  const blocked = await syncOrderStatusFromProductionJob({ client, tenantId: 'tenant-a', printJobId: 41, nextStatus: 'Impresso' })
  assert.deepEqual(blocked, { updated: false, reason: 'production_pending' })
  pending = false
  const completed = await syncOrderStatusFromProductionJob({ client, tenantId: 'tenant-a', printJobId: 43, nextStatus: 'Impresso' })
  assert.deepEqual(completed, { updated: true, reason: null })
  assert.equal(updates, 1)
})
