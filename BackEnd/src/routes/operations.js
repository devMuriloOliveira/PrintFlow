import { getAuthUser } from './auth.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { hasDatabase, tenantQuery } from '../db/pool.js'
import { describeAuditEvent, writeAuditEvent } from '../services/operationalEvents.js'
import { env } from '../config/env.js'

const limitFromUrl = (url) => Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 25)))

export const handleOperationalNotificationsList = async (req, res, url) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })

  const result = await tenantQuery(user.tenantId, `
    select id, type, severity, title, message, entity_type, entity_id, read_at, created_at
     from operational_notifications
     where tenant_id = $1 and (recipient_id is null or recipient_id = $3)
     order by created_at desc
     limit $2
  `, [user.tenantId, limitFromUrl(url), String(user.id)])

  return sendJson(res, 200, result.rows.map((row) => ({
    id: String(row.id), type: row.type, severity: row.severity, title: row.title,
    message: row.message, entityType: row.entity_type, entityId: row.entity_id,
    readAt: row.read_at, createdAt: row.created_at
  })))
}

export const handleOperationalNotificationRead = async (req, res, notificationId) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })

  await readJsonBody(req).catch(() => ({}))
  const result = await tenantQuery(user.tenantId, `
    update operational_notifications
       set read_at = coalesce(read_at, now())
     where tenant_id = $1 and id = $2
     returning id
  `, [user.tenantId, notificationId])

  if (!result.rowCount) return sendJson(res, 404, { error: 'Notificacao nao encontrada' })

  await writeAuditEvent(user.tenantId, {
    action: 'notification.read', actorType: 'user', actorId: user.id,
    entityType: 'notification', entityId: notificationId
  })

  return sendJson(res, 200, { id: String(notificationId), read: true })
}

export const handleOperationalAuditList = async (req, res, url) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })

  const result = await tenantQuery(user.tenantId, `
    select id, action, actor_type, actor_id, entity_type, entity_id, details, created_at
      from operational_audit_events
     where tenant_id = $1
     order by created_at desc
     limit $2
  `, [user.tenantId, limitFromUrl(url)])

  return sendJson(res, 200, result.rows.map((row) => {
    const description = describeAuditEvent(row)
    return {
      id: String(row.id), action: row.action, actorType: row.actor_type, actorId: row.actor_id,
      entityType: row.entity_type, entityId: row.entity_id, details: row.details || {},
      summary: description.summary, context: description.context, createdAt: row.created_at
    }
  }))
}

export const handleOperationalHealth = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })

  if (!hasDatabase) {
    return sendJson(res, 200, {
      offlineAgents: 0, activePrints: 0, queuedPrints: 0, pendingConfirmations: 0,
      pendingAlerts: 0, integrationsWithError: 0, checkedAt: new Date().toISOString()
    })
  }

  const result = await tenantQuery(user.tenantId, `
    select
      (select count(*)::int from agents where tenant_id = $1 and (status = 'offline' or last_seen_at < now() - ($2::int * interval '1 millisecond'))) as offline_agents,
      (select count(*)::int from print_jobs where tenant_id = $1 and status in ('starting', 'printing', 'paused')) as active_prints,
      (select count(*)::int from print_jobs where tenant_id = $1 and status = 'queued') as queued_prints,
      (select count(*)::int from print_jobs where tenant_id = $1 and status = 'awaiting_confirmation') as pending_confirmations,
      (select count(*)::int from operational_notifications where tenant_id = $1 and read_at is null and severity in ('warning', 'error')) as pending_alerts,
      (select count(*)::int from marketplace_integrations where tenant_id = $1 and (status = 'error' or nullif(last_error, '') is not null)) as integrations_with_error
  `, [user.tenantId, env.agentOfflineAfterMs])
  const health = result.rows[0] || {}

  return sendJson(res, 200, {
    offlineAgents: Number(health.offline_agents || 0),
    activePrints: Number(health.active_prints || 0),
    queuedPrints: Number(health.queued_prints || 0),
    pendingConfirmations: Number(health.pending_confirmations || 0),
    pendingAlerts: Number(health.pending_alerts || 0),
    integrationsWithError: Number(health.integrations_with_error || 0),
    checkedAt: new Date().toISOString()
  })
}
