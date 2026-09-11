import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { EventEmitter } from 'node:events'
import test from 'node:test'

process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'mercado-pago-test-webhook-secret'

const { invoiceStatus, mercadoPagoWebhookSignatureMatches } = await import('../src/services/mercadoPagoBilling.js')
const { handleMercadoPagoWebhook } = await import('../src/routes/billing.js')

const webhookRequest = (headers, body) => {
  const request = new EventEmitter()
  request.headers = headers
  queueMicrotask(() => {
    request.emit('data', Buffer.from(JSON.stringify(body)))
    request.emit('end')
  })
  return request
}

const webhookResponse = () => {
  const response = { status: 0, body: '' }
  response.writeHead = (status) => { response.status = status }
  response.end = (body) => { response.body = String(body || '') }
  return response
}

const signedHeaders = (dataId = '12345') => {
  const ts = '1704908010'
  const requestId = 'request-123'
  const signature = createHmac('sha256', process.env.MERCADO_PAGO_WEBHOOK_SECRET)
    .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
    .digest('hex')
  return { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${signature}` }
}

test('classifica faturas recorrentes do Mercado Pago sem guardar o payload completo', () => {
  assert.equal(invoiceStatus({ payment: { status: 'approved' } }), 'paid')
  assert.equal(invoiceStatus({ payment: { status: 'rejected' } }), 'void')
  assert.equal(invoiceStatus({ status: 'recycling' }), 'overdue')
  assert.equal(invoiceStatus({ status: 'scheduled' }), 'pending')
})

test('aceita somente assinatura HMAC valida do webhook Mercado Pago', () => {
  const headers = signedHeaders('12345')
  assert.equal(mercadoPagoWebhookSignatureMatches({ xSignature: headers['x-signature'], xRequestId: headers['x-request-id'], dataId: '12345' }), true)
  assert.equal(mercadoPagoWebhookSignatureMatches({ xSignature: headers['x-signature'], xRequestId: headers['x-request-id'], dataId: '67890' }), false)
  assert.equal(mercadoPagoWebhookSignatureMatches({ xSignature: 'ts=1,v1=abc', xRequestId: 'request-123', dataId: '12345' }), false)
})

test('webhook rejeita assinatura invalida antes de ler ou processar o evento', async () => {
  const unauthorized = webhookResponse()
  await handleMercadoPagoWebhook(
    webhookRequest({ 'x-request-id': 'request-123', 'x-signature': `ts=1704908010,v1=${'0'.repeat(64)}` }, { id: 'evt_test', type: 'subscription_preapproval', data: { id: '12345' } }),
    unauthorized,
    new URL('https://api.example.test/webhooks/mercado-pago?data.id=12345&type=subscription_preapproval')
  )
  assert.equal(unauthorized.status, 401)
})
