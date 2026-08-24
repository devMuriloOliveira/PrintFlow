import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.env.PRINTFLOW_AGENT_DATA_DIR =
  await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      'printflow-agent-credentials-test-'
    )
  )

const {
  getPrinterCredentialKey,
  loadPrinterCredentials,
  savePrinterCredentials
} = await import(
  '../src/storage/printerCredentials.js'
)

test('gera chave estavel com porta padrao para impressora de rede', () => {
  const key =
    getPrinterCredentialKey({
      protocol:
        'octoprint',
      ip:
        '192.168.1.40'
    })

  assert.equal(
    key,
    'octoprint:192.168.1.40:80'
  )
})

test('salva e carrega credenciais sem texto puro no arquivo', async () => {
  const printer = {
    protocol:
      'prusalink',
    ip:
      '192.168.1.60'
  }

  await savePrinterCredentials(
    printer,
    {
      username:
        'maker',
      password:
        'senha-local-teste'
    }
  )

  const loaded =
    await loadPrinterCredentials(
      printer
    )

  assert.deepEqual(
    loaded,
    {
      username:
        'maker',
      password:
        'senha-local-teste'
    }
  )

  const fileContent =
    await fs.readFile(
      path.join(
        process.env.PRINTFLOW_AGENT_DATA_DIR,
        'printer-credentials.json'
      ),
      'utf8'
    )

  assert.equal(
    fileContent.includes(
      'senha-local-teste'
    ),
    false
  )
})
