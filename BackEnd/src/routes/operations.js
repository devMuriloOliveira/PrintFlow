import { getAuthUser } from './auth.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { tenantQuery } from '../db/pool.js'
import { describeAuditEvent, writeAuditEvent } from '../services/operationalEvents.js'

const limitFromUrl = (url) => Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 25)))

export const handleOperationalNotificationsList = async (req, res, url) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })

  const result = await tenantQuery(user.tenantId, `
    select id, type, severity, title, message, entity_type, entity_id, read_at, created_at
      from operational_notifications
     where tenant_id = $1
     order by created_at desc
     limit $2
  `, [user.tenantId, limitFromUrl(url)])

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
