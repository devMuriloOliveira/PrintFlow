import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decryptPrinterConnectionOptions,
  encryptPrinterConnectionOptions,
  redactCommandSecrets,
  stripPrinterConnectionSecrets,
  validatePrinterConnectionRequest
} from '../src/services/agentPrinterConnectionSecurity.js'

const encryptionKey = 'test-only-command-encryption-key'

test('aceita somente destinos IPv4 privados e portas suportadas por protocolo', () => {
  const accepted = validatePrinterConnectionRequest({
    printer: { protocol: 'prusalink', connectionType: 'network', ip: '192.168.1.40', port: 5000 },
    options: { username: 'maker', password: 'secret' }
  })
  assert.equal(accepted.printer.ip, '192.168.1.40')
  assert.equal(accepted.printer.port, 5000)

  for (const ip of ['127.0.0.1', '8.8.8.8', 'printer.local', 'http://192.168.1.2', '169.254.169.254']) {
    assert.throws(() => validatePrinterConnectionRequest({
      printer: { protocol: 'octoprint', connectionType: 'network', ip, port: 80 }, options: { apiKey: 'secret' }
    }), /IPv4 privado/)
  }
  assert.equal(validatePrinterConnectionRequest({
    printer: { protocol: 'moonraker', connectionType: 'network', ip: '169.254.1.2' }, options: {}
  }).printer.ip, '169.254.1.2')
  assert.equal(validatePrinterConnectionRequest({
    printer: { protocol: 'moonraker', connectionType: 'network', ip: '100.64.20.1' }, options: {}
  }).printer.ip, '100.64.20.1')

  for (const port of [0, -1, 65536, 80.5, '80', 8883]) {
    assert.throws(() => validatePrinterConnectionRequest({
      printer: { protocol: 'octoprint', connectionType: 'network', ip: '10.1.2.3', port }, options: { apiKey: 'secret' }
    }), /Porta|porta/)
  }
})

test('valida credenciais obrigatórias e descarta opções não permitidas', () => {
  assert.throws(() => validatePrinterConnectionRequest({
    printer: { protocol: 'octoprint', connectionType: 'network', ip: '10.1.2.3', port: 80 }, options: {}
  }), /API Key/)

  const normalized = validatePrinterConnectionRequest({
    printer: { protocol: 'octoprint', connectionType: 'network', ip: '10.1.2.3', port: 80, token: 'not-a-secret' },
    options: { apiKey: 'octo-key', password: 'unexpected', extra: 'discard' }
  })
  assert.deepEqual(normalized.options, { apiKey: 'octo-key' })
  assert.equal('token' in normalized.printer, false)
})

test('protege credenciais no payload, entrega em memória e vincula ciphertext ao tenant e Agent', () => {
  const { printer, options } = validatePrinterConnectionRequest({
    printer: { protocol: 'prusalink', connectionType: 'network', ip: '10.2.3.4', port: 80 },
    options: { username: 'maker', password: 'printer-password' }
  })
  const encryptedOptions = encryptPrinterConnectionOptions({
    tenantId: 'tenant-a', agentId: 'agent-a', protocol: printer.protocol, options, key: encryptionKey
  })
  const stored = { printer, options: encryptedOptions }

  assert.equal(stored.options.username.protected, true)
  assert.equal(stored.options.password.protected, true)
  assert.equal(JSON.stringify(stored).includes('printer-password'), false)
  assert.deepEqual(decryptPrinterConnectionOptions({
    tenantId: 'tenant-a', agentId: 'agent-a', protocol: printer.protocol, options: stored.options, key: encryptionKey
  }).optionsForAgent, { username: 'maker', password: 'printer-password' })
  assert.throws(() => decryptPrinterConnectionOptions({
    tenantId: 'tenant-b', agentId: 'agent-a', protocol: printer.protocol, options: stored.options, key: encryptionKey
  }))
})

test('redige segredos inclusive em payload legado e remove-os do payload terminal', () => {
  const payload = {
    printer: { protocol: 'octoprint', ip: '10.0.0.2' },
    options: { apiKey: 'legacy-api-key', username: 'legacy-user', password: 'legacy-password' }
  }
  const redacted = redactCommandSecrets(payload)
  assert.equal(redacted.options.apiKey, '[PROTECTED]')
  assert.equal(redacted.options.username, '[PROTECTED]')
  assert.equal(redacted.options.password, '[PROTECTED]')
  assert.equal(JSON.stringify(redacted).includes('legacy-password'), false)
  assert.deepEqual(stripPrinterConnectionSecrets(payload), {
    printer: { protocol: 'octoprint', ip: '10.0.0.2' }, options: {}
  })
  assert.equal(payload.options.password, 'legacy-password')
})

test('cifra credenciais legadas em texto ao reivindicar comando pendente', () => {
  const result = decryptPrinterConnectionOptions({
    tenantId: 'tenant-a', agentId: 'agent-a', protocol: 'octoprint',
    options: { apiKey: 'legacy-api-key' }, key: encryptionKey
  })
  assert.deepEqual(result.optionsForAgent, { apiKey: 'legacy-api-key' })
  assert.equal(result.optionsForStorage.apiKey.protected, true)
  assert.equal(JSON.stringify(result.optionsForStorage).includes('legacy-api-key'), false)
})
