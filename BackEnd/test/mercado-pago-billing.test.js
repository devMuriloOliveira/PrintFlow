import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { EventEmitter } from 'node:events'
import test from 'node:test'

process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'mercado-pago-test-webhook-secret'
process.env.MERCADO_PAGO_ACCESS_TOKEN = 'test-access-token'

const {
  expireMercadoPagoPreapproval,
  invoiceStatus,
  mercadoPagoCheckoutExpiresAt,
  mercadoPagoWebhookSignatureMatches,
  updateMercadoPagoPreapprovalStatus
} = await import('../src/services/mercadoPagoBilling.js')
const { handleMercadoPagoWebhook, handleMercadoPagoWebhookProbe } = await import('../src/routes/billing.js')

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

test('checkout Mercado Pago expira apos oito horas da criacao', () => {
  const expiresAt = mercadoPagoCheckoutExpiresAt('2026-10-07T00:00:00.000Z')
  assert.equal(expiresAt.toISOString(), '2026-10-07T08:00:00.000Z')
})

test('expira checkout remoto pendente e exige confirmacao de cancelamento', async () => {
  const originalFetch = globalThis.fetch
  const operations = []
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method || 'GET'
    operations.push(method)
    return method === 'GET'
      ? new Response(JSON.stringify({ id: 'preapproval-test', status: 'pending' }), { status: 200 })
      : new Response(JSON.stringify({ id: 'preapproval-test', status: 'cancelled' }), { status: 200 })
  }

  try {
    const result = await expireMercadoPagoPreapproval('preapproval-test')
    assert.deepEqual(operations, ['GET', 'PUT'])
    assert.equal(result.status, 'cancelled')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('nao cancela checkout remoto que ja foi autorizado', async () => {
  const originalFetch = globalThis.fetch
  const operations = []
  globalThis.fetch = async (_url, options = {}) => {
    operations.push(options.method || 'GET')
    return new Response(JSON.stringify({ id: 'preapproval-test', status: 'authorized' }), { status: 200 })
  }

  try {
    await assert.rejects(expireMercadoPagoPreapproval('preapproval-test'), /nao esta pendente/)
    assert.deepEqual(operations, ['GET'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('usa a grafia de cancelamento aceita pela API quando o primeiro valor e rejeitado', async () => {
  const originalFetch = globalThis.fetch
  const requestedOperations = []
  globalThis.fetch = async (_url, options) => {
    const operation = options.body ? JSON.parse(options.body).status : 'GET'
    requestedOperations.push(operation)
    if (requestedOperations.length === 1) {
      return new Response(JSON.stringify({ message: 'Invalid preapproval status param: canceled' }), { status: 400 })
    }
    if (operation === 'GET') return new Response(JSON.stringify({ id: 'preapproval-test', status: 'authorized' }), { status: 200 })
    return new Response(JSON.stringify({ id: 'preapproval-test', status: 'cancelled' }), { status: 200 })
  }

  try {
    const result = await updateMercadoPagoPreapprovalStatus('preapproval-test', 'canceled')
    assert.deepEqual(requestedOperations, ['canceled', 'GET', 'cancelled'])
    assert.equal(result.status, 'cancelled')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('nao repete a acao quando o Mercado Pago ja confirmou cancelamento', async () => {
  const originalFetch = globalThis.fetch
  const requestedOperations = []
  globalThis.fetch = async (_url, options) => {
    const operation = options.body ? JSON.parse(options.body).status : 'GET'
    requestedOperations.push(operation)
    return requestedOperations.length === 1
      ? new Response(JSON.stringify({ message: 'Invalid preapproval status param: canceled' }), { status: 400 })
      : new Response(JSON.stringify({ id: 'preapproval-test', status: 'cancelled' }), { status: 200 })
  }

  try {
    const result = await updateMercadoPagoPreapprovalStatus('preapproval-test', 'canceled')
    assert.deepEqual(requestedOperations, ['canceled', 'GET'])
    assert.equal(result.status, 'cancelled')
  } finally {
    globalThis.fetch = originalFetch
  }
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

test('sondagem de URL do Mercado Pago responde sem processar pagamento', async () => {
  const response = webhookResponse()
  await handleMercadoPagoWebhookProbe({}, response)
  assert.equal(response.status, 200)
  assert.match(response.body, /mercado-pago-webhook/)
})
