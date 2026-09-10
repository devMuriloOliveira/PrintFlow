import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL = ''

const {
  AUDIT_CHAT_OPEN_STATUSES,
  autoAssignPlatformSupport,
  bulkUpdatePlatformSupport,
  cancelRequesterRequest,
  createPlatformAuditChatActions,
  createPlatformChatAssignmentActions,
  createPlatformSupportMetadataActions,
  createPlatformPrivacyRequestActions,
  findRequesterRequest,
  isAuditChatOpenStatus,
  mapAuditRequestRow,
  mapPlatformAuditMessage,
  mapTenantSupportMessage,
  normalizeSupportRequest,
  supportReopenDecision,
  updatePlatformSupportSlaRule
} = await import('../src/services/tenantAuditRequests.js')
const { encryptField } = await import('../src/security/crypto.js')
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
    requester_name: 'Alex Solicitante',
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
  assert.equal(row.requesterName, 'Alex Solicitante')
})

test('normaliza suporte comum sem exigir escopo e protege auditoria', () => {
  const support = normalizeSupportRequest({ category: 'technical', subject: 'Falha na fila', reason: 'A fila nao inicia a impressao.', priority: 'high', scope: { entityId: 'ignorado' } })
  assert.deepEqual(support, { category: 'technical', subject: 'Falha na fila', reason: 'A fila nao inicia a impressao.', priority: 'high', privacyRight: '', requestKind: 'support', scope: {} })

  const privacy = normalizeSupportRequest({ category: 'privacy', privacyRight: 'access', subject: 'Solicitacao LGPD', reason: 'Preciso confirmar quais dados pessoais sao tratados.' })
  assert.deepEqual(privacy, { category: 'privacy', subject: 'Solicitacao LGPD', reason: 'Preciso confirmar quais dados pessoais sao tratados.', priority: 'normal', privacyRight: 'access', requestKind: 'privacy', scope: {} })
  assert.throws(() => normalizeSupportRequest({ category: 'privacy', subject: 'Solicitacao LGPD', reason: 'Preciso confirmar quais dados pessoais sao tratados.' }), /direito relacionado/)

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

test('resposta do suporte para tenant usa alias e nao expoe o identificador interno', () => {
  const message = mapTenantSupportMessage({ id: 7, sender_type: 'superadmin', sender_id: 'admin-interno', body: 'Atendimento iniciado.', created_at: '2026-09-04T12:00:00.000Z' })
  assert.deepEqual(message, { id: '7', senderType: 'support', body: 'Atendimento iniciado.', createdAt: '2026-09-04T12:00:00.000Z' })
})

test('retorno administrativo descriptografa a mensagem sem expor a cifra', () => {
  const message = mapPlatformAuditMessage({ id: 8, sender_type: 'requester', sender_id: 'user-a', body: encryptField('Preciso de ajuda com a fila.'), created_at: '2026-09-04T12:00:00.000Z' })
  assert.equal(message.body, 'Preciso de ajuda com a fila.')
})

test('nota interna permanece identificada como privada no retorno administrativo', () => {
  const message = mapPlatformAuditMessage({ id: 9, sender_type: 'superadmin', sender_id: 'admin-a', body: encryptField('Aguardando equipe tecnica.'), visibility: 'internal', created_at: '2026-09-04T12:00:00.000Z' })
  assert.equal(message.visibility, 'internal')
  assert.equal(message.body, 'Aguardando equipe tecnica.')
})

test('metadados de suporte validam status, tags e responsavel', async () => {
  const calls = []
  const actions = createPlatformSupportMetadataActions(async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1, rows: [{ id: 'support-1', tenant_id: 'tenant-a', request_kind: 'support', support_status: params[1], support_tags: JSON.parse(params[2]), created_at: '2026-09-04T12:00:00.000Z', updated_at: '2026-09-04T12:00:00.000Z' }] } })
  const updated = await actions.update({ id: 'admin-a' }, 'support-1', { supportStatus: 'waiting_customer', tags: 'login, urgente, login' })
  assert.equal(updated.supportStatus, 'waiting_customer')
  assert.deepEqual(updated.supportTags, ['login', 'urgente'])
  assert.equal(calls[0].params[5], 'admin-a')
  await assert.rejects(actions.update({ id: 'admin-a' }, 'support-1', { supportStatus: 'unknown', tags: '' }), /Status de suporte invalido/)
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

test('suporte encerrado pode ser reaberto somente com justificativa', async () => {
  const calls = []
  const actions = createPlatformAuditChatActions(async (sql, params) => {
    calls.push({ sql, params })
    return { rowCount: 1, rows: [{ tenant_id: 'tenant-test', support_reopened_at: '2026-09-04T13:00:00.000Z' }] }
  })
  const reopened = await actions.reopen(admin, 'support-closed', 'Cliente enviou novas informacoes.')
  assert.equal(reopened.tenant_id, 'tenant-test')
  assert.equal(calls[0].params[2], 'Cliente enviou novas informacoes.')
  await assert.rejects(actions.reopen(admin, 'support-closed', 'curto'), /motivo da reabertura/)
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

test('triagem LGPD registra status, prazo, responsavel e justificativa', async () => {
  const calls = []
  const dueAt = new Date('2026-09-12T15:00:00.000Z')
  const actions = createPlatformPrivacyRequestActions(async (sql, params) => {
    calls.push({ sql, params })
    return {
      rowCount: 1,
      rows: [{
        id: 'privacy-1', tenant_id: 'tenant-test', requested_by: 'user-test', requester_name: 'Solicitante',
        status: params[1], category: 'privacy', request_kind: 'privacy', privacy_right: 'access',
        priority: 'normal', reason: 'Quais dados sao tratados?', scope: {}, requester_role: 'owner',
        responsible_id: params[2], responsible_name: 'Administrador', due_at: params[3],
        review_reason: params[4], reviewed_by: params[2], chat_opened_at: '2026-09-09T12:00:00.000Z',
        chat_closed_at: null, expires_at: null, created_at: '2026-09-09T11:00:00.000Z', updated_at: '2026-09-09T12:00:00.000Z'
      }]
    }
  })

  const request = await actions.update({ id: 'admin-test' }, 'privacy-1', {
    status: 'under_review', dueAt: dueAt.toISOString(), reason: 'Prazo definido e atendimento iniciado.'
  })

  assert.equal(request.status, 'under_review')
  assert.equal(request.requestKind, 'privacy')
  assert.equal(request.privacyRight, 'access')
  assert.equal(request.responsibleId, 'admin-test')
  assert.equal(new Date(request.dueAt).toISOString(), dueAt.toISOString())
  assert.equal(request.reviewReason, 'Prazo definido e atendimento iniciado.')
  assert.match(calls[0].sql, /request_kind = 'privacy'/)
  assert.deepEqual(calls[0].params.slice(0, 3), ['privacy-1', 'under_review', 'admin-test'])
})

test('atribuicao exclusiva permite assumir uma vez e somente o responsavel pode transferir', async () => {
  const state = { assignedTo: null }
  const actions = createPlatformChatAssignmentActions(async (sql, params) => {
    if (sql.includes("select id from users")) return { rowCount: 1, rows: [{ id: params[0] }] }
    if (sql.includes('chat_assigned_to is null')) {
      if (state.assignedTo) return { rowCount: 0, rows: [] }
      state.assignedTo = params[1]
      return { rowCount: 1, rows: [{ id: params[0], tenant_id: 'tenant-test', chat_assigned_to: state.assignedTo, status: 'under_review' }] }
    }
    if (sql.includes('set chat_assigned_to = $3')) {
      if (state.assignedTo !== params[1]) return { rowCount: 0, rows: [] }
      state.assignedTo = params[2]
      return { rowCount: 1, rows: [{ tenant_id: 'tenant-test', chat_assigned_to: state.assignedTo }] }
    }
    throw new Error(`Consulta inesperada no teste: ${sql}`)
  })

  await actions.claim({ id: 'admin-a' }, 'chat-1')
  await assert.rejects(actions.claim({ id: 'admin-b' }, 'chat-1'), /ja atribuida/)
  await assert.rejects(actions.transfer({ id: 'admin-b' }, 'chat-1', 'admin-c', 'Transferencia autorizada.'), /responsavel atual/)
  await assert.rejects(actions.transfer({ id: 'admin-a' }, 'chat-1', 'admin-c', 'curto'), /motivo/)
  const transfer = await actions.transfer({ id: 'admin-a' }, 'chat-1', 'admin-c', 'Transferencia autorizada.')
  assert.equal(transfer.chat_assigned_to, 'admin-c')
})

test('ciclo LGPD cobre protocolo, atribuicao, prazo, atendimento e encerramento', async () => {
  const normalized = normalizeSupportRequest({
    category: 'privacy', privacyRight: 'access', subject: 'Acesso aos dados',
    reason: 'Solicito a confirmacao dos dados pessoais tratados pela plataforma.'
  })
  const state = {
    id: 'privacy-cycle-1', tenantId: 'tenant-cycle', status: 'pending', requestKind: normalized.requestKind,
    privacyRight: normalized.privacyRight, assignedTo: null, dueAt: null, messages: [], reviewedBy: null,
    chatOpenedAt: null, chatClosedAt: null
  }
  const row = () => ({
    id: state.id, tenant_id: state.tenantId, requested_by: 'user-cycle', requester_name: 'Titular',
    status: state.status, category: 'privacy', request_kind: state.requestKind, privacy_right: state.privacyRight,
    priority: 'normal', reason: normalized.reason, scope: {}, requester_role: 'owner', responsible_id: state.reviewedBy,
    responsible_name: 'Admin LGPD', due_at: state.dueAt, review_reason: 'Atendimento concluido dentro do prazo.',
    reviewed_by: state.reviewedBy, chat_assigned_to: state.assignedTo, chat_assignee_name: 'Admin LGPD',
    chat_opened_at: state.chatOpenedAt, chat_closed_at: state.chatClosedAt, expires_at: null,
    created_at: '2026-09-09T10:00:00.000Z', updated_at: '2026-09-09T10:30:00.000Z'
  })
  const claim = createPlatformChatAssignmentActions(async (sql, params) => {
    if (sql.includes('chat_assigned_to is null')) {
      if (state.assignedTo) return { rowCount: 0, rows: [] }
      state.assignedTo = params[1]; state.status = 'under_review'; state.reviewedBy = params[1]; state.chatOpenedAt = '2026-09-09T10:05:00.000Z'
      return { rowCount: 1, rows: [row()] }
    }
    throw new Error(`Consulta inesperada no ciclo: ${sql}`)
  })
  const triage = createPlatformPrivacyRequestActions(async (sql, params) => {
    state.status = params[1]; state.reviewedBy = params[2]; state.dueAt = params[3]
    state.chatOpenedAt ||= '2026-09-09T10:05:00.000Z'
    state.chatClosedAt = state.status === 'closed' ? '2026-09-09T10:30:00.000Z' : null
    return { rowCount: 1, rows: [row()] }
  })
  const chat = createPlatformAuditChatActions(async (sql, params) => {
    if (sql.includes('with writable_request')) {
      state.messages.push(params[2]); state.status = 'under_review'; state.reviewedBy = params[1]
      return { rowCount: 1, rows: [{ tenant_id: state.tenantId }] }
    }
    if (sql.includes("set status = 'closed'")) {
      state.status = 'closed'; state.chatClosedAt = '2026-09-09T10:30:00.000Z'
      return { rowCount: 1, rows: [{ tenant_id: state.tenantId, chat_opened_at: state.chatOpenedAt, chat_closed_at: state.chatClosedAt }] }
    }
    throw new Error(`Consulta inesperada no atendimento: ${sql}`)
  })

  assert.equal(state.id, 'privacy-cycle-1')
  await claim.claim({ id: 'admin-cycle' }, state.id)
  await triage.update({ id: 'admin-cycle' }, state.id, { status: 'under_review', dueAt: '2026-09-12T10:00:00.000Z', reason: 'Prazo e responsavel registrados.' })
  await chat.addMessage({ id: 'admin-cycle' }, state.id, 'Atendimento iniciado e protocolo confirmado.')
  await chat.close({ id: 'admin-cycle' }, state.id)

  assert.equal(state.requestKind, 'privacy')
  assert.equal(state.privacyRight, 'access')
  assert.equal(state.assignedTo, 'admin-cycle')
  assert.equal(new Date(state.dueAt).toISOString(), '2026-09-12T10:00:00.000Z')
  assert.deepEqual(state.messages, ['Atendimento iniciado e protocolo confirmado.'])
  assert.equal(state.status, 'closed')
  assert.ok(state.chatOpenedAt)
  assert.ok(state.chatClosedAt)
})

test('acao em lote atualiza somente suportes atribuidos ao admin e limita a selecao', async () => {
  const rows = [{ id: 'support-1', tenant_id: 'tenant-1', chat_assigned_to: 'admin-1', support_status: 'waiting_customer', updated_at: new Date() }]
  const result = await bulkUpdatePlatformSupport({ id: 'admin-1' }, ['support-1', 'support-1'], 'status', 'waiting_customer', async () => ({ rowCount: 1, rows }))
  assert.deepEqual(result, rows)
})

test('distribuicao da fila atribui somente pendentes ao superadmin menos carregado', async () => {
  const calls = []
  const runQuery = async (sql, params) => {
    calls.push({ sql, params })
    if (sql.startsWith('select id from tenant_audit_requests')) return { rowCount: 2, rows: [{ id: 'support-1' }, { id: 'support-2' }] }
    if (sql.includes('from users admin')) return { rowCount: 1, rows: [{ id: 'admin-queue' }] }
    if (sql.trimStart().startsWith('update tenant_audit_requests')) return { rowCount: 1, rows: [{ id: params[0], tenant_id: 'tenant-1', chat_assigned_to: params[1], support_status: 'in_progress' }] }
    throw new Error(`Consulta inesperada na distribuicao: ${sql}`)
  }
  const result = await autoAssignPlatformSupport(['support-1', 'support-2'], runQuery)
  assert.deepEqual(result.map((row) => row.id), ['support-1', 'support-2'])
  assert.equal(calls.filter((call) => call.sql.trimStart().startsWith('update tenant_audit_requests')).length, 2)
  assert.equal(calls[0].params[1][0], 'support-1')
  await assert.rejects(autoAssignPlatformSupport([], runQuery), /Selecione pelo menos um atendimento/)
})

test('regra de SLA valida limites e atualiza somente a regra indicada', async () => {
  let received
  const updated = await updatePlatformSupportSlaRule({ id: 'admin-1' }, 'sla-default-normal', { category: '*', priority: 'normal', firstResponseMinutes: 60, resolutionMinutes: 1440, active: true }, async (sql, params) => {
    received = { sql, params }
    return { rowCount: 1, rows: [{ id: params[0], category: params[1], priority: params[2], first_response_minutes: params[3], resolution_minutes: params[4], active: params[5], updated_at: new Date() }] }
  })
  assert.equal(updated.firstResponseMinutes, 60)
  assert.equal(received.params[0], 'sla-default-normal')
  await assert.rejects(updatePlatformSupportSlaRule({ id: 'admin-1' }, 'sla-default-normal', { category: 'invalid', priority: 'normal', firstResponseMinutes: 60, resolutionMinutes: 1440 }, async () => ({ rowCount: 0, rows: [] })), /Categoria de SLA invalida/)
})

test('reabertura respeita a janela e muda para novo protocolo depois do prazo', () => {
  const resolvedAt = new Date('2026-09-01T12:00:00.000Z')
  const request = { request_kind: 'support', support_status: 'resolved', support_resolved_at: resolvedAt }
  assert.equal(supportReopenDecision(request, new Date('2026-09-05T12:00:00.000Z')).mode, 'reopen')
  assert.equal(supportReopenDecision(request, new Date('2026-09-09T12:00:00.000Z')).mode, 'new_protocol')
})
