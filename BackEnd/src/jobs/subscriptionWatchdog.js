import { env } from '../config/env.js'
import { hasDatabase, withPlatformAdmin, withTenant } from '../db/pool.js'
import { writeAuditEvent, writeOperationalNotification } from '../services/operationalEvents.js'
import { subscriptionCancellationDeadline } from '../services/subscriptionEntitlements.js'
import { expireMercadoPagoPendingCheckouts } from '../services/mercadoPagoBilling.js'

const deadlineFor = (subscription = {}) => {
  if (subscription.cancel_at_period_end) return subscriptionCancellationDeadline(subscription)
  if (subscription.status === 'grace') return subscription.grace_ends_at
  return null
}

export const subscriptionTransition = (subscription, now = new Date()) => {
  const deadline = deadlineFor(subscription)
  if (!deadline || new Date(deadline) > now) return null
  if (subscription.cancel_at_period_end) return 'cancelled'
  if (subscription.status === 'grace') return 'paused'
  return null
}

export const runSubscriptionWatchdog = async ({ now = new Date(), warningMs = env.subscriptionWarningMs } = {}) => {
  if (!hasDatabase) return { transitioned: 0, warned: 0 }

  const warningUntil = new Date(now.getTime() + Math.max(60 * 60 * 1000, Number(warningMs) || 3 * 24 * 60 * 60 * 1000))
  const work = await withPlatformAdmin(async (client) => {
    const result = await client.query(`
      select id, tenant_id, status, grace_ends_at, current_period_end, trial_ends_at, cancel_at_period_end, provider
        from tenant_subscriptions
       where status = 'grace' or (provider = 'mercado_pago' and cancel_at_period_end = true)
       for update
    `)
    const transitions = []
    const warnings = []

    for (const subscription of result.rows) {
      const deadline = deadlineFor(subscription)
      const nextStatus = subscriptionTransition(subscription, now)
      if (nextStatus) {
        const freePlan = await client.query("select id from platform_plans where code = 'free' and active = true limit 1")
        await client.query(`
          update tenant_subscriptions
             set plan_id = coalesce($3, plan_id), status = $2,
                 cancel_at_period_end = case when $2 = 'cancelled' then false else cancel_at_period_end end,
                 cancelled_at = case when $2 = 'cancelled' then coalesce(cancelled_at, $4::timestamptz, now()) else cancelled_at end,
                 updated_at = now()
           where id = $1
        `, [subscription.id, nextStatus, freePlan.rows[0]?.id || null, deadline])
        if (nextStatus === 'cancelled') await client.query(`update tenants set billing_status = 'cancelled' where id = $1`, [subscription.tenant_id])
        await client.query(`
          insert into tenant_subscription_events (tenant_id, subscription_id, action, previous_state, new_state, reason, actor_user_id, source)
          values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, '', 'system')
        `, [subscription.tenant_id, subscription.id, nextStatus === 'cancelled' ? 'subscription.cancel_at_period_end_transition' : 'subscription.deadline_transition',
          JSON.stringify({ status: subscription.status, deadline }), JSON.stringify({ status: nextStatus, planCode: 'free' }),
          nextStatus === 'cancelled' ? 'Período pago encerrado após o cancelamento da renovação; empresa retornou ao FREE sem excluir dados.' : 'Carencia de pagamento encerrada; empresa retornou ao FREE sem excluir dados.'])
        transitions.push({ tenantId: subscription.tenant_id, subscriptionId: subscription.id, fromStatus: subscription.status, toStatus: nextStatus, deadline, cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end) })
      } else if (deadline && new Date(deadline) <= warningUntil) {
        warnings.push({ tenantId: subscription.tenant_id, subscriptionId: subscription.id, status: subscription.status, deadline })
      }
    }
    return { transitions, warnings }
  })

  for (const item of [...work.transitions, ...work.warnings]) {
    const transitioned = 'toStatus' in item
    await withTenant(item.tenantId, async (client) => {
      const title = transitioned && item.toStatus === 'cancelled' ? 'Período da assinatura encerrado' : transitioned ? 'Assinatura atualizada por prazo' : 'Prazo da assinatura proximo'
      const message = transitioned
        ? item.toStatus === 'cancelled'
          ? 'O período pago terminou. A empresa voltou ao plano FREE e seus dados foram mantidos.'
          : `A assinatura mudou de ${item.fromStatus} para ${item.toStatus} em razao do prazo configurado.`
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

  const checkoutExpiry = await expireMercadoPagoPendingCheckouts({ now })
  return {
    transitioned: work.transitions.length,
    warned: work.warnings.length,
    expiredCheckouts: checkoutExpiry.expired,
    checkoutExpiryFailures: checkoutExpiry.failed
  }
}

export const startSubscriptionWatchdog = () => {
  if (!hasDatabase || env.subscriptionWatchdogIntervalMs <= 0) return null
  const run = () => runSubscriptionWatchdog().catch((error) => console.error('[SubscriptionWatchdog] Falha:', error))
  void run()
  const timer = setInterval(run, env.subscriptionWatchdogIntervalMs)
  timer.unref?.()
  return timer
}
