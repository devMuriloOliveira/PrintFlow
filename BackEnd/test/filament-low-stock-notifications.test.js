import test from 'node:test'
import assert from 'node:assert/strict'

// A pool is constructed but never connected: all queries use the isolated fake client.
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test'
process.env.AUTH_SECRET = 'a'.repeat(32)
process.env.DATA_ENCRYPTION_KEY = 'b'.repeat(32)
process.env.WEBHOOK_SHARED_SECRET = 'c'.repeat(32)
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000'
const { createFilamentMovementWithClient } = await import('../src/repositories/inventoryRepository.js')

const fixture = () => {
  const state = { weight: 400, minimum: 300, notifications: [], movements: [], savepoints: [] }
  const client = { async query(sql, params) {
    if (/^(savepoint|release savepoint|rollback to savepoint)/i.test(sql.trim())) {
      state.savepoints.push(sql.trim())
      return { rowCount: 0, rows: [] }
    }
    if (sql.includes('select id, remaining_weight')) {
      if (params[0] !== 'tenant-a' || Number(params[1]) !== 4) return { rowCount: 0, rows: [] }
      return { rowCount: 1, rows: [{ id: 4, name: 'PLA azul', remaining_weight: state.weight, min_stock_weight: state.minimum }] }
    }
    if (sql.includes('update filaments')) {
      state.weight = params[2]
      return { rowCount: 1, rows: [{ status: state.weight <= state.minimum ? 'Baixo estoque' : 'Em estoque' }] }
    }
    if (sql.includes('insert into inventory_movements')) {
      const row = { id: state.movements.length + 1 }
      state.movements.push(row)
      return { rowCount: 1, rows: [row] }
    }
    if (sql.includes('insert into operational_notifications')) {
      state.notifications.push(params)
      return { rowCount: 1, rows: [{ id: state.notifications.length }] }
    }
    throw new Error(`SQL inesperado: ${sql}`)
  } }
  return { state, client }
}

test('notifica uma vez por queda ao limite e volta a notificar apos reposicao', async () => {
  const { state, client } = fixture()
  const move = (type, quantity) => createFilamentMovementWithClient(client, 'tenant-a', 4, { type, quantity, reason: 'teste' })
  await move('out', 100)
  assert.equal(state.notifications.length, 1)
  const first = state.notifications[0]
  assert.equal(first[0], 'tenant-a')
  assert.equal(first[2], 'inventory.filament_low_stock')
  assert.equal(first[6], 'filaments')
  assert.equal(first[7], '4')
  assert.match(first[5], /PLA azul/)
  await move('out', 10)
  assert.equal(state.notifications.length, 1)
  await move('in', 20)
  assert.equal(state.notifications.length, 1)
  await move('out', 10)
  assert.equal(state.notifications.length, 2)
  assert.notEqual(state.notifications[0][8], state.notifications[1][8])
})

test('nao movimenta nem notifica filamento de outro tenant', async () => {
  const { state, client } = fixture()
  await assert.rejects(createFilamentMovementWithClient(client, 'tenant-b', 4, { type: 'out', quantity: 100, reason: 'teste' }), /Registro nao encontrado/)
  assert.equal(state.weight, 400)
  assert.equal(state.notifications.length, 0)
  assert.equal(state.movements.length, 0)
})

test('falha ao gravar notificacao nao impede a movimentacao', async () => {
  const { client, state } = fixture()
  const query = client.query.bind(client)
  client.query = async (sql, params) => {
    if (sql.includes('insert into operational_notifications')) throw new Error('falha simulada')
    return query(sql, params)
  }
  await createFilamentMovementWithClient(client, 'tenant-a', 4, { type: 'out', quantity: 100, reason: 'teste' })
  assert.equal(state.weight, 300)
  assert.equal(state.movements.length, 1)
  assert.equal(state.notifications.length, 0)
  assert.ok(state.savepoints.includes('rollback to savepoint filament_low_stock_notification'))
})
