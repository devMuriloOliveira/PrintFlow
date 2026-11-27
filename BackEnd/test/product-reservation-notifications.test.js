import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test'
process.env.AUTH_SECRET = 'a'.repeat(32)
process.env.DATA_ENCRYPTION_KEY = 'b'.repeat(32)
process.env.WEBHOOK_SHARED_SECRET = 'c'.repeat(32)
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000'
const { createSalesFulfillmentPlan, fulfillSalesFulfillmentPlan, releaseSalesFulfillmentPlan } = await import('../src/services/salesFulfillment.js')

const fixture = () => {
  const state = { quantity: 2, reserved: 0, plans: new Map(), notifications: [], savepoints: [], failNotification: false }
  const client = { async query(sql, params = []) {
    const query = sql.trim()
    if (/^(savepoint|release savepoint|rollback to savepoint)/i.test(query)) {
      state.savepoints.push(query)
      return { rowCount: 0, rows: [] }
    }
    if (query.includes('from sales_fulfillment_plans') && query.includes('source_type')) {
      const plan = params[0] === 'tenant-a' ? state.plans.get(`${params[1]}:${params[2]}`) : null
      return { rowCount: plan ? 1 : 0, rows: plan ? [plan] : [] }
    }
    if (query.includes('from products p') && query.includes('product_inventory')) {
      if (params[0] !== 'tenant-a' || Number(params[1]) !== 4) return { rowCount: 0, rows: [] }
      return { rowCount: 1, rows: [{ id: 4, name: 'Peca azul', quantity: state.quantity, reserved_quantity: state.reserved }] }
    }
    if (query.startsWith('insert into product_inventory')) {
      if (query.includes('reserved_quantity = product_inventory.reserved_quantity + $4')) state.reserved += params[3]
      else state.quantity = params[2]
      return { rowCount: 1, rows: [] }
    }
    if (query.startsWith('insert into sales_fulfillment_plans')) {
      const row = { id: state.plans.size + 1, product_id: params[3], requested_quantity: params[4], reserved_quantity: params[5], production_quantity: params[6], status: params[7] }
      state.plans.set(`${params[1]}:${params[2]}`, row)
      return { rowCount: 1, rows: [row] }
    }
    if (query.startsWith('update product_inventory')) {
      state.reserved = query.includes('greatest(0, reserved_quantity - $3)') ? Math.max(0, state.reserved - params[2]) : params[2]
      return { rowCount: 1, rows: [] }
    }
    if (query.startsWith('update sales_fulfillment_plans')) {
      const plan = [...state.plans.values()].find((item) => item.id === params[1])
      plan.status = query.includes("'cancelled'") ? 'cancelled' : 'fulfilled'
      return { rowCount: 1, rows: [] }
    }
    if (query.startsWith('insert into inventory_movements')) return { rowCount: 1, rows: [{ id: 10 }] }
    if (query.startsWith('insert into operational_notifications')) {
      if (state.failNotification) throw new Error('falha simulada')
      state.notifications.push(params)
      return { rowCount: 1, rows: [{ id: state.notifications.length }] }
    }
    throw new Error(`SQL inesperado: ${query}`)
  } }
  const create = (sourceType, sourceId, tenantId = 'tenant-a') => createSalesFulfillmentPlan({ client, tenantId, sourceType, sourceId, productId: 4, requestedQuantity: 2 })
  return { state, client, create }
}

for (const sourceType of ['order', 'tracked_sale']) {
  test(`${sourceType}: reserva da ultima unidade avisa uma vez e expedicao nao duplica`, async () => {
    const { state, client, create } = fixture()
    await create(sourceType, 7)
    assert.equal(state.notifications.length, 1)
    const notification = state.notifications[0]
    assert.equal(notification[0], 'tenant-a')
    assert.equal(notification[2], 'inventory.product_out_of_stock')
    assert.match(notification[5], /Peca azul.*0/)
    assert.equal(notification[6], 'products')
    assert.equal(notification[7], '4')
    await create(sourceType, 7)
    await fulfillSalesFulfillmentPlan({ client, tenantId: 'tenant-a', sourceType, sourceId: 7 })
    assert.equal(state.quantity, 0)
    assert.equal(state.reserved, 0)
    assert.equal(state.notifications.length, 1)
  })
}

test('cancelamento e nova reserva geram novo alerta, sem cruzar tenants', async () => {
  const { state, client, create } = fixture()
  await assert.rejects(create('order', 7, 'tenant-b'), /Produto nao encontrado/)
  await create('order', 7)
  await releaseSalesFulfillmentPlan({ client, tenantId: 'tenant-a', sourceType: 'order', sourceId: 7 })
  await create('tracked_sale', 8)
  assert.equal(state.notifications.length, 2)
  assert.notEqual(state.notifications[0][8], state.notifications[1][8])
})

test('falha na notificacao nao impede reserva nem plano', async () => {
  const { state, create } = fixture()
  state.failNotification = true
  await create('order', 7)
  assert.equal(state.reserved, 2)
  assert.equal(state.plans.size, 1)
  assert.ok(state.savepoints.includes('rollback to savepoint product_reservation_notification'))
})
