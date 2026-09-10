import { hasDatabase, withTenant } from '../db/pool.js'

const readOnlyStatuses = new Set(['past_due', 'paused', 'cancelled', 'ended'])
const managedFeatures = new Set(['marketplaces', 'advancedReports'])
const resourceLimits = {
  users: { table: 'users', where: "status = 'active'" },
  printers: { table: 'printers', where: 'true' },
  agents: { table: 'agents', where: "status <> 'revoked'" },
  products: { table: 'products', where: 'true' }
}

const numberLimit = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

export const entitlementFromSubscription = (subscription = null) => {
  if (!subscription?.status) {
    return { configured: false, status: 'not_configured', mode: 'full', limits: {}, features: {} }
  }

  const status = String(subscription.status)
  return {
    configured: true,
    status,
    mode: readOnlyStatuses.has(status) ? 'read_only' : 'full',
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

const subscriptionError = () => {
  const error = new Error('A assinatura desta empresa esta em modo somente leitura. Consulte o administrador da conta.')
  error.code = 'subscription_read_only'
  return error
}

export const resolveTenantEntitlement = async (tenantId, client = null) => {
  if (!hasDatabase) return entitlementFromSubscription()

  const read = async (queryClient) => {
    const result = await queryClient.query(`
      select subscription.status, plan.limits, plan.features
        from tenant_subscriptions subscription
        left join platform_plans plan on plan.id = subscription.plan_id
       where subscription.tenant_id = $1
       limit 1
    `, [tenantId])
    return entitlementFromSubscription(result.rows[0] || null)
  }

  return client ? read(client) : withTenant(tenantId, read)
}

export const assertTenantRequestEntitlement = async ({ tenantId, method, pathname }) => {
  const isAdvancedReport = pathname === '/api/reports/financial-export'
  if (method === 'GET' && !isAdvancedReport) return null

  const entitlement = await resolveTenantEntitlement(tenantId)
  if (!canUseSubscriptionRequest({ method, pathname, entitlement })) throw subscriptionError()

  if (isAdvancedReport && entitlement.configured && entitlement.features.advancedReports !== true) {
    throw new Error('O plano atual nao inclui relatorios avancados.')
  }

  const marketplaceWrite = method !== 'GET' && (pathname.startsWith('/api/marketplaces') || pathname.startsWith('/api/marketplace-integrations'))
  if (marketplaceWrite && entitlement.configured && entitlement.features.marketplaces !== true) {
    throw new Error('O plano atual nao inclui integracoes de marketplace.')
  }

  return entitlement
}

export const assertTenantResourceLimit = async (client, tenantId, resource, { includePendingInvitations = false } = {}) => {
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
