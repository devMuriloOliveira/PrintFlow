import { createHash, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'
import { query, withPlatformAdmin, withTenant } from '../db/pool.js'
import { blindIndexesForLookup, decryptField } from '../security/crypto.js'
import { describeAuditEvent } from './operationalEvents.js'
import { synchronizeStripePrices } from './stripeBilling.js'

const text = (value, max = 500) => String(value || '').trim().slice(0, max)
const configuredEmails = () => env.platformSuperAdminEmails
const platformQuery = (statement, params = []) => withPlatformAdmin((client) => client.query(statement, params))

export const syncConfiguredPlatformSuperAdmins = async () => {
  const emails = configuredEmails()
  if (!emails.length) return { granted: 0 }

  const hashes = emails.flatMap((email) => blindIndexesForLookup(email))
  const result = await query(`select id, email_hash from users where email_hash = any($1::text[])`, [hashes])

  for (const user of result.rows) {
    await query(`update users set role = 'platform_super_admin', token_version = token_version + 1, updated_at = now() where id = $1`, [user.id])
    await query(`insert into platform_super_admins (user_id, email_hash) values ($1, $2) on conflict (user_id) do update set email_hash = excluded.email_hash, status = 'active', updated_at = now()`, [user.id, user.email_hash])
  }

  return { granted: result.rowCount }
}

export const isPlatformSuperAdmin = async (user) => {
  if (!user || user.platformRole !== 'platform_super_admin') return false
  if (!configuredEmails().includes(String(user.email || '').toLowerCase())) return false
  const result = await query(`select 1 from platform_super_admins where user_id = $1 and status = 'active' limit 1`, [user.id])
  return Boolean(result.rowCount)
}

export const listPlatformChatAssignees = async () => (await query(`
  select u.id, u.name
    from users u
    join platform_super_admins sa on sa.user_id = u.id and sa.status = 'active'
   where u.role = 'platform_super_admin' and u.status = 'active'
   order by u.name
`)).rows.map((row) => ({ id: String(row.id), name: decryptField(row.name) }))

const requestIpHash = (req) => createHash('sha256')
  .update(`${env.authSecret}:${String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')}`)
  .digest('hex')

export const writePlatformAudit = async (req, user, event = {}) => {
  await query(`
    insert into platform_admin_audit_events (
      actor_user_id, action, target_tenant_id, target_resource, target_resource_id, reason, ip_hash, user_agent, details
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
  `, [
    user.id, text(event.action, 120), text(event.targetTenantId, 120) || null,
    text(event.targetResource, 80), text(event.targetResourceId, 120), text(event.reason, 500),
    requestIpHash(req), text(req.headers['user-agent'], 500), JSON.stringify(event.details && typeof event.details === 'object' ? event.details : {})
  ])
}

const tenantRow = (row) => ({
  id: row.id,
  name: decryptField(row.name),
  cnpj: maskedDocument(decryptField(row.document)),
  accountStatus: row.account_status,
  billingStatus: row.billing_status,
  billingDueAt: row.billing_due_at,
  planId: row.plan_id ? String(row.plan_id) : null,
  planName: row.plan_name || 'Sem plano',
  subscriptionStatus: row.subscription_status || 'not_configured',
  billingCycle: row.billing_cycle || 'manual',
  currentPeriodEnd: row.current_period_end || null,
  trialEndsAt: row.trial_ends_at || null,
  graceEndsAt: row.grace_ends_at || null,
  createdAt: row.created_at,
  users: Number(row.users || 0),
  activeUsers: Number(row.active_users || 0),
  agents: Number(row.agents || 0),
  onlineAgents: Number(row.online_agents || 0),
  printers: Number(row.printers || 0)
})

export const getPlatformOverview = async () => {
  const result = await query(`
    select
      count(*) as tenants,
      count(*) filter (where account_status = 'active') as active_tenants,
      count(*) filter (where account_status in ('suspended', 'blocked')) as suspended_tenants,
      count(*) filter (where billing_status in ('pending', 'overdue')) as payment_attention
    from tenants
  `)
  const agents = await query(`select count(*) as total, count(*) filter (where status = 'online') as online from agents`)
  const printers = await query(`select count(*) as total, count(*) filter (where status in ('connected', 'printing', 'paused')) as connected from agent_printers`)
  return {
    tenants: Number(result.rows[0]?.tenants || 0), activeTenants: Number(result.rows[0]?.active_tenants || 0),
    suspendedTenants: Number(result.rows[0]?.suspended_tenants || 0), paymentAttention: Number(result.rows[0]?.payment_attention || 0),
    agents: Number(agents.rows[0]?.total || 0), onlineAgents: Number(agents.rows[0]?.online || 0),
    printers: Number(printers.rows[0]?.total || 0), connectedPrinters: Number(printers.rows[0]?.connected || 0)
  }
}

export const listPlatformTenants = async () => {
  const result = await platformQuery(`
    select t.id, t.name, t.document, t.account_status, t.billing_status, t.billing_due_at, t.created_at,
      sub.plan_id, plan.name as plan_name, sub.status as subscription_status, sub.billing_cycle,
      sub.current_period_end, sub.trial_ends_at, sub.grace_ends_at,
      count(distinct u.id) as users,
      count(distinct u.id) filter (where u.status = 'active') as active_users,
      count(distinct a.id) as agents,
      count(distinct a.id) filter (where a.status = 'online') as online_agents,
      count(distinct p.id) as printers
    from tenants t
    left join tenant_subscriptions sub on sub.tenant_id = t.id
    left join platform_plans plan on plan.id = sub.plan_id
    left join users u on u.tenant_id = t.id
    left join agents a on a.tenant_id = t.id
    left join agent_printers p on p.tenant_id = t.id
    group by t.id, t.name, t.document, t.account_status, t.billing_status, t.billing_due_at, t.created_at,
      sub.plan_id, plan.name, sub.status, sub.billing_cycle, sub.current_period_end, sub.trial_ends_at, sub.grace_ends_at
    order by t.created_at desc
  `)
  return result.rows.map(tenantRow)
}

export const listPlatformPlans = async () => {
  const result = await query(`select id, code, name, description, monthly_reference_price, yearly_reference_price, stripe_product_id, stripe_monthly_price_id, stripe_yearly_price_id, trial_days, limits, features, active, created_at, updated_at from platform_plans order by active desc, name asc`)
  return result.rows.map((row) => ({
    id: String(row.id), code: row.code, name: row.name, description: row.description || '',
    monthlyReferencePrice: Number(row.monthly_reference_price || 0), yearlyReferencePrice: Number(row.yearly_reference_price || 0),
    stripeProductId: row.stripe_product_id || '', stripeMonthlyPriceId: row.stripe_monthly_price_id || '', stripeYearlyPriceId: row.stripe_yearly_price_id || '', trialDays: Number(row.trial_days || 0),
    limits: row.limits || {}, features: row.features || {}, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at
  }))
}

export const updatePlatformPlanBillingConfiguration = async (planId, payload = {}) => {
  const monthlyReferencePrice = Number(payload.monthlyReferencePrice)
  const yearlyReferencePrice = Number(payload.yearlyReferencePrice)
  const trialDays = Number(payload.trialDays)
  if (!Number.isFinite(monthlyReferencePrice) || monthlyReferencePrice <= 0 || !Number.isFinite(yearlyReferencePrice) || yearlyReferencePrice <= 0) throw new Error('Informe valores mensal e anual validos.')
  if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 30) throw new Error('O periodo de teste deve ter entre 0 e 30 dias.')
  const current = await query(`select id, name, monthly_reference_price, yearly_reference_price, trial_days, stripe_product_id, stripe_monthly_price_id, stripe_yearly_price_id from platform_plans where id = $1 limit 1`, [planId])
  if (!current.rowCount) throw new Error('Plano nao encontrado.')
  const plan = current.rows[0]
  const pricesChanged = Number(plan.monthly_reference_price) !== monthlyReferencePrice || Number(plan.yearly_reference_price) !== yearlyReferencePrice
  const hasProviderPlans = Boolean(plan.stripe_monthly_price_id && plan.stripe_yearly_price_id)
  const providerPlans = pricesChanged || !hasProviderPlans
    ? await synchronizeStripePrices({ name: plan.name, monthly: monthlyReferencePrice, yearly: yearlyReferencePrice })
    : { productId: plan.stripe_product_id, monthlyPriceId: plan.stripe_monthly_price_id, yearlyPriceId: plan.stripe_yearly_price_id }
  const result = await query(`
    update platform_plans
       set monthly_reference_price = $2, yearly_reference_price = $3, stripe_product_id = $4, stripe_monthly_price_id = $5, stripe_yearly_price_id = $6, trial_days = $7, updated_at = now()
     where id = $1
     returning id, code, name, description, monthly_reference_price, yearly_reference_price, stripe_product_id, stripe_monthly_price_id, stripe_yearly_price_id, trial_days, limits, features, active, created_at, updated_at
  `, [planId, monthlyReferencePrice, yearlyReferencePrice, providerPlans.productId, providerPlans.monthlyPriceId, providerPlans.yearlyPriceId, trialDays])
  const row = result.rows[0]
  return {
    id: String(row.id), code: row.code, name: row.name, description: row.description || '',
    monthlyReferencePrice: Number(row.monthly_reference_price || 0), yearlyReferencePrice: Number(row.yearly_reference_price || 0),
    stripeProductId: row.stripe_product_id || '', stripeMonthlyPriceId: row.stripe_monthly_price_id || '', stripeYearlyPriceId: row.stripe_yearly_price_id || '', trialDays: Number(row.trial_days || 0),
    limits: row.limits || {}, features: row.features || {}, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at
  }
}

export const getPlatformTenantDetails = async (tenantId) => {
  const result = await platformQuery(`
    select t.id, t.name, t.document, t.account_status, t.billing_status, t.billing_due_at, t.created_at,
      sub.id as subscription_id, sub.plan_id, plan.name as plan_name, sub.status as subscription_status,
      sub.billing_cycle, sub.started_at, sub.current_period_start, sub.current_period_end,
      sub.trial_ends_at, sub.grace_ends_at, sub.cancelled_at, sub.cancellation_reason, sub.manual_override, sub.source as subscription_source, sub.provider, sub.last_provider_sync_at, sub.notes as subscription_notes,
      (select count(*)::int from users where tenant_id = t.id) as users,
      (select count(*)::int from users where tenant_id = t.id and status = 'active') as active_users,
      (select count(*)::int from agents where tenant_id = t.id) as agents,
      (select count(*)::int from agent_printers where tenant_id = t.id) as printers,
      (select count(*)::int from products where tenant_id = t.id) as products,
      (select count(*)::int from orders where tenant_id = t.id) as orders
    from tenants t
    left join tenant_subscriptions sub on sub.tenant_id = t.id
    left join platform_plans plan on plan.id = sub.plan_id
    where t.id = $1 limit 1
  `, [tenantId])
  if (!result.rowCount) throw new Error('Empresa nao encontrada.')
  const row = result.rows[0]
  return {
    ...tenantRow(row),
    subscription: row.subscription_id ? {
      id: String(row.subscription_id), planId: row.plan_id ? String(row.plan_id) : null, planName: row.plan_name || 'Sem plano',
      status: row.subscription_status, billingCycle: row.billing_cycle, startedAt: row.started_at,
      currentPeriodStart: row.current_period_start, currentPeriodEnd: row.current_period_end,
      trialEndsAt: row.trial_ends_at, graceEndsAt: row.grace_ends_at, cancelledAt: row.cancelled_at,
      cancellationReason: row.cancellation_reason || '', manualOverride: Boolean(row.manual_override), source: row.subscription_source || 'manual', provider: row.provider || '', lastProviderSyncAt: row.last_provider_sync_at || null, notes: row.subscription_notes || ''
    } : null,
    usage: { users: Number(row.users || 0), activeUsers: Number(row.active_users || 0), agents: Number(row.agents || 0), printers: Number(row.printers || 0), products: Number(row.products || 0), orders: Number(row.orders || 0) }
  }
}

export const listPlatformTenantUsers = async (tenantId) => {
  const exists = await query('select 1 from tenants where id = $1 limit 1', [tenantId])
  if (!exists.rowCount) throw new Error('Empresa nao encontrada.')
  const result = await query(`select id, name, role, status, created_at, updated_at from users where tenant_id = $1 order by status asc, name asc`, [tenantId])
  return result.rows.map((row) => ({ id: String(row.id), name: decryptField(row.name), role: row.role, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }))
}

export const listPlatformTenantSubscriptionEvents = async (tenantId, limit = 100) => {
  const result = await platformQuery(`select id, action, previous_state, new_state, reason, actor_user_id, source, provider, created_at from tenant_subscription_events where tenant_id = $1 order by created_at desc limit $2`, [tenantId, Math.min(200, Math.max(1, Number(limit) || 100))])
  return result.rows.map((row) => ({ id: String(row.id), action: row.action, previousState: row.previous_state || {}, newState: row.new_state || {}, reason: row.reason || '', actorUserId: row.actor_user_id || '', source: row.source || 'manual', provider: row.provider || '', createdAt: row.created_at }))
}

const subscriptionStatuses = new Set(['trial', 'active', 'past_due', 'grace', 'paused', 'courtesy', 'cancelled', 'ended'])
const billingCycles = new Set(['monthly', 'yearly', 'manual'])

export const updatePlatformTenantSubscription = async (tenantId, payload = {}, actorId = '') => {
  const status = String(payload.status || '').trim()
  const billingCycle = String(payload.billingCycle || '').trim()
  const reason = text(payload.reason, 500)
  if (!subscriptionStatuses.has(status)) throw new Error('Status de assinatura invalido.')
  if (!billingCycles.has(billingCycle)) throw new Error('Ciclo de cobranca invalido.')
  if (reason.length < 8) throw new Error('Informe um motivo com pelo menos 8 caracteres.')
  await withPlatformAdmin(async (client) => {
    const tenant = await client.query('select id from tenants where id = $1 limit 1', [tenantId])
    if (!tenant.rowCount) throw new Error('Empresa nao encontrada.')
    if (payload.planId) {
      const plan = await client.query('select id from platform_plans where id = $1 and active = true limit 1', [String(payload.planId)])
      if (!plan.rowCount) throw new Error('Plano ativo nao encontrado.')
    }
    const current = await client.query('select * from tenant_subscriptions where tenant_id = $1 limit 1', [tenantId])
    const previous = current.rows[0] || {}
    const id = previous.id ? String(previous.id) : `subscription_${randomBytes(12).toString('hex')}`
    const result = await client.query(`
    insert into tenant_subscriptions (id, tenant_id, plan_id, status, billing_cycle, started_at, current_period_start, current_period_end, trial_ends_at, grace_ends_at, cancelled_at, cancellation_reason, manual_override, notes)
    values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), $7::timestamptz, $8::timestamptz, $9::timestamptz, $10::timestamptz, $11::timestamptz, $12, true, $13)
    on conflict (tenant_id) do update set plan_id = excluded.plan_id, status = excluded.status, billing_cycle = excluded.billing_cycle,
      current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end, trial_ends_at = excluded.trial_ends_at,
      grace_ends_at = excluded.grace_ends_at, cancelled_at = excluded.cancelled_at, cancellation_reason = excluded.cancellation_reason,
      manual_override = true, notes = excluded.notes, updated_at = now()
    returning *
    `, [id, tenantId, payload.planId || previous.plan_id || null, status, billingCycle, payload.startedAt || previous.started_at || null, payload.currentPeriodStart || previous.current_period_start || null, payload.currentPeriodEnd || previous.current_period_end || null, payload.trialEndsAt || previous.trial_ends_at || null, payload.graceEndsAt || previous.grace_ends_at || null, status === 'cancelled' ? (payload.cancelledAt || new Date().toISOString()) : null, status === 'cancelled' ? text(payload.cancellationReason || reason, 500) : '', text(payload.notes, 1000)])
    const next = result.rows[0]
    await client.query('insert into tenant_subscription_events (tenant_id, subscription_id, action, previous_state, new_state, reason, actor_user_id, source) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)', [tenantId, id, 'subscription.updated', JSON.stringify({ status: previous.status || null, planId: previous.plan_id || null, billingCycle: previous.billing_cycle || null }), JSON.stringify({ status: next.status, planId: next.plan_id, billingCycle: next.billing_cycle }), reason, String(actorId || ''), 'manual'])
  })
  return getPlatformTenantDetails(tenantId)
}

export const createPlatformTenantBillingRecord = async (tenantId, payload = {}, actorId = '') => {
  const amount = Number(payload.amount)
  const status = String(payload.status || 'pending')
  const reason = text(payload.reason || payload.notes, 500)
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Valor de cobranca invalido.')
  if (!['pending', 'paid', 'overdue', 'void', 'courtesy'].includes(status)) throw new Error('Status de cobranca invalido.')
  if (reason.length < 8) throw new Error('Informe um motivo com pelo menos 8 caracteres.')
  return withPlatformAdmin(async (client) => {
    const exists = await client.query('select id from tenants where id = $1 limit 1', [tenantId]); if (!exists.rowCount) throw new Error('Empresa nao encontrada.')
    const id = `billing_${randomBytes(12).toString('hex')}`
    const result = await client.query(`insert into tenant_billing_records (id, tenant_id, reference, amount, currency, due_at, paid_at, status, source, notes) values ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10) returning id, tenant_id, reference, amount, currency, due_at, paid_at, status, source, notes, created_at`, [id, tenantId, text(payload.reference, 120), amount, text(payload.currency || 'BRL', 8), payload.dueAt || null, status === 'paid' ? (payload.paidAt || new Date().toISOString()) : null, status, 'manual', reason])
    await client.query('insert into tenant_subscription_events (tenant_id, action, new_state, reason, actor_user_id, source) values ($1,$2,$3::jsonb,$4,$5,$6)', [tenantId, 'billing.recorded', JSON.stringify({ billingRecordId: id, amount, status }), reason, String(actorId || ''), 'manual'])
    return { ...result.rows[0], amount: Number(result.rows[0].amount || 0) }
  })
}

export const listPlatformTenantBillingRecords = async (tenantId, limit = 100) => {
  const result = await platformQuery('select id, reference, amount, currency, due_at, paid_at, status, source, provider, provider_invoice_id, notes, created_at from tenant_billing_records where tenant_id = $1 order by due_at desc nulls last, created_at desc limit $2', [tenantId, Math.min(200, Math.max(1, Number(limit) || 100))])
  return result.rows.map((row) => ({ id: String(row.id), reference: row.reference, amount: Number(row.amount || 0), currency: row.currency, dueAt: row.due_at, paidAt: row.paid_at, status: row.status, source: row.source || 'manual', provider: row.provider || '', providerInvoiceId: row.provider_invoice_id || '', notes: row.notes || '', createdAt: row.created_at }))
}

export const listTenantOperationalAudit = async (tenantId, limit = 100, range = {}) => withTenant(tenantId, async (client) => {
  const result = await client.query(`
    select id, action, actor_type, actor_id, entity_type, entity_id, details, created_at
     from operational_audit_events
     where tenant_id = $1
       and ($3::date is null or created_at >= $3::date)
       and ($4::date is null or created_at < $4::date + interval '1 day')
     order by created_at desc
     limit $2
  `, [tenantId, Math.min(200, Math.max(1, Number(limit) || 100)), range.from || null, range.to || null])
  return result.rows.map((row) => {
    const description = describeAuditEvent(row)
    return {
      id: String(row.id), action: row.action, actorType: row.actor_type, actorId: row.actor_id,
      entityType: row.entity_type, entityId: row.entity_id, details: row.details || {},
      summary: description.summary, context: description.context, createdAt: row.created_at
    }
  })
})

const normalizedDocument = (value) => String(value || '').replace(/\D/g, '')
const maskedDocument = (value) => {
  const digits = normalizedDocument(value)
  return digits.length === 14 ? `${digits.slice(0, 2)}.***.***/${digits.slice(8, 12)}-${digits.slice(12)}` : 'CNPJ nao informado'
}

export const createDataAccessRequest = async (user, tenantId, reason, scope = 'user_audit') => {
  const cleanReason = text(reason, 500)
  if (cleanReason.length < 12) throw new Error('Informe um motivo detalhado para a solicitacao.')
  const tenant = await query('select id, name, document from tenants where id = $1 limit 1', [tenantId])
  if (!tenant.rowCount) throw new Error('Empresa nao encontrada.')
  const row = tenant.rows[0]
  const id = `access_${randomBytes(16).toString('hex')}`
  await query(`insert into platform_data_access_requests (id, tenant_id, requested_by, reason, scope) values ($1, $2, $3, $4, $5)`, [id, tenantId, user.id, cleanReason, scope])
  return { id, tenantId, companyName: decryptField(row.name), cnpj: maskedDocument(decryptField(row.document)), status: 'pending' }
}

export const verifyDataAccessRequest = async (user, requestId, document) => {
  const result = await query(`select r.id, r.tenant_id, r.status, t.document from platform_data_access_requests r join tenants t on t.id = r.tenant_id where r.id = $1 and r.requested_by = $2 limit 1`, [requestId, user.id])
  const request = result.rows[0]
  if (!request || request.status !== 'pending') throw new Error('Solicitacao nao encontrada ou indisponivel.')
  const matches = normalizedDocument(document) && normalizedDocument(document) === normalizedDocument(decryptField(request.document))
  if (!matches) { await query(`update platform_data_access_requests set status = 'rejected', updated_at = now() where id = $1`, [requestId]); throw new Error('CNPJ nao confere com o cadastro da empresa.') }
  await query(`update platform_data_access_requests set status = 'approved', verified_at = now(), expires_at = now() + interval '30 minutes', updated_at = now() where id = $1`, [requestId])
  return { id: requestId, tenantId: request.tenant_id, status: 'approved', expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() }
}

export const createApprovedDataAccessChecker = (runQuery = query) => async (user, requestId, tenantId) => {
  const result = await runQuery(`
    select id from platform_data_access_requests
     where id = $1 and tenant_id = $2 and requested_by = $3 and status = 'approved' and expires_at > now()
    union all
    select id from tenant_audit_requests
     where id = $1 and tenant_id = $2 and reviewed_by = $3 and category = 'audit'
       and status in ('approved', 'closed') and expires_at > now()
    limit 1
  `, [requestId, tenantId, user.id])
  if (!result.rowCount) throw new Error('Solicitacao de acesso nao aprovada ou expirada.')
}

export const requireApprovedDataAccess = createApprovedDataAccessChecker()

export const getTenantAuditReport = async (user, requestId, tenantId, limit = 500, range = {}) => {
  await requireApprovedDataAccess(user, requestId, tenantId)
  const result = await query(`
    select t.name, t.document, access.reason, access.verified_at, access.expires_at
      from (
        select tenant_id, reason, verified_at, expires_at from platform_data_access_requests
         where id = $1 and tenant_id = $2 and requested_by = $3 and status = 'approved' and expires_at > now()
        union all
        select tenant_id, reason, updated_at as verified_at, expires_at from tenant_audit_requests
         where id = $1 and tenant_id = $2 and reviewed_by = $3 and category = 'audit'
           and status in ('approved', 'closed') and expires_at > now()
      ) access
      join tenants t on t.id = access.tenant_id
     limit 1
  `, [requestId, tenantId, user.id])
  if (!result.rowCount) throw new Error('Solicitacao de acesso nao aprovada ou expirada.')

  const row = result.rows[0]
  return {
    companyName: decryptField(row.name),
    cnpj: maskedDocument(decryptField(row.document)),
    reason: row.reason,
    verifiedAt: row.verified_at,
    expiresAt: row.expires_at,
    events: await listTenantOperationalAudit(tenantId, limit, range)
  }
}

export const listPlatformAdminAudit = async (limit = 100, range = {}) => {
  const result = await query(`
    select id, action, target_tenant_id, target_resource, target_resource_id, reason, details, created_at
      from platform_admin_audit_events
     where ($2::date is null or created_at >= $2::date)
       and ($3::date is null or created_at < $3::date + interval '1 day')
     order by created_at desc
     limit $1
  `, [Math.min(200, Math.max(1, Number(limit) || 100)), range.from || null, range.to || null])
  return result.rows.map((row) => {
    const description = describeAuditEvent(row)
    return {
      id: String(row.id), action: row.action, targetTenantId: row.target_tenant_id,
      targetResource: row.target_resource, targetResourceId: row.target_resource_id,
      reason: row.reason, details: row.details || {}, summary: description.summary,
      context: description.context, createdAt: row.created_at
    }
  })
}

export const listPlatformSupportHistory = async (user, requestId, limit = 100) => {
  const result = await query(`
    select event.id, event.action, event.target_tenant_id, event.target_resource, event.target_resource_id,
           event.reason, event.details, event.created_at
      from platform_admin_audit_events event
     where event.target_resource_id = $1
       and event.target_resource like 'support%'
       and exists (
         select 1 from tenant_audit_requests request
          where request.id = $1
            and (request.chat_assigned_to is null or request.chat_assigned_to = $2
              or exists (select 1 from platform_chat_collaborators c where c.request_id = request.id and c.user_id = $2))
       )
     order by event.created_at desc
     limit $3
  `, [requestId, String(user.id), Math.min(200, Math.max(1, Number(limit) || 100))])
  return result.rows.map((row) => {
    const description = describeAuditEvent(row)
    return { id: String(row.id), action: row.action, targetTenantId: row.target_tenant_id, targetResource: row.target_resource, targetResourceId: row.target_resource_id, reason: row.reason, details: row.details || {}, summary: description.summary, context: description.context, createdAt: row.created_at }
  })
}

export const updatePlatformTenantStatus = async (tenantId, payload = {}) => {
  const accountStatus = ['active', 'suspended', 'blocked'].includes(payload.accountStatus) ? payload.accountStatus : ''
  const billingStatus = ['not_configured', 'active', 'pending', 'overdue', 'cancelled'].includes(payload.billingStatus) ? payload.billingStatus : ''
  if (!accountStatus && !billingStatus) throw new Error('Informe um status valido para a conta ou cobranca.')

  const result = await query(`
    update tenants
       set account_status = case when $2 <> '' then $2 else account_status end,
           billing_status = case when $3 <> '' then $3 else billing_status end,
           billing_due_at = case when $4::timestamptz is not null then $4::timestamptz else billing_due_at end
     where id = $1
     returning id, name, email, account_status, billing_status, billing_due_at, created_at,
       0::int as users, 0::int as active_users, 0::int as agents, 0::int as online_agents, 0::int as printers
  `, [tenantId, accountStatus, billingStatus, payload.billingDueAt || null])
  if (!result.rowCount) throw new Error('Empresa nao encontrada.')
  return tenantRow(result.rows[0])
}
