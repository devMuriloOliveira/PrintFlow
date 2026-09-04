import { randomBytes } from 'node:crypto'
import { hasDatabase, query, withTenant } from '../db/pool.js'
import { verifyPassword } from '../auth/password.js'
import { writeAuditEvent } from './operationalEvents.js'

const id = () => `auditreq_${randomBytes(16).toString('hex')}`
const clean = (value, max = 1000) => String(value || '').trim().slice(0, max)
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
  reason: row.reason, scope: row.scope || {}, reviewerId: row.reviewed_by ? String(row.reviewed_by) : null,
  reviewReason: row.review_reason || '', decision: row.review_reason ? (row.expires_at ? 'approved' : 'rejected') : null,
  expiresAt: row.expires_at, chatOpenedAt: row.chat_opened_at, chatClosedAt: row.chat_closed_at,
  createdAt: row.created_at, updatedAt: row.updated_at
})

export const createTenantAuditRequest = async (user, payload) => {
  if (!hasDatabase) throw new Error('Solicitacoes de auditoria exigem DATABASE_URL.')
  if (user.role !== 'owner') throw new Error('Somente o Owner pode solicitar auditoria excepcional.')
  const reason = clean(payload.reason, 500)
  if (reason.length < 12) throw new Error('Informe um motivo detalhado para a solicitacao.')
  return withTenant(user.tenantId, async (client) => {
    const account = await client.query('select password_hash from users where id::text = $1 and tenant_id = $2 and status = $3 limit 1', [String(user.id), user.tenantId, 'active'])
    if (!account.rowCount || !verifyPassword(clean(payload.currentPassword, 500), account.rows[0].password_hash)) throw new Error('Senha atual invalida.')
    const requestId = id(); const scope = scopeFor(payload.scope)
    await client.query('insert into tenant_audit_requests (id, tenant_id, requested_by, reason, scope, chat_opened_at) values ($1, $2, $3, $4, $5::jsonb, now())', [requestId, user.tenantId, String(user.id), reason, JSON.stringify(scope)])
    await writeAuditEvent(user.tenantId, { action: 'tenant.audit_request.created', actorType: 'user', actorId: user.id, entityType: 'audit_request', entityId: requestId, details: { scope } }, client)
    return { id: requestId, status: 'pending', scope }
  })
}

export const listTenantAuditRequests = async (user) => withTenant(user.tenantId, async (client) => {
  const result = await client.query('select * from tenant_audit_requests where tenant_id = $1 and requested_by::text = $2 order by created_at desc limit 50', [user.tenantId, String(user.id)])
  return result.rows.map(mapAuditRequestRow)
})

const ownerRequest = async (user, requestId) => withTenant(user.tenantId, async (client) => (await client.query('select * from tenant_audit_requests where id = $1 and tenant_id = $2 and requested_by::text = $3 limit 1', [requestId, user.tenantId, String(user.id)])).rows[0])
export const listTenantAuditMessages = async (user, requestId) => {
  const request = await ownerRequest(user, requestId); if (!request) throw new Error('Solicitacao nao encontrada.')
  const result = await withTenant(user.tenantId, (client) => client.query('select id, sender_type, sender_id, body, created_at from tenant_audit_request_messages where request_id = $1 and tenant_id = $2 order by created_at asc limit 200', [requestId, user.tenantId]))
  return result.rows.map((row) => ({ id: String(row.id), senderType: row.sender_type, senderId: String(row.sender_id), body: row.body, createdAt: row.created_at }))
}
export const addTenantAuditMessage = async (user, requestId, body) => {
  const request = await ownerRequest(user, requestId); if (!request || !writable.has(request.status)) throw new Error('Conversa indisponivel para esta solicitacao.')
  const message = clean(body); if (!message) throw new Error('Mensagem obrigatoria.')
  await withTenant(user.tenantId, async (client) => { await client.query('insert into tenant_audit_request_messages (tenant_id, request_id, sender_type, sender_id, body) values ($1, $2, $3, $4, $5)', [user.tenantId, requestId, 'owner', String(user.id), message]); await writeAuditEvent(user.tenantId, { action: 'tenant.audit_request.message_sent', actorType: 'user', actorId: user.id, entityType: 'audit_request', entityId: requestId }, client) })
}
export const cancelTenantAuditRequest = async (user, requestId) => withTenant(user.tenantId, async (client) => { const result = await client.query("update tenant_audit_requests set status = 'cancelled', updated_at = now() where id = $1 and tenant_id = $2 and requested_by::text = $3 and status in ('pending', 'under_review') returning id", [requestId, user.tenantId, String(user.id)]); if (!result.rowCount) throw new Error('Solicitacao nao encontrada ou indisponivel.'); await writeAuditEvent(user.tenantId, { action: 'tenant.audit_request.cancelled', actorType: 'user', actorId: user.id, entityType: 'audit_request', entityId: requestId }, client) })

export const listPlatformAuditRequests = async () => (await query('select * from tenant_audit_requests order by created_at desc limit 200')).rows.map(mapAuditRequestRow)
export const platformAuditMessages = async (requestId) => (await query('select id, sender_type, sender_id, body, created_at from tenant_audit_request_messages where request_id = $1 order by created_at asc limit 200', [requestId])).rows

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
       where id = $1 and status in ('pending', 'under_review')
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
