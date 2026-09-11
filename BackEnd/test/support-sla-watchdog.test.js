import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL = ''

const { runSupportSlaWatchdog } = await import('../src/jobs/supportSlaWatchdog.js')

test('SLA compara o responsavel textual sem falhar quando o id do superadmin e UUID', async () => {
  const queries = []
  await runSupportSlaWatchdog({
    databaseAvailable: true,
    runQuery: async (sql, params) => { queries.push({ sql, params }); return { rows: [] } }
  })
  assert.match(queries[0].sql, /u\.id::text <> request\.chat_assigned_to/)
})

test('SLA de suporte alerta primeira resposta e resolucao vencidas ao responsavel', async () => {
  const notifications = []
  const now = new Date('2026-09-09T12:00:00.000Z')
  const result = await runSupportSlaWatchdog({
    now,
    databaseAvailable: true,
    runQuery: async () => ({ rows: [{
      id: 'support-1', chat_assigned_to: 'admin-1',
      support_first_response_due_at: '2026-09-08T12:00:00.000Z',
      support_resolution_due_at: '2026-09-08T13:00:00.000Z', has_public_response: false
    }] }),
    notify: async (recipientId, event) => { notifications.push({ recipientId, event }); return { id: String(notifications.length) } }
  })
  assert.equal(result.notified, 2)
  assert.equal(notifications.every(item => item.recipientId === 'admin-1'), true)
  assert.match(notifications[0].event.dedupeKey, /support-sla:/)
})

test('SLA de suporte nao alerta primeira resposta depois que ela foi enviada', async () => {
  const notifications = []
  const result = await runSupportSlaWatchdog({
    now: new Date('2026-09-09T12:00:00.000Z'), databaseAvailable: true,
    runQuery: async () => ({ rows: [{ id: 'support-2', chat_assigned_to: 'admin-2', support_first_response_due_at: '2026-09-08T12:00:00.000Z', support_resolution_due_at: null, has_public_response: true }] }),
    notify: async (_recipientId, event) => { notifications.push(event); return { id: '1' } }
  })
  assert.equal(result.notified, 0)
  assert.equal(notifications.length, 0)
})

test('SLA de resolucao vencido escala para outro superadmin sem transferir o chat', async () => {
  const notifications = []
  const result = await runSupportSlaWatchdog({
    now: new Date('2026-09-09T12:00:00.000Z'), databaseAvailable: true,
    runQuery: async () => ({ rows: [{ id: 'support-3', chat_assigned_to: 'admin-3', escalation_recipient_id: 'admin-4', support_first_response_due_at: null, support_resolution_due_at: '2026-09-08T12:00:00.000Z', has_public_response: true }] }),
    notify: async (recipientId, event) => { notifications.push({ recipientId, event }); return { id: String(notifications.length) } }
  })
  assert.equal(result.notified, 2)
  assert.equal(notifications[0].recipientId, 'admin-3')
  assert.equal(notifications[1].recipientId, 'admin-4')
  assert.equal(notifications[1].event.type, 'support.sla.escalation')
})
