import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import test from 'node:test'

process.env.ALLOW_DEMO_TENANT = 'false'
process.env.AUTH_SECRET = 'auth-security-test-secret-32-characters'
process.env.DATA_ENCRYPTION_KEY = 'auth-security-data-key-32-characters'
process.env.WEBHOOK_SHARED_SECRET = 'auth-security-webhook-secret-32-characters'
process.env.PLATFORM_SUPER_ADMIN_EMAILS = 'platform-admin@example.com'
process.env.RATE_LIMIT_AUTH_MAX_REQUESTS = '2'
process.env.RATE_LIMIT_WINDOW_MS = '60000'
process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com,https://admin.example.com'
process.env.DATABASE_URL = ''

const { hashPassword, validatePasswordPolicy, verifyPassword } = await import('../src/auth/password.js')
const { createToken } = await import('../src/auth/token.js')
const { safeChangedFields } = await import('../src/repositories/crudRepository.js')
const { describeAuditEvent } = await import('../src/services/operationalEvents.js')
const { auditReportFilename, formatTenantAuditCsv, formatTenantAuditWorkbook } = await import('../src/routes/platformAdmin.js')
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

const request = ({ method = 'GET', path, body, ip, token, origin, cookie, userAgent }) => new Promise((resolve) => {
  const req = new MockRequest({
    method,
    path,
    body,
    ip,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
      ...(userAgent ? { 'user-agent': userAgent } : {})
    }
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
  assert.equal(response.body.refreshToken, undefined)
  assert.match(response.headers['Set-Cookie'], /HttpOnly/)
  assert.match(response.headers['Set-Cookie'], /SameSite=Lax/)
  assert.equal(response.headers['Cache-Control'], 'no-store')
  assert.equal(response.body.token, response.body.accessToken)
  return { ...response.body, refreshCookie: response.headers['Set-Cookie'] }
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
    cookie: session.refreshCookie,
    ip: '127.0.1.12'
  })
  assert.equal(refreshed.status, 200)
  assert.ok(refreshed.body.accessToken)
  assert.equal(refreshed.body.refreshToken, undefined)
  assert.match(refreshed.headers['Set-Cookie'], /HttpOnly/)

  const reused = await request({
    method: 'POST',
    path: '/api/auth/refresh',
    cookie: session.refreshCookie,
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
    cookie: session.refreshCookie,
    ip: '127.0.2.12'
  })
  assert.equal(logout.status, 200)
  assert.match(logout.headers['Set-Cookie'], /Max-Age=0/)

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
    cookie: session.refreshCookie,
    ip: '127.0.2.14'
  })
  assert.equal(refreshAfterLogout.status, 400)
})

test('alteracao de senha exige a senha atual e invalida as sessoes anteriores', async () => {
  const session = await registerSession('troca-senha', '127.0.0.211')

  const rejected = await request({
    method: 'POST', path: '/api/auth/change-password', token: session.accessToken, ip: '127.0.0.212',
    body: { currentPassword: 'SenhaIncorreta1!', newPassword: 'NovaSenhaForte1!' }
  })
  assert.equal(rejected.status, 400)
  assert.equal(rejected.body.error, 'Senha atual invalida.')

  const changed = await request({
    method: 'POST', path: '/api/auth/change-password', token: session.accessToken, ip: '127.0.0.213',
    body: { currentPassword: 'SenhaForte1!', newPassword: 'NovaSenhaForte1!' }
  })
  assert.equal(changed.status, 200)
  assert.ok(changed.body.accessToken)
  assert.notEqual(changed.body.accessToken, session.accessToken)

  const oldSession = await request({ method: 'GET', path: '/api/auth/me', token: session.accessToken, ip: '127.0.0.214' })
  assert.equal(oldSession.status, 401)
  const currentSession = await request({ method: 'GET', path: '/api/auth/me', token: changed.body.accessToken, ip: '127.0.0.215' })
  assert.equal(currentSession.status, 200)

  const oldPassword = await request({ method: 'POST', path: '/api/auth/login', ip: '127.0.0.216', body: { email: session.user.email, password: 'SenhaForte1!' } })
  assert.equal(oldPassword.status, 400)
  const newPassword = await request({ method: 'POST', path: '/api/auth/login', ip: '127.0.0.217', body: { email: session.user.email, password: 'NovaSenhaForte1!' } })
  assert.equal(newPassword.status, 200)
})

test('auditoria de recursos registra somente campos seguros alterados', () => {
  const changedFields = safeChangedFields({ description: 'anterior', email: 'anterior@example.com' }, {
    description: 'atualizado',
    cost: 10,
    email: 'novo@example.com',
    phone: '11999999999',
    refreshToken: 'nao-deve-ser-registrado',
    printFileHash: 'nao-deve-ser-registrado'
  })

  assert.deepEqual(changedFields, ['description', 'cost'])
})

test('auditoria apresenta resumo compreensivel sem expor valores', () => {
  const event = describeAuditEvent({
    action: 'products.updated',
    details: { changedFields: ['price', 'status', 'email'] }
  })

  assert.equal(event.summary, 'Produto atualizado')
  assert.equal(event.context, 'Campos alterados: preco, status.')

  const passwordChange = describeAuditEvent({ action: 'password.changed', details: { sessionsRevoked: true } })
  assert.equal(passwordChange.summary, 'Senha alterada')
  assert.match(passwordChange.context, /Sessoes anteriores foram encerradas por seguranca/)
})

test('relatorio CSV de auditoria preserva o contexto seguro e escapa celulas', () => {
  const csv = formatTenantAuditCsv({
    companyName: 'Empresa "Teste"',
    cnpj: '12.***.***/0001-90',
    reason: 'Solicitacao de suporte',
    verifiedAt: '2026-09-03T12:00:00.000Z',
    expiresAt: '2026-09-03T12:30:00.000Z',
    events: [{
      createdAt: '2026-09-03T12:01:00.000Z', summary: 'Produto atualizado', action: 'products.updated',
      context: 'Campos alterados: preco.', actorType: 'user', entityType: 'products', entityId: '42'
    }]
  })

  assert.match(csv, /^\ufeff"Relatorio de auditoria PrintFlow"/)
  assert.match(csv, /"Empresa ""Teste"""/)
  assert.match(csv, /"Produto atualizado"/)
  assert.match(csv, /"products.updated"/)
})

test('relatorio usa nome padronizado e gera planilha Excel real', async () => {
  const date = new Date('2026-09-03T15:04:05.000Z')
  assert.equal(auditReportFilename('xlsx', date), 'Relatorio_Auditoria_de_Empresa_2026-09-03_12-04-05.xlsx')

  const workbook = await formatTenantAuditWorkbook({
    companyName: 'Empresa teste', cnpj: '12.***.***/0001-90', reason: 'Suporte solicitado',
    verifiedAt: date.toISOString(), expiresAt: new Date(date.getTime() + 30 * 60 * 1000).toISOString(),
    events: []
  })
  assert.equal(workbook.subarray(0, 2).toString(), 'PK')
})

test('CORS permite somente as origens configuradas', async () => {
  const allowed = await request({
    method: 'OPTIONS',
    path: '/api/auth/login',
    origin: 'https://app.example.com'
  })
  assert.equal(allowed.status, 204)
  assert.equal(allowed.headers['Access-Control-Allow-Origin'], 'https://app.example.com')
  assert.equal(allowed.headers['Access-Control-Allow-Credentials'], 'true')
  assert.equal(allowed.headers['X-Content-Type-Options'], 'nosniff')
  assert.match(allowed.headers['Access-Control-Allow-Methods'], /PATCH/)

  const blocked = await request({
    method: 'OPTIONS',
    path: '/api/auth/login',
    origin: 'https://untrusted.example.com'
  })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.headers['Access-Control-Allow-Origin'], undefined)
})

test('sessoes mostram metadados minimos sem expor o IP completo', async () => {
  const session = await registerSession('metadados', '10.20.30.40')
  const response = await request({
    method: 'GET',
    path: '/api/auth/sessions',
    token: session.accessToken,
    ip: '10.20.30.40',
    userAgent: 'PrintFlow Test Browser/1.0'
  })

  assert.equal(response.status, 200)
  const current = response.body.find((item) => item.sessionId)
  assert.equal(current.ipMasked, '10.20.30.0')
  assert.equal(current.deviceLabel, 'PrintFlow Test Browser/1.0')
  assert.ok(current.lastSeenAt)
})

test('rota de producao rejeita sessao de financeiro no backend', async () => {
  const session = await registerSession('autorizacao', '127.0.3.10')
  const payload = JSON.parse(Buffer.from(session.accessToken.split('.')[1], 'base64url').toString('utf8'))
  const financeiroToken = createToken({
    id: session.user.id,
    tenantId: session.user.tenantId,
    name: session.user.name,
    email: session.user.email,
    role: 'financeiro',
    tokenVersion: payload.tokenVersion
  }, { sessionId: payload.sid })

  const response = await request({
    method: 'POST',
    path: '/api/print-jobs/enqueue',
    token: financeiroToken,
    ip: '127.0.3.11',
    body: { productId: 1, printerId: 1 }
  })

  assert.equal(response.status, 403)
})

test('papel global da plataforma permanece separado do papel owner do tenant', async () => {
  const anonymous = await request({
    method: 'GET',
    path: '/api/platform-admin/audit-requests',
    ip: '127.0.4.9'
  })
  assert.equal(anonymous.status, 401)

  const tenantOwner = await registerSession('owner-sem-acesso-global', '127.0.4.8')
  const hiddenFromTenantOwner = await request({
    method: 'GET',
    path: '/api/platform-admin/audit-requests',
    token: tenantOwner.accessToken,
    ip: '127.0.4.7'
  })
  assert.equal(hiddenFromTenantOwner.status, 404)

  const response = await request({
    method: 'POST',
    path: '/api/auth/register',
    ip: '127.0.4.10',
    body: {
      name: 'Administrador da Plataforma',
      email: 'platform-admin@example.com',
      password: 'SenhaForte1!',
      company: 'Tenant da Plataforma'
    }
  })

  assert.equal(response.status, 201)
  assert.equal(response.body.user.role, 'owner')
  assert.equal(response.body.user.platformRole, 'platform_super_admin')

  const payload = JSON.parse(Buffer.from(response.body.accessToken.split('.')[1], 'base64url').toString('utf8'))
  assert.equal(payload.role, 'owner')
  assert.equal(payload.platformRole, 'platform_super_admin')

  const removedGlobalReport = await request({
    method: 'GET',
    path: '/api/platform-admin/user-audit',
    token: response.body.accessToken,
    ip: '127.0.4.11'
  })
  assert.equal(removedGlobalReport.status, 404)
})
