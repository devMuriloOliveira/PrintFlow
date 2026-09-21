import test from 'node:test'
import assert from 'node:assert/strict'

const { stripeCheckoutExpired } = await import('../src/services/stripeBilling.js')

test('checkout Stripe vencido nao pode ser reutilizado', () => {
  const now = Date.parse('2026-09-16T12:00:00.000Z')
  assert.equal(stripeCheckoutExpired({ expiresAt: '2026-09-16T11:59:59.000Z' }, now), true)
  assert.equal(stripeCheckoutExpired({ expiresAt: '2026-09-16T12:00:01.000Z' }, now), false)
  assert.equal(stripeCheckoutExpired({ createdAt: '2026-09-15T11:59:59.000Z' }, now), true)
  assert.equal(stripeCheckoutExpired({ createdAt: '2026-09-15T12:00:01.000Z' }, now), false)
})
