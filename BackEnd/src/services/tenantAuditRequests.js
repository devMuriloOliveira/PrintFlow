import { randomBytes } from 'node:crypto'
import { hasDatabase, query, withTenant } from '../db/pool.js'
import { verifyPassword } from '../auth/password.js'
import { decryptField } from '../security/crypto.js'
import { writeAuditEvent } from './operationalEvents.js'

const id = () => `support_${randomBytes(16).toString('hex')}`
const clean = (value, max = 1000) => String(value || '').trim().slice(0, max)
const categories = new Set(['technical', 'financial', 'integration', 'account', 'data_backup', 'audit'])
const priorities = new Set(['low', 'normal', 'high'])
export const AUDIT_CHAT_OPEN_STATUSES = Object.freeze(['pending', 'under_review', 'approved', 'rejected'])
export const isAuditChatOpenStatus = (status) => AUDIT_CHAT_OPEN_STATUSES.includes(status)
const writable = new Set(AUDIT_CHAT_OPEN_STATUSES)
const scopeFor = (value = {}) => ({
  type: 'operational_audit',
  entityType: clean(value.entityType, 80), entityId: clean(value.entityId, 160),
  periodStart: /^\d{4}-\d{2}-\d{2}$/.test(String(value.periodStart || '')) ? value.periodStart : null,
  periodEnd: /^\d{4}-\d{2}-\d{2}$/.test(String(value.periodEnd || '')) ? value.periodEnd : null
})
export const mapAuditRequestRow = (row) => ({
  id: row.id, tenantId: row.tenant_id, requestedBy: String(row.requested_by), status: row.status,
  requesterName: clean(decryptField(row.requester_name), 160),
  subject: row.subject || row.reason, category: row.category || 'audit', priority: row.priority || 'normal',
  requesterRole: row.requester_role || '',
  reason: row.reason, scope: row.scope || {}, reviewerId: row.reviewed_by ? String(row.reviewed_by) : null,
  reviewReason: row.review_reason || '', decision: row.review_reason ? (row.expires_at ? 'approved' : 'rejected') : null,
  expiresAt: row.expires_at, chatOpenedAt: row.chat_opened_at, chatClosedAt: row.chat_closed_at,
  createdAt: row.created_at, updatedAt: row.updated_at
})

export const normalizeSupportRequest = (payload = {}) => {
  const category = String(payload.category || 'audit')
  if (!categories.has(category)) throw new Error('Categoria de suporte invalida.')
  const requestedPriority = String(payload.priority || 'normal')
  if (!priorities.has(requestedPriority)) throw new Error('Prioridade de suporte invalida.')
  const priority = category === 'audit' ? 'high' : requestedPriority
  const subject = clean(payload.subject || (category === 'audit' ? 'Solicitacao de auditoria' : ''), 120)
  const reason = clean(payload.reason, 1000)
  if (subject.length < 4) throw new Error('Informe um assunto para a solicitacao.')
  if (reason.length < 12) throw new Error('Descreva a solicitacao com pelo menos 12 caracteres.')
  return { subject, category, priority, reason, scope: category === 'audit' ? scopeFor(payload.scope) : {} }
}

export const createTenantAuditRequest = async (user, payload) => {
  if (!hasDatabase) throw new Error('Solicitacoes de suporte exigem DATABASE_URL.')
  const request = normalizeSupportRequest(payload)
  return withTenant(user.tenantId, async (client) => {
    if (request.category === 'audit') {
      const account = await client.query('select password_hash from users where id::text = $1 and tenant_id = $2 and status = $3 limit 1', [String(user.id), user.tenantId, 'active'])
      if (!account.rowCount || !verifyPassword(clean(payload.currentPassword, 500), account.rows[0].password_hash)) throw new Error('Senha atual invalida.')
    }
    const requestId = id()
    await client.query('insert into tenant_audit_requests (id, tenant_id, requested_by, requester_role, subject, category, priority, reason, scope, chat_opened_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())', [requestId, user.tenantId, String(user.id), clean(user.role, 40), request.subject, request.category, request.priority, request.reason, JSON.stringify(request.scope)])
    await writeAuditEvent(user.tenantId, { action: 'support.request.created', actorType: 'user', actorId: user.id, entityType: 'support_request', entityId: requestId, details: { category: request.category, priority: request.priority, requesterRole: clean(user.role, 40), scope: request.scope } }, client)
    return { id: requestId, status: 'pending', ...request, requesterRole: clean(user.role, 40) }
  })
}

export const listTenantAuditRequests = async (user) => withTenant(user.tenantId, async (client) => {
  const result = await client.query('select * from tenant_audit_requests where tenant_id = $1 and requested_by::text = $2 order by created_at desc limit 50', [user.tenantId, String(user.id)])
  return result.rows.map(mapAuditRequestRow)
})

export const findRequesterRequest = async (client, user, requestId) => (await client.query('select * from tenant_audit_requests where id = $1 and tenant_id = $2 and requested_by::text = $3 limit 1', [requestId, user.tenantId, String(user.id)])).rows[0]
const requesterRequest = async (user, requestId) => withTenant(user.tenantId, (client) => findRequesterRequest(client, user, requestId))
export const mapTenantSupportMessage = (row) => ({
  id: String(row.id),
  senderType: row.sender_type === 'superadmin' ? 'support' : 'requester',
  body: decryptField(row.body),
  createdAt: row.created_at
})
export const listTenantAuditMessages = async (user, requestId) => {
  const request = await requesterRequest(user, requestId); if (!request) throw new Error('Solicitacao nao encontrada.')
  const result = await withTenant(user.tenantId, (client) => client.query('select id, sender_type, sender_id, body, created_at from tenant_audit_request_messages where request_id = $1 and tenant_id = $2 order by created_at asc limit 200', [requestId, user.tenantId]))
  return result.rows.map(mapTenantSupportMessage)
}
export const addTenantAuditMessage = async (user, requestId, body) => {
  const request = await requesterRequest(user, requestId); if (!request || !writable.has(request.status)) throw new Error('Conversa indisponivel para esta solicitacao.')
  const message = clean(body); if (!message) throw new Error('Mensagem obrigatoria.')
  await withTenant(user.tenantId, async (client) => { await client.query('insert into tenant_audit_request_messages (tenant_id, request_id, sender_type, sender_id, body) values ($1, $2, $3, $4, $5)', [user.tenantId, requestId, 'requester', String(user.id), message]); await writeAuditEvent(user.tenantId, { action: 'support.request.message_sent', actorType: 'user', actorId: user.id, entityType: 'support_request', entityId: requestId }, client) })
}
export const cancelRequesterRequest = (client, user, requestId) => client.query("update tenant_audit_requests set status = 'cancelled', updated_at = now() where id = $1 and tenant_id = $2 and requested_by::text = $3 and status = 'pending' returning id", [requestId, user.tenantId, String(user.id)])
export const cancelTenantAuditRequest = async (user, requestId) => withTenant(user.tenantId, async (client) => { const result = await cancelRequesterRequest(client, user, requestId); if (!result.rowCount) throw new Error('Solicitacao nao encontrada ou indisponivel.'); await writeAuditEvent(user.tenantId, { action: 'support.request.cancelled', actorType: 'user', actorId: user.id, entityType: 'support_request', entityId: requestId }, client) })

export const listPlatformAuditRequests = async () => (await query(`
  select request.*, coalesce(nullif(trim(account.name), ''), '') as requester_name
    from tenant_audit_requests request
    left join users account
      on account.id::text = request.requested_by
     and account.tenant_id = request.tenant_id
   order by request.created_at desc
   limit 200
`)).rows.map(mapAuditRequestRow)
export const mapPlatformAuditMessage = (row) => ({ ...row, body: decryptField(row.body) })
export const platformAuditMessages = async (requestId, range = {}) => {
  const result = await query(`select id, tenant_id, sender_type, sender_id, body, created_at
    from tenant_audit_request_messages where request_id = $1
      and ($2::date is null or created_at >= $2::date)
      and ($3::date is null or created_at < $3::date + interval '1 day')
    order by created_at asc limit 200`, [requestId, range.from || null, range.to || null])
  return {
    tenantId: result.rows[0]?.tenant_id || null,
    messages: result.rows.map(({ tenant_id, ...row }) => mapPlatformAuditMessage(row))
  }
}

export const getPlatformAuditChatReport = async (requestId, range = {}) => {
  const request = await query(`
    select request.id, request.tenant_id, request.subject, request.created_at,
           tenant.name as company_name, account.name as requester_name
      from tenant_audit_requests request
      join tenants tenant on tenant.id = request.tenant_id
      left join users account on account.id::text = request.requested_by and account.tenant_id = request.tenant_id
     where request.id = $1
     limit 1
  `, [requestId])
  if (!request.rowCount) throw new Error('Solicitacao nao encontrada.')
  const conversation = await platformAuditMessages(requestId, range)
  return {
    id: request.rows[0].id, tenantId: request.rows[0].tenant_id, subject: request.rows[0].subject,
    createdAt: request.rows[0].created_at, companyName: decryptField(request.rows[0].company_name),
    requesterName: decryptField(request.rows[0].requester_name), messages: conversation.messages
  }
}

export const createPlatformAuditChatActions = (runQuery = query) => ({
  addMessage: async (user, requestId, body) => {
    const message = clean(body)
    if (!message) throw new Error('Mensagem obrigatoria.')
    const result = await runQuery(`
      with writable_request as (
        update tenant_audit_requests
           set status = case when status = 'pending' then 'under_review' else status end,
               reviewed_by = $2, chat_opened_at = coalesce(chat_opened_at, now()), updated_at = now()
         where id = $1 and status = any($4::text[])
         returning tenant_id
      )
      insert into tenant_audit_request_messages (tenant_id, request_id, sender_type, sender_id, body)
      select tenant_id, $1, 'superadmin', $2, $3 from writable_request
      returning tenant_id
    `, [requestId, String(user.id), message, AUDIT_CHAT_OPEN_STATUSES])
    if (!result.rowCount) throw new Error('Solicitacao indisponivel.')
  },
  close: async (user, requestId) => {
    const result = await runQuery(`
      update tenant_audit_requests
         set status = 'closed', reviewed_by = $2,
             chat_opened_at = coalesce(chat_opened_at, now()), chat_closed_at = now(), updated_at = now()
       where id = $1 and status = any($3::text[])
       returning tenant_id, chat_opened_at, chat_closed_at
    `, [requestId, String(user.id), AUDIT_CHAT_OPEN_STATUSES])
    if (!result.rowCount) throw new Error('Conversa indisponivel.')
    return result.rows[0]
  },
  decide: async (user, requestId, approved, reason) => {
    const reviewReason = clean(reason, 500)
    if (reviewReason.length < 12) throw new Error('Informe a justificativa da decisao.')
    const status = approved ? 'approved' : 'rejected'
    const result = await runQuery(`
      update tenant_audit_requests
         set status = $2, reviewed_by = $3, review_reason = $4,
             expires_at = case when $2 = 'approved' then now() + interval '30 minutes' else null end,
             updated_at = now()
       where id = $1 and category = 'audit' and status in ('pending', 'under_review')
       returning tenant_id, expires_at
    `, [requestId, status, String(user.id), reviewReason])
    if (!result.rowCount) throw new Error('Solicitacao indisponivel.')
    return { tenantId: result.rows[0].tenant_id, status, expiresAt: result.rows[0].expires_at }
  }
})

const platformAuditChatActions = createPlatformAuditChatActions()
export const addPlatformAuditMessage = (...args) => platformAuditChatActions.addMessage(...args)
export const closePlatformAuditChat = (...args) => platformAuditChatActions.close(...args)
export const decidePlatformAuditRequest = (...args) => platformAuditChatActions.decide(...args)
