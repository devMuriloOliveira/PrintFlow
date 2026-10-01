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
process.env.TRUSTED_CLIENT_IP_HEADER = 'CF-Connecting-IP'
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

const request = ({ method = 'GET', path, body, ip, token, origin, cookie, userAgent, forwardedFor, trustedClientIp }) => new Promise((resolve) => {
  const req = new MockRequest({
    method,
    path,
    body,
    ip,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
      ...(userAgent ? { 'user-agent': userAgent } : {}),
      ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
      ...(trustedClientIp ? { 'cf-connecting-ip': trustedClientIp } : {})
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
      company: `Tenant ${label}`,
      document: '52998224725'
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

test('rate limit usa o IP confiavel do proxy e ignora X-Forwarded-For informado pelo cliente', async () => {
  const trustedClientIp = `198.51.100.${Math.floor(Math.random() * 200) + 20}`
  const body = { email: 'nao-existe-proxy@example.com', password: 'SenhaErrada1!' }

  assert.equal((await request({ method: 'POST', path: '/api/auth/login', body, trustedClientIp, forwardedFor: '203.0.113.10' })).status, 400)
  assert.equal((await request({ method: 'POST', path: '/api/auth/login', body, trustedClientIp, forwardedFor: '203.0.113.11' })).status, 400)

  const blocked = await request({ method: 'POST', path: '/api/auth/login', body, trustedClientIp, forwardedFor: '203.0.113.12' })
  assert.equal(blocked.status, 429)
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

test('access token contem apenas os dados minimos de sessao e permissao', () => {
  const token = createToken({
    id: 'usuario-1', tenantId: 'empresa-1', name: 'Nome privado', email: 'privado@example.com',
    role: 'admin', platformRole: '', tokenVersion: 3
  }, { sessionId: 'sessao-1' })
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))

  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'platformRole', 'role', 'sid', 'sub', 'tenantId', 'tokenVersion'])
  assert.equal(payload.name, undefined)
  assert.equal(payload.email, undefined)
})

test('alteracao de senha exige a senha atual e invalida as sessoes anteriores', async () => {
  const session = await registerSession('troca-senha', '127.10.0.211')

  const rejected = await request({
    method: 'POST', path: '/api/auth/change-password', token: session.accessToken, ip: '127.10.0.212',
    body: { currentPassword: 'SenhaIncorreta1!', newPassword: 'NovaSenhaForte1!' }
  })
  assert.equal(rejected.status, 400)
  assert.equal(rejected.body.error, 'Senha atual invalida.')

  const changed = await request({
    method: 'POST', path: '/api/auth/change-password', token: session.accessToken, ip: '127.10.0.213',
    body: { currentPassword: 'SenhaForte1!', newPassword: 'NovaSenhaForte1!' }
  })
  assert.equal(changed.status, 200)
  assert.ok(changed.body.accessToken)
  assert.notEqual(changed.body.accessToken, session.accessToken)

  const oldSession = await request({ method: 'GET', path: '/api/auth/me', token: session.accessToken, ip: '127.10.0.214' })
  assert.equal(oldSession.status, 401)
  const currentSession = await request({ method: 'GET', path: '/api/auth/me', token: changed.body.accessToken, ip: '127.10.0.215' })
  assert.equal(currentSession.status, 200)

  const oldPassword = await request({ method: 'POST', path: '/api/auth/login', ip: '127.10.0.216', body: { email: session.user.email, password: 'SenhaForte1!' } })
  assert.equal(oldPassword.status, 400)
  const newPassword = await request({ method: 'POST', path: '/api/auth/login', ip: '127.10.0.217', body: { email: session.user.email, password: 'NovaSenhaForte1!' } })
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

test('fluxo operacional do pedido exige etapas sequenciais e rastreio para envio', async () => {
  const session = await registerSession('fluxo-pedido', '127.0.5.10')
  const created = await request({
    method: 'POST', path: '/api/orders', token: session.accessToken, ip: '127.0.5.11',
    body: { id: `PED-FLUXO-${Date.now()}`, product: 'Produto teste', qty: 1, status: 'Novo', salesChannel: 'direct' }
  })
  assert.equal(created.status, 201)
  const order = created.body[0]
  const path = `/api/orders/${order.dbId || order.id}/advance-stage`

  assert.equal((await request({ method: 'POST', path, token: session.accessToken, body: { status: 'Producao' } })).status, 200)
  const skipped = await request({ method: 'POST', path, token: session.accessToken, body: { status: 'Entregue' } })
  assert.equal(skipped.status, 400)
  assert.equal(skipped.body.error, 'O pedido deve avancar uma etapa por vez.')
  assert.equal((await request({ method: 'POST', path, token: session.accessToken, body: { status: 'Impresso' } })).status, 200)
  assert.equal((await request({ method: 'POST', path, token: session.accessToken, body: { status: 'Embalando' } })).status, 200)
  const missingTracking = await request({ method: 'POST', path, token: session.accessToken, body: { status: 'Enviado' } })
  assert.equal(missingTracking.status, 400)
  const sent = await request({ method: 'POST', path, token: session.accessToken, body: { status: 'Enviado', trackingCode: 'BR123456789' } })
  assert.equal(sent.status, 200)
  assert.equal(sent.body.order.trackingCode, 'BR123456789')
  assert.ok(sent.body.order.shippedAt)
})

test('cancelamento de pedido e permitido antes do envio e bloqueado depois', async () => {
  const session = await registerSession('cancelamento-pedido', '127.0.5.12')
  const created = await request({
    method: 'POST', path: '/api/orders', token: session.accessToken,
    body: { id: `PED-CANCEL-${Date.now()}`, product: 'Produto teste', qty: 1, status: 'Novo' }
  })
  const order = created.body[0]
  const path = `/api/orders/${order.dbId || order.id}/advance-stage`

  const cancelled = await request({ method: 'POST', path, token: session.accessToken, body: { status: 'Cancelado' } })
  assert.equal(cancelled.status, 200)
  assert.equal(cancelled.body.order.status, 'Cancelado')
  const cannotResume = await request({ method: 'POST', path, token: session.accessToken, body: { status: 'Producao' } })
  assert.equal(cannotResume.status, 400)

  const shippedCreate = await request({
    method: 'POST', path: '/api/orders', token: session.accessToken,
    body: { id: `PED-CANCEL-ENVIADO-${Date.now()}`, product: 'Produto teste', qty: 1, status: 'Novo' }
  })
  const shippedOrder = shippedCreate.body[0]
  const shippedPath = `/api/orders/${shippedOrder.dbId || shippedOrder.id}/advance-stage`
  for (const status of ['Producao', 'Impresso', 'Embalando']) {
    assert.equal((await request({ method: 'POST', path: shippedPath, token: session.accessToken, body: { status } })).status, 200)
  }
  assert.equal((await request({ method: 'POST', path: shippedPath, token: session.accessToken, body: { status: 'Enviado', trackingCode: 'BR123456789' } })).status, 200)
  const rejected = await request({ method: 'POST', path: shippedPath, token: session.accessToken, body: { status: 'Cancelado' } })
  assert.equal(rejected.status, 400)
})

test('resumo financeiro exclui vendas canceladas e conserva total cancelado', async () => {
  const session = await registerSession('resumo-venda-cancelada', '127.0.5.13')
  const active = await request({
    method: 'POST', path: '/api/orders', token: session.accessToken,
    body: { id: `PED-ATIVO-${Date.now()}`, product: 'Produto ativo', qty: 1, gross: 120, net: 110, profit: 40, status: 'Novo' }
  })
  assert.equal(active.status, 201)
  const cancelled = await request({
    method: 'POST', path: '/api/orders', token: session.accessToken,
    body: { id: `PED-CANCELADO-${Date.now()}`, product: 'Produto cancelado', qty: 1, gross: 75, net: 70, profit: 25, status: 'Novo' }
  })
  assert.equal(cancelled.status, 201)
  const cancelledOrder = cancelled.body.find((order) => order.id.startsWith('PED-CANCELADO-'))
  const cancelledPath = `/api/orders/${cancelledOrder.dbId || cancelledOrder.id}/advance-stage`
  assert.equal((await request({ method: 'POST', path: cancelledPath, token: session.accessToken, body: { status: 'Cancelado' } })).status, 200)

  const summary = await request({ method: 'GET', path: '/api/orders/summary', token: session.accessToken })
  assert.equal(summary.status, 200)
  assert.equal(summary.body.orderCount, 1)
  assert.equal(summary.body.gross, 120)
  assert.equal(summary.body.cancelledCount, 1)
  assert.equal(summary.body.cancelledGross, 75)
  assert.equal(summary.body.byStatus.find((item) => item.status === 'Cancelado').count, 1)
})

test('dashboard agregado exige autenticacao e retorna contrato resumido', async () => {
  const denied = await request({ method: 'GET', path: '/api/dashboard-summary' })
  assert.equal(denied.status, 401)

  const session = await registerSession('dashboard-summary', '127.0.5.14')
  const response = await request({ method: 'GET', path: '/api/dashboard-summary', token: session.accessToken })
  assert.equal(response.status, 200)
  assert.equal(typeof response.body.totals.revenue, 'number')
  assert.equal(response.body.monthlyRevenue.length, 12)
  assert.equal(response.body.monthlyExpenses.length, 12)
  assert.equal(response.body.monthlyOrders.length, 12)
  assert.ok(Array.isArray(response.body.productPerformance))
  assert.ok(Array.isArray(response.body.queuePrinters))
  assert.equal(response.body.orders, undefined)
  assert.equal(response.body.expenses, undefined)
  assert.equal(response.body.printJobs, undefined)
})

test('relatorio agregado exige autenticacao e explicita a dependencia de banco real', async () => {
  const denied = await request({ method: 'GET', path: '/api/reports/summary?from=2026-01-01&to=2026-12-31' })
  assert.equal(denied.status, 401)

  const session = await registerSession('report-summary', '127.0.5.16')
  const response = await request({ method: 'GET', path: '/api/reports/summary?from=2026-01-01&to=2026-12-31', token: session.accessToken })
  assert.equal(response.status, 501)
  assert.match(response.body.error, /banco de dados/i)
})

test('edicao generica nao permite pular a etapa operacional do pedido', async () => {
  const session = await registerSession('edicao-etapa-pedido', '127.0.5.15')
  const created = await request({
    method: 'POST', path: '/api/orders', token: session.accessToken,
    body: { id: `PED-EDICAO-${Date.now()}`, product: 'Produto teste', qty: 1, status: 'Novo' }
  })
  assert.equal(created.status, 201)
  const order = created.body[0]
  const response = await request({
    method: 'PUT', path: `/api/orders/${order.dbId || order.id}`, token: session.accessToken,
    body: { ...order, status: 'Entregue' }
  })
  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'Altere a etapa do pedido pelo acompanhamento operacional.')
})

test('saude operacional retorna somente contagens para perfis de producao', async () => {
  const session = await registerSession('saude-operacional', '127.0.5.20')
  const response = await request({ method: 'GET', path: '/api/operational-health', token: session.accessToken })

  assert.equal(response.status, 200)
  assert.equal(typeof response.body.activePrints, 'number')
  assert.equal(typeof response.body.pendingAlerts, 'number')
  assert.ok(response.body.checkedAt)
  assert.equal(response.body.lastError, undefined)
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
      company: 'Tenant da Plataforma',
      document: '52998224725'
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
