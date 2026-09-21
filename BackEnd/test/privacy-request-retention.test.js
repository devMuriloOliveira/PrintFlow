import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL = ''

const { runPrivacyRequestRetention } = await import('../src/jobs/privacyRequestRetention.js')

test('retenção alerta somente responsável e anonimiz​a solicitação encerrada após 7 dias', async () => {
  const notifications = []
  const audits = []
  const queries = []
  const runQuery = async (sql, params) => {
    queries.push({ sql, params })
    if (sql.includes('due_at >')) return { rowCount: 1, rows: [{ id: 'privacy-due', tenant_id: 'tenant-a', responsible_id: 'admin-a', due_at: '2026-09-11T12:00:00.000Z' }] }
    if (sql.includes('privacy_anonymized_at is null') && sql.includes('status in')) return { rowCount: 1, rows: [{ id: 'privacy-old', tenant_id: 'tenant-a' }] }
    if (sql.includes("set requested_by = 'anonymized'")) return { rowCount: 1, rows: [{ id: 'privacy-old' }] }
    if (sql.includes('update tenant_audit_request_messages')) return { rowCount: 1, rows: [] }
    throw new Error(`Consulta inesperada: ${sql}`)
  }
  const result = await runPrivacyRequestRetention({
    now: new Date('2026-09-08T12:00:00.000Z'), runQuery, databaseAvailable: true,
    notify: async (tenantId, event) => { notifications.push({ tenantId, event }); return { id: 'notification-1' } },
    audit: async (tenantId, event) => { audits.push({ tenantId, event }) }
  })

  assert.deepEqual(result, { notified: 1, anonymized: 1 })
  assert.equal(notifications[0].tenantId, 'tenant-a')
  assert.equal(notifications[0].event.recipientId, 'admin-a')
  assert.equal(notifications[0].event.dedupeKey, 'privacy-request-due-3d:privacy-due')
  assert.equal(audits[0].event.details.retentionDays, 7)
  assert.match(queries[0].sql, /due_at > \$1::timestamptz/)
  assert.match(queries[0].sql, /due_at <= \(\$1::timestamptz \+ interval '3 days'\)/)
  assert.match(queries[1].sql, /updated_at <= \(\$1::timestamptz - interval '7 days'\)/)
  assert.equal(queries.filter(({ sql }) => sql.includes('update tenant_audit_request_messages')).length, 1)
})
