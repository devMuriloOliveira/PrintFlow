import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { verifyReleaseDirectory } from '../src/updates/releaseVerifier.js'

const digest = (value) => createHash('sha256').update(value).digest('hex').toUpperCase()

test('valida release por manifesto, certificado e SHA-256', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'printflow-release-verifier-'))
  const certificate = Buffer.from('fixture certificate')
  const zip = Buffer.from('fixture package')
  await writeFile(path.join(directory, 'PrintFlow-Agent-Dev-Certificate.cer'), certificate)
  await writeFile(path.join(directory, 'PrintFlow-Agent-Windows.zip'), zip)
  await writeFile(path.join(directory, 'RELEASE-METADATA.json'), JSON.stringify({ version: '0.1.0', signingMode: 'DEV_SELF_SIGNED', productionTrusted: false, certificateSha256: digest(certificate) }))
  await writeFile(path.join(directory, 'SHA256SUMS.txt'), `${digest(zip)}  PrintFlow-Agent-Windows.zip\n${digest(certificate)}  PrintFlow-Agent-Dev-Certificate.cer\n`)
  const result = await verifyReleaseDirectory({ directory, expectedVersion: '0.1.0' })
  assert.equal(result.entries.length, 2)
  await writeFile(path.join(directory, 'PrintFlow-Agent-Windows.zip'), Buffer.from('tampered'))
  await assert.rejects(verifyReleaseDirectory({ directory }), /Hash divergente/)
  await rm(directory, { recursive: true, force: true })
})
