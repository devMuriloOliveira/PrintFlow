import test from 'node:test'
import { backupStatus, formatTenantDataCsv, normalizedSettings, registeredCompanyDocumentLockedError, registeredCompanyNameLockedError, selectTenantExportResources, validateRegisteredCompanyDocument, validateRegisteredCompanyName } from '../src/routes/settings.js'
import assert from 'node:assert/strict'
import { canAccessRequest, requiredPermissionForRequest } from '../src/auth/authorization.js'

test('exportacao de configuracoes usa a permissao settings.manage', () => {
  assert.equal(requiredPermissionForRequest('GET', '/api/settings/export'), 'settings.manage')
  assert.equal(requiredPermissionForRequest('GET', '/api/settings/backup-status'), 'settings.manage')
  assert.equal(requiredPermissionForRequest('GET', '/api/settings/company-lookup'), 'settings.manage')
  assert.equal(canAccessRequest({ role: 'owner' }, 'GET', '/api/settings/backup-status'), true)
  assert.equal(canAccessRequest({ role: 'admin' }, 'GET', '/api/settings/export'), true)
  assert.equal(canAccessRequest({ role: 'financeiro' }, 'GET', '/api/settings/export'), false)
})

test('suporte fica disponivel para todos os perfis sem liberar configuracoes', () => {
  for (const role of ['owner', 'admin', 'financeiro', 'producao', 'usuario']) {
    assert.equal(requiredPermissionForRequest('POST', '/api/support/requests'), 'support.use')
    assert.equal(canAccessRequest({ role }, 'POST', '/api/support/requests'), true)
    assert.equal(canAccessRequest({ role }, 'GET', '/api/support/requests/protocolo/messages'), true)
  }
  assert.equal(canAccessRequest({ role: 'usuario' }, 'GET', '/api/settings/backup-status'), false)
})

test('status de backup reconhece sucesso real e nao expoe dados ou credenciais', () => {
  const status = backupStatus([
    { status: 'failed', started_at: '2026-10-02T12:00:00.000Z', completed_at: '2026-10-02T12:01:00.000Z', error_message: 'segredo nao deve ser exposto' },
    { status: 'success', started_at: '2026-10-01T12:00:00.000Z', completed_at: '2026-10-01T12:02:00.000Z' },
    { status: 'completed', started_at: '2026-09-30T12:00:00.000Z', completed_at: '2026-09-30T12:02:00.000Z' }
  ])
  assert.equal(status.restore.enabled, false)
  assert.equal(status.export.format, 'csv')
  assert.deepEqual(status.export.excludes, ['tokens de integracoes', 'credenciais', 'sessoes de autenticacao'])
  assert.equal(status.operational.lastCompletedAt, '2026-10-01T12:02:00.000Z')
  assert.equal(status.operational.lastStatus, 'failed')
  assert.equal(status.operational.history.length, 3)
  assert.equal(status.operational.history[0].status, 'failed')
  assert.equal('error_message' in status.operational.history[0], false)
})

test('nome de empresa informado no cadastro nao pode ser alterado diretamente', () => {
  assert.doesNotThrow(() => validateRegisteredCompanyName({ incomingName: ' Oficina 3D ', registeredName: 'Oficina 3D', locked: true }))
  assert.throws(() => validateRegisteredCompanyName({ incomingName: 'Nova Oficina', registeredName: 'Oficina 3D', locked: true }), { message: registeredCompanyNameLockedError })
  assert.doesNotThrow(() => validateRegisteredCompanyName({ incomingName: 'Nova Oficina', registeredName: 'Oficina 3D', locked: false }))
})

test('documento registrado so pode ser alterado por solicitacao ao suporte', () => {
  const registered = { hash: 'registered-document-hash' }
  assert.doesNotThrow(() => validateRegisteredCompanyDocument({ hash: registered.hash }, registered))
  assert.throws(() => validateRegisteredCompanyDocument({ hash: 'other-document-hash' }, registered), { message: registeredCompanyDocumentLockedError })
  assert.throws(() => validateRegisteredCompanyDocument(null, registered), { message: registeredCompanyDocumentLockedError })
})

test('personalizacao aceita somente cor hexadecimal e URL HTTPS', () => {
  const settings = normalizedSettings({ preferences: {
    brandName: '  Oficina 3D  ', accentColor: '#C04A2A', logoUrl: 'https://cdn.example.com/logo.png', onboardingPrinterMode: 'manual'
  } })
  assert.equal(settings.preferences.brandName, 'Oficina 3D')
  assert.equal(settings.preferences.accentColor, '#c04a2a')
  assert.equal(settings.preferences.logoUrl, 'https://cdn.example.com/logo.png')
  assert.equal(settings.preferences.onboardingPrinterMode, 'manual')

  const invalid = normalizedSettings({ preferences: { accentColor: 'blue', logoUrl: 'http://example.com/logo.png' } })
  assert.equal(invalid.preferences.accentColor, '#1768f2')
  assert.equal(invalid.preferences.logoUrl, '')
  assert.equal(invalid.preferences.onboardingPrinterMode, '')
})

test('portabilidade organiza todos os dados em CSV sem perder campos aninhados', () => {
  const csv = formatTenantDataCsv({ settings: { name: 'Oficina; 3D' }, orders: [{ id: 'order-1', totals: { net: 42 } }] })
  assert.match(csv, /Colecao.*Registro.*Campo.*Valor/)
  assert.match(csv, /settings.*name.*Oficina; 3D/)
  assert.match(csv, /orders.*totals.*\{\"\"net\"\":42\}/)
})

test('exportacao selecionada aceita somente grupos previstos e retorna CSV', () => {
  const selected = selectTenantExportResources('company,customers,desconhecido')
  assert.deepEqual(selected.groups, ['company', 'customers'])
  assert.deepEqual([...selected.resources].sort(), ['clients', 'orders', 'settings'])
  assert.equal(backupStatus().export.format, 'csv')
})
