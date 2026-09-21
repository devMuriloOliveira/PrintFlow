import { env } from '../config/env.js'
import { hasDatabase, query } from '../db/pool.js'
import { writeAuditEvent, writeOperationalNotification } from '../services/operationalEvents.js'

export const runPrivacyRequestRetention = async ({ now = new Date(), runQuery = query, notify = writeOperationalNotification, audit = writeAuditEvent, databaseAvailable = hasDatabase } = {}) => {
  if (!databaseAvailable) return { notified: 0, anonymized: 0 }

  const dueSoon = await runQuery(`
    select id, tenant_id, responsible_id, due_at
      from tenant_audit_requests
     where request_kind = 'privacy'
       and responsible_id is not null
       and status not in ('closed', 'rejected', 'cancelled', 'expired')
       and due_at > $1::timestamptz
       and due_at <= ($1::timestamptz + interval '3 days')
       and privacy_anonymized_at is null
  `, [now])
  let notified = 0
  for (const request of dueSoon.rows) {
    const result = await notify(request.tenant_id, {
      recipientId: request.responsible_id,
      type: 'privacy.request',
      severity: 'warning',
      title: 'Prazo de solicitacao LGPD se aproxima',
      message: `O protocolo ${request.id} vence em ${new Date(request.due_at).toLocaleDateString('pt-BR')}.`,
      entityType: 'privacy_request',
      entityId: request.id,
      dedupeKey: `privacy-request-due-3d:${request.id}`
    })
    if (result) notified += 1
  }

  const toAnonymize = await runQuery(`
    select id, tenant_id
      from tenant_audit_requests
     where request_kind = 'privacy'
       and status in ('closed', 'rejected')
       and privacy_anonymized_at is null
       and updated_at <= ($1::timestamptz - interval '7 days')
  `, [now])
  let anonymized = 0
  for (const request of toAnonymize.rows) {
    const result = await runQuery(`
      update tenant_audit_requests
         set requested_by = 'anonymized', requester_role = '', subject = 'Solicitacao LGPD anonimizada',
             reason = 'Dados anonimizados conforme politica de retencao de 7 dias.',
             scope = '{}'::jsonb, privacy_anonymized_at = $2, updated_at = $2
       where id = $1 and privacy_anonymized_at is null
       returning id
    `, [request.id, now])
    if (!result.rowCount) continue
    await runQuery(`
      update tenant_audit_request_messages
         set sender_id = 'anonymized', body = 'Conteudo anonimizado conforme politica de retencao de 7 dias.'
       where request_id = $1
    `, [request.id])
    await audit(request.tenant_id, {
      action: 'privacy.request.anonymized', actorType: 'system', actorId: 'privacy-retention',
      entityType: 'privacy_request', entityId: request.id,
      details: { retentionDays: 7 }
    })
    anonymized += 1
  }
  return { notified, anonymized }
}

export const startPrivacyRequestRetention = () => {
  const intervalMs = Math.max(60_000, Number(env.privacyRequestRetentionIntervalMs) || 60 * 60 * 1000)
  const run = async () => {
    const result = await runPrivacyRequestRetention()
    if (result.notified || result.anonymized) console.log(`[PrivacyRetention] ${result.notified} alerta(s), ${result.anonymized} solicitacao(oes) anonimizada(s).`)
  }
  void run().catch((error) => console.error('[PrivacyRetention] Falha na rotina:', error))
  const timer = setInterval(() => void run().catch((error) => console.error('[PrivacyRetention] Falha na rotina:', error)), intervalMs)
  timer.unref?.()
  return timer
}
