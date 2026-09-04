import test from 'node:test'
import { backupStatus, normalizedSettings } from '../src/routes/settings.js'
import assert from 'node:assert/strict'
import { canAccessRequest, requiredPermissionForRequest } from '../src/auth/authorization.js'

test('exportacao de configuracoes usa a permissao settings.manage', () => {
  assert.equal(requiredPermissionForRequest('GET', '/api/settings/export'), 'settings.manage')
  assert.equal(requiredPermissionForRequest('GET', '/api/settings/backup-status'), 'settings.manage')
  assert.equal(canAccessRequest({ role: 'owner' }, 'GET', '/api/settings/backup-status'), true)
  assert.equal(canAccessRequest({ role: 'admin' }, 'GET', '/api/settings/export'), true)
  assert.equal(canAccessRequest({ role: 'financeiro' }, 'GET', '/api/settings/export'), false)
})

test('status de backup nao expoe dados ou credenciais', () => {
  const status = backupStatus()
  assert.equal(status.restore.enabled, false)
  assert.equal(status.export.format, 'json')
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
