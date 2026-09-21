import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL = ''
process.env.PLATFORM_SUPER_ADMIN_EMAILS = 'developer@example.com'
process.env.PLATFORM_DEVELOPER_EMAILS = 'developer@example.com'

const {
  canUseSubscriptionRequest,
  entitlementFromSubscription,
  isPlatformDeveloper,
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

test('assinatura vencida fica somente leitura e preserva suporte', () => {
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

test('plano gratuito mantem calculadora limitada e bloqueia recursos PRO', () => {
  const entitlement = entitlementFromSubscription({
    status: 'active',
    limits: { calculatorSimulations: 1 },
    features: { coreOperations: false, marketplaces: false, advancedReports: false, printers: false, team: false }
  }, false)

  assert.equal(entitlement.mode, 'full')
  assert.equal(entitlement.limits.calculatorSimulations, 1)
  assert.equal(supportsSubscriptionFeature(entitlement, 'coreOperations'), false)
  assert.equal(supportsSubscriptionFeature(entitlement, 'printers'), false)
  assert.equal(supportsSubscriptionFeature(entitlement, 'advancedReports'), false)
  assert.equal(canUseSubscriptionRequest({ method: 'GET', pathname: '/api/orders', entitlement }), true)
})

test('desenvolvedor configurado possui acesso completo sem liberar outros superadmins', () => {
  assert.equal(isPlatformDeveloper({ platformRole: 'platform_super_admin', email: 'developer@example.com' }), true)
  assert.equal(isPlatformDeveloper({ platformRole: 'platform_super_admin', email: 'outro@example.com' }), false)
  assert.equal(isPlatformDeveloper({ platformRole: '', email: 'developer@example.com' }), false)
})

test('watchdog aplica a transicao prevista para cada prazo', () => {
  const now = new Date('2026-09-10T12:00:00.000Z')

  assert.equal(subscriptionTransition({ status: 'trial', trial_ends_at: '2026-09-10T11:59:59.000Z' }, now), 'ended')
  assert.equal(subscriptionTransition({ status: 'active', current_period_end: '2026-09-10T11:59:59.000Z' }, now), 'past_due')
  assert.equal(subscriptionTransition({ status: 'grace', grace_ends_at: '2026-09-10T11:59:59.000Z' }, now), 'paused')
  assert.equal(subscriptionTransition({ status: 'active', current_period_end: '2026-09-11T12:00:00.000Z' }, now), null)
})
