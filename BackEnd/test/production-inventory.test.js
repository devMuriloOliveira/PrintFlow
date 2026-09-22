import test from 'node:test'
import assert from 'node:assert/strict'
import {
  reserveProductionMaterial,
  reconcilePendingProductionMaterial
} from '../src/services/productionInventory.js'

test('reserva de producao considera somente compromissos do mesmo tenant', async () => {
  const calls = []
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params })
      if (sql.includes('from print_job_material_reservations') && sql.includes('for update')) return { rowCount: 0, rows: [] }
      if (sql.includes('from products where')) return { rowCount: 1, rows: [{ filament_id: 7, weight: 20, cost_breakdown: {} }] }
      if (sql.includes('from filaments') && sql.includes('for update')) return { rowCount: 1, rows: [{ id: 7, remaining_weight: 100 }] }
      if (sql.includes('sum(reserved_grams)')) return { rowCount: 1, rows: [{ grams: 50 }] }
      if (sql.includes('insert into print_job_material_reservations')) return { rowCount: 1, rows: [{ id: 1, filament_id: 7, reserved_grams: 40, status: 'active' }] }
      throw new Error(`SQL inesperado: ${sql}`)
    }
  }
  const result = await reserveProductionMaterial({ client, tenantId: 'tenant-a', printJobId: 9, productId: 3, quantity: 2 })
  assert.equal(result.reserved, true)
  assert.ok(calls.every((call) => !call.params.length || call.params[0] === 'tenant-a'))
})

test('reconciliacao recusa uma reserva pendente de outro tenant', async () => {
  const client = {
    async query(sql, params = []) {
      assert.equal(params[0], 'tenant-a')
      if (sql.includes('from print_job_material_reservations') && sql.includes('for update')) return { rowCount: 0, rows: [] }
      throw new Error(`SQL inesperado: ${sql}`)
    }
  }
  const result = await reconcilePendingProductionMaterial({ client, tenantId: 'tenant-a', printJobId: 99 })
  assert.deepEqual(result, { reconciled: false, reason: 'not_pending' })
})
