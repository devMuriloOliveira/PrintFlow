import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'
import { hasDatabase, query, withPlatformAdmin, withTenant } from '../db/pool.js'

const provider = 'stripe'
const text = (value, max = 500) => String(value || '').trim().slice(0, max)
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const billingPlanCode = 'starter'
const dateFromUnix = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? new Date(Number(value) * 1000).toISOString() : null
const checkoutReturnUrl = (state) => `${text(env.appPublicUrl, 800).replace(/\/$/, '')}/configuracoes?billing=${state}`

const stripeRequest = async (path, { method = 'GET', form = null } = {}) => {
  if (!env.stripeSecretKey) throw new Error('Stripe ainda nao esta configurado no ambiente de deploy.')
  const response = await fetch(`${env.stripeApiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.stripeSecretKey}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(form ? { body: new URLSearchParams(form).toString() } : {})
  })
  const raw = await response.text()
  let data = {}
  try { data = raw ? JSON.parse(raw) : {} } catch { data = {} }
  if (!response.ok) {
    const reference = text(response.headers.get('request-id'), 120)
    throw new Error(`Stripe retornou HTTP ${response.status}${reference ? ` (referencia Stripe: ${reference})` : ''}`)
  }
  return data
}

const mapPlan = (row) => ({
  id: String(row.id), code: row.code, name: row.name, description: row.description || '',
  monthly: number(row.monthly_reference_price), yearly: number(row.yearly_reference_price),
  stripeProductId: text(row.stripe_product_id, 160), stripeMonthlyPriceId: text(row.stripe_monthly_price_id, 160), stripeYearlyPriceId: text(row.stripe_yearly_price_id, 160),
  trialDays: Math.max(0, Math.min(30, Number(row.trial_days) || 0))
})

export const synchronizeStripePrices = async ({ name, monthly, yearly }) => {
  if (monthly <= 0 || yearly <= 0) throw new Error('Os valores mensal e anual precisam ser maiores que zero.')
  const product = await stripeRequest('/products', { method: 'POST', form: { name: `PrintFlow - ${text(name, 120)}`, 'metadata[managed_by]': 'printflow' } })
  const productId = text(product.id, 160)
  if (!productId) throw new Error('Stripe nao retornou o produto criado.')
  const [monthlyPrice, yearlyPrice] = await Promise.all([
    stripeRequest('/prices', { method: 'POST', form: { product: productId, currency: 'brl', unit_amount: String(Math.round(monthly * 100)), 'recurring[interval]': 'month', 'metadata[managed_by]': 'printflow' } }),
    stripeRequest('/prices', { method: 'POST', form: { product: productId, currency: 'brl', unit_amount: String(Math.round(yearly * 100)), 'recurring[interval]': 'year', 'metadata[managed_by]': 'printflow' } })
  ])
  const monthlyPriceId = text(monthlyPrice.id, 160)
  const yearlyPriceId = text(yearlyPrice.id, 160)
  if (!monthlyPriceId || !yearlyPriceId) throw new Error('Stripe nao retornou os precos criados.')
  return { productId, monthlyPriceId, yearlyPriceId }
}

const activePlan = async () => {
  const result = await query(`select id, code, name, description, monthly_reference_price, yearly_reference_price, stripe_product_id, stripe_monthly_price_id, stripe_yearly_price_id, trial_days from platform_plans where code = $1 and active = true limit 1`, [billingPlanCode])
  return result.rows[0] ? mapPlan(result.rows[0]) : null
}

const ensureStripePrices = async (plan) => {
  if (plan.stripeMonthlyPriceId && plan.stripeYearlyPriceId) return plan
  const prices = await synchronizeStripePrices(plan)
  const result = await withPlatformAdmin((client) => client.query(`
    update platform_plans
       set stripe_product_id = $2, stripe_monthly_price_id = $3, stripe_yearly_price_id = $4, updated_at = now()
     where id = $1
     returning id, code, name, description, monthly_reference_price, yearly_reference_price, stripe_product_id, stripe_monthly_price_id, stripe_yearly_price_id, trial_days
  `, [plan.id, prices.productId, prices.monthlyPriceId, prices.yearlyPriceId]))
  return mapPlan(result.rows[0])
}

export const getStripeBillingSummary = async (tenantId) => {
  const plan = hasDatabase ? await activePlan() : null
  if (!hasDatabase) return { configured: false, environment: 'production', plans: [], subscription: null, checkout: null }
  return withTenant(tenantId, async (client) => {
    const [subscription, checkout] = await Promise.all([
      client.query(`select subscription.status, subscription.billing_cycle, subscription.current_period_end, plan.code as plan_code, plan.name as plan_name from tenant_subscriptions subscription left join platform_plans plan on plan.id = subscription.plan_id where subscription.tenant_id = $1 limit 1`, [tenantId]),
      client.query(`select status, checkout_url, expires_at, created_at from tenant_billing_checkouts where tenant_id = $1 and provider = '${provider}' and status in ('creating', 'open') order by created_at desc limit 1`, [tenantId])
    ])
    return {
      configured: Boolean(env.stripeSecretKey && env.stripeWebhookSecret), environment: 'production',
      plans: plan ? [{ ...plan, monthlyEnabled: plan.monthly > 0, yearlyEnabled: plan.yearly > 0 }] : [],
      subscription: subscription.rows[0] ? { status: subscription.rows[0].status, billingCycle: subscription.rows[0].billing_cycle, planCode: subscription.rows[0].plan_code || '', planName: subscription.rows[0].plan_name || '', currentPeriodEnd: subscription.rows[0].current_period_end } : null,
      checkout: checkout.rows[0] ? { status: checkout.rows[0].status, url: checkout.rows[0].checkout_url, expiresAt: checkout.rows[0].expires_at, createdAt: checkout.rows[0].created_at } : null
    }
  })
}

export const createStripeCheckout = async ({ tenantId, actorId, actorEmail, planCode, billingCycle }) => {
  if (!hasDatabase) throw new Error('A cobranca exige banco de dados.')
  if (!env.appPublicUrl || !env.stripeWebhookSecret) throw new Error('Stripe ainda precisa da URL publica e do segredo de webhook no ambiente de deploy.')
  const cycle = ['monthly', 'yearly'].includes(billingCycle) ? billingCycle : ''
  const basePlan = await activePlan()
  const plan = basePlan && basePlan.code === text(planCode, 80) ? await ensureStripePrices(basePlan) : null
  if (!plan || !cycle) throw new Error('Plano ou ciclo de cobranca invalido.')
  const amount = number(plan[cycle])
  const priceId = cycle === 'yearly' ? plan.stripeYearlyPriceId : plan.stripeMonthlyPriceId
  if (!priceId || amount <= 0 || !text(actorEmail, 320)) throw new Error('O plano ou o e-mail do Owner ainda nao esta valido para o checkout.')
  const previous = await withTenant(tenantId, (client) => client.query('select trial_used_at from tenant_subscriptions where tenant_id = $1 limit 1', [tenantId]))
  const trialDays = previous.rows[0]?.trial_used_at ? 0 : plan.trialDays
  const pending = await withTenant(tenantId, (client) => client.query(`select id, checkout_url, expires_at from tenant_billing_checkouts where tenant_id = $1 and provider = '${provider}' and status in ('creating', 'open') and checkout_url <> '' order by created_at desc limit 1`, [tenantId]))
  if (pending.rowCount) return { id: pending.rows[0].id, url: pending.rows[0].checkout_url, expiresAt: pending.rows[0].expires_at }
  const checkoutId = `stripe_checkout_${randomBytes(12).toString('hex')}`
  await withTenant(tenantId, (client) => client.query(`insert into tenant_billing_checkouts (id, tenant_id, plan_id, billing_cycle, amount, provider, status, created_by, provider_plan_id, trial_days) values ($1,$2,$3,$4,$5,'${provider}','creating',$6,$7,$8)`, [checkoutId, tenantId, plan.id, cycle, amount, String(actorId || ''), priceId, trialDays]))
  try {
    const session = await stripeRequest('/checkout/sessions', { method: 'POST', form: {
      mode: 'subscription', customer_email: text(actorEmail, 320), payment_method_collection: 'always',
      'line_items[0][price]': priceId, 'line_items[0][quantity]': '1',
      'metadata[checkout_id]': checkoutId, 'metadata[tenant_id]': tenantId,
      'subscription_data[metadata][checkout_id]': checkoutId, 'subscription_data[metadata][tenant_id]': tenantId,
      ...(trialDays ? { 'subscription_data[trial_period_days]': String(trialDays) } : {}),
      success_url: `${checkoutReturnUrl('success')}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: checkoutReturnUrl('cancelled')
    } })
    const sessionId = text(session.id, 160); const url = text(session.url, 1000)
    if (!sessionId || !url) throw new Error('Stripe nao retornou um checkout valido.')
    await withTenant(tenantId, (client) => client.query(`update tenant_billing_checkouts set provider_checkout_id = $2, checkout_url = $3, status = 'open', expires_at = $4::timestamptz, updated_at = now() where id = $1`, [checkoutId, sessionId, url, dateFromUnix(session.expires_at)]))
    return { id: checkoutId, url, expiresAt: dateFromUnix(session.expires_at) }
  } catch (error) {
    await withTenant(tenantId, (client) => client.query(`update tenant_billing_checkouts set status = 'failed', updated_at = now() where id = $1`, [checkoutId]))
    throw error
  }
}

const signatureParts = (value) => Object.fromEntries(String(value || '').split(',').map((part) => part.trim().split('=').map((piece) => piece.trim())).filter(([key, item]) => key && item))
export const stripeWebhookSignatureMatches = ({ header = '', rawBody = Buffer.alloc(0), now = Date.now() } = {}) => {
  const { t, v1 } = signatureParts(header); const secret = text(env.stripeWebhookSecret, 500)
  if (!secret || !t || !v1 || !/^\d+$/.test(t) || !/^[a-f0-9]{64}$/i.test(v1) || Math.abs(now - Number(t) * 1000) > 5 * 60 * 1000) return false
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${Buffer.from(rawBody).toString('utf8')}`).digest('hex'))
  const received = Buffer.from(v1.toLowerCase())
  return expected.length === received.length && timingSafeEqual(expected, received)
}

const stripeStatus = (value) => ({ trialing: 'trial', active: 'active', past_due: 'past_due', paused: 'paused', canceled: 'cancelled', unpaid: 'past_due' }[text(value, 80).toLowerCase()] || '')

const stripeInvoiceStatus = (invoice = {}, eventType = '') => {
  if (eventType === 'invoice.paid' || text(invoice.status, 40).toLowerCase() === 'paid') return 'paid'
  if (['invoice.payment_failed', 'invoice.marked_uncollectible'].includes(eventType) || ['open', 'uncollectible'].includes(text(invoice.status, 40).toLowerCase())) return 'overdue'
  if (text(invoice.status, 40).toLowerCase() === 'void') return 'void'
  return 'pending'
}

const syncSubscription = async (client, resource, eventId, eventType) => {
  const checkoutId = text(resource.metadata?.checkout_id, 200); const providerSubscriptionId = text(resource.id, 160)
  if (!checkoutId || !providerSubscriptionId) return { ignored: true }
  const lookup = await client.query(`select * from tenant_billing_checkouts where id = $1 and provider = '${provider}' limit 1`, [checkoutId]); const checkout = lookup.rows[0]
  if (!checkout) return { ignored: true }
  const state = stripeStatus(resource.status); if (!state) return { tenantId: checkout.tenant_id, ignored: true }
  const trialEndsAt = dateFromUnix(resource.trial_end); const periodEnd = dateFromUnix(resource.current_period_end)
  const current = await client.query(`select * from tenant_subscriptions where tenant_id = $1 limit 1`, [checkout.tenant_id]); let subscription = current.rows[0]
  if (!subscription) {
    const created = await client.query(`insert into tenant_subscriptions (id, tenant_id, plan_id, status, billing_cycle, started_at, trial_started_at, trial_ends_at, trial_used_at, current_period_end, manual_override, source, provider, provider_customer_id, provider_subscription_id, last_provider_sync_at) values ($1,$2,$3,$4,$5,now(),$6::timestamptz,$7::timestamptz,$8::timestamptz,$9::timestamptz,false,'provider','${provider}',$10,$11,now()) returning *`, [`subscription_${randomBytes(12).toString('hex')}`, checkout.tenant_id, checkout.plan_id, state, checkout.billing_cycle, state === 'trial' ? new Date().toISOString() : null, trialEndsAt, state === 'trial' ? new Date().toISOString() : null, periodEnd, text(resource.customer, 160) || null, providerSubscriptionId])
    subscription = created.rows[0]
  } else if (!(subscription.manual_override && subscription.status === 'courtesy')) {
    await client.query(`update tenant_subscriptions set plan_id=$2,billing_cycle=$3,status=$4,provider='${provider}',provider_customer_id=coalesce($5,provider_customer_id),provider_subscription_id=$6,trial_started_at=case when $4='trial' then coalesce(trial_started_at,now()) else trial_started_at end,trial_ends_at=case when $4='trial' then $7::timestamptz else trial_ends_at end,trial_used_at=case when $4='trial' then coalesce(trial_used_at,now()) else trial_used_at end,current_period_end=coalesce($8::timestamptz,current_period_end),source='provider',last_provider_sync_at=now(),cancelled_at=case when $4='cancelled' then now() else cancelled_at end,updated_at=now() where id=$1`, [subscription.id, checkout.plan_id, checkout.billing_cycle, state, text(resource.customer, 160) || null, providerSubscriptionId, trialEndsAt, periodEnd])
  }
  await client.query(`update tenant_billing_checkouts set provider_checkout_id=$2,status=case when $3='cancelled' then 'cancelled' else status end,updated_at=now() where id=$1`, [checkoutId, providerSubscriptionId, state])
  await client.query(`update tenants set billing_status=$2,billing_due_at=$3::timestamptz where id=$1`, [checkout.tenant_id, state === 'past_due' ? 'overdue' : state, state === 'trial' ? trialEndsAt : periodEnd])
  await client.query(`insert into tenant_subscription_events (tenant_id,subscription_id,action,new_state,reason,actor_user_id,source,provider,provider_event_id) values ($1,$2,$3,$4::jsonb,'Atualizacao de assinatura recebida do Stripe.','','provider','${provider}',$5)`, [checkout.tenant_id, subscription.id, `stripe.${text(eventType, 120)}`, JSON.stringify({ providerSubscriptionId, status: state, trialEndsAt }), eventId])
  return { tenantId: checkout.tenant_id, subscriptionId: subscription.id }
}

const syncInvoice = async (client, invoice, eventId, eventType) => {
  const providerInvoiceId = text(invoice.id, 160)
  const providerSubscriptionId = text(invoice.subscription, 160)
  if (!providerInvoiceId || !providerSubscriptionId) return { ignored: true }
  const result = await client.query(`select * from tenant_subscriptions where provider = '${provider}' and provider_subscription_id = $1 limit 1`, [providerSubscriptionId])
  const subscription = result.rows[0]
  if (!subscription) return { ignored: true }
  const status = stripeInvoiceStatus(invoice, eventType)
  const amount = Math.max(0, number(invoice.amount_paid || invoice.amount_due) / 100)
  const dueAt = dateFromUnix(invoice.due_date || invoice.next_payment_attempt || invoice.created)
  const paidAt = status === 'paid' ? dateFromUnix(invoice.status_transitions?.paid_at || invoice.created) : null
  const existing = await client.query(`select id from tenant_billing_records where provider = '${provider}' and provider_invoice_id = $1 limit 1`, [providerInvoiceId])
  if (existing.rowCount) {
    await client.query(`update tenant_billing_records set status = $2, amount = $3, due_at = coalesce($4::timestamptz, due_at), paid_at = coalesce($5::timestamptz, paid_at), updated_at = now() where id = $1`, [existing.rows[0].id, status, amount, dueAt, paidAt])
  } else {
    await client.query(`insert into tenant_billing_records (id, tenant_id, subscription_id, reference, amount, currency, due_at, paid_at, status, source, provider, provider_invoice_id, notes) values ($1,$2,$3,$4,$5,'BRL',$6::timestamptz,$7::timestamptz,$8,'provider','${provider}',$9,$10)`, [
      `billing_${randomBytes(12).toString('hex')}`, subscription.tenant_id, subscription.id,
      text(invoice.description || invoice.number || 'Cobranca recorrente', 120), amount, dueAt, paidAt, status, providerInvoiceId,
      'Cobranca recorrente Stripe'
    ])
  }
  if (!(subscription.manual_override && subscription.status === 'courtesy')) {
    if (status === 'paid') {
      await client.query(`update tenant_subscriptions set status = 'active', source = 'provider', last_provider_sync_at = now(), updated_at = now() where id = $1`, [subscription.id])
      await client.query(`update tenant_billing_checkouts set status = 'paid', updated_at = now() where provider = '${provider}' and provider_checkout_id = $1 and tenant_id = $2`, [providerSubscriptionId, subscription.tenant_id])
      await client.query(`update tenants set billing_status = 'active', account_status = case when account_status = 'suspended' then account_status else 'active' end where id = $1`, [subscription.tenant_id])
    } else if (status === 'overdue') {
      await client.query(`update tenant_subscriptions set status = 'past_due', source = 'provider', last_provider_sync_at = now(), updated_at = now() where id = $1`, [subscription.id])
      await client.query(`update tenants set billing_status = 'overdue', billing_due_at = $2::timestamptz where id = $1`, [subscription.tenant_id, dueAt])
    }
  }
  await client.query(`insert into tenant_subscription_events (tenant_id, subscription_id, action, new_state, reason, actor_user_id, source, provider, provider_event_id) values ($1,$2,$3,$4::jsonb,'Atualizacao de cobranca recebida do Stripe.','','provider','${provider}',$5)`, [subscription.tenant_id, subscription.id, `stripe.${text(eventType, 120)}`, JSON.stringify({ providerInvoiceId, status, amount }), eventId])
  return { tenantId: subscription.tenant_id, subscriptionId: subscription.id }
}

export const processStripeWebhook = async ({ event = {} } = {}) => {
  if (!hasDatabase) return { handled: false, reason: 'database_unavailable' }
  const eventId = text(event.id, 200); const eventType = text(event.type, 120); const resource = event.data?.object || {}
  if (!eventId || !eventType || !resource.id) throw new Error('Webhook Stripe sem evento valido.')
  return withPlatformAdmin(async (client) => {
    const received = await client.query(`insert into payment_provider_events (provider,provider_event_id,event_type,provider_resource_id) values ('${provider}',$1,$2,$3) on conflict (provider,provider_event_id) do nothing returning id`, [eventId, eventType, text(resource.id, 160)])
    if (!received.rowCount) return { handled: true, duplicate: true }
    let synced = { ignored: true }
    if (eventType === 'checkout.session.completed' && resource.subscription) {
      const subscription = await stripeRequest(`/subscriptions/${encodeURIComponent(resource.subscription)}`)
      synced = await syncSubscription(client, subscription, eventId, eventType)
    } else if (eventType === 'customer.subscription.updated' || eventType === 'customer.subscription.deleted') synced = await syncSubscription(client, resource, eventId, eventType)
    else if (['invoice.paid', 'invoice.payment_failed', 'invoice.marked_uncollectible', 'invoice.voided'].includes(eventType)) synced = await syncInvoice(client, resource, eventId, eventType)
    await client.query(`update payment_provider_events set tenant_id=$2,processed_at=now() where provider='${provider}' and provider_event_id=$1`, [eventId, synced.tenantId || null])
    return { handled: true, ...synced }
  })
}
