import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeSlicingArtifact, recordProductionJobSlicingArtifact } from '../src/services/productionJobSlicing.js'

const payload = {
  idempotencyKey: 'slice-job-88-v1',
  profileId: 'bambu-p1s-0.4',
  profileVersion: '2.4.2',
  estimatedPrintSeconds: 3600,
  estimatedFilamentGrams: 22.5,
  artifact: {
    name: 'job-88.gcode',
    storageKey: 'tenant-a/job-88/hash.gcode',
    hash: 'a'.repeat(64),
    format: 'gcode',
    sizeBytes: 1234
  }
}

test('artefato de slicing exige G-code, hash e perfil versionado', () => {
  const normalized = normalizeSlicingArtifact(payload)
  assert.equal(normalized.artifact.format, 'gcode')
  assert.equal(normalized.estimatedFilamentGrams, 22.5)
  assert.throws(() => normalizeSlicingArtifact({ ...payload, artifact: { ...payload.artifact, format: '3mf' } }), /Artefato/)
  assert.throws(() => normalizeSlicingArtifact({ ...payload, profileVersion: '' }), /Perfil/)
})

test('slicing do Agent vincula um unico artefato ao Production Job', async () => {
  const state = { artifact: null, updates: 0 }
  const client = {
    async query(sql, params) {
      if (sql.includes('from print_jobs j')) {
        return { rowCount: 1, rows: [{ id: 88, status: 'queued', slicing_artifact_sha256: state.artifact?.hash || null, slicing_artifact_storage_key: state.artifact?.storageKey || null }] }
      }
      if (sql.includes('update print_jobs')) {
        state.updates += 1
        state.artifact = { hash: params[7], storageKey: params[4] }
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`SQL inesperado: ${sql}`)
    }
  }

  const first = await recordProductionJobSlicingArtifact({ client, tenantId: 'tenant-a', agentId: 7, printJobId: 88, payload })
  const retry = await recordProductionJobSlicingArtifact({ client, tenantId: 'tenant-a', agentId: 7, printJobId: 88, payload })
  assert.equal(first.idempotent, false)
  assert.equal(retry.idempotent, true)
  assert.equal(state.updates, 1)
})
