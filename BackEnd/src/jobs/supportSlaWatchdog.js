import { env } from '../config/env.js'
import { hasDatabase, query } from '../db/pool.js'
import { writePlatformAdminNotification } from '../services/platformAdminNotifications.js'

const warningMs = () => Math.max(60 * 60 * 1000, Number(env.supportSlaWarningMs) || 24 * 60 * 60 * 1000)

export const runSupportSlaWatchdog = async ({ now = new Date(), runQuery = query, notify = writePlatformAdminNotification, databaseAvailable = hasDatabase } = {}) => {
  if (!databaseAvailable) return { notified: 0 }
  const warningUntil = new Date(now.getTime() + warningMs())
  const result = await runQuery(`
    select request.id, request.chat_assigned_to, request.support_first_response_due_at,
           request.support_resolution_due_at,
           escalation.user_id as escalation_recipient_id,
           exists (
             select 1 from tenant_audit_request_messages message
              where message.request_id = request.id and message.sender_type = 'superadmin'
                and message.visibility = 'public'
           ) as has_public_response
      from tenant_audit_requests request
      left join lateral (
        select u.id as user_id
          from users u
          join platform_super_admins sa on sa.user_id = u.id and sa.status = 'active'
         where u.role = 'platform_super_admin' and u.status = 'active'
           and u.id::text <> request.chat_assigned_to
         order by u.id
         limit 1
      ) escalation on true
     where request.request_kind = 'support'
       and request.chat_assigned_to is not null
       and request.support_status <> 'resolved'
       and (request.support_snoozed_until is null or request.support_snoozed_until <= $2)
       and request.status not in ('cancelled', 'expired')
       and (
         (request.support_first_response_due_at is not null and request.support_first_response_due_at <= $1)
         or (request.support_resolution_due_at is not null and request.support_resolution_due_at <= $1)
       )
  `, [warningUntil, now])
  let notified = 0
  for (const request of result.rows) {
    const firstDue = request.support_first_response_due_at ? new Date(request.support_first_response_due_at) : null
    const resolutionDue = request.support_resolution_due_at ? new Date(request.support_resolution_due_at) : null
    const candidates = []
    if (!request.has_public_response && firstDue) candidates.push({ kind: 'first-response', due: firstDue, label: 'primeira resposta' })
    if (resolutionDue) candidates.push({ kind: 'resolution', due: resolutionDue, label: 'resolucao' })
    for (const item of candidates) {
      const overdue = item.due <= now
      const state = overdue ? 'overdue' : 'due-soon'
      const created = await notify(request.chat_assigned_to, {
        type: 'support.sla', severity: overdue ? 'error' : 'warning',
        title: overdue ? 'SLA de suporte vencido' : 'SLA de suporte proximo do vencimento',
        message: overdue
          ? `O protocolo ${request.id} ultrapassou o prazo de ${item.label}.`
          : `O protocolo ${request.id} vence em ${item.label} em ${item.due.toLocaleString('pt-BR')}.`,
        entityType: 'support_request', entityId: request.id,
        dedupeKey: `support-sla:${item.kind}:${state}:${request.id}`
      })
      if (created) notified += 1
      if (overdue && item.kind === 'resolution' && request.escalation_recipient_id) {
        const escalated = await notify(request.escalation_recipient_id, {
          type: 'support.sla.escalation', severity: 'error',
          title: 'Escalonamento de SLA de suporte',
          message: `O protocolo ${request.id} está vencido e precisa de acompanhamento da equipe.`,
          entityType: 'support_request', entityId: request.id,
          dedupeKey: `support-sla:escalation:${request.id}`
        })
        if (escalated) notified += 1
      }
    }
  }
  return { notified }
}

export const startSupportSlaWatchdog = () => {
  const intervalMs = Math.max(60_000, Number(env.supportSlaWatchdogIntervalMs) || 15 * 60 * 1000)
  const run = async () => {
    const result = await runSupportSlaWatchdog()
    if (result.notified) console.log(`[SupportSLA] ${result.notified} alerta(s) gerado(s).`)
  }
  void run().catch((error) => console.error('[SupportSLA] Falha na rotina:', error))
  const timer = setInterval(() => void run().catch((error) => console.error('[SupportSLA] Falha na rotina:', error)), intervalMs)
  timer.unref?.()
  return timer
}
