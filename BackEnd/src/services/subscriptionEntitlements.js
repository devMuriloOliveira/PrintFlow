import { env } from '../config/env.js'
import { hasDatabase, withTenant } from '../db/pool.js'

const proAccessStatuses = new Set(['trial', 'active', 'grace', 'courtesy'])
const managedFeatures = new Set(['coreOperations', 'marketplaces', 'advancedReports', 'manualPrinters', 'agent', 'team'])
const resourceLimits = {
  users: { table: 'users', where: "status = 'active'" },
  printers: { table: 'printers', where: 'true' },
  agents: { table: 'agents', where: "status <> 'revoked'" },
  products: { table: 'products', where: 'true' },
  clients: { table: 'clients', where: 'true' },
  filaments: { table: 'filaments', where: 'true' },
  goals: { table: 'goals', where: 'true' },
  ordersMonthly: { table: 'orders', where: "order_date >= date_trunc('month', current_date) and order_date < date_trunc('month', current_date) + interval '1 month'" },
  calculatorSimulations: { table: 'calculator_simulations', where: 'true' }
}

const developerEntitlement = () => ({
  configured: true,
  status: 'developer',
  mode: 'full',
  limits: {},
  features: Object.fromEntries([...managedFeatures].map((feature) => [feature, true]))
})

export const isPlatformDeveloper = (user) =>
  Boolean(user?.platformRole === 'platform_super_admin' && env.platformDeveloperEmails.includes(String(user.email || '').trim().toLowerCase()))

const numberLimit = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

export const entitlementFromSubscription = (subscription = null, billingEnforcementExempt = true) => {
  if (!subscription?.status) {
    return {
      configured: false,
      status: billingEnforcementExempt ? 'not_configured' : 'payment_required',
      mode: billingEnforcementExempt ? 'full' : 'read_only',
      planCode: '',
      limits: {},
      features: {}
    }
  }

  const status = String(subscription.status)
  const planCode = String(subscription.plan_code || subscription.planCode || '')
  const isFree = planCode === 'free'
  return {
    configured: true,
    status,
    planCode,
    // O plano define o produto contratado. O status financeiro so libera PRO
    // enquanto estiver saudavel, em carencia ou em trial historico.
    mode: isFree || proAccessStatuses.has(status) ? 'full' : 'read_only',
    limits: subscription.limits && typeof subscription.limits === 'object' ? subscription.limits : {},
    features: subscription.features && typeof subscription.features === 'object' ? subscription.features : {}
  }
}

export const canUseSubscriptionRequest = ({ method, pathname, entitlement }) => {
  if (entitlement.mode !== 'read_only') return true
  if (method === 'GET') return true
  if (pathname.startsWith('/api/support/requests')) return true
  if (/^\/api\/operational-notifications\/[^/]+\/read$/.test(pathname)) return true
  return false
}

export const subscriptionFeatureForRequest = ({ method, pathname }) => {
  if (pathname === '/api/reports/financial-export') return 'advancedReports'
  if (['/api/agents', '/api/agent-commands', '/api/print-jobs'].some((path) => pathname.startsWith(path))) return 'agent'
  if (method === 'GET') return null
  return [
    { feature: 'coreOperations', paths: ['/api/products', '/api/orders', '/api/clients', '/api/filaments', '/api/expenses', '/api/goals'] },
    { feature: 'marketplaces', paths: ['/api/marketplaces', '/api/marketplace-integrations'] },
    { feature: 'manualPrinters', paths: ['/api/printers'] },
    { feature: 'team', paths: ['/api/members'] }
  ].find((item) => item.paths.some((path) => pathname.startsWith(path)))?.feature || null
}

const subscriptionError = () => {
  const error = new Error('A assinatura desta empresa ainda nao foi ativada. O Owner deve concluir o checkout para liberar as operacoes.')
  error.code = 'subscription_read_only'
  return error
}

export const resolveTenantEntitlement = async (tenantId, client = null, user = null) => {
  if (isPlatformDeveloper(user)) return developerEntitlement()
  if (!hasDatabase) return entitlementFromSubscription()

  const read = async (queryClient) => {
    const result = await queryClient.query(`
      select subscription.status, plan.code as plan_code, plan.limits, plan.features, tenant.billing_enforcement_exempt
        from tenants tenant
        left join tenant_subscriptions subscription on subscription.tenant_id = tenant.id
        left join platform_plans plan on plan.id = subscription.plan_id
       where tenant.id = $1
       limit 1
    `, [tenantId])
    const row = result.rows[0] || null
    return entitlementFromSubscription(row, Boolean(row?.billing_enforcement_exempt))
  }

  return client ? read(client) : withTenant(tenantId, read)
}

export const assertTenantRequestEntitlement = async ({ tenantId, method, pathname, user = null }) => {
  if (isPlatformDeveloper(user)) return developerEntitlement()
  const requiredFeature = subscriptionFeatureForRequest({ method, pathname })
  if (method === 'GET' && !requiredFeature) return null

  const entitlement = await resolveTenantEntitlement(tenantId, null, user)
  if (!canUseSubscriptionRequest({ method, pathname, entitlement })) throw subscriptionError()

  if (requiredFeature && !supportsSubscriptionFeature(entitlement, requiredFeature)) {
    if (requiredFeature === 'advancedReports') throw new Error('O plano atual nao inclui relatorios avancados.')
    throw new Error('Este recurso esta disponivel apenas no plano PRO.')
  }

  return entitlement
}

export const assertTenantResourceLimit = async (client, tenantId, resource, { includePendingInvitations = false, actor = null } = {}) => {
  if (isPlatformDeveloper(actor)) return
  const config = resourceLimits[resource]
  if (!config || !hasDatabase) return

  const entitlement = await resolveTenantEntitlement(tenantId, client)
  const limit = numberLimit(entitlement.limits[resource])
  if (!limit) return

  const result = await client.query(
    resource === 'users' && includePendingInvitations
      ? `select (
           (select count(*) from users where tenant_id = $1 and status = 'active') +
           (select count(*) from tenant_invitations where tenant_id = $1 and accepted_at is null and revoked_at is null and expires_at > now())
         )::int as count`
      : `select count(*)::int as count from ${config.table} where tenant_id = $1 and ${config.where}`,
    [tenantId]
  )
  if (Number(result.rows[0]?.count || 0) >= limit) {
    throw new Error(`O plano atual permite no maximo ${limit} ${resource}.`)
  }
}

export const supportsSubscriptionFeature = (entitlement, feature) =>
  !managedFeatures.has(feature) || !entitlement.configured || entitlement.features[feature] === true
