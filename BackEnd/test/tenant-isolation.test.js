import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import test from 'node:test'

process.env.ALLOW_DEMO_TENANT = 'false'
process.env.AUTH_SECRET = 'tenant-isolation-test-secret'
delete process.env.DATABASE_URL

const { handleRequest } = await import('../src/routes/index.js')

class MockRequest extends Readable {
  constructor({ method, path, body, headers = {} }) {
    super()
    this.method = method
    this.url = path
    this.headers = { host: 'localhost:3333', ...headers }
    this.socket = { remoteAddress: '127.0.0.1' }
    this.body = body === undefined ? null : JSON.stringify(body)
  }

  _read() {
    if (this.body !== null) {
      this.push(this.body)
      this.body = null
    }
    this.push(null)
  }
}

class MockResponse extends EventEmitter {
  writeHead(status, headers) {
    this.statusCode = status
    this.headers = headers
  }

  end(chunk) {
    this.body = chunk ? JSON.parse(String(chunk)) : null
    this.emit('finish')
  }
}

const request = ({ method = 'GET', path, body, token }) => new Promise((resolve) => {
  const req = new MockRequest({
    method,
    path,
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {}
  })
  const res = new MockResponse()
  res.once('finish', () => resolve({ status: res.statusCode, body: res.body }))
  handleRequest(req, res)
})

const register = async (suffix) => {
  const response = await request({
    method: 'POST',
    path: '/api/auth/register',
    body: {
      name: `Usuario ${suffix}`,
      email: `usuario-${suffix}-${Date.now()}@example.com`,
      password: 'SenhaSegura1!',
      company: `Tenant ${suffix}`
    }
  })

  assert.equal(response.status, 201)
  assert.ok(response.body.token)
  return response.body
}

test('usuario de outro tenant nao acessa cliente por ID', async () => {
  const tenantA = await register('a')
  const tenantB = await register('b')

  assert.notEqual(tenantA.user.tenantId, tenantB.user.tenantId)

  const created = await request({
    method: 'POST',
    path: '/api/clients',
    token: tenantA.token,
    body: {
      name: 'Cliente Tenant A',
      email: 'cliente-a@example.com',
      phone: '11999999999'
    }
  })

  assert.equal(created.status, 201)
  const clientId = created.body[0].id

  const ownerRead = await request({
    method: 'GET',
    path: `/api/clients/${clientId}`,
    token: tenantA.token
  })

  assert.equal(ownerRead.status, 200)
  assert.equal(ownerRead.body.id, clientId)

  const crossTenantRead = await request({
    method: 'GET',
    path: `/api/clients/${clientId}`,
    token: tenantB.token
  })

  assert.equal(crossTenantRead.status, 404)
  assert.equal(crossTenantRead.body.error, 'Registro nao encontrado')

  const crossTenantUpdate = await request({
    method: 'PUT',
    path: `/api/clients/${clientId}`,
    token: tenantB.token,
    body: {
      id: clientId,
      name: 'Cliente invadido',
      email: 'cliente-invadido@example.com',
      phone: '11888888888'
    }
  })

  assert.equal(crossTenantUpdate.status, 404)

  const crossTenantDelete = await request({
    method: 'DELETE',
    path: `/api/clients/${clientId}`,
    token: tenantB.token
  })

  assert.equal(crossTenantDelete.status, 404)

  const ownerReadAfterAttempts = await request({
    method: 'GET',
    path: `/api/clients/${clientId}`,
    token: tenantA.token
  })

  assert.equal(ownerReadAfterAttempts.status, 200)
  assert.equal(ownerReadAfterAttempts.body.name, 'Cliente Tenant A')
})
