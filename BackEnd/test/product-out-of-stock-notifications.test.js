import test from 'node:test'
import assert from 'node:assert/strict'

// O pool nao conecta: todas as consultas usam o cliente ficticio abaixo.
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test'
process.env.AUTH_SECRET = 'a'.repeat(32)
process.env.DATA_ENCRYPTION_KEY = 'b'.repeat(32)
process.env.WEBHOOK_SHARED_SECRET = 'c'.repeat(32)
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000'
const { createProductMovementWithClient } = await import('../src/repositories/inventoryRepository.js')

const fixture = () => {
  const state = { quantity: 3, reserved: 1, notifications: [], movements: [], savepoints: [] }
  const client = { async query(sql, params) {
    if (/^(savepoint|release savepoint|rollback to savepoint)/i.test(sql.trim())) {
      state.savepoints.push(sql.trim())
      return { rows: [], rowCount: 0 }
    }
    if (sql.includes('from products p left join product_inventory')) {
      if (params[0] !== 'tenant-a' || Number(params[1]) !== 4) return { rows: [], rowCount: 0 }
      return { rows: [{ id: 4, name: 'Peca azul', quantity: state.quantity, reserved_quantity: state.reserved }], rowCount: 1 }
    }
    if (sql.includes('insert into product_inventory')) {
      state.quantity = params[2]
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('insert into inventory_movements')) {
      const row = { id: state.movements.length + 1 }
      state.movements.push(row)
      return { rows: [row], rowCount: 1 }
    }
    if (sql.includes('insert into operational_notifications')) {
      state.notifications.push(params)
      return { rows: [{ id: state.notifications.length }], rowCount: 1 }
    }
    throw new Error(`SQL inesperado: ${sql}`)
  } }
  return { state, client }
}

test('avisa quando saldo disponivel zera e repete somente apos reposicao e nova queda', async () => {
  const { state, client } = fixture()
  const move = (type, quantity) => createProductMovementWithClient(client, 'tenant-a', 4, { type, quantity, reason: 'teste' })
  await move('out', 2)
  assert.equal(state.notifications.length, 1)
  const first = state.notifications[0]
  assert.equal(first[0], 'tenant-a')
  assert.equal(first[2], 'inventory.product_out_of_stock')
  assert.match(first[5], /Peca azul/)
  assert.match(first[5], /0/)
  assert.equal(first[6], 'products')
  assert.equal(first[7], '4')
  await move('adjustment', 1)
  assert.equal(state.notifications.length, 1)
  await move('in', 1)
  await move('out', 1)
  assert.equal(state.notifications.length, 2)
  assert.notEqual(state.notifications[0][8], state.notifications[1][8])
})

test('nao movimenta nem notifica produto de outro tenant', async () => {
  const { state, client } = fixture()
  await assert.rejects(createProductMovementWithClient(client, 'tenant-b', 4, { type: 'out', quantity: 2, reason: 'teste' }), /Registro nao encontrado/)
  assert.equal(state.quantity, 3)
  assert.equal(state.movements.length, 0)
  assert.equal(state.notifications.length, 0)
})

test('falha ao notificar nao impede movimentacao', async () => {
  const { state, client } = fixture()
  const query = client.query.bind(client)
  client.query = async (sql, params) => {
    if (sql.includes('insert into operational_notifications')) throw new Error('falha simulada')
    return query(sql, params)
  }
  await createProductMovementWithClient(client, 'tenant-a', 4, { type: 'out', quantity: 2, reason: 'teste' })
  assert.equal(state.quantity, 1)
  assert.equal(state.movements.length, 1)
  assert.ok(state.savepoints.includes('rollback to savepoint product_out_of_stock_notification'))
})
