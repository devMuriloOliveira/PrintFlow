import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'
import { hasDatabase, query, withPlatformAdmin, withTenant } from '../db/pool.js'

const provider = 'mercado_pago'
const text = (value, max = 500) => String(value || '').trim().slice(0, max)
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const billingPlanCode = 'starter'
const supportedEvents = new Set(['subscription_preapproval', 'subscription_authorized_payment', 'payment'])

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

const mercadoPagoRequest = async (path, options = {}) => {
  if (!env.mercadoPagoAccessToken) throw new Error('Mercado Pago ainda nao esta configurado. Informe MERCADO_PAGO_ACCESS_TOKEN no ambiente de deploy.')
  const response = await fetch(`${env.mercadoPagoApiUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.mercadoPagoAccessToken}`,
      'Content-Type': 'application/json',
      ...(env.mercadoPagoEnvironment === 'sandbox' ? { 'X-Scope': 'stage' } : {}),
      ...(options.headers || {})
    }
  })
  const body = await response.text()
  let data = {}
  try { data = body ? JSON.parse(body) : {} } catch { data = {} }
  if (!response.ok) {
    const error = new Error(text(data.message || data.cause?.[0]?.description || `Mercado Pago retornou HTTP ${response.status}`, 500))
    error.status = response.status
    throw error
  }
  return data
}

const activePlans = async () => {
  const result = await query(`select id, code, name, description, monthly_reference_price, yearly_reference_price from platform_plans where code = $1 and active = true limit 1`, [billingPlanCode])
  return result.rows.map((plan) => ({
    id: String(plan.id), code: plan.code, name: plan.name, description: plan.description || '',
    monthly: number(plan.monthly_reference_price), yearly: number(plan.yearly_reference_price)
  }))
}

const subscriptionStatus = (value) => {
  const status = text(value, 80).toLowerCase()
  if (status === 'cancelled') return 'cancelled'
  if (status === 'paused') return 'paused'
  return ''
}

export const invoiceStatus = (invoice = {}) => {
  const paymentStatus = text(invoice.payment?.status, 80).toLowerCase()
  if (paymentStatus === 'approved') return 'paid'
  if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(paymentStatus)) return 'void'
  if (text(invoice.status, 80).toLowerCase() === 'recycling') return 'overdue'
  return 'pending'
}

export const getMercadoPagoBillingSummary = async (tenantId) => {
  const plans = hasDatabase ? await activePlans() : []
  if (!hasDatabase) return { configured: Boolean(env.mercadoPagoAccessToken), environment: env.mercadoPagoEnvironment, plans: [], subscription: null, checkout: null }
  return withTenant(tenantId, async (client) => {
    const [subscription, checkout] = await Promise.all([
      client.query(`select subscription.status, subscription.billing_cycle, subscription.current_period_end, plan.code as plan_code, plan.name as plan_name from tenant_subscriptions subscription left join platform_plans plan on plan.id = subscription.plan_id where subscription.tenant_id = $1 limit 1`, [tenantId]),
      client.query(`select status, checkout_url, expires_at, created_at from tenant_billing_checkouts where tenant_id = $1 and provider = '${provider}' and status in ('creating', 'open') order by created_at desc limit 1`, [tenantId])
    ])
    const current = subscription.rows[0]
    const pending = checkout.rows[0]
    return {
      configured: Boolean(env.mercadoPagoAccessToken), environment: env.mercadoPagoEnvironment,
      plans: plans.map((plan) => ({ ...plan, monthlyEnabled: plan.monthly > 0, yearlyEnabled: plan.yearly > 0 })),
      subscription: current ? { status: current.status, billingCycle: current.billing_cycle, planCode: current.plan_code || '', planName: current.plan_name || '', currentPeriodEnd: current.current_period_end } : null,
      checkout: pending ? { status: pending.status, url: pending.checkout_url, expiresAt: pending.expires_at, createdAt: pending.created_at } : null
    }
  })
}

export const createMercadoPagoCheckout = async ({ tenantId, actorId, actorEmail, planCode, billingCycle }) => {
  if (!hasDatabase) throw new Error('A cobranca exige banco de dados.')
  if (!env.appPublicUrl) throw new Error('APP_PUBLIC_URL precisa estar configurada antes de ativar o checkout do Mercado Pago.')
  const cycle = ['monthly', 'yearly'].includes(billingCycle) ? billingCycle : ''
  const plan = (await activePlans()).find((item) => item.code === text(planCode, 80))
  if (!plan || !cycle) throw new Error('Plano ou ciclo de cobranca invalido.')
  const amount = number(plan[cycle])
  if (amount <= 0) throw new Error('O valor da assinatura ainda nao foi configurado.')
  const payerEmail = env.mercadoPagoEnvironment === 'sandbox'
    ? text(env.mercadoPagoTestPayerEmail, 320)
    : text(actorEmail, 320)
  if (!payerEmail) throw new Error('O Owner precisa possuir um e-mail valido para iniciar a assinatura.')

  const pending = await withTenant(tenantId, (client) => client.query(`
    select id, checkout_url, expires_at
      from tenant_billing_checkouts
     where tenant_id = $1 and provider = '${provider}' and status in ('creating', 'open') and checkout_url <> ''
     order by created_at desc limit 1
  `, [tenantId]))
  if (pending.rowCount) return { id: pending.rows[0].id, url: pending.rows[0].checkout_url, expiresAt: pending.rows[0].expires_at }

  const checkoutId = `mercado_pago_checkout_${randomBytes(12).toString('hex')}`
  await withTenant(tenantId, (client) => client.query(`
    insert into tenant_billing_checkouts (id, tenant_id, plan_id, billing_cycle, amount, provider, status, created_by)
    values ($1, $2, $3, $4, $5, '${provider}', 'creating', $6)
  `, [checkoutId, tenantId, plan.id, cycle, amount, String(actorId || '')]))

  try {
    const subscription = await mercadoPagoRequest('/preapproval', {
      method: 'POST',
      body: JSON.stringify({
        reason: `PrintFlow - assinatura ${cycle === 'yearly' ? 'anual' : 'mensal'}`,
        external_reference: checkoutId,
        payer_email: payerEmail,
        auto_recurring: {
          frequency: cycle === 'yearly' ? 12 : 1,
          frequency_type: 'months',
          transaction_amount: amount,
          currency_id: 'BRL'
        },
        back_url: checkoutReturnUrl('success'),
        status: 'pending'
      })
    })
    const providerCheckoutId = text(subscription.id, 160)
    const checkoutUrl = text(subscription.init_point, 1000)
    if (!providerCheckoutId || !checkoutUrl) throw new Error('O Mercado Pago nao retornou um checkout valido.')
    await withTenant(tenantId, (client) => client.query(`
      update tenant_billing_checkouts set provider_checkout_id = $2, checkout_url = $3, status = 'open', updated_at = now() where id = $1
    `, [checkoutId, providerCheckoutId, checkoutUrl]))
    return { id: checkoutId, url: checkoutUrl, expiresAt: null }
  } catch (error) {
    await withTenant(tenantId, (client) => client.query(`update tenant_billing_checkouts set status = 'failed', updated_at = now() where id = $1`, [checkoutId]))
    throw error
  }
}

const signatureParts = (value) => Object.fromEntries(String(value || '').split(',').map((part) => part.trim().split('=').map((item) => item.trim())).filter(([key, item]) => key && item))

export const mercadoPagoWebhookSignatureMatches = ({ xSignature = '', xRequestId = '', dataId = '' } = {}) => {
  const { ts, v1 } = signatureParts(xSignature)
  const secret = text(env.mercadoPagoWebhookSecret, 500)
  const normalizedDataId = text(dataId, 200).toLowerCase()
  const requestId = text(xRequestId, 200)
  if (!secret || !ts || !v1 || !normalizedDataId || !requestId || !/^[a-f0-9]{64}$/i.test(v1)) return false
  const manifest = `id:${normalizedDataId};request-id:${requestId};ts:${ts};`
  const expected = Buffer.from(createHmac('sha256', secret).update(manifest).digest('hex'))
  const received = Buffer.from(v1.toLowerCase())
  return expected.length === received.length && timingSafeEqual(expected, received)
}

const recordSubscriptionEvent = async (client, { tenantId, subscriptionId, eventId, action, reason, state }) => {
  if (!subscriptionId) return
  await client.query(`
    insert into tenant_subscription_events (tenant_id, subscription_id, action, new_state, reason, actor_user_id, source, provider, provider_event_id)
    values ($1,$2,$3,$4::jsonb,$5,'','provider','${provider}',$6)
  `, [tenantId, subscriptionId, action, JSON.stringify(state), reason, eventId])
}

const syncPreapproval = async (client, { resource, eventId, action }) => {
  const providerSubscriptionId = text(resource.id, 160)
  const externalReference = text(resource.external_reference, 200)
  if (!providerSubscriptionId || !externalReference) return { ignored: true }
  const checkoutResult = await client.query(`select * from tenant_billing_checkouts where provider = '${provider}' and id = $1 and provider_checkout_id = $2 limit 1`, [externalReference, providerSubscriptionId])
  const checkout = checkoutResult.rows[0]
  if (!checkout) return { ignored: true }
  const tenantId = checkout.tenant_id
  const currentResult = await client.query(`select * from tenant_subscriptions where tenant_id = $1 limit 1`, [tenantId])
  let subscription = currentResult.rows[0]
  const providerState = subscriptionStatus(resource.status)
  const providerCustomerId = text(resource.payer_id, 160) || null

  if (!subscription) {
    const created = await client.query(`
      insert into tenant_subscriptions (id, tenant_id, plan_id, status, billing_cycle, started_at, manual_override, source, provider, provider_customer_id, provider_subscription_id, last_provider_sync_at)
      values ($1,$2,$3,$4,$5,now(),false,'provider','${provider}',$6,$7,now()) returning *
    `, [`subscription_${randomBytes(12).toString('hex')}`, tenantId, checkout.plan_id, providerState || 'past_due', checkout.billing_cycle, providerCustomerId, providerSubscriptionId])
    subscription = created.rows[0]
  } else if (!(subscription.manual_override && subscription.status === 'courtesy') && (subscription.provider === provider || text(resource.status, 80).toLowerCase() === 'authorized')) {
    await client.query(`
      update tenant_subscriptions
         set plan_id = $2, billing_cycle = $3, status = coalesce(nullif($4, ''), status), provider = '${provider}',
             provider_customer_id = coalesce($5, provider_customer_id), provider_subscription_id = $6,
             source = 'provider', last_provider_sync_at = now(), cancelled_at = case when $4 = 'cancelled' then now() else cancelled_at end,
             updated_at = now()
       where id = $1
    `, [subscription.id, checkout.plan_id, checkout.billing_cycle, providerState, providerCustomerId, providerSubscriptionId])
  }

  if (providerState === 'cancelled') await client.query(`update tenants set billing_status = 'cancelled' where id = $1`, [tenantId])
  if (providerState === 'paused') await client.query(`update tenants set billing_status = 'paused' where id = $1`, [tenantId])
  if (providerState === 'cancelled') await client.query(`update tenant_billing_checkouts set status = 'cancelled', updated_at = now() where id = $1`, [checkout.id])
  await recordSubscriptionEvent(client, {
    tenantId, subscriptionId: subscription.id, eventId, action: `mercado_pago.${text(action, 120) || 'subscription_preapproval'}`,
    reason: 'Atualizacao de assinatura recebida do Mercado Pago.',
    state: { providerSubscriptionId, status: text(resource.status, 80) }
  })
  return { tenantId, subscriptionId: subscription.id }
}

const syncInvoice = async (client, { invoice, eventId, action }) => {
  const providerInvoiceId = text(invoice.id, 160)
  const providerSubscriptionId = text(invoice.preapproval_id, 160)
  if (!providerInvoiceId || !providerSubscriptionId) return { ignored: true }
  const subscriptionResult = await client.query(`select * from tenant_subscriptions where provider = '${provider}' and provider_subscription_id = $1 limit 1`, [providerSubscriptionId])
  const subscription = subscriptionResult.rows[0]
  if (!subscription) return { ignored: true }
  const tenantId = subscription.tenant_id
  const status = invoiceStatus(invoice)
  const dueAt = invoice.debit_date || invoice.date_created || null
  const paidAt = status === 'paid' ? (invoice.payment?.date_approved || invoice.last_modified || new Date().toISOString()) : null
  const paymentId = text(invoice.payment?.id, 160)
  const existing = await client.query(`select id from tenant_billing_records where provider = '${provider}' and provider_invoice_id = $1 limit 1`, [providerInvoiceId])
  if (existing.rowCount) {
    await client.query(`update tenant_billing_records set status = $2, due_at = coalesce($3::timestamptz, due_at), paid_at = coalesce($4::timestamptz, paid_at), amount = $5, updated_at = now() where id = $1`, [existing.rows[0].id, status, dueAt, paidAt, Math.max(0, number(invoice.transaction_amount))])
  } else {
    await client.query(`
      insert into tenant_billing_records (id, tenant_id, subscription_id, reference, amount, currency, due_at, paid_at, status, source, provider, provider_invoice_id, notes)
      values ($1,$2,$3,$4,$5,'BRL',$6::timestamptz,$7::timestamptz,$8,'provider','${provider}',$9,$10)
    `, [`billing_${randomBytes(12).toString('hex')}`, tenantId, subscription.id, text(invoice.reason || 'Cobranca recorrente', 120), Math.max(0, number(invoice.transaction_amount)), dueAt, paidAt, status, providerInvoiceId, paymentId ? `Pagamento Mercado Pago ${paymentId}` : 'Cobranca recorrente Mercado Pago'])
  }

  if (status === 'paid' && !(subscription.manual_override && subscription.status === 'courtesy')) {
    const periodStart = paidAt || dueAt || new Date().toISOString()
    const periodEnd = addCycle(periodStart, subscription.billing_cycle)
    await client.query(`
      update tenant_subscriptions
         set status = 'active', current_period_start = $2::timestamptz, current_period_end = $3::timestamptz,
             source = 'provider', last_provider_sync_at = now(), updated_at = now()
       where id = $1
    `, [subscription.id, periodStart, periodEnd])
    await client.query(`update tenant_billing_checkouts set status = 'paid', updated_at = now() where provider = '${provider}' and provider_checkout_id = $1 and tenant_id = $2`, [providerSubscriptionId, tenantId])
    await client.query(`update tenants set billing_status = 'active', billing_due_at = $2::timestamptz, account_status = case when account_status = 'suspended' then account_status else 'active' end where id = $1`, [tenantId, periodEnd])
  } else if (status === 'overdue' && !(subscription.manual_override && subscription.status === 'courtesy')) {
    await client.query(`update tenant_subscriptions set status = 'past_due', source = 'provider', last_provider_sync_at = now(), updated_at = now() where id = $1`, [subscription.id])
    await client.query(`update tenants set billing_status = 'overdue', billing_due_at = $2::timestamptz where id = $1`, [tenantId, dueAt])
  }

  await recordSubscriptionEvent(client, {
    tenantId, subscriptionId: subscription.id, eventId, action: `mercado_pago.${text(action, 120) || 'subscription_authorized_payment'}`,
    reason: 'Atualizacao de cobranca recebida do Mercado Pago.',
    state: { providerInvoiceId, providerSubscriptionId, status, paymentId: paymentId || null }
  })
  return { tenantId, subscriptionId: subscription.id }
}

const resourceForEvent = async (eventType, resourceId) => {
  if (eventType === 'subscription_preapproval') return { kind: 'subscription', data: await mercadoPagoRequest(`/preapproval/${encodeURIComponent(resourceId)}`) }
  if (eventType === 'subscription_authorized_payment') return { kind: 'invoice', data: await mercadoPagoRequest(`/authorized_payments/${encodeURIComponent(resourceId)}`) }
  if (eventType === 'payment') {
    const invoices = await mercadoPagoRequest(`/authorized_payments/search?payment_id=${encodeURIComponent(resourceId)}`)
    return { kind: 'invoice', data: Array.isArray(invoices.results) ? invoices.results[0] : null }
  }
  return { kind: '', data: null }
}

export const processMercadoPagoWebhook = async ({ notification = {}, resourceId = '' } = {}) => {
  if (!hasDatabase) return { handled: false, reason: 'database_unavailable' }
  const eventId = text(notification.id, 200)
  const eventType = text(notification.type, 120)
  const action = text(notification.action, 120)
  const providerResourceId = text(resourceId, 160)
  if (!eventId || !providerResourceId || !supportedEvents.has(eventType)) throw new Error('Webhook Mercado Pago sem evento valido.')

  return withPlatformAdmin(async (client) => {
    const received = await client.query(`
      insert into payment_provider_events (provider, provider_event_id, event_type, provider_resource_id)
      values ('${provider}', $1, $2, $3) on conflict (provider, provider_event_id) do nothing returning id
    `, [eventId, eventType, providerResourceId])
    if (!received.rowCount) return { handled: true, duplicate: true }
    const resource = await resourceForEvent(eventType, providerResourceId)
    const synced = resource.kind === 'subscription'
      ? await syncPreapproval(client, { resource: resource.data || {}, eventId, action })
      : await syncInvoice(client, { invoice: resource.data || {}, eventId, action })
    if (synced.tenantId) await client.query(`update payment_provider_events set tenant_id = $2, processed_at = now() where provider = '${provider}' and provider_event_id = $1`, [eventId, synced.tenantId])
    else await client.query(`update payment_provider_events set processed_at = now() where provider = '${provider}' and provider_event_id = $1`, [eventId])
    return { handled: true, ...synced }
  })
}
