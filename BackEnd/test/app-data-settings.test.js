import test from 'node:test'
import assert from 'node:assert/strict'
import { mapSettingsRow } from '../src/repositories/appDataRepository.js'

test('configuracoes usam identidade do cadastro antes do primeiro salvamento', () => {
  const settings = mapSettingsRow({
    name: 'Studio Maker',
    document: '12345678901',
    email: 'pessoa@example.com',
    document_locked_at: new Date('2026-10-02T00:00:00.000Z'),
    document_type: 'cpf'
  })

  assert.equal(settings.name, 'Studio Maker')
  assert.equal(settings.document, '12345678901')
  assert.equal(settings.email, 'pessoa@example.com')
  assert.equal(settings.nameLocked, true)
  assert.equal(settings.documentLocked, true)
  assert.equal(settings.phone, '')
  assert.deepEqual(settings.preferences, {})
})

test('configuracoes continuam ausentes quando a empresa nao existe', () => {
  assert.equal(mapSettingsRow(undefined), null)
})
