import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { createLocalObjectStorageProvider } from '../src/services/localObjectStorageProvider.js'

test('provider local grava, lê, inspeciona e remove objetos sem escapar do root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'printflow-r2-local-'))
  try {
    const provider = createLocalObjectStorageProvider({ root })
    const result = await provider.put({
      key: 'tenant-a/products/piece.gcode',
      body: Readable.from(['G1 X1\n']),
      contentType: 'text/plain'
    })

    assert.equal(result.sizeBytes, 6)
    assert.equal((await provider.head('tenant-a/products/piece.gcode')).sizeBytes, 6)
    const stored = await provider.get('tenant-a/products/piece.gcode')
    const chunks = []
    for await (const chunk of stored.body) chunks.push(chunk)
    assert.equal(Buffer.concat(chunks).toString(), 'G1 X1\n')

    await provider.delete('tenant-a/products/piece.gcode')
    await assert.rejects(() => provider.head('tenant-a/products/piece.gcode'), { code: 'ENOENT' })
    await assert.rejects(() => provider.put({ key: '../outside', body: 'x' }), /invalida/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
