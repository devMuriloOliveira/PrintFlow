import test from 'node:test'
import { backupStatus, formatTenantDataCsv, normalizedSettings, selectTenantExportResources } from '../src/routes/settings.js'
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

test('status de backup nao expoe dados ou credenciais', () => {
  const status = backupStatus()
  assert.equal(status.restore.enabled, false)
  assert.equal(status.export.format, 'csv')
  assert.deepEqual(status.export.excludes, ['tokens de integracoes', 'credenciais', 'sessoes de autenticacao'])
})

test('personalizacao aceita somente cor hexadecimal e URL HTTPS', () => {
  const settings = normalizedSettings({ preferences: {
    brandName: '  Oficina 3D  ', accentColor: '#C04A2A', logoUrl: 'https://cdn.example.com/logo.png'
  } })
  assert.equal(settings.preferences.brandName, 'Oficina 3D')
  assert.equal(settings.preferences.accentColor, '#c04a2a')
  assert.equal(settings.preferences.logoUrl, 'https://cdn.example.com/logo.png')

  const invalid = normalizedSettings({ preferences: { accentColor: 'blue', logoUrl: 'http://example.com/logo.png' } })
  assert.equal(invalid.preferences.accentColor, '#1768f2')
  assert.equal(invalid.preferences.logoUrl, '')
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
