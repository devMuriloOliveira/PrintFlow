import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

process.env.ASAAS_WEBHOOK_TOKEN = 'a'.repeat(32)

const { asaasWebhookTokenMatches, paymentRecordStatus } = await import('../src/services/asaasBilling.js')
const { handleAsaasWebhook } = await import('../src/routes/billing.js')

const webhookRequest = (token, body) => {
  const request = new EventEmitter()
  request.headers = { 'asaas-access-token': token }
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

test('classifica os eventos de pagamento do Asaas sem depender do payload completo', () => {
  assert.equal(paymentRecordStatus('PAYMENT_CREATED'), 'pending')
  assert.equal(paymentRecordStatus('PAYMENT_RECEIVED'), 'paid')
  assert.equal(paymentRecordStatus('PAYMENT_CONFIRMED'), 'paid')
  assert.equal(paymentRecordStatus('PAYMENT_OVERDUE'), 'overdue')
  assert.equal(paymentRecordStatus('PAYMENT_REFUNDED'), 'void')
})

test('aceita apenas o token exato do webhook do Asaas', () => {
  assert.equal(asaasWebhookTokenMatches('a'.repeat(32)), true)
  assert.equal(asaasWebhookTokenMatches('b'.repeat(32)), false)
  assert.equal(asaasWebhookTokenMatches('a'.repeat(31)), false)
  assert.equal(asaasWebhookTokenMatches(''), false)
})

test('webhook rejeita token invalido antes de ler ou processar o evento', async () => {
  const unauthorized = webhookResponse()
  await handleAsaasWebhook(webhookRequest('b'.repeat(32), { id: 'evt_test', event: 'PAYMENT_CREATED' }), unauthorized)
  assert.equal(unauthorized.status, 401)
})
