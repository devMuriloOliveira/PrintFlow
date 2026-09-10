import { env } from '../config/env.js'
import { hasDatabase, withPlatformAdmin, withTenant } from '../db/pool.js'
import { writeAuditEvent, writeOperationalNotification } from '../services/operationalEvents.js'

const deadlineFor = (subscription = {}) => {
  if (subscription.status === 'trial') return subscription.trial_ends_at
  if (subscription.status === 'active') return subscription.current_period_end
  if (subscription.status === 'grace') return subscription.grace_ends_at
  return null
}

export const subscriptionTransition = (subscription, now = new Date()) => {
  const deadline = deadlineFor(subscription)
  if (!deadline || new Date(deadline) > now) return null
  if (subscription.status === 'trial') return 'ended'
  if (subscription.status === 'active') return 'past_due'
  if (subscription.status === 'grace') return 'paused'
  return null
}

export const runSubscriptionWatchdog = async ({ now = new Date(), warningMs = env.subscriptionWarningMs } = {}) => {
  if (!hasDatabase) return { transitioned: 0, warned: 0 }

  const warningUntil = new Date(now.getTime() + Math.max(60 * 60 * 1000, Number(warningMs) || 3 * 24 * 60 * 60 * 1000))
  const work = await withPlatformAdmin(async (client) => {
    const result = await client.query(`
      select id, tenant_id, status, trial_ends_at, current_period_end, grace_ends_at
        from tenant_subscriptions
       where status in ('trial', 'active', 'grace')
       for update
    `)
    const transitions = []
    const warnings = []

    for (const subscription of result.rows) {
      const deadline = deadlineFor(subscription)
      const nextStatus = subscriptionTransition(subscription, now)
      if (nextStatus) {
        await client.query(
          'update tenant_subscriptions set status = $2, updated_at = now() where id = $1',
          [subscription.id, nextStatus]
        )
        await client.query(`
          insert into tenant_subscription_events (tenant_id, subscription_id, action, previous_state, new_state, reason, actor_user_id, source)
          values ($1, $2, 'subscription.deadline_transition', $3::jsonb, $4::jsonb, $5, '', 'system')
        `, [subscription.tenant_id, subscription.id, JSON.stringify({ status: subscription.status, deadline }), JSON.stringify({ status: nextStatus }), 'Transicao automatica pelo prazo da assinatura.'])
        transitions.push({ tenantId: subscription.tenant_id, subscriptionId: subscription.id, fromStatus: subscription.status, toStatus: nextStatus, deadline })
      } else if (deadline && new Date(deadline) <= warningUntil) {
        warnings.push({ tenantId: subscription.tenant_id, subscriptionId: subscription.id, status: subscription.status, deadline })
      }
    }
    return { transitions, warnings }
  })

  for (const item of [...work.transitions, ...work.warnings]) {
    const transitioned = 'toStatus' in item
    await withTenant(item.tenantId, async (client) => {
      const title = transitioned ? 'Assinatura atualizada por prazo' : 'Prazo da assinatura proximo'
      const message = transitioned
        ? `A assinatura mudou de ${item.fromStatus} para ${item.toStatus} em razao do prazo configurado.`
        : `A assinatura em ${item.status} vence em ${new Date(item.deadline).toLocaleString('pt-BR')}.`
      await writeOperationalNotification(item.tenantId, {
        type: transitioned ? 'subscription.status_changed' : 'subscription.deadline_soon',
        severity: transitioned ? 'warning' : 'info', title, message,
        entityType: 'tenant_subscription', entityId: String(item.subscriptionId),
        dedupeKey: transitioned
          ? `subscription-transition:${item.subscriptionId}:${item.toStatus}:${new Date(item.deadline).toISOString()}`
          : `subscription-warning:${item.subscriptionId}:${item.status}:${new Date(item.deadline).toISOString()}`
      }, client)
      await writeAuditEvent(item.tenantId, {
        action: transitioned ? 'subscription.deadline_transition' : 'subscription.deadline_warning',
        actorType: 'system', entityType: 'tenant_subscription', entityId: String(item.subscriptionId),
        details: transitioned ? { fromStatus: item.fromStatus, toStatus: item.toStatus, deadline: item.deadline } : { status: item.status, deadline: item.deadline }
      }, client)
    })
  }

  return { transitioned: work.transitions.length, warned: work.warnings.length }
}

export const startSubscriptionWatchdog = () => {
  if (!hasDatabase || env.subscriptionWatchdogIntervalMs <= 0) return null
  const run = () => runSubscriptionWatchdog().catch((error) => console.error('[SubscriptionWatchdog] Falha:', error))
  void run()
  const timer = setInterval(run, env.subscriptionWatchdogIntervalMs)
  timer.unref?.()
  return timer
}
