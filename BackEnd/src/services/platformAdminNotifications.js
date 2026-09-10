import { hasDatabase, query } from '../db/pool.js'

const clean = (value, max = 300) => String(value || '').trim().slice(0, max)

export const writePlatformAdminNotification = async (recipientId, event = {}, runQuery = query) => {
  if (!hasDatabase || !recipientId) return null
  const result = await runQuery(`
    insert into platform_admin_notifications (
      recipient_id, type, severity, title, message, entity_type, entity_id, dedupe_key
    ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (recipient_id, dedupe_key) do nothing
    returning id, created_at
  `, [String(recipientId), clean(event.type, 80) || 'support', clean(event.severity, 20) || 'info', clean(event.title, 180), clean(event.message, 1000), clean(event.entityType, 80), clean(event.entityId, 120), clean(event.dedupeKey, 180)])
  return result.rows[0] || null
}

export const listPlatformAdminNotifications = async (user, runQuery = query) => {
  const result = await runQuery(`
    select id, type, severity, title, message, entity_type, entity_id, read_at, created_at
      from platform_admin_notifications
     where recipient_id = $1
     order by read_at nulls first, created_at desc
     limit 100
  `, [String(user.id)])
  return result.rows.map((row) => ({
    id: String(row.id), type: row.type, severity: row.severity, title: row.title, message: row.message,
    entityType: row.entity_type, entityId: row.entity_id, readAt: row.read_at, createdAt: row.created_at
  }))
}

export const markPlatformAdminNotificationRead = async (user, notificationId, runQuery = query) => {
  const result = await runQuery(`
    update platform_admin_notifications set read_at = coalesce(read_at, now())
     where id = $1 and recipient_id = $2
     returning id, read_at
  `, [String(notificationId), String(user.id)])
  if (!result.rowCount) throw new Error('Notificacao nao encontrada.')
  return { id: String(result.rows[0].id), readAt: result.rows[0].read_at }
}
