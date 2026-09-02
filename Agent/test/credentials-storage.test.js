import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const tempDir =
  await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      'printflow-agent-credentials-'
    )
  )

process.env.PRINTFLOW_AGENT_DATA_DIR =
  tempDir

const {
  clearCredentials,
  consumePendingPairingCode,
  getAgentDataDirectory,
  loadCredentials,
  saveCredentials,
  savePendingPairingCode
} = await import(
  '../src/storage/credentials.js'
)

test('credenciais do Agent usam diretorio local configuravel', async () => {
  assert.equal(
    getAgentDataDirectory(),
    tempDir
  )

  await saveCredentials({
    agentId:
      'agent-1',
    agentSecret:
      'secret-1',
    tenantId:
      'tenant-a',
    tenantName:
      'Empresa A',
    machineName:
      'pc-a'
  })

  assert.deepEqual(
    await loadCredentials(),
    {
      agentId:
        'agent-1',
      agentSecret:
        'secret-1',
      tenantId:
        'tenant-a',
      tenantName:
        'Empresa A',
      machineName:
        'pc-a'
    }
  )

  await clearCredentials()

  assert.equal(
    await loadCredentials(),
    null
  )
})

test('codigo de pareamento pendente e consumido uma unica vez', async () => {
  await savePendingPairingCode(
    'ab12cd'
  )

  assert.equal(
    await consumePendingPairingCode(),
    'AB12CD'
  )

  assert.equal(
    await consumePendingPairingCode(),
    ''
  )
})
