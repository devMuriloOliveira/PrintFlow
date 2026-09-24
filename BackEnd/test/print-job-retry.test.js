import test from 'node:test'
import assert from 'node:assert/strict'
import { createPrintJobRetry } from '../src/routes/printJobs.js'

test('nova tentativa preserva job falho e cria outro job tenant-scoped', async () => {
  const calls = []
  const client = { async query(sql, params = []) {
    calls.push({ sql, params })
    if (sql.includes('select j.*')) return { rowCount: 1, rows: [{ id: 44, status: 'failed', quantity: 2, order_id: 10, tracked_sale_id: null, product_id: 4, printer_id: 2, agent_printer_id: 7, fulfillment_plan_id: 9, title: 'Kit', notes: 'Execucao 1/2' }] }
    if (sql.includes('retry_of_job_id') && sql.includes('select id')) return { rowCount: 0, rows: [] }
    if (sql.includes('max(priority)')) return { rowCount: 1, rows: [{ next_priority: 3 }] }
    if (sql.includes('insert into print_jobs')) return { rowCount: 1, rows: [{ id: 45 }] }
    if (sql.includes('from print_job_material_reservations')) return { rowCount: 0, rows: [] }
    if (sql.includes('from products where')) return { rowCount: 1, rows: [{ filament_id: null, weight: 0, cost_breakdown: {} }] }
    throw new Error(`SQL inesperado: ${sql}`)
  } }

  const result = await createPrintJobRetry({ client, tenantId: 'tenant-a', printJobId: 44 })
  assert.deepEqual(result, { printJobId: 45, retryOfJobId: 44, quantity: 2 })
  const inserted = calls.find((call) => call.sql.includes('insert into print_jobs'))
  assert.equal(inserted.params[0], 'tenant-a')
  assert.equal(inserted.params[7], 44)
  assert.equal(inserted.params[9], 2)
  assert.match(inserted.params[11], /#44/)
})

test('replay da solicitacao nao cria segunda tentativa ativa', async () => {
  const client = { async query(sql) {
    if (sql.includes('select j.*')) return { rowCount: 1, rows: [{ id: 44, status: 'failed', quantity: 1 }] }
    if (sql.includes('retry_of_job_id')) return { rowCount: 1, rows: [{ id: 45 }] }
    throw new Error(`SQL inesperado: ${sql}`)
  } }
  await assert.rejects(
    createPrintJobRetry({ client, tenantId: 'tenant-a', printJobId: 44 }),
    /Ja existe uma nova tentativa ativa/
  )
})
