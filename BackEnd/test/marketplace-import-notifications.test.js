import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test'
process.env.AUTH_SECRET = 'a'.repeat(32)
process.env.DATA_ENCRYPTION_KEY = 'b'.repeat(32)
process.env.WEBHOOK_SHARED_SECRET = 'c'.repeat(32)
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000'

const { pool } = await import('../src/db/pool.js')
const { recordTrackedSales } = await import('../src/repositories/integrationsRepository.js')

const fixture = () => {
  const state = { sales: new Map(), notifications: new Map(), failNotification: false, failLookup: false }
  pool.connect = async () => ({
    release() {},
    async query(sql, params = []) {
      if (/^(begin|commit|rollback|select set_config)/i.test(sql.trim())) return { rows: [] }
      if (sql.includes('select 1 from tracked_sales')) {
        if (state.failLookup) throw new Error('falha simulada')
        const prefix = params.join('|') + '|'
        return { rows: [...state.sales.keys()].some((key) => key.startsWith(prefix)) ? [{}] : [] }
      }
      if (sql.includes('insert into tracked_sales')) {
        const key = [params[0], params[1], params[3], params[5], params[19]].join('|')
        const id = state.sales.get(key) || state.sales.size + 1
        state.sales.set(key, id)
        return { rows: [{ id }] }
      }
      if (sql.includes('insert into operational_notifications')) {
        if (state.failNotification) throw new Error('falha simulada')
        const key = `${params[0]}|${params[8]}`
        if (state.notifications.has(key)) return { rows: [] }
        state.notifications.set(key, params)
        return { rows: [{ id: state.notifications.size }] }
      }
      throw new Error(`SQL inesperado: ${sql}`)
    }
  })
  return state
}

const integration = { tenant_id: 'tenant-a', id: 'integration-1', platform: 'shopee', marketplace_id: null }
const sale = { externalOrderId: 'ORDER-123', status: 'cancelled', soldAt: '2020-01-01T00:00:00Z', items: [
  { lineKey: '1', productName: 'Peça azul', quantity: 1 },
  { lineKey: '2', productName: 'Peça verde', quantity: 2 }
] }

test('importa pedido historico com varias linhas e notifica uma unica vez, sem afirmar pagamento', async () => {
  const state = fixture()
  assert.equal((await recordTrackedSales(integration, sale)).length, 2)
  await recordTrackedSales(integration, sale)
  assert.equal(state.sales.size, 2)
  assert.equal(state.notifications.size, 1)
  const notification = [...state.notifications.values()][0]
  assert.equal(notification[2], 'marketplace.sale_received')
  assert.match(notification[4], /Pedido importado/)
  assert.match(notification[5], /Shopee.*Peça azul.*cancelado/)
  assert.doesNotMatch(notification[5], /ORDER-123/)
  assert.match(notification[5], /2020-01-01/)
  assert.doesNotMatch(notification[5], /pag[ao]|nova venda/i)
})

test('deduplica importacoes concorrentes por tenant, integracao e pedido', async () => {
  const state = fixture()
  await Promise.all([recordTrackedSales(integration, sale), recordTrackedSales(integration, sale)])
  assert.equal(state.sales.size, 2)
  assert.equal(state.notifications.size, 1)
  await recordTrackedSales({ ...integration, id: 'integration-2' }, sale)
  await recordTrackedSales({ ...integration, tenant_id: 'tenant-b' }, sale)
  assert.equal(state.notifications.size, 3)
})

test('falhas do aviso ou da consulta auxiliar nao impedem importacao', async () => {
  const state = fixture()
  state.failNotification = true
  assert.equal((await recordTrackedSales(integration, sale)).length, 2)
  assert.equal(state.sales.size, 2)
  assert.equal(state.notifications.size, 0)
  state.failLookup = true
  assert.equal((await recordTrackedSales(integration, { ...sale, externalOrderId: 'ORDER-456' })).length, 2)
  assert.equal(state.sales.size, 4)
})
