import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL = ''

const { cleanupExpiredSupportAttachments } = await import('../src/jobs/supportAttachmentCleanup.js')

test('limpeza de anexos expirados remove somente arquivos dentro do storage e marca o registro', async () => {
  const removed = []
  const updates = []
  let first = true
  const result = await cleanupExpiredSupportAttachments({
    databaseAvailable: true,
    runQuery: async (_sql, params) => {
      if (first) { first = false; return { rows: [{ id: 'attachment-1', storage_key: 'tenant/request/file.pdf' }] } }
      updates.push(params[0]); return { rows: [] }
    },
    remove: async (filePath) => { removed.push(filePath) }
  })
  assert.equal(result.removed, 1)
  assert.equal(updates[0], 'attachment-1')
  assert.equal(removed.length, 1)
})
