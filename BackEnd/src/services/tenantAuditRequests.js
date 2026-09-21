import { randomBytes } from 'node:crypto'
import { hasDatabase, query, withTenant } from '../db/pool.js'
import { verifyPassword } from '../auth/password.js'
import { decryptField } from '../security/crypto.js'
import { writeAuditEvent } from './operationalEvents.js'
import { loadAppData } from '../repositories/appDataRepository.js'
import { env } from '../config/env.js'

const id = () => `support_${randomBytes(16).toString('hex')}`
const clean = (value, max = 1000) => String(value || '').trim().slice(0, max)
const categories = new Set(['technical', 'financial', 'integration', 'account', 'data_backup', 'privacy', 'audit'])
const priorities = new Set(['low', 'normal', 'high'])
const privacyRights = new Set(['access', 'correction', 'deletion', 'opposition', 'portability', 'sharing'])
const supportStatuses = new Set(['new', 'in_progress', 'waiting_customer', 'waiting_internal', 'resolved', 'reopened'])
const platformRequestStatuses = new Set(['pending', 'under_review', 'rejected', 'closed'])
export const AUDIT_CHAT_OPEN_STATUSES = Object.freeze(['pending', 'under_review', 'approved', 'rejected'])
export const isAuditChatOpenStatus = (status) => AUDIT_CHAT_OPEN_STATUSES.includes(status)
const writable = new Set(AUDIT_CHAT_OPEN_STATUSES)
const supportReopenWindowDays = () => Math.min(30, Math.max(1, Number(env.supportReopenWindowDays) || 7))
export const supportReopenDecision = (request, now = new Date()) => {
  if (request?.request_kind !== 'support' || request?.support_status !== 'resolved') return { mode: 'continue' }
  const until = request.support_reopen_until ? new Date(request.support_reopen_until) : request.support_resolved_at ? new Date(new Date(request.support_resolved_at).getTime() + supportReopenWindowDays() * 86_400_000) : null
  return until && until <= now ? { mode: 'new_protocol', until } : { mode: 'reopen', until }
}
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
  requestKind: row.request_kind || (row.category === 'privacy' ? 'privacy' : 'support'),
  privacyRight: row.privacy_right || '',
  requesterRole: row.requester_role || '',
  reason: row.reason, scope: row.scope || {}, reviewerId: row.reviewed_by ? String(row.reviewed_by) : null,
  responsibleId: row.responsible_id ? String(row.responsible_id) : null,
  responsibleName: clean(decryptField(row.responsible_name || ''), 160),
  chatAssigneeId: row.chat_assigned_to ? String(row.chat_assigned_to) : null,
  chatAssigneeName: clean(decryptField(row.chat_assignee_name || ''), 160),
  chatAssignedAt: row.chat_assigned_at || null,
  chatCollaborators: Array.isArray(row.chat_collaborators) ? row.chat_collaborators : [],
  supportStatus: row.support_status || (row.status === 'pending' ? 'new' : row.status === 'closed' ? 'resolved' : 'in_progress'),
  supportTags: Array.isArray(row.support_tags) ? row.support_tags.filter((tag) => typeof tag === 'string').slice(0, 20) : [],
  supportFirstResponseDueAt: row.support_first_response_due_at || null,
  supportResolutionDueAt: row.support_resolution_due_at || null,
  supportReopenUntil: row.support_reopen_until || null,
  supportParentRequestId: row.support_parent_request_id || null,
  supportSnoozedUntil: row.support_snoozed_until || null,
  dueAt: row.due_at || null,
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
  const privacyRight = category === 'privacy' ? String(payload.privacyRight || '') : ''
  if (category === 'privacy' && !privacyRights.has(privacyRight)) throw new Error('Informe o direito relacionado a solicitacao de privacidade.')
  return { subject, category, priority, reason, privacyRight, requestKind: category === 'privacy' ? 'privacy' : 'support', scope: category === 'audit' ? scopeFor(payload.scope) : {} }
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
    const sla = request.requestKind === 'support'
      ? (await client.query(`select first_response_minutes, resolution_minutes from platform_support_sla_rules where active = true and (category = $1 or category = '*') and (priority = $2 or priority = '*') order by (category = $1) desc, (priority = $2) desc limit 1`, [request.category, request.priority])).rows[0]
      : null
    const firstResponseDueAt = sla ? new Date(Date.now() + Number(sla.first_response_minutes) * 60_000) : null
    const resolutionDueAt = sla ? new Date(Date.now() + Number(sla.resolution_minutes) * 60_000) : null
    await client.query('insert into tenant_audit_requests (id, tenant_id, requested_by, requester_role, subject, category, request_kind, privacy_right, priority, reason, scope, support_first_response_due_at, support_resolution_due_at, chat_opened_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, now())', [requestId, user.tenantId, String(user.id), clean(user.role, 40), request.subject, request.category, request.requestKind, request.privacyRight, request.priority, request.reason, JSON.stringify(request.scope), firstResponseDueAt, resolutionDueAt])
    await writeAuditEvent(user.tenantId, { action: request.requestKind === 'privacy' ? 'privacy.request.created' : 'support.request.created', actorType: 'user', actorId: user.id, entityType: request.requestKind === 'privacy' ? 'privacy_request' : 'support_request', entityId: requestId, details: { category: request.category, privacyRight: request.privacyRight, priority: request.priority, requesterRole: clean(user.role, 40), scope: request.scope } }, client)
    return { id: requestId, status: 'pending', ...request, requesterRole: clean(user.role, 40), responsibleId: null, responsibleName: '', dueAt: null, supportFirstResponseDueAt: firstResponseDueAt, supportResolutionDueAt: resolutionDueAt }
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
export const listTenantAuditMessages = async (user, requestId, since = '') => {
  const request = await requesterRequest(user, requestId); if (!request) throw new Error('Solicitacao nao encontrada.')
  const parsedSince = String(since || '').trim()
  const hasSince = /^\d+$/.test(parsedSince)
  const sql = `select id, sender_type, sender_id, body, created_at
    from tenant_audit_request_messages
   where request_id = $1 and tenant_id = $2 and visibility = 'public'
     and ($3::bigint is null or id > $3::bigint)
   order by id asc limit 200`
  const result = await withTenant(user.tenantId, (client) => client.query(sql, [requestId, user.tenantId, hasSince ? parsedSince : null]))
  return result.rows.map(mapTenantSupportMessage)
}
export const countTenantUnreadMessages = async (user, since = '') => {
  const parsedSince = String(since || '').trim()
  const hasSince = /^\d+$/.test(parsedSince)
  return withTenant(user.tenantId, async (client) => {
    const result = await client.query(`select message.request_id, count(*)::int as total
      from tenant_audit_request_messages message
      join tenant_audit_requests request on request.id = message.request_id and request.tenant_id = message.tenant_id
     where message.tenant_id = $1 and request.requested_by::text = $2
       and message.sender_type = 'superadmin' and message.visibility = 'public'
       and ($3::bigint is null or message.id > $3::bigint)
     group by message.request_id order by max(message.id) desc limit 100`, [user.tenantId, String(user.id), hasSince ? parsedSince : null])
    return { total: result.rows.reduce((sum, row) => sum + Number(row.total || 0), 0), byRequest: result.rows.map(row => ({ requestId: row.request_id, total: Number(row.total || 0) })) }
  })
}
export const addTenantAuditMessage = async (user, requestId, body) => {
  const request = await requesterRequest(user, requestId); if (!request || !writable.has(request.status)) throw new Error('Conversa indisponivel para esta solicitacao.')
  const message = clean(body); if (!message) throw new Error('Mensagem obrigatoria.')
  return withTenant(user.tenantId, async (client) => {
    const reopenDecision = supportReopenDecision(request)
    const resolved = reopenDecision.mode !== 'continue'
    if (reopenDecision.mode === 'new_protocol') {
      const newRequestId = id()
      const sla = (await client.query(`select first_response_minutes, resolution_minutes from platform_support_sla_rules where active = true and (category = $1 or category = '*') and (priority = $2 or priority = '*') order by (category = $1) desc, (priority = $2) desc limit 1`, [request.category, request.priority])).rows[0]
      const firstResponseDueAt = sla ? new Date(Date.now() + Number(sla.first_response_minutes) * 60_000) : null
      const resolutionDueAt = sla ? new Date(Date.now() + Number(sla.resolution_minutes) * 60_000) : null
      await client.query(`insert into tenant_audit_requests (id, tenant_id, requested_by, requester_role, subject, category, request_kind, privacy_right, priority, reason, scope, support_first_response_due_at, support_resolution_due_at, support_parent_request_id, chat_opened_at) values ($1, $2, $3, $4, $5, $6, 'support', '', $7, $8, $9::jsonb, $10, $11, $12, now())`, [newRequestId, user.tenantId, String(user.id), request.requester_role || '', `Continuação: ${request.subject || request.reason}`.slice(0, 120), request.category, request.priority, request.reason, JSON.stringify(request.scope || {}), firstResponseDueAt, resolutionDueAt, request.id])
      await client.query('insert into tenant_audit_request_messages (tenant_id, request_id, sender_type, sender_id, body) values ($1, $2, $3, $4, $5)', [user.tenantId, newRequestId, 'requester', String(user.id), message])
      await writeAuditEvent(user.tenantId, { action: 'support.request.reopened_as_new', actorType: 'user', actorId: user.id, entityType: 'support_request', entityId: newRequestId, details: { previousRequestId: request.id } }, client)
      return { requestId: newRequestId, createdNewProtocol: true, previousRequestId: request.id }
    }
    await client.query(`update tenant_audit_requests set support_status = case when $3 then 'reopened' else support_status end, support_reopened_at = case when $3 then now() else support_reopened_at end, updated_at = now() where id = $1 and tenant_id = $2`, [requestId, user.tenantId, resolved])
    await client.query('insert into tenant_audit_request_messages (tenant_id, request_id, sender_type, sender_id, body) values ($1, $2, $3, $4, $5)', [user.tenantId, requestId, 'requester', String(user.id), message])
    await writeAuditEvent(user.tenantId, { action: resolved ? 'support.request.reopened' : 'support.request.message_sent', actorType: 'user', actorId: user.id, entityType: 'support_request', entityId: requestId }, client)
    return { requestId, createdNewProtocol: false, previousRequestId: null }
  })
}
export const cancelRequesterRequest = (client, user, requestId) => client.query("update tenant_audit_requests set status = 'cancelled', updated_at = now() where id = $1 and tenant_id = $2 and requested_by::text = $3 and status = 'pending' returning id", [requestId, user.tenantId, String(user.id)])
export const cancelTenantAuditRequest = async (user, requestId) => withTenant(user.tenantId, async (client) => { const result = await cancelRequesterRequest(client, user, requestId); if (!result.rowCount) throw new Error('Solicitacao nao encontrada ou indisponivel.'); await writeAuditEvent(user.tenantId, { action: 'support.request.cancelled', actorType: 'user', actorId: user.id, entityType: 'support_request', entityId: requestId }, client) })

const supportListFilters = (filters = {}) => ({
  search: clean(filters.search, 120), category: categories.has(String(filters.category || '')) ? String(filters.category) : '',
  status: supportStatuses.has(String(filters.status || '')) || ['closed', 'cancelled', 'expired'].includes(String(filters.status || '')) ? String(filters.status) : '',
  assigneeId: clean(filters.assigneeId, 120), tenantId: clean(filters.tenantId, 120),
  from: /^\d{4}-\d{2}-\d{2}$/.test(String(filters.from || '')) ? String(filters.from) : '',
  to: /^\d{4}-\d{2}-\d{2}$/.test(String(filters.to || '')) ? String(filters.to) : '',
  limit: Math.min(500, Math.max(1, Number(filters.limit) || 200)),
  offset: Math.min(1000000, Math.max(0, Number(filters.offset) || 0))
})

export const listPlatformAuditRequests = async (user, filters = {}) => {
  const selected = supportListFilters(filters)
  const params = [String(user.id)]
  const where = [`(request.chat_assigned_to is null or request.chat_assigned_to = $1 or exists (select 1 from platform_chat_collaborators visible_collaborator where visible_collaborator.request_id = request.id and visible_collaborator.user_id = $1))`]
  const bind = (value) => { params.push(value); return `$${params.length}` }
  if (selected.search) { const value = `%${selected.search}%`; const placeholder = bind(value); where.push(`(request.id::text ilike ${placeholder} or request.subject ilike ${placeholder} or request.reason ilike ${placeholder})`) }
  if (selected.category) where.push(`request.category = ${bind(selected.category)}`)
  if (selected.status) where.push(['closed', 'cancelled', 'expired'].includes(selected.status) ? `request.status = ${bind(selected.status)}` : `coalesce(request.support_status, request.status) = ${bind(selected.status)}`)
  if (selected.assigneeId === 'unassigned') where.push('request.chat_assigned_to is null')
  else if (selected.assigneeId) where.push(`request.chat_assigned_to = ${bind(selected.assigneeId)}`)
  if (selected.tenantId) where.push(`request.tenant_id::text = ${bind(selected.tenantId)}`)
  if (selected.from) where.push(`request.created_at >= ${bind(selected.from)}::date`)
  if (selected.to) where.push(`request.created_at < (${bind(selected.to)}::date + interval '1 day')`)
  params.push(selected.limit, selected.offset)
  return (await query(`
  select request.*, coalesce(nullif(trim(account.name), ''), '') as requester_name,
         coalesce(nullif(trim(responsible.name), ''), '') as responsible_name,
         coalesce(nullif(trim(assignee.name), ''), '') as chat_assignee_name,
         coalesce(collaborators.items, '[]'::json) as chat_collaborators
    from tenant_audit_requests request
    left join users account
      on account.id::text = request.requested_by
     and account.tenant_id = request.tenant_id
    left join users responsible
      on responsible.id::text = request.responsible_id
    left join users assignee
      on assignee.id::text = request.chat_assigned_to
    left join lateral (
      select json_agg(json_build_object('id', collaborator.user_id, 'name', collaborator_user.name) order by collaborator.created_at) as items
        from platform_chat_collaborators collaborator
        left join users collaborator_user on collaborator_user.id::text = collaborator.user_id
       where collaborator.request_id = request.id
    ) collaborators on true
   where ${where.join('\n      and ')}
   order by request.created_at desc
   limit $${params.length - 1} offset $${params.length}
`, params)).rows.map((row) => ({ ...mapAuditRequestRow(row), chatCollaborators: (row.chat_collaborators || []).map((collaborator) => ({ id: String(collaborator.id), name: clean(decryptField(collaborator.name || ''), 160) })) }))
}

export const createPlatformPrivacyRequestActions = (runQuery = query) => ({
  update: async (user, requestId, payload = {}) => {
    const status = String(payload.status || 'under_review')
    if (!platformRequestStatuses.has(status)) throw new Error('Status de solicitacao invalido.')
    const dueAt = payload.dueAt ? new Date(String(payload.dueAt)) : null
    if (payload.dueAt && Number.isNaN(dueAt.getTime())) throw new Error('Prazo de solicitacao invalido.')
    const reason = clean(payload.reason, 500)
    if (!reason || reason.length < 8) throw new Error('Informe um motivo com pelo menos 8 caracteres.')
    const result = await runQuery(`
      update tenant_audit_requests
         set status = $2, responsible_id = $3, due_at = $4, review_reason = $5,
             reviewed_by = $3,
             chat_opened_at = case when $2 = 'under_review' then coalesce(chat_opened_at, now()) else chat_opened_at end,
             chat_closed_at = case when $2 in ('closed', 'rejected') then coalesce(chat_closed_at, now()) else chat_closed_at end,
             updated_at = now()
       where id = $1 and request_kind = 'privacy' and status not in ('cancelled', 'closed', 'expired')
       returning *
    `, [requestId, status, String(user.id), dueAt, reason])
    if (!result.rowCount) throw new Error('Solicitacao de privacidade indisponivel.')
    return mapAuditRequestRow(result.rows[0])
  }
})
const platformPrivacyRequestActions = createPlatformPrivacyRequestActions()
export const updatePlatformSupportRequest = (...args) => platformPrivacyRequestActions.update(...args)

export const createPlatformSupportMetadataActions = (runQuery = query) => ({
  update: async (user, requestId, payload = {}) => {
    const supportStatus = String(payload.supportStatus || 'in_progress')
    if (!supportStatuses.has(supportStatus)) throw new Error('Status de suporte invalido.')
    const tags = Array.from(new Set(String(payload.tags || '').split(',').map((tag) => clean(tag, 40).toLowerCase()).filter(Boolean))).slice(0, 20)
    const firstResponseDueAt = payload.firstResponseDueAt ? new Date(String(payload.firstResponseDueAt)) : null
    const resolutionDueAt = payload.resolutionDueAt ? new Date(String(payload.resolutionDueAt)) : null
    if (firstResponseDueAt && Number.isNaN(firstResponseDueAt.getTime())) throw new Error('Prazo de primeira resposta invalido.')
    if (resolutionDueAt && Number.isNaN(resolutionDueAt.getTime())) throw new Error('Prazo de resolucao invalido.')
    const result = await runQuery(`
      update tenant_audit_requests
         set support_status = $2, support_tags = $3::jsonb,
             support_first_response_due_at = $4, support_resolution_due_at = $5,
             support_resolved_at = case when $2 = 'resolved' then coalesce(support_resolved_at, now()) else null end,
             support_reopen_until = case when $2 = 'resolved' then coalesce(support_reopen_until, now() + ($7::int * interval '1 day')) else null end,
             updated_at = now()
       where id = $1 and request_kind = 'support'
         and (chat_assigned_to = $6 or exists (select 1 from platform_chat_collaborators c where c.request_id = tenant_audit_requests.id and c.user_id = $6))
       returning *
    `, [requestId, supportStatus, JSON.stringify(tags), firstResponseDueAt, resolutionDueAt, String(user.id), supportReopenWindowDays()])
    if (!result.rowCount) throw new Error('Somente o responsavel ou colaborador pode atualizar este suporte.')
    return mapAuditRequestRow(result.rows[0])
  }
})
const platformSupportMetadataActions = createPlatformSupportMetadataActions()
export const updatePlatformSupportMetadata = (...args) => platformSupportMetadataActions.update(...args)

export const listPlatformSupportMacros = async () => (await query(`
  select id, name, body, category from platform_support_macros where active = true order by name asc
`)).rows.map((row) => ({ id: row.id, name: row.name, body: row.body, category: row.category }))

export const listPlatformSupportSlaRules = async () => (await query(`
  select id, category, priority, first_response_minutes, resolution_minutes, active, updated_at
    from platform_support_sla_rules order by category, priority
`)).rows.map((row) => ({ id: row.id, category: row.category, priority: row.priority, firstResponseMinutes: Number(row.first_response_minutes), resolutionMinutes: Number(row.resolution_minutes), active: row.active, updatedAt: row.updated_at }))

export const updatePlatformSupportSlaRule = async (user, ruleId, payload = {}, runQuery = query) => {
  const category = String(payload.category || '*')
  const priority = String(payload.priority || '*')
  const firstResponseMinutes = Number(payload.firstResponseMinutes)
  const resolutionMinutes = Number(payload.resolutionMinutes)
  if (!(categories.has(category) || category === '*')) throw new Error('Categoria de SLA invalida.')
  if (!(priorities.has(priority) || priority === '*')) throw new Error('Prioridade de SLA invalida.')
  if (!Number.isInteger(firstResponseMinutes) || firstResponseMinutes < 1 || firstResponseMinutes > 43_200) throw new Error('Prazo de primeira resposta invalido.')
  if (!Number.isInteger(resolutionMinutes) || resolutionMinutes < 1 || resolutionMinutes > 43_200) throw new Error('Prazo de resolucao invalido.')
  const result = await runQuery(`
    update platform_support_sla_rules
       set category = $2, priority = $3, first_response_minutes = $4, resolution_minutes = $5,
           active = coalesce($6::boolean, active), updated_at = now()
     where id = $1 returning id, category, priority, first_response_minutes, resolution_minutes, active, updated_at
  `, [String(ruleId), category, priority, firstResponseMinutes, resolutionMinutes, payload.active === undefined ? null : Boolean(payload.active)])
  if (!result.rowCount) throw new Error('Regra de SLA nao encontrada.')
  const row = result.rows[0]
  return { id: row.id, category: row.category, priority: row.priority, firstResponseMinutes: Number(row.first_response_minutes), resolutionMinutes: Number(row.resolution_minutes), active: row.active, updatedAt: row.updated_at }
}

export const getPlatformSupportMetrics = async (filters = {}) => {
  const selected = supportListFilters(filters)
  const params = [selected.from || null, selected.to || null]
  const dateClause = `created_at >= coalesce($1::date, '-infinity'::date) and created_at < coalesce($2::date + interval '1 day', 'infinity'::date)`
  const overview = await query(`
    with base as (
      select request.*,
        (select min(message.created_at) from tenant_audit_request_messages message where message.request_id = request.id and message.sender_type = 'superadmin' and message.visibility = 'public') as first_response_at
        from tenant_audit_requests request
       where request.request_kind = 'support' and ${dateClause}
    )
    select count(*)::int as total,
      count(*) filter (where support_status <> 'resolved' and status not in ('closed', 'cancelled', 'expired'))::int as open,
      count(*) filter (where support_status = 'waiting_customer')::int as waiting_customer,
      count(*) filter (where support_status = 'waiting_internal')::int as waiting_internal,
      count(*) filter (where support_status <> 'resolved' and ((support_first_response_due_at is not null and support_first_response_due_at < now() and first_response_at is null) or (support_resolution_due_at is not null and support_resolution_due_at < now())))::int as overdue,
      count(*) filter (where support_reopened_at is not null)::int as reopened,
      round((extract(epoch from avg(first_response_at - created_at)) / 60)::numeric, 1) as average_first_response_minutes,
      round((extract(epoch from avg(support_resolved_at - created_at)) / 60)::numeric, 1) as average_resolution_minutes
      from base
  `, params)
  const categoriesResult = await query(`select category, count(*)::int as total from tenant_audit_requests where request_kind = 'support' and ${dateClause} group by category order by total desc`, params)
  const assigneesResult = await query(`
    select request.chat_assigned_to as id, coalesce(nullif(trim(admin.name), ''), 'Superadmin') as name, count(*)::int as total
      from tenant_audit_requests request left join users admin on admin.id::text = request.chat_assigned_to
     where request.request_kind = 'support' and ${dateClause}
     group by request.chat_assigned_to, admin.name order by total desc
  `, params)
  const tenantsResult = await query(`select tenant_id, count(*)::int as total from tenant_audit_requests where request_kind = 'support' and ${dateClause} group by tenant_id order by total desc limit 20`, params)
  const privacyResult = await query(`
    select count(*)::int as total,
      count(*) filter (where due_at is not null and status not in ('closed', 'cancelled', 'expired') and due_at >= now())::int as within_deadline,
      count(*) filter (where due_at is not null and status not in ('closed', 'cancelled', 'expired') and due_at < now())::int as overdue
      from tenant_audit_requests where request_kind = 'privacy' and ${dateClause}
  `, params)
  const row = overview.rows[0] || {}
  return {
    total: Number(row.total || 0), open: Number(row.open || 0), waitingCustomer: Number(row.waiting_customer || 0), waitingInternal: Number(row.waiting_internal || 0),
    overdue: Number(row.overdue || 0), reopened: Number(row.reopened || 0),
    averageFirstResponseMinutes: Number(row.average_first_response_minutes || 0), averageResolutionMinutes: Number(row.average_resolution_minutes || 0),
    byCategory: categoriesResult.rows.map((item) => ({ category: item.category, total: Number(item.total || 0) })),
    byAssignee: assigneesResult.rows.map((item) => ({ id: item.id ? String(item.id) : null, name: clean(decryptField(item.name || ''), 160), total: Number(item.total || 0) })),
    byTenant: tenantsResult.rows.map((item) => ({ tenantId: String(item.tenant_id), total: Number(item.total || 0) })),
    lgpd: { total: Number(privacyResult.rows[0]?.total || 0), withinDeadline: Number(privacyResult.rows[0]?.within_deadline || 0), overdue: Number(privacyResult.rows[0]?.overdue || 0) }
  }
}

export const snoozePlatformSupport = async (user, requestId, until) => {
  const snoozedUntil = new Date(String(until || ''))
  if (Number.isNaN(snoozedUntil.getTime()) || snoozedUntil <= new Date()) throw new Error('Informe uma data futura para a soneca.')
  const result = await query(`
    update tenant_audit_requests
       set support_snoozed_until = $3, updated_at = now()
     where id = $1 and request_kind = 'support' and status not in ('closed', 'cancelled', 'expired')
       and (chat_assigned_to = $2 or exists (select 1 from platform_chat_collaborators c where c.request_id = tenant_audit_requests.id and c.user_id = $2))
     returning *
  `, [requestId, String(user.id), snoozedUntil])
  if (!result.rowCount) throw new Error('Somente o responsavel ou colaborador pode adiar este suporte.')
  return mapAuditRequestRow(result.rows[0])
}

export const getPlatformPrivacyPortabilityExport = async (requestId) => {
  const result = await query(`
    select id, tenant_id, status, privacy_right
      from tenant_audit_requests
     where id = $1 and request_kind = 'privacy' and privacy_right = 'portability'
     limit 1
  `, [requestId])
  if (!result.rowCount) throw new Error('Solicitacao de portabilidade nao encontrada.')
  const request = result.rows[0]
  if (request.status !== 'closed') throw new Error('A portabilidade somente pode ser exportada apos o encerramento da solicitacao.')
  return { requestId: request.id, tenantId: request.tenant_id, data: await loadAppData(request.tenant_id) }
}
export const mapPlatformAuditMessage = (row) => ({ ...row, body: decryptField(row.body), visibility: row.visibility || 'public' })
export const platformAuditMessages = async (requestId, range = {}, user = null) => {
  const since = /^\d+$/.test(String(range.since || '').trim()) ? String(range.since).trim() : null
  const result = await query(`select id, tenant_id, sender_type, sender_id, body, visibility, created_at
    from tenant_audit_request_messages where request_id = $1
      and ($4::text is null or exists (select 1 from tenant_audit_requests request where request.id = $1 and (request.chat_assigned_to = $4 or exists (select 1 from platform_chat_collaborators collaborator where collaborator.request_id = request.id and collaborator.user_id = $4))))
      and ($2::date is null or created_at >= $2::date)
      and ($3::date is null or created_at < $3::date + interval '1 day')
      and ($5::bigint is null or id > $5::bigint)
    order by id asc limit 200`, [requestId, range.from || null, range.to || null, user ? String(user.id) : null, since])
  return {
    tenantId: result.rows[0]?.tenant_id || null,
    messages: result.rows.map(({ tenant_id, ...row }) => mapPlatformAuditMessage(row))
  }
}

export const getPlatformAuditChatReport = async (requestId, range = {}, user = null) => {
  const request = await query(`
    select request.id, request.tenant_id, request.subject, request.created_at,
           tenant.name as company_name, account.name as requester_name
      from tenant_audit_requests request
      join tenants tenant on tenant.id = request.tenant_id
      left join users account on account.id::text = request.requested_by and account.tenant_id = request.tenant_id
     where request.id = $1
       and ($2::text is null or request.chat_assigned_to = $2 or exists (select 1 from platform_chat_collaborators collaborator where collaborator.request_id = request.id and collaborator.user_id = $2)
       )
     limit 1
  `, [requestId, user ? String(user.id) : null])
  if (!request.rowCount) throw new Error('Solicitacao nao encontrada.')
  const conversation = await platformAuditMessages(requestId, range, user)
  if (!conversation.tenantId) throw new Error('Conversa indisponivel.')
  return {
    id: request.rows[0].id, tenantId: request.rows[0].tenant_id, subject: request.rows[0].subject,
    createdAt: request.rows[0].created_at, companyName: decryptField(request.rows[0].company_name),
    requesterName: decryptField(request.rows[0].requester_name), messages: conversation.messages
  }
}

export const createPlatformAuditChatActions = (runQuery = query) => ({
  addMessage: async (user, requestId, body) => {
    const visibility = body?.visibility === 'internal' ? 'internal' : 'public'
    const text = typeof body === 'string' ? body : body?.body
    const cleanMessage = clean(text)
    if (!cleanMessage) throw new Error('Mensagem obrigatoria.')
    const result = await runQuery(`
      with writable_request as (
        update tenant_audit_requests
           set status = case when status = 'pending' then 'under_review' else status end,
               reviewed_by = $2, chat_opened_at = coalesce(chat_opened_at, now()), updated_at = now()
         where id = $1 and status = any($4::text[])
           and (chat_assigned_to = $2 or exists (select 1 from platform_chat_collaborators c where c.request_id = tenant_audit_requests.id and c.user_id = $2))
         returning tenant_id, requested_by
      )
      , inserted_message as (
        insert into tenant_audit_request_messages (tenant_id, request_id, sender_type, sender_id, body, visibility)
        select tenant_id, $1, 'superadmin', $2, $3, $5 from writable_request
        returning id
      )
      select writable_request.tenant_id, writable_request.requested_by
        from writable_request cross join inserted_message
    `, [requestId, String(user.id), cleanMessage, AUDIT_CHAT_OPEN_STATUSES, visibility])
    if (!result.rowCount) throw new Error('Solicitacao indisponivel.')
    return result.rows[0]
  },
  close: async (user, requestId) => {
    const result = await runQuery(`
      update tenant_audit_requests
         set status = 'closed', reviewed_by = $2,
             support_status = case when request_kind = 'support' then 'resolved' else support_status end,
             support_resolved_at = case when request_kind = 'support' then coalesce(support_resolved_at, now()) else support_resolved_at end,
             support_reopen_until = case when request_kind = 'support' then now() + ($4::int * interval '1 day') else support_reopen_until end,
             chat_opened_at = coalesce(chat_opened_at, now()), chat_closed_at = now(), updated_at = now()
       where id = $1 and status = any($3::text[])
         and (chat_assigned_to = $2 or exists (select 1 from platform_chat_collaborators c where c.request_id = tenant_audit_requests.id and c.user_id = $2))
       returning tenant_id, requested_by, chat_opened_at, chat_closed_at
    `, [requestId, String(user.id), AUDIT_CHAT_OPEN_STATUSES, supportReopenWindowDays()])
    if (!result.rowCount) throw new Error('Conversa indisponivel.')
    return result.rows[0]
  },
  reopen: async (user, requestId, reason) => {
    const note = clean(reason, 500)
    if (note.length < 8) throw new Error('Informe o motivo da reabertura.')
    const result = await runQuery(`
      update tenant_audit_requests
         set status = 'under_review', support_status = 'reopened', support_reopened_at = now(),
             chat_closed_at = null, reviewed_by = $2, review_reason = $3, updated_at = now()
       where id = $1 and request_kind = 'support' and status = 'closed'
         and (chat_assigned_to = $2 or exists (select 1 from platform_chat_collaborators c where c.request_id = tenant_audit_requests.id and c.user_id = $2))
       returning tenant_id, support_reopened_at
    `, [requestId, String(user.id), note])
    if (!result.rowCount) throw new Error('Somente suporte encerrado atribuido ao admin pode ser reaberto.')
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
         and (chat_assigned_to = $3 or exists (select 1 from platform_chat_collaborators c where c.request_id = tenant_audit_requests.id and c.user_id = $3))
       returning tenant_id, expires_at
    `, [requestId, status, String(user.id), reviewReason])
    if (!result.rowCount) throw new Error('Solicitacao indisponivel.')
    return { tenantId: result.rows[0].tenant_id, status, expiresAt: result.rows[0].expires_at }
  }
})

export const createPlatformChatAssignmentActions = (runQuery = query) => ({
  claim: async (user, requestId) => {
    const result = await runQuery(`
      update tenant_audit_requests
         set chat_assigned_to = $2, chat_assigned_at = coalesce(chat_assigned_at, now()),
             status = case when status = 'pending' then 'under_review' else status end,
             support_status = case when request_kind = 'support' and support_status = 'new' then 'in_progress' else support_status end,
             reviewed_by = $2, chat_opened_at = coalesce(chat_opened_at, now()), updated_at = now()
       where id = $1 and status = any($3::text[]) and chat_assigned_to is null
       returning *
    `, [requestId, String(user.id), AUDIT_CHAT_OPEN_STATUSES])
    if (!result.rowCount) throw new Error('Conversa indisponivel ou ja atribuida.')
    return mapAuditRequestRow(result.rows[0])
  },
  transfer: async (user, requestId, targetUserId, reason) => {
    const target = clean(targetUserId, 120)
    if (!target || target === String(user.id)) throw new Error('Informe outro superadmin para a transferencia.')
    const transferReason = clean(reason, 500)
    if (transferReason.length < 8) throw new Error('Informe um motivo com pelo menos 8 caracteres para a transferencia.')
    const targetResult = await runQuery(`select id from users where id::text = $1 and role = 'platform_super_admin' and status = 'active' limit 1`, [target])
    if (!targetResult.rowCount) throw new Error('Superadmin de destino indisponivel.')
    const result = await runQuery(`
      update tenant_audit_requests
         set chat_assigned_to = $3, chat_assigned_at = now(), updated_at = now()
       where id = $1 and chat_assigned_to = $2 and status = any($4::text[])
       returning tenant_id, chat_assigned_to
    `, [requestId, String(user.id), target, AUDIT_CHAT_OPEN_STATUSES])
    if (!result.rowCount) throw new Error('Somente o responsavel atual pode transferir esta conversa.')
    return result.rows[0]
  },
  addCollaborator: async (user, requestId, collaboratorId) => {
    const collaborator = clean(collaboratorId, 120)
    if (!collaborator || collaborator === String(user.id)) throw new Error('Informe outro superadmin para colaborar.')
    const targetResult = await runQuery(`select id from users where id::text = $1 and role = 'platform_super_admin' and status = 'active' limit 1`, [collaborator])
    if (!targetResult.rowCount) throw new Error('Superadmin colaborador indisponivel.')
    const result = await runQuery(`
      insert into platform_chat_collaborators (request_id, user_id, added_by)
      select request_id, $3, $2 from (select id as request_id from tenant_audit_requests where id = $1 and chat_assigned_to = $2 and status = any($4::text[])) eligible
      on conflict (request_id, user_id) do nothing
      returning request_id, user_id, (select tenant_id from tenant_audit_requests where id = request_id) as tenant_id
    `, [requestId, String(user.id), collaborator, AUDIT_CHAT_OPEN_STATUSES])
    if (!result.rowCount) throw new Error('Somente o responsavel atual pode incluir colaboradores nesta conversa.')
    return result.rows[0]
  }
})

const platformAuditChatActions = createPlatformAuditChatActions()
const platformChatAssignmentActions = createPlatformChatAssignmentActions()
export const addPlatformAuditMessage = (...args) => platformAuditChatActions.addMessage(...args)
export const closePlatformAuditChat = (...args) => platformAuditChatActions.close(...args)
export const reopenPlatformSupportChat = (...args) => platformAuditChatActions.reopen(...args)
export const decidePlatformAuditRequest = (...args) => platformAuditChatActions.decide(...args)
export const claimPlatformAuditChat = (...args) => platformChatAssignmentActions.claim(...args)
export const transferPlatformAuditChat = (...args) => platformChatAssignmentActions.transfer(...args)
export const addPlatformChatCollaborator = (...args) => platformChatAssignmentActions.addCollaborator(...args)

export const bulkUpdatePlatformSupport = async (user, requestIds, operation, value = '', runQuery = query) => {
  const ids = Array.from(new Set((Array.isArray(requestIds) ? requestIds : []).map((item) => clean(item, 120)).filter(Boolean))).slice(0, 50)
  if (!ids.length) throw new Error('Selecione pelo menos um atendimento.')
  const action = String(operation || '')
  if (!['claim', 'status'].includes(action)) throw new Error('Acao em lote invalida.')
  const params = [ids, String(user.id)]
  let setClause = "chat_assigned_to = chat_assigned_to"
  let predicate = "request_kind = 'support'"
  if (action === 'claim') {
    setClause = "chat_assigned_to = $2, chat_assigned_at = coalesce(chat_assigned_at, now()), status = case when status = 'pending' then 'under_review' else status end, support_status = case when support_status = 'new' then 'in_progress' else support_status end, reviewed_by = $2"
    predicate += ' and status = any($3::text[]) and chat_assigned_to is null'
  } else {
    if (!supportStatuses.has(String(value))) throw new Error('Status de suporte invalido.')
    params.push(String(value))
    setClause = "support_status = $3, support_resolved_at = case when $3 = 'resolved' then coalesce(support_resolved_at, now()) else null end"
    predicate += ' and status = any($4::text[]) and (chat_assigned_to = $2 or exists (select 1 from platform_chat_collaborators c where c.request_id = tenant_audit_requests.id and c.user_id = $2))'
  }
  params.push(AUDIT_CHAT_OPEN_STATUSES)
  const result = await runQuery(`
    update tenant_audit_requests
       set ${setClause}, updated_at = now()
     where id = any($1::text[]) and ${predicate}
     returning id, tenant_id, chat_assigned_to, support_status, updated_at
  `, params)
  return result.rows
}

export const autoAssignPlatformSupport = async (requestIds = [], runQuery = query) => {
  const ids = Array.from(new Set((Array.isArray(requestIds) ? requestIds : []).map((item) => clean(item, 120)).filter(Boolean))).slice(0, 50)
  if (!ids.length) throw new Error('Selecione pelo menos um atendimento para distribuir.')
  const candidates = (await runQuery(`select id from tenant_audit_requests where request_kind = 'support' and chat_assigned_to is null and status = any($1::text[]) and id = any($2::text[]) order by created_at asc limit 50`, [AUDIT_CHAT_OPEN_STATUSES, ids])).rows
  const assigned = []
  for (const candidate of candidates) {
    const admin = await runQuery(`
      select admin.id
        from users admin
        join platform_super_admins platform on platform.user_id = admin.id and platform.status = 'active'
       where admin.role = 'platform_super_admin' and admin.status = 'active'
       order by (select count(*) from tenant_audit_requests load where load.chat_assigned_to = admin.id and load.status = any($1::text[])), admin.id
       limit 1
    `, [AUDIT_CHAT_OPEN_STATUSES])
    if (!admin.rowCount) break
    const result = await runQuery(`
      update tenant_audit_requests
         set chat_assigned_to = $2, chat_assigned_at = now(),
             status = case when status = 'pending' then 'under_review' else status end,
             support_status = case when support_status = 'new' then 'in_progress' else support_status end,
             reviewed_by = $2, updated_at = now()
       where id = $1 and chat_assigned_to is null and request_kind = 'support'
       returning id, tenant_id, chat_assigned_to, support_status
    `, [candidate.id, admin.rows[0].id])
    if (result.rowCount) assigned.push(result.rows[0])
  }
  return assigned
}
