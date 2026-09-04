import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL = ''

const {
  AUDIT_CHAT_OPEN_STATUSES,
  createPlatformAuditChatActions,
  isAuditChatOpenStatus,
  mapAuditRequestRow
} = await import('../src/services/tenantAuditRequests.js')

const createStore = (initialStatus = 'pending') => {
  const request = {
    tenantId: 'tenant-test', status: initialStatus, reviewReason: '', expiresAt: null,
    chatOpenedAt: null, chatClosedAt: null
  }
  const messages = []

  const runQuery = async (sql, params) => {
    if (sql.includes('with writable_request')) {
      if (!params[3].includes(request.status)) return { rowCount: 0, rows: [] }
      request.status = request.status === 'pending' ? 'under_review' : request.status
      request.chatOpenedAt ||= new Date('2026-09-04T12:00:00.000Z')
      messages.push({ senderType: 'superadmin', senderId: params[1], body: params[2] })
      return { rowCount: 1, rows: [{ tenant_id: request.tenantId }] }
    }
    if (sql.includes("set status = 'closed'")) {
      if (!params[2].includes(request.status)) return { rowCount: 0, rows: [] }
      request.status = 'closed'
      request.chatOpenedAt ||= new Date('2026-09-04T12:00:00.000Z')
      request.chatClosedAt = new Date('2026-09-04T12:30:00.000Z')
      return { rowCount: 1, rows: [{ tenant_id: request.tenantId, chat_opened_at: request.chatOpenedAt, chat_closed_at: request.chatClosedAt }] }
    }
    if (sql.includes('review_reason')) {
      if (!['pending', 'under_review'].includes(request.status)) return { rowCount: 0, rows: [] }
      request.status = params[1]
      request.reviewReason = params[3]
      request.expiresAt = request.status === 'approved' ? new Date('2026-09-04T12:30:00.000Z') : null
      return { rowCount: 1, rows: [{ tenant_id: request.tenantId, expires_at: request.expiresAt }] }
    }
    throw new Error(`Consulta inesperada no teste: ${sql}`)
  }

  return { request, messages, actions: createPlatformAuditChatActions(runQuery) }
}

const admin = { id: 'superadmin-test' }

test('chat permanece aberto durante analise, aprovacao e rejeicao', () => {
  assert.deepEqual(AUDIT_CHAT_OPEN_STATUSES, ['pending', 'under_review', 'approved', 'rejected'])
  for (const status of AUDIT_CHAT_OPEN_STATUSES) assert.equal(isAuditChatOpenStatus(status), true)
  for (const status of ['closed', 'cancelled', 'expired']) assert.equal(isAuditChatOpenStatus(status), false)
})

test('retorno preserva decisao e horarios depois do encerramento', () => {
  const row = mapAuditRequestRow({
    id: 'auditreq-mapped', tenant_id: 'tenant-test', requested_by: 'owner-test', reviewed_by: 'admin-test',
    status: 'closed', reason: 'Auditoria solicitada', scope: {}, review_reason: 'Acesso temporario aprovado.',
    expires_at: '2026-09-04T12:30:00.000Z', chat_opened_at: '2026-09-04T12:00:00.000Z',
    chat_closed_at: '2026-09-04T12:20:00.000Z', created_at: '2026-09-04T12:00:00.000Z', updated_at: '2026-09-04T12:20:00.000Z'
  })

  assert.equal(row.status, 'closed')
  assert.equal(row.decision, 'approved')
  assert.equal(row.reviewReason, 'Acesso temporario aprovado.')
  assert.equal(row.chatOpenedAt, '2026-09-04T12:00:00.000Z')
  assert.equal(row.chatClosedAt, '2026-09-04T12:20:00.000Z')
})

test('mensagem inicial abre atendimento e gravacao e atomica', async () => {
  const store = createStore()
  await store.actions.addMessage(admin, 'auditreq-test', 'Iniciando atendimento seguro.')

  assert.equal(store.request.status, 'under_review')
  assert.ok(store.request.chatOpenedAt)
  assert.deepEqual(store.messages, [{ senderType: 'superadmin', senderId: admin.id, body: 'Iniciando atendimento seguro.' }])
})

test('aprovacao preserva decisao, permite conversa e termina somente no encerramento', async () => {
  const store = createStore('under_review')
  const decision = await store.actions.decide(admin, 'auditreq-approved', true, 'Acesso temporario validado para auditoria.')

  assert.equal(decision.status, 'approved')
  assert.equal(store.request.status, 'approved')
  assert.ok(store.request.expiresAt)

  await store.actions.addMessage(admin, 'auditreq-approved', 'A solicitacao foi aprovada dentro do escopo informado.')
  assert.equal(store.request.status, 'approved')
  assert.equal(store.messages.length, 1)

  const closed = await store.actions.close(admin, 'auditreq-approved')
  assert.equal(store.request.status, 'closed')
  assert.ok(closed.chat_opened_at)
  assert.ok(closed.chat_closed_at)
  assert.ok(store.request.expiresAt)
})

test('rejeicao preserva decisao e permite resposta antes do encerramento', async () => {
  const store = createStore('under_review')
  const decision = await store.actions.decide(admin, 'auditreq-rejected', false, 'Solicitacao recusada por escopo insuficiente.')

  assert.equal(decision.status, 'rejected')
  assert.equal(store.request.status, 'rejected')
  assert.equal(store.request.expiresAt, null)

  await store.actions.addMessage(admin, 'auditreq-rejected', 'Expliquei ao owner o motivo da rejeicao.')
  assert.equal(store.request.status, 'rejected')
  await store.actions.close(admin, 'auditreq-rejected')
  assert.equal(store.request.status, 'closed')
  assert.equal(store.request.reviewReason, 'Solicitacao recusada por escopo insuficiente.')
})

test('estados finais bloqueiam novas mensagens, decisoes e encerramentos', async () => {
  for (const status of ['closed', 'cancelled', 'expired']) {
    const store = createStore(status)
    await assert.rejects(store.actions.addMessage(admin, `auditreq-${status}`, 'Mensagem que deve ser bloqueada.'), /indisponivel/)
    await assert.rejects(store.actions.close(admin, `auditreq-${status}`), /indisponivel/)
    await assert.rejects(store.actions.decide(admin, `auditreq-${status}`, true, 'Decisao que deve permanecer bloqueada.'), /indisponivel/)
  }
})

test('decisao exige justificativa detalhada', async () => {
  const store = createStore('under_review')
  await assert.rejects(store.actions.decide(admin, 'auditreq-reason', true, 'muito curta'), /justificativa/)
  assert.equal(store.request.status, 'under_review')
})
