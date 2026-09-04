import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL = ''

const {
  AUDIT_CHAT_OPEN_STATUSES,
  cancelRequesterRequest,
  createPlatformAuditChatActions,
  findRequesterRequest,
  isAuditChatOpenStatus,
  mapAuditRequestRow,
  normalizeSupportRequest
} = await import('../src/services/tenantAuditRequests.js')
const { createApprovedDataAccessChecker } = await import('../src/services/platformAdmin.js')

const createStore = (initialStatus = 'pending', category = 'audit') => {
  const request = {
    tenantId: 'tenant-test', status: initialStatus, category, reviewReason: '', expiresAt: null,
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
      if (request.category !== 'audit' || !['pending', 'under_review'].includes(request.status)) return { rowCount: 0, rows: [] }
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
  assert.equal(row.category, 'audit')
  assert.equal(row.subject, 'Auditoria solicitada')
})

test('normaliza suporte comum sem exigir escopo e protege auditoria', () => {
  const support = normalizeSupportRequest({ category: 'technical', subject: 'Falha na fila', reason: 'A fila nao inicia a impressao.', priority: 'high', scope: { entityId: 'ignorado' } })
  assert.deepEqual(support, { category: 'technical', subject: 'Falha na fila', reason: 'A fila nao inicia a impressao.', priority: 'high', scope: {} })

  const audit = normalizeSupportRequest({ category: 'audit', subject: 'Auditar pedido', reason: 'Preciso conferir os eventos do pedido.', priority: 'low', scope: { entityType: 'order', entityId: 'order-1' } })
  assert.equal(audit.priority, 'high')
  assert.deepEqual(audit.scope, { type: 'operational_audit', entityType: 'order', entityId: 'order-1', periodStart: null, periodEnd: null })
  assert.throws(() => normalizeSupportRequest({ category: 'unknown', subject: 'Teste', reason: 'Descricao suficientemente longa.' }), /Categoria/)
})

test('consulta de conversa exige tenant e solicitante exatos', async () => {
  const calls = []
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] } } }
  await findRequesterRequest(client, { id: 'user-a', tenantId: 'tenant-a' }, 'support-1')
  assert.deepEqual(calls[0].params, ['support-1', 'tenant-a', 'user-a'])
  assert.match(calls[0].sql, /tenant_id = \$2 and requested_by::text = \$3/)
})

test('solicitante somente cancela o proprio protocolo antes do atendimento', async () => {
  const calls = []
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1, rows: [{ id: params[0] }] } } }
  await cancelRequesterRequest(client, { id: 'user-a', tenantId: 'tenant-a' }, 'support-1')
  assert.deepEqual(calls[0].params, ['support-1', 'tenant-a', 'user-a'])
  assert.match(calls[0].sql, /status = 'pending'/)
  assert.doesNotMatch(calls[0].sql, /under_review/)
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

test('suporte comum aceita conversa mas nunca decisao de acesso', async () => {
  const store = createStore('pending', 'technical')
  await store.actions.addMessage(admin, 'support-common', 'Vamos analisar o problema informado.')
  assert.equal(store.request.status, 'under_review')
  await assert.rejects(store.actions.decide(admin, 'support-common', true, 'Tentativa indevida de liberar acesso.'), /indisponivel/)
})

test('protocolo somente autoriza relatorio para auditoria aprovada pelo mesmo superadmin', async () => {
  const calls = []
  const allow = createApprovedDataAccessChecker(async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1, rows: [{ id: params[0] }] } })
  await allow({ id: 'superadmin-test' }, 'support-audit', 'tenant-test')
  assert.deepEqual(calls[0].params, ['support-audit', 'tenant-test', 'superadmin-test'])
  assert.match(calls[0].sql, /category = 'audit'/)
  assert.match(calls[0].sql, /reviewed_by = \$3/)
  assert.match(calls[0].sql, /expires_at > now\(\)/)

  const deny = createApprovedDataAccessChecker(async () => ({ rowCount: 0, rows: [] }))
  await assert.rejects(deny({ id: 'outro-admin' }, 'support-audit', 'tenant-test'), /nao aprovada ou expirada/)
})
