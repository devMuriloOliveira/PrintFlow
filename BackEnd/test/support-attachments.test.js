import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL = ''

const { cleanupExpiredSupportAttachments } = await import('../src/jobs/supportAttachmentCleanup.js')
const { decodeAttachmentPayload } = await import('../src/services/supportAttachments.js')

test('anexo PDF precisa conter assinatura PDF compatível com o MIME declarado', () => {
  assert.throws(
    () => decodeAttachmentPayload({ mimeType: 'application/pdf', fileName: 'nota.pdf', data: Buffer.from('texto comum').toString('base64') }),
    /conteudo do anexo nao corresponde ao tipo declarado/
  )
})

test('anexo de texto rejeita bytes que não formam UTF-8 válido', () => {
  assert.throws(
    () => decodeAttachmentPayload({ mimeType: 'text/plain', fileName: 'nota.txt', data: Buffer.from([0xff, 0xfe, 0xfd]).toString('base64') }),
    /conteudo do anexo nao corresponde ao tipo declarado/
  )
})

test('anexos PDF, PNG e texto válidos são aceitos pelo conteúdo', () => {
  assert.equal(decodeAttachmentPayload({ mimeType: 'application/pdf', fileName: 'nota.pdf', data: Buffer.from('%PDF-1.7\n').toString('base64') }).mimeType, 'application/pdf')
  assert.equal(decodeAttachmentPayload({ mimeType: 'image/png', fileName: 'imagem.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64') }).mimeType, 'image/png')
  assert.equal(decodeAttachmentPayload({ mimeType: 'text/csv', fileName: 'dados.csv', data: Buffer.from('id,nome\n1,teste\n').toString('base64') }).mimeType, 'text/csv')
})

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
