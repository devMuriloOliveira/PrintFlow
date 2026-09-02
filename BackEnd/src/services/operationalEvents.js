import { hasDatabase, tenantQuery } from '../db/pool.js'

const text = (value, max = 300) => String(value || '').trim().slice(0, max)

const normalizeSeverity = (value) =>
  ['info', 'success', 'warning', 'error'].includes(String(value || '').toLowerCase())
    ? String(value).toLowerCase()
    : 'info'

export const writeOperationalNotification = async (tenantId, event = {}, client = null) => {
  if (!hasDatabase || !tenantId) return null

  const params = [
    String(tenantId),
    text(event.type || 'system', 80),
    normalizeSeverity(event.severity),
    text(event.title || 'Atualizacao operacional', 180),
    text(event.message || '', 1000),
    text(event.entityType || '', 80),
    text(event.entityId || '', 120),
    text(event.dedupeKey || '', 180) || null
  ]

  const sql = `
    insert into operational_notifications (
      tenant_id, type, severity, title, message, entity_type, entity_id, dedupe_key
    ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (tenant_id, dedupe_key) do nothing
    returning id, created_at
  `

  const result = client
    ? await client.query(sql, params)
    : await tenantQuery(tenantId, sql, params)

  return result.rows[0] || null
}

export const writeAuditEvent = async (tenantId, event = {}, client = null) => {
  if (!hasDatabase || !tenantId) return null

  const params = [
    String(tenantId),
    text(event.action || 'system.event', 120),
    text(event.actorType || 'system', 40),
    text(event.actorId || '', 120),
    text(event.entityType || '', 80),
    text(event.entityId || '', 120),
    JSON.stringify(event.details && typeof event.details === 'object' ? event.details : {})
  ]

  const sql = `
    insert into operational_audit_events (
      tenant_id, action, actor_type, actor_id, entity_type, entity_id, details
    ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)
    returning id, created_at
  `

  const result = client
    ? await client.query(sql, params)
    : await tenantQuery(tenantId, sql, params)

  return result.rows[0] || null
}
