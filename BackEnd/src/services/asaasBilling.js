import { randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'
import { hasDatabase, query, withPlatformAdmin, withTenant } from '../db/pool.js'

const provider = 'asaas'
const text = (value, max = 500) => String(value || '').trim().slice(0, max)
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const paymentEvents = new Set(['PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED'])
const paidEvents = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'])
const voidEvents = new Set(['PAYMENT_DELETED', 'PAYMENT_REFUNDED'])
const billingPlanCode = 'starter'

const cycleFor = (billingCycle) => billingCycle === 'yearly' ? 'YEARLY' : 'MONTHLY'
const priceFor = (plan, billingCycle) => {
  const configured = number(billingCycle === 'yearly' ? env.asaasYearlyPrice : env.asaasMonthlyPrice)
  if (configured > 0) return configured
  return number(billingCycle === 'yearly' ? plan.yearly_reference_price : plan.monthly_reference_price)
}
const addCycle = (value, billingCycle) => {
  const date = new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) return null
  if (billingCycle === 'yearly') date.setFullYear(date.getFullYear() + 1)
  else date.setMonth(date.getMonth() + 1)
  return date.toISOString()
}
const checkoutReturnUrl = (path) => {
  const origin = text(env.appPublicUrl, 800).replace(/\/$/, '')
  return origin ? `${origin}/configuracoes?billing=${path}` : ''
}

const asaasRequest = async (path, options = {}) => {
  if (!env.asaasApiKey) throw new Error('Asaas ainda nao esta configurado. Informe ASAAS_API_KEY no ambiente de deploy.')
  const response = await fetch(`${env.asaasApiUrl}${path}`, {
    ...options,
    headers: { access_token: env.asaasApiKey, 'Content-Type': 'application/json', ...(options.headers || {}) }
  })
  const body = await response.text()
  let data = {}
  try { data = body ? JSON.parse(body) : {} } catch { data = {} }
  if (!response.ok) {
    const error = new Error(text(data.errors?.[0]?.description || data.message || `Asaas retornou HTTP ${response.status}`, 500))
    error.status = response.status
    throw error
  }
  return data
}

const activePlans = async () => {
  const result = await query(`select id, code, name, description, monthly_reference_price, yearly_reference_price from platform_plans where code = $1 and active = true limit 1`, [billingPlanCode])
  return result.rows.map((plan) => ({
    id: String(plan.id), code: plan.code, name: plan.name, description: plan.description || '',
    monthly: priceFor(plan, 'monthly'), yearly: priceFor(plan, 'yearly')
  }))
}

export const getAsaasBillingSummary = async (tenantId) => {
  const plans = hasDatabase ? await activePlans() : []
  if (!hasDatabase) return { configured: Boolean(env.asaasApiKey), environment: env.asaasEnvironment, plans: [], subscription: null, checkout: null }
  return withTenant(tenantId, async (client) => {
    const [subscription, checkout] = await Promise.all([
      client.query(`select subscription.status, subscription.billing_cycle, subscription.current_period_end, plan.code as plan_code, plan.name as plan_name from tenant_subscriptions subscription left join platform_plans plan on plan.id = subscription.plan_id where subscription.tenant_id = $1 limit 1`, [tenantId]),
      client.query(`select status, checkout_url, expires_at, created_at from tenant_billing_checkouts where tenant_id = $1 and status in ('creating', 'open') order by created_at desc limit 1`, [tenantId])
    ])
    const current = subscription.rows[0]
    const pending = checkout.rows[0]
    return {
      configured: Boolean(env.asaasApiKey), environment: env.asaasEnvironment,
      plans: plans.map((plan) => ({ ...plan, monthlyEnabled: plan.monthly > 0, yearlyEnabled: plan.yearly > 0 })),
      subscription: current ? { status: current.status, billingCycle: current.billing_cycle, planCode: current.plan_code || '', planName: current.plan_name || '', currentPeriodEnd: current.current_period_end } : null,
      checkout: pending ? { status: pending.status, url: pending.checkout_url, expiresAt: pending.expires_at, createdAt: pending.created_at } : null
    }
  })
}

export const createAsaasPaymentLink = async ({ tenantId, actorId, planCode, billingCycle }) => {
  if (!hasDatabase) throw new Error('A cobranca exige banco de dados.')
  if (!env.appPublicUrl) throw new Error('APP_PUBLIC_URL precisa estar configurada antes de ativar o checkout Asaas.')
  const cycle = ['monthly', 'yearly'].includes(billingCycle) ? billingCycle : ''
  const plan = (await activePlans()).find((item) => item.code === text(planCode, 80))
  if (!plan || !cycle) throw new Error('Plano ou ciclo de cobranca invalido.')
  const amount = number(plan[cycle])
  if (amount <= 0) throw new Error('Defina os valores ASAAS_MONTHLY_PRICE e ASAAS_YEARLY_PRICE antes de gerar a cobranca.')

  const pending = await withTenant(tenantId, (client) => client.query(`
    select id, checkout_url, expires_at
      from tenant_billing_checkouts
     where tenant_id = $1
       and status in ('creating', 'open')
       and checkout_url <> ''
     order by created_at desc
     limit 1
  `, [tenantId]))
  if (pending.rowCount) {
    return { id: pending.rows[0].id, url: pending.rows[0].checkout_url, expiresAt: pending.rows[0].expires_at }
  }

  const checkoutId = `asaas_checkout_${randomBytes(12).toString('hex')}`
  await withTenant(tenantId, (client) => client.query(`
    insert into tenant_billing_checkouts (id, tenant_id, plan_id, billing_cycle, amount, provider, status, created_by)
    values ($1, $2, $3, $4, $5, '${provider}', 'creating', $6)
  `, [checkoutId, tenantId, plan.id, cycle, amount, String(actorId)]))

  try {
    const paymentLink = await asaasRequest('/paymentLinks', {
      method: 'POST',
      body: JSON.stringify({
        name: `PrintFlow ${plan.name}`,
        description: `Assinatura ${cycle === 'yearly' ? 'anual' : 'mensal'} do plano ${plan.name}`,
        value: amount,
        billingType: 'UNDEFINED',
        chargeType: 'RECURRENT',
        subscriptionCycle: cycleFor(cycle),
        dueDateLimitDays: 5,
        externalReference: checkoutId,
        notificationEnabled: true,
        callback: {
          successUrl: checkoutReturnUrl('success'),
          cancelUrl: checkoutReturnUrl('cancelled'),
          expiredUrl: checkoutReturnUrl('expired')
        }
      })
    })
    const providerCheckoutId = text(paymentLink.id, 160)
    const checkoutUrl = text(paymentLink.url, 1000)
    if (!providerCheckoutId || !checkoutUrl) throw new Error('O Asaas nao retornou um link de pagamento valido.')
    await withTenant(tenantId, (client) => client.query(`
      update tenant_billing_checkouts
         set provider_checkout_id = $2, checkout_url = $3, status = 'open', updated_at = now()
       where id = $1
    `, [checkoutId, providerCheckoutId, checkoutUrl]))
    return { id: checkoutId, url: checkoutUrl, expiresAt: paymentLink.endDate || null }
  } catch (error) {
    await withTenant(tenantId, (client) => client.query(`update tenant_billing_checkouts set status = 'failed', updated_at = now() where id = $1`, [checkoutId]))
    throw error
  }
}

export const asaasWebhookTokenMatches = (receivedToken = '') => {
  const expected = Buffer.from(env.asaasWebhookToken || '')
  const received = Buffer.from(String(receivedToken || ''))
  if (!expected.length || expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}

export const paymentRecordStatus = (event) => paidEvents.has(event) ? 'paid' : event === 'PAYMENT_OVERDUE' ? 'overdue' : voidEvents.has(event) ? 'void' : 'pending'

export const processAsaasWebhook = async (payload = {}) => {
  if (!hasDatabase) return { handled: false, reason: 'database_unavailable' }
  const eventId = text(payload.id, 200)
  const event = text(payload.event, 120)
  const payment = payload.payment && typeof payload.payment === 'object' ? payload.payment : {}
  const subscriptionPayload = payload.subscription && typeof payload.subscription === 'object' ? payload.subscription : {}
  const paymentId = text(payment.id, 160)
  const providerSubscriptionId = text(payment.subscription || subscriptionPayload.id, 160)
  const providerCheckoutId = text(payment.paymentLink || payload.checkout?.id, 160)
  if (!eventId || !event) throw new Error('Webhook Asaas sem identificador valido.')

  return withPlatformAdmin(async (client) => {
    const received = await client.query(`
      insert into payment_provider_events (provider, provider_event_id, event_type, provider_resource_id)
      values ('${provider}', $1, $2, $3)
      on conflict (provider, provider_event_id) do nothing
      returning id
    `, [eventId, event, paymentId || providerSubscriptionId || providerCheckoutId])
    if (!received.rowCount) return { handled: true, duplicate: true }

    const checkoutResult = providerCheckoutId
      ? await client.query(`select * from tenant_billing_checkouts where provider = '${provider}' and provider_checkout_id = $1 limit 1`, [providerCheckoutId])
      : { rows: [] }
    const subscriptionResult = providerSubscriptionId
      ? await client.query(`select * from tenant_subscriptions where provider = '${provider}' and provider_subscription_id = $1 limit 1`, [providerSubscriptionId])
      : { rows: [] }
    const checkout = checkoutResult.rows[0]
    let subscription = subscriptionResult.rows[0]
    const tenantId = subscription?.tenant_id || checkout?.tenant_id

    if (!tenantId) {
      await client.query(`update payment_provider_events set processed_at = now() where provider = '${provider}' and provider_event_id = $1`, [eventId])
      return { handled: true, ignored: true }
    }

    if (!subscription) {
      const currentSubscription = await client.query(`select * from tenant_subscriptions where tenant_id = $1 limit 1`, [tenantId])
      subscription = currentSubscription.rows[0]
    }

    if (event === 'CHECKOUT_PAID' && checkout) {
      await client.query(`update tenant_billing_checkouts set status = 'paid', updated_at = now() where id = $1`, [checkout.id])
    } else if (event === 'CHECKOUT_CANCELED' && checkout) {
      await client.query(`update tenant_billing_checkouts set status = 'cancelled', updated_at = now() where id = $1`, [checkout.id])
    } else if (event === 'CHECKOUT_EXPIRED' && checkout) {
      await client.query(`update tenant_billing_checkouts set status = 'expired', updated_at = now() where id = $1`, [checkout.id])
    }

    if (paymentEvents.has(event) && paymentId) {
      const recordStatus = paymentRecordStatus(event)
      const existingRecord = await client.query(`select id from tenant_billing_records where provider = '${provider}' and provider_invoice_id = $1 limit 1`, [paymentId])
      const dueAt = payment.dueDate || null
      const paidAt = paidEvents.has(event) ? (payment.paymentDate || payment.clientPaymentDate || new Date().toISOString()) : null
      if (existingRecord.rowCount) {
        await client.query(`update tenant_billing_records set status = $2, due_at = coalesce($3::timestamptz, due_at), paid_at = coalesce($4::timestamptz, paid_at), updated_at = now() where id = $1`, [existingRecord.rows[0].id, recordStatus, dueAt, paidAt])
      } else {
        await client.query(`insert into tenant_billing_records (id, tenant_id, subscription_id, reference, amount, currency, due_at, paid_at, status, source, provider, provider_invoice_id, notes) values ($1,$2,$3,$4,$5,'BRL',$6::timestamptz,$7::timestamptz,$8,'provider','${provider}',$9,$10)`, [
          `billing_${randomBytes(12).toString('hex')}`, tenantId, subscription?.id || null, text(payment.description || event, 120), Math.max(0, number(payment.value)), dueAt, paidAt, recordStatus, paymentId, `Evento ${event}`
        ])
      }
    }

    if (paidEvents.has(event) && (checkout || subscription)) {
      if (!subscription) {
        const id = `subscription_${randomBytes(12).toString('hex')}`
        const periodStart = payment.paymentDate || payment.clientPaymentDate || new Date().toISOString()
        const periodEnd = addCycle(periodStart, checkout.billing_cycle)
        const created = await client.query(`
          insert into tenant_subscriptions (id, tenant_id, plan_id, status, billing_cycle, started_at, current_period_start, current_period_end, manual_override, source, provider, provider_customer_id, provider_subscription_id, last_provider_sync_at)
          values ($1,$2,$3,'active',$4,now(),$5::timestamptz,$6::timestamptz,false,'provider','${provider}',$7,$8,now())
          returning *
        `, [id, tenantId, checkout.plan_id, checkout.billing_cycle, periodStart, periodEnd, text(payment.customer, 160) || null, providerSubscriptionId || null])
        subscription = created.rows[0]
      } else if (!(subscription.manual_override && subscription.status === 'courtesy')) {
        const periodStart = payment.paymentDate || payment.clientPaymentDate || new Date().toISOString()
        const billingCycle = checkout?.billing_cycle || subscription.billing_cycle
        const planId = checkout?.plan_id || subscription.plan_id
        const periodEnd = addCycle(periodStart, billingCycle)
        if (!planId || !billingCycle) throw new Error('Assinatura Asaas sem plano ou ciclo de cobranca.')
        await client.query(`update tenant_subscriptions set plan_id = $2, billing_cycle = $3, status = 'active', current_period_start = $4::timestamptz, current_period_end = $5::timestamptz, provider_customer_id = coalesce($6, provider_customer_id), provider_subscription_id = coalesce($7, provider_subscription_id), source = 'provider', last_provider_sync_at = now(), updated_at = now() where id = $1`, [subscription.id, planId, billingCycle, periodStart, periodEnd, text(payment.customer, 160) || null, providerSubscriptionId || null])
      }
      if (subscription?.id) await client.query(`update tenant_billing_records set subscription_id = $2, updated_at = now() where tenant_id = $1 and provider = '${provider}' and subscription_id is null`, [tenantId, subscription.id])
      if (checkout) await client.query(`update tenant_billing_checkouts set status = 'paid', updated_at = now() where id = $1`, [checkout.id])
      await client.query(`update tenants set billing_status = 'active', billing_due_at = (select current_period_end from tenant_subscriptions where tenant_id = $1), account_status = case when account_status = 'suspended' then account_status else 'active' end where id = $1`, [tenantId])
    } else if (event === 'PAYMENT_OVERDUE' && subscription && !(subscription.manual_override && subscription.status === 'courtesy')) {
      await client.query(`update tenant_subscriptions set status = 'past_due', source = 'provider', last_provider_sync_at = now(), updated_at = now() where id = $1`, [subscription.id])
      await client.query(`update tenants set billing_status = 'overdue', billing_due_at = $2::timestamptz where id = $1`, [tenantId, payment.dueDate || null])
    }

    const linkedSubscriptionId = subscription?.id || null
    if (linkedSubscriptionId) {
      await client.query(`insert into tenant_subscription_events (tenant_id, subscription_id, action, new_state, reason, actor_user_id, source, provider, provider_event_id) values ($1,$2,$3,$4::jsonb,$5,'','provider','${provider}',$6)`, [tenantId, linkedSubscriptionId, `asaas.${event.toLowerCase()}`, JSON.stringify({ paymentId: paymentId || null, providerSubscriptionId: providerSubscriptionId || null }), `Evento recebido do Asaas: ${event}.`, eventId])
    }
    await client.query(`update payment_provider_events set tenant_id = $2, processed_at = now() where provider = '${provider}' and provider_event_id = $1`, [eventId, tenantId])
    return { handled: true, tenantId }
  })
}
