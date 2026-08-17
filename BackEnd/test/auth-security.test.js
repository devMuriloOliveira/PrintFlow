import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import test from 'node:test'

process.env.ALLOW_DEMO_TENANT = 'false'
process.env.AUTH_SECRET = 'auth-security-test-secret'
process.env.RATE_LIMIT_AUTH_MAX_REQUESTS = '2'
process.env.RATE_LIMIT_WINDOW_MS = '60000'
delete process.env.DATABASE_URL

const { hashPassword, validatePasswordPolicy, verifyPassword } = await import('../src/auth/password.js')
const { handleRequest } = await import('../src/routes/index.js')

class MockRequest extends Readable {
  constructor({ method, path, body, headers = {}, ip = '127.0.0.10' }) {
    super()
    this.method = method
    this.url = path
    this.headers = { host: 'localhost:3333', ...headers }
    this.socket = { remoteAddress: ip }
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

const request = ({ method = 'GET', path, body, ip, token }) => new Promise((resolve) => {
  const req = new MockRequest({
    method,
    path,
    body,
    ip,
    headers: token ? { authorization: `Bearer ${token}` } : {}
  })
  const res = new MockResponse()
  res.once('finish', () => resolve({ status: res.statusCode, body: res.body, headers: res.headers }))
  handleRequest(req, res)
})

const registerSession = async (label, ip) => {
  const response = await request({
    method: 'POST',
    path: '/api/auth/register',
    ip,
    body: {
      name: `Usuario ${label}`,
      email: `auth-${label}-${Date.now()}@example.com`,
      password: 'SenhaForte1!',
      company: `Tenant ${label}`
    }
  })

  assert.equal(response.status, 201)
  assert.ok(response.body.accessToken)
  assert.ok(response.body.refreshToken)
  assert.equal(response.body.token, response.body.accessToken)
  return response.body
}

test('senha e armazenada como hash scrypt, nunca em texto puro', () => {
  const password = 'SenhaForte1!'
  const stored = hashPassword(password)

  assert.notEqual(stored, password)
  assert.match(stored, /^scrypt\$/)
  assert.equal(verifyPassword(password, stored), true)
  assert.equal(verifyPassword('SenhaErrada1!', stored), false)
})

test('politica minima rejeita senhas fracas', () => {
  assert.equal(validatePasswordPolicy('curta'), 'A senha precisa ter pelo menos 10 caracteres.')
  assert.equal(validatePasswordPolicy('senhasemnumero!'), 'A senha precisa conter letra maiuscula.')
  assert.equal(validatePasswordPolicy('SENHASENUMERO!'), 'A senha precisa conter letra minuscula.')
  assert.equal(validatePasswordPolicy('SenhaSemEspecial1'), 'A senha precisa conter caractere especial.')
  assert.equal(validatePasswordPolicy('SenhaForte1!'), '')
})

test('login possui rate limiting contra brute force', async () => {
  const ip = `127.0.0.${Math.floor(Math.random() * 200) + 20}`
  const body = { email: 'nao-existe@example.com', password: 'SenhaErrada1!' }

  assert.equal((await request({ method: 'POST', path: '/api/auth/login', body, ip })).status, 400)
  assert.equal((await request({ method: 'POST', path: '/api/auth/login', body, ip })).status, 400)

  const blocked = await request({ method: 'POST', path: '/api/auth/login', body, ip })
  assert.equal(blocked.status, 429)
  assert.equal(blocked.headers['Retry-After'], '60')
})

test('refresh token possui rotacao e rejeita reutilizacao', async () => {
  const session = await registerSession('rotacao', '127.0.1.10')

  const meBeforeRefresh = await request({
    method: 'GET',
    path: '/api/auth/me',
    token: session.accessToken,
    ip: '127.0.1.11'
  })
  assert.equal(meBeforeRefresh.status, 200)

  const refreshed = await request({
    method: 'POST',
    path: '/api/auth/refresh',
    body: { refreshToken: session.refreshToken },
    ip: '127.0.1.12'
  })
  assert.equal(refreshed.status, 200)
  assert.ok(refreshed.body.accessToken)
  assert.notEqual(refreshed.body.refreshToken, session.refreshToken)

  const reused = await request({
    method: 'POST',
    path: '/api/auth/refresh',
    body: { refreshToken: session.refreshToken },
    ip: '127.0.1.13'
  })
  assert.equal(reused.status, 400)

  const accessAfterReuse = await request({
    method: 'GET',
    path: '/api/auth/me',
    token: refreshed.body.accessToken,
    ip: '127.0.1.14'
  })
  assert.equal(accessAfterReuse.status, 401)
})

test('logout revoga refresh token e invalida access token da sessao', async () => {
  const session = await registerSession('logout', '127.0.2.10')

  assert.equal((await request({
    method: 'GET',
    path: '/api/auth/me',
    token: session.accessToken,
    ip: '127.0.2.11'
  })).status, 200)

  const logout = await request({
    method: 'POST',
    path: '/api/auth/logout',
    body: { refreshToken: session.refreshToken },
    ip: '127.0.2.12'
  })
  assert.equal(logout.status, 200)

  const afterLogout = await request({
    method: 'GET',
    path: '/api/auth/me',
    token: session.accessToken,
    ip: '127.0.2.13'
  })
  assert.equal(afterLogout.status, 401)

  const refreshAfterLogout = await request({
    method: 'POST',
    path: '/api/auth/refresh',
    body: { refreshToken: session.refreshToken },
    ip: '127.0.2.14'
  })
  assert.equal(refreshAfterLogout.status, 400)
})
