import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createSupportBundle, writeSupportBundle } from '../src/runtime/supportBundle.js'

test('pacote de suporte remove credenciais e identificadores privados', () => {
  const bundle = JSON.parse(createSupportBundle({
    agent: { version: '0.1.21', token: 'secret-token' },
    network: { address: '192.168.1.2' },
    printer: { serial: 'SERIAL-1234', state: 'offline', key: 'bambu:SERIAL-1234', pnpDeviceId: 'USB\\VID_1234' },
    outbox: { eventId: 123, payload: { serial: 'SERIAL-1234', secret: 'nested-secret' }, lastError: 'https://user:password@printer.local' },
    backend: { connected: true, secret: 'secret' }
  }))

  assert.equal(bundle.format, 'printflow-agent-support-v1')
  assert.deepEqual(bundle.diagnostics, {
    agent: { version: '0.1.21' },
    network: { address: '[redacted]' },
    printer: { serial: '[redacted]', state: 'offline', key: '[redacted]', pnpDeviceId: '[redacted]' },
    outbox: { eventId: '[redacted]' },
    backend: { connected: true }
  })

  assert.doesNotMatch(JSON.stringify(bundle), /SERIAL-1234|nested-secret|user:password|printer\.local/)
})

test('pacote grava somente arquivo novo e valida extensao', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'printflow-support-bundle-'))
  const outputPath = path.join(directory, 'support.json')
  try {
    const result = await writeSupportBundle(outputPath, { ok: true })
    assert.equal(result.path, outputPath)
    assert.equal(JSON.parse(await fs.readFile(outputPath, 'utf8')).diagnostics.ok, true)
    await assert.rejects(writeSupportBundle(outputPath, { changed: true }), /EEXIST/)
    await assert.rejects(writeSupportBundle(path.join(directory, 'support.txt'), { ok: true }), /\.json/)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
