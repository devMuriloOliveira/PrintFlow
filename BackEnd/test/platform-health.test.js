import assert from 'node:assert/strict'
import test from 'node:test'
import { getPlatformOverview } from '../src/services/platformAdmin.js'

const rows = (row) => ({ rows: [row] })

test('overview interno agrega saúde operacional sem devolver payloads de tenants', async () => {
  const observedQueries = []
  const runQuery = async (sql) => {
    observedQueries.push(sql)
    if (sql.includes('from tenants')) return rows({ tenants: '4', active_tenants: '3', suspended_tenants: '1', payment_attention: '2' })
    if (sql.includes('agents_not_online')) return rows({
      agents_not_online: '2',
      stale_print_starts: '1',
      long_waiting_print_jobs: '3',
      delayed_mercado_pago_webhooks: '4',
      marketplace_sync_errors: '5',
      latest_backup_status: 'success',
      last_successful_backup_at: '2026-10-03T12:00:00.000Z'
    })
    if (sql.includes('from agents')) return rows({ total: '6', online: '4' })
    if (sql.includes('from agent_printers')) return rows({ total: '8', connected: '6' })
    throw new Error('Consulta inesperada no teste.')
  }
  const now = new Date('2026-10-03T12:30:00.000Z')

  const overview = await getPlatformOverview({ runQuery, now })

  assert.equal(overview.tenants, 4)
  assert.deepEqual(overview.health, {
    checkedAt: now.toISOString(),
    agentsNotOnline: 2,
    stalePrintStarts: 1,
    longWaitingPrintJobs: 3,
    delayedMercadoPagoWebhooks: 4,
    marketplaceSyncErrors: 5,
    latestBackupStatus: 'success',
    lastSuccessfulBackupAt: '2026-10-03T12:00:00.000Z',
    backupStale: false
  })
  assert.equal(observedQueries.length, 4)
  assert.ok(observedQueries.some((sql) => sql.includes("interval '10 minutes'")))
  assert.ok(observedQueries.some((sql) => sql.includes("interval '1 hour'")))
  assert.ok(observedQueries.some((sql) => sql.includes('scheduled_at is null or scheduled_at <= now()')))
  assert.ok(observedQueries.some((sql) => sql.includes("interval '5 minutes'")))
  assert.ok(observedQueries.every((sql) => !sql.includes('payload')))
})

test('overview sinaliza ausência de backup concluído', async () => {
  const runQuery = async (sql) => {
    if (sql.includes('from tenants')) return rows({})
    if (sql.includes('agents_not_online')) return rows({ latest_backup_status: 'failed', last_successful_backup_at: null })
    if (sql.includes('from agents')) return rows({})
    if (sql.includes('from agent_printers')) return rows({})
    throw new Error('Consulta inesperada no teste.')
  }

  const overview = await getPlatformOverview({ runQuery, now: new Date('2026-10-03T12:30:00.000Z') })

  assert.equal(overview.health.latestBackupStatus, 'failed')
  assert.equal(overview.health.lastSuccessfulBackupAt, null)
  assert.equal(overview.health.backupStale, true)
})
