import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL = ''
process.env.PLATFORM_SUPER_ADMIN_EMAILS = 'developer@example.com'
process.env.PLATFORM_DEVELOPER_EMAILS = 'developer@example.com'

const {
  canUseSubscriptionRequest,
  entitlementFromSubscription,
  isPlatformDeveloper,
  subscriptionFeatureForRequest,
  supportsSubscriptionFeature
} = await import('../src/services/subscriptionEntitlements.js')
const { subscriptionTransition } = await import('../src/jobs/subscriptionWatchdog.js')

test('empresa sem assinatura configurada preserva o acesso atual', () => {
  const entitlement = entitlementFromSubscription()

  assert.equal(entitlement.configured, false)
  assert.equal(entitlement.mode, 'full')
  assert.equal(canUseSubscriptionRequest({ method: 'POST', pathname: '/api/orders', entitlement }), true)
  assert.equal(supportsSubscriptionFeature(entitlement, 'advancedReports'), true)
})

test('empresa nova sem checkout fica somente leitura ate iniciar a assinatura', () => {
  const entitlement = entitlementFromSubscription(null, false)

  assert.equal(entitlement.configured, false)
  assert.equal(entitlement.status, 'payment_required')
  assert.equal(entitlement.mode, 'read_only')
  assert.equal(canUseSubscriptionRequest({ method: 'POST', pathname: '/api/orders', entitlement }), false)
  assert.equal(canUseSubscriptionRequest({ method: 'POST', pathname: '/api/support/requests', entitlement }), true)
})

test('status financeiro sem plano FREE fica somente leitura e preserva suporte', () => {
  const entitlement = entitlementFromSubscription({
    status: 'past_due',
    limits: { users: 3 },
    features: { advancedReports: false }
  })

  assert.equal(entitlement.mode, 'read_only')
  assert.equal(canUseSubscriptionRequest({ method: 'GET', pathname: '/api/orders', entitlement }), true)
  assert.equal(canUseSubscriptionRequest({ method: 'POST', pathname: '/api/support/requests', entitlement }), true)
  assert.equal(canUseSubscriptionRequest({ method: 'POST', pathname: '/api/orders', entitlement }), false)
  assert.equal(supportsSubscriptionFeature(entitlement, 'advancedReports'), false)
})

test('FREE permite a operacao manual e bloqueia somente recursos PRO', () => {
  const entitlement = entitlementFromSubscription({
    status: 'active',
    plan_code: 'free',
    limits: { clients: 20, products: 10, ordersMonthly: 15, printers: 1, filaments: 5, goals: 1 },
    features: { coreOperations: true, marketplaces: false, advancedReports: false, manualPrinters: true, agent: false, team: false }
  }, false)

  assert.equal(entitlement.mode, 'full')
  assert.equal(entitlement.limits.clients, 20)
  assert.equal(supportsSubscriptionFeature(entitlement, 'coreOperations'), true)
  assert.equal(supportsSubscriptionFeature(entitlement, 'manualPrinters'), true)
  assert.equal(supportsSubscriptionFeature(entitlement, 'agent'), false)
  assert.equal(supportsSubscriptionFeature(entitlement, 'advancedReports'), false)
  assert.equal(canUseSubscriptionRequest({ method: 'GET', pathname: '/api/orders', entitlement }), true)
})

test('PRO mantem acesso durante grace, mas nao quando o provider encerra o acesso', () => {
  const grace = entitlementFromSubscription({ plan_code: 'starter', status: 'grace', features: { agent: true } }, false)
  const paused = entitlementFromSubscription({ plan_code: 'free', status: 'paused', features: { agent: false } }, false)

  assert.equal(grace.mode, 'full')
  assert.equal(supportsSubscriptionFeature(grace, 'agent'), true)
  assert.equal(paused.mode, 'full')
  assert.equal(supportsSubscriptionFeature(paused, 'agent'), false)
})

test('Agent e bloqueado pelo resolvedor central, independentemente da rota do frontend', () => {
  assert.equal(subscriptionFeatureForRequest({ method: 'GET', pathname: '/api/agents' }), 'agent')
  assert.equal(subscriptionFeatureForRequest({ method: 'POST', pathname: '/api/agent-commands' }), 'agent')
  assert.equal(subscriptionFeatureForRequest({ method: 'POST', pathname: '/api/print-jobs/123/start' }), 'agent')
  assert.equal(subscriptionFeatureForRequest({ method: 'POST', pathname: '/api/printers' }), 'manualPrinters')
  assert.equal(subscriptionFeatureForRequest({ method: 'POST', pathname: '/api/orders' }), 'coreOperations')
})

test('desenvolvedor configurado possui acesso completo sem liberar outros superadmins', () => {
  assert.equal(isPlatformDeveloper({ platformRole: 'platform_super_admin', email: 'developer@example.com' }), true)
  assert.equal(isPlatformDeveloper({ platformRole: 'platform_super_admin', email: 'outro@example.com' }), false)
  assert.equal(isPlatformDeveloper({ platformRole: '', email: 'developer@example.com' }), false)
})

test('watchdog apenas encerra carencia e nunca usa vencimento local para cobrar', () => {
  const now = new Date('2026-09-10T12:00:00.000Z')

  assert.equal(subscriptionTransition({ status: 'trial', trial_ends_at: '2026-09-10T11:59:59.000Z' }, now), null)
  assert.equal(subscriptionTransition({ status: 'active', current_period_end: '2026-09-10T11:59:59.000Z' }, now), null)
  assert.equal(subscriptionTransition({ status: 'grace', grace_ends_at: '2026-09-10T11:59:59.000Z' }, now), 'paused')
  assert.equal(subscriptionTransition({ status: 'grace', grace_ends_at: '2026-09-11T12:00:00.000Z' }, now), null)
})
