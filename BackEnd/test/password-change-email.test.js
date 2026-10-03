import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import test from 'node:test'

process.env.DATABASE_URL = ''
process.env.AUTH_SECRET = 'password-change-email-test-secret-32-characters'
process.env.DATA_ENCRYPTION_KEY = 'password-change-email-data-key-32-characters'
process.env.WEBHOOK_SHARED_SECRET = 'password-change-email-webhook-secret-32-characters'
process.env.CORS_ALLOWED_ORIGINS = 'https://filamind.com.br,https://www.filamind.com.br'
process.env.RESEND_API_KEY = 're_test_password_change'
process.env.EMAIL_FROM = 'Filamind <acesso@filamind.com.br>'
process.env.APP_PUBLIC_URL = 'https://filamind.com.br'

let deliveredEmail
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.resend.com/emails')
  deliveredEmail = JSON.parse(options.body)
  return { ok: true, status: 200, text: async () => '{"id":"email-test"}' }
}

const { handleRequest } = await import('../src/routes/index.js')

class MockRequest extends Readable {
  constructor({ method, path, body, headers = {}, ip }) {
    super()
    this.method = method
    this.url = path
    this.headers = { host: 'localhost:3333', ...headers }
    this.socket = { remoteAddress: ip }
    this.body = body === undefined ? null : JSON.stringify(body)
  }
  _read() {
    if (this.body !== null) { this.push(this.body); this.body = null }
    this.push(null)
  }
}

class MockResponse extends EventEmitter {
  writeHead(status, headers) { this.statusCode = status; this.headers = headers }
  end(chunk) { this.body = chunk ? JSON.parse(String(chunk)) : null; this.emit('finish') }
}

const request = ({ method, path, body, token, ip }) => new Promise((resolve) => {
  const req = new MockRequest({ method, path, body, ip, headers: token ? { authorization: `Bearer ${token}` } : {} })
  const res = new MockResponse()
  res.once('finish', () => resolve({ status: res.statusCode, body: res.body, headers: res.headers }))
  handleRequest(req, res)
})

test('troca de senha exige codigo de e-mail de uso unico e encerra sessoes anteriores', async () => {
  const registered = await request({ method: 'POST', path: '/api/auth/register', ip: '127.21.0.1', body: {
    name: 'Conta Filamind', email: `password-change-${Date.now()}@example.test`, password: 'SenhaForte1!', company: 'Filamind', document: '52998224725'
  } })
  assert.equal(registered.status, 201)

  const wrongPassword = await request({ method: 'POST', path: '/api/auth/change-password/request-code', ip: '127.21.0.2', token: registered.body.accessToken, body: { currentPassword: 'Errada123!' } })
  assert.equal(wrongPassword.status, 400)
  assert.equal(deliveredEmail, undefined)

  const sent = await request({ method: 'POST', path: '/api/auth/change-password/request-code', ip: '127.21.0.3', token: registered.body.accessToken, body: { currentPassword: 'SenhaForte1!' } })
  assert.equal(sent.status, 202)
  assert.equal(sent.body.status, 'code_sent')
  assert.equal(deliveredEmail.to[0], registered.body.user.email)
  const code = deliveredEmail.text.match(/\b(\d{8})\b/)[1]

  const invalid = await request({ method: 'POST', path: '/api/auth/change-password/confirm', ip: '127.21.0.4', token: registered.body.accessToken, body: { currentPassword: 'SenhaForte1!', newPassword: 'NovaSenhaForte2!', code: '00000000' } })
  assert.equal(invalid.status, 400)

  const changed = await request({ method: 'POST', path: '/api/auth/change-password/confirm', ip: '127.21.0.5', token: registered.body.accessToken, body: { currentPassword: 'SenhaForte1!', newPassword: 'NovaSenhaForte2!', code } })
  assert.equal(changed.status, 200)
  assert.ok(changed.body.accessToken)

  const oldSession = await request({ method: 'GET', path: '/api/auth/me', ip: '127.21.0.6', token: registered.body.accessToken })
  assert.equal(oldSession.status, 401)
  const replay = await request({ method: 'POST', path: '/api/auth/change-password/confirm', ip: '127.21.0.7', token: changed.body.accessToken, body: { currentPassword: 'NovaSenhaForte2!', newPassword: 'OutraSenhaForte3!', code } })
  assert.equal(replay.status, 400)

  const oldPassword = await request({ method: 'POST', path: '/api/auth/login', ip: '127.21.0.8', body: { email: registered.body.user.email, password: 'SenhaForte1!' } })
  assert.equal(oldPassword.status, 400)
  const newPassword = await request({ method: 'POST', path: '/api/auth/login', ip: '127.21.0.9', body: { email: registered.body.user.email, password: 'NovaSenhaForte2!' } })
  assert.equal(newPassword.status, 200)
})
