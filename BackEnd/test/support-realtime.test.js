import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { publishTenantSupportEvent, subscribeTenantSupportEvents } from '../src/services/supportRealtime.js'

const stream = () => {
  const req = new EventEmitter()
  const res = new EventEmitter()
  res.headers = null
  res.body = ''
  res.writeHead = (_status, headers) => { res.headers = headers }
  res.write = (chunk) => { res.body += chunk }
  return { req, res }
}

test('evento de suporte e entregue somente ao solicitante do mesmo tenant', () => {
  const first = stream()
  const second = stream()
  subscribeTenantSupportEvents({ tenantId: 'tenant-a', id: 'user-a' }, first.req, first.res)
  subscribeTenantSupportEvents({ tenantId: 'tenant-a', id: 'user-b' }, second.req, second.res)
  publishTenantSupportEvent({ tenantId: 'tenant-a', requesterId: 'user-a', requestId: 'request-a', type: 'message' })
  assert.match(first.res.body, /request-a/)
  assert.doesNotMatch(second.res.body, /request-a/)
  first.req.emit('close')
  second.req.emit('close')
})
