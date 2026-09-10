import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DATABASE_URL = ''

const {
  canUseSubscriptionRequest,
  entitlementFromSubscription,
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

test('watchdog aplica a transicao prevista para cada prazo', () => {
  const now = new Date('2026-09-10T12:00:00.000Z')

  assert.equal(subscriptionTransition({ status: 'trial', trial_ends_at: '2026-09-10T11:59:59.000Z' }, now), 'ended')
  assert.equal(subscriptionTransition({ status: 'active', current_period_end: '2026-09-10T11:59:59.000Z' }, now), 'past_due')
  assert.equal(subscriptionTransition({ status: 'grace', grace_ends_at: '2026-09-10T11:59:59.000Z' }, now), 'paused')
  assert.equal(subscriptionTransition({ status: 'active', current_period_end: '2026-09-11T12:00:00.000Z' }, now), null)
})
