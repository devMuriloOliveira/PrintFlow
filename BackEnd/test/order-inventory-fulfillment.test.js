import assert from 'node:assert/strict'
import test from 'node:test'
import { fulfillShippedOrderInventory } from '../src/routes/resources.js'

test('pedido enviado sem produto interno nao cria baixa de estoque', async () => {
  const client = { query: async () => { throw new Error('nao deveria consultar estoque') } }
  const result = await fulfillShippedOrderInventory(client, 'tenant-test', { id: 12, product_id: null, quantity: 2 }, null)
  assert.deepEqual(result, { skipped: true, reason: 'missing_product' })
})

test('pedido enviado com produto cria uma unica baixa vinculada ao pedido', async () => {
  const calls = []
  const client = {
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('from order_inventory_fulfillments')) return { rowCount: 0, rows: [] }
      if (sql.includes('from products p left join product_inventory')) return { rowCount: 1, rows: [{ id: 5, quantity: 4, reserved_quantity: 0 }] }
      if (sql.includes('insert into inventory_movements')) return { rowCount: 1, rows: [{ id: 77 }] }
      return { rowCount: 1, rows: [] }
    }
  }

  const result = await fulfillShippedOrderInventory(client, 'tenant-test', { id: 12, product_id: 5, quantity: 2 }, null)
  assert.deepEqual(result, { movementId: '77', quantity: 2 })
  const fulfillment = calls.find((call) => call.sql.includes('insert into order_inventory_fulfillments'))
  assert.deepEqual(fulfillment.params, ['tenant-test', 12, 5, '77', 2])
})

test('pedido que ja teve baixa nao registra uma segunda movimentacao', async () => {
  const calls = []
  const client = {
    async query(sql, params) {
      calls.push({ sql, params })
      return { rowCount: 1, rows: [{ id: 2, inventory_movement_id: 77 }] }
    }
  }
  const result = await fulfillShippedOrderInventory(client, 'tenant-test', { id: 12, product_id: 5, quantity: 2 }, null)
  assert.deepEqual(result, { alreadyFulfilled: true, movementId: '77' })
  assert.equal(calls.length, 1)
})
