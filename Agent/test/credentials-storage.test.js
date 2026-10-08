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
  resolveNativeDpapiHost,
  saveCredentials,
  savePendingPairingCode
} = await import(
  '../src/storage/credentials.js'
)

test('resolver DPAPI usa host C# configurado e conserva alias legado', async () => {
  const filaHost = path.join(tempDir, 'fila-agent-host.exe')
  const legacyHost = path.join(tempDir, 'printflow-agent-host.exe')
  await fs.writeFile(filaHost, 'fixture')
  await fs.writeFile(legacyHost, 'fixture')
  const previousFilaHost = process.env.FILA_AGENT_HOST_PATH
  const previousLegacyHost = process.env.PRINTFLOW_AGENT_HOST_PATH
  try {
    process.env.FILA_AGENT_HOST_PATH = filaHost
    process.env.PRINTFLOW_AGENT_HOST_PATH = legacyHost
    assert.equal(resolveNativeDpapiHost(), filaHost)
    process.env.FILA_AGENT_HOST_PATH = path.join(tempDir, 'missing-host.exe')
    assert.equal(resolveNativeDpapiHost(), legacyHost)
  } finally {
    if (previousFilaHost === undefined) delete process.env.FILA_AGENT_HOST_PATH
    else process.env.FILA_AGENT_HOST_PATH = previousFilaHost
    if (previousLegacyHost === undefined) delete process.env.PRINTFLOW_AGENT_HOST_PATH
    else process.env.PRINTFLOW_AGENT_HOST_PATH = previousLegacyHost
  }
})

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

  const storedContent =
    await fs.readFile(
      path.join(
        tempDir,
        'agent.json'
      ),
      'utf8'
    )

  if (process.platform === 'win32') {
    assert.equal(
      storedContent.includes('secret-1'),
      false
    )
    assert.match(
      storedContent,
      /windows-dpapi/
    )
  }

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

  const pendingContent = await fs.readFile(
    path.join(tempDir, 'pending-pairing.json'),
    'utf8'
  )
  if (process.platform === 'win32') {
    assert.equal(pendingContent.includes('AB12CD'), false)
    assert.match(pendingContent, /windows-dpapi/)
  }

  assert.equal(
    await consumePendingPairingCode(),
    'AB12CD'
  )

  assert.equal(
    await consumePendingPairingCode(),
    ''
  )
})

test('descarta codigo de pareamento local expirado', async () => {
  await fs.writeFile(
    path.join(tempDir, 'pending-pairing.json'),
    JSON.stringify({
      code: 'STALE1',
      createdAt: new Date(Date.now() - 11 * 60 * 1000).toISOString()
    }),
    'utf8'
  )

  assert.equal(await consumePendingPairingCode(), '')
})
