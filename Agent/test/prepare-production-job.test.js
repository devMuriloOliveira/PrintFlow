import test from 'node:test'
import assert from 'node:assert/strict'

import { prepareProductionJobSlicing } from '../src/slicing/prepareProductionJob.js'

test('prepara 3MF, envia G-code e nunca inicia a impressora', async () => {
  const calls = { pin: 0, unpin: 0, upload: 0 }
  const result = await prepareProductionJobSlicing({
    job: { id: '88', printFile: { format: '3mf', storageKey: 'tenant/product/source.3mf' } },
    printer: { manufacturer: 'Bambu Lab', model: 'P1S' },
    apiUrl: 'https://api.example.test',
    credentials: { agentId: 'agent-1', agentSecret: 'secret' },
    executablePath: 'C:/Orca/orca-slicer.exe',
    fileManager: {
      ensureCached: async () => ({ localPath: 'C:/cache/source.3mf' }),
      pin: async () => { calls.pin += 1 },
      unpin: async () => { calls.unpin += 1 }
    },
    slice: async () => ({
      profile: { id: 'bambu-p1s-pla-basic', version: '2.4.2' },
      artifact: { outputPath: 'C:/tmp/job.gcode', sha256: 'a'.repeat(64), sizeBytes: 123 },
      metrics: { estimatedPrintSeconds: 60, estimatedFilamentGrams: 2 }
    }),
    upload: async (_url, _credentials, jobId, payload) => {
      calls.upload += 1
      assert.equal(jobId, '88')
      assert.equal(payload.idempotencyKey, `slice-88-${'a'.repeat(64)}`)
      return { artifact: { hash: payload.artifact.sha256 } }
    }
  })
  assert.equal(result.success, true)
  assert.equal(calls.pin, 1)
  assert.equal(calls.unpin, 1)
  assert.equal(calls.upload, 1)
})

test('recusa fonte que nao seja 3MF', async () => {
  await assert.rejects(
    prepareProductionJobSlicing({ job: { id: '1', printFile: { format: 'gcode', storageKey: 'x' } } }),
    /3MF/
  )
})
