import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

process.env.STRIPE_WEBHOOK_SECRET = 'stripe-test-webhook-secret'

const { stripeWebhookSignatureMatches } = await import('../src/services/stripeBilling.js')

test('aceita somente assinatura valida do webhook Stripe', () => {
  const rawBody = Buffer.from(JSON.stringify({ id: 'evt_test', type: 'checkout.session.completed' }))
  const timestamp = 1704908010
  const digest = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex')
  const header = `t=${timestamp},v1=${digest}`

  assert.equal(stripeWebhookSignatureMatches({ header, rawBody, now: timestamp * 1000 }), true)
  assert.equal(stripeWebhookSignatureMatches({ header, rawBody: Buffer.from(`${rawBody} `), now: timestamp * 1000 }), false)
  assert.equal(stripeWebhookSignatureMatches({ header, rawBody, now: (timestamp + 301) * 1000 }), false)
})
