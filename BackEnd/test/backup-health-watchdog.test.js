import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL = ''

const { runBackupHealthWatchdog } = await import('../src/jobs/backupHealthWatchdog.js')

test('backup recente nao gera alerta para administradores da plataforma', async () => {
  const notifications = []
  const result = await runBackupHealthWatchdog({
    now: new Date('2026-09-23T12:00:00.000Z'), databaseAvailable: true,
    runQuery: async () => ({ rows: [{ id: 8, status: 'success', completed_at: '2026-09-23T11:00:00.000Z' }] }),
    notify: async (_recipientId, event) => { notifications.push(event); return { id: '1' } }
  })
  assert.deepEqual(result, { healthy: true, notified: 0 })
  assert.equal(notifications.length, 0)
})

test('backup ausente alerta somente administradores ativos sem expor detalhes tecnicos', async () => {
  const notifications = []
  let queryCount = 0
  const result = await runBackupHealthWatchdog({
    now: new Date('2026-09-23T12:00:00.000Z'), databaseAvailable: true,
    runQuery: async () => {
      queryCount += 1
      return queryCount === 1 ? { rows: [] } : { rows: [{ user_id: 'admin-1' }, { user_id: 'admin-2' }] }
    },
    notify: async (recipientId, event) => { notifications.push({ recipientId, event }); return { id: recipientId } }
  })
  assert.equal(result.stale, true)
  assert.equal(result.notified, 2)
  assert.deepEqual(notifications.map((item) => item.recipientId), ['admin-1', 'admin-2'])
  assert.match(notifications[0].event.message, /ambiente controlado/)
  assert.doesNotMatch(notifications[0].event.message, /DATABASE_URL|backup\\|\/backups/i)
})

test('falha registrada no backup gera alerta mesmo antes do prazo de validade', async () => {
  let queryCount = 0
  const result = await runBackupHealthWatchdog({
    now: new Date('2026-09-23T12:00:00.000Z'), databaseAvailable: true,
    runQuery: async () => {
      queryCount += 1
      return queryCount === 1
        ? { rows: [{ id: 12, status: 'failed', completed_at: '2026-09-23T11:55:00.000Z', error_message: 'privado' }] }
        : { rows: [{ user_id: 'admin-1' }] }
    },
    notify: async () => ({ id: '1' })
  })
  assert.equal(result.failed, true)
  assert.equal(result.notified, 1)
})
