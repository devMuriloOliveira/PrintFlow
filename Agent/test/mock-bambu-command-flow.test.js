import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import axios from 'axios'

process.env.PRINTFLOW_DEV_MOCK_BAMBU =
  'true'

process.env.PRINTFLOW_AGENT_DATA_DIR =
  await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      'printflow-agent-test-'
    )
  )

const { handleCommand } =
  await import(
    '../src/commands/commandHandler.js'
  )

const printer = {
  protocol:
    'bambu',

  connectionType:
    'network',

  name:
    'Bambu Lab - Ambiente de Teste',

  manufacturer:
    'Bambu Lab',

  software:
    'Bambu Lab',

  ip:
    '192.168.2.250',

  port:
    8883,

  serial:
    'PFMOCKBAMBU001',

  mock:
    true
}

const command = (
  type,
  payload = {}
) => ({
  id:
    `test-${type}-${Date.now()}`,

  type,

  payload
})

test(
  'mock Bambu executa ciclo de comandos sem impressora fisica',
  async () => {
    const connected =
      await handleCommand(
        command(
          'connect_printer',
          {
            printer,
            options:
              {
                accessCode:
                  'mock-access-code'
              }
          }
        )
      )

    assert.equal(
      connected.success,
      true
    )

    assert.equal(
      connected.connection.connected,
      true
    )

    assert.equal(
      connected.connection.key,
      'bambu:PFMOCKBAMBU001'
    )

    assert.equal(
      connected.connection.capabilities.status,
      true
    )

    const initialStatus =
      await handleCommand(
        command(
          'printer_status',
          {
            printer
          }
        )
      )

    assert.equal(
      initialStatus.success,
      true
    )

    assert.equal(
      initialStatus.status.state,
      'RUNNING'
    )

    const started =
      await handleCommand(
        command(
          'start_print',
          {
            printer,
            job: {
              id:
                'job-1',

              title:
                'Produto de teste',

              quantity:
                1,

              validationStatus:
                'validated',

              printFile: {
                name:
                  'produto-teste.3mf',

                format:
                  '3mf',

                hash:
                  'mock-sha256'
              }
            }
          }
        )
      )

    assert.equal(
      started.success,
      true
    )

    assert.equal(
      started.result.job.id,
      'job-1'
    )

    const paused =
      await handleCommand(
        command(
          'printer_pause',
          {
            printer
          }
        )
      )

    assert.equal(
      paused.success,
      true
    )

    const pausedStatus =
      await handleCommand(
        command(
          'printer_status',
          {
            printer
          }
        )
      )

    assert.equal(
      pausedStatus.status.state,
      'PAUSE'
    )

    const resumed =
      await handleCommand(
        command(
          'printer_resume',
          {
            printer
          }
        )
      )

    assert.equal(
      resumed.success,
      true
    )

    const cancelled =
      await handleCommand(
        command(
          'printer_cancel',
          {
            printer
          }
        )
      )

    assert.equal(
      cancelled.success,
      true
    )

    const cancelledStatus =
      await handleCommand(
        command(
          'printer_status',
          {
            printer
          }
        )
      )

    assert.equal(
      cancelledStatus.status.state,
      'CANCELLED'
    )

    const disconnected =
      await handleCommand(
        command(
          'disconnect_printer',
          {
            printer
          }
        )
      )

    assert.equal(
      disconnected.success,
      true
    )

    assert.equal(
      disconnected.result.disconnected,
      true
    )

    const reconnectedStatus =
      await handleCommand(
        command(
          'printer_status',
          {
            printer
          }
        )
      )

    assert.equal(
      reconnectedStatus.success,
      true
    )

    assert.equal(
      reconnectedStatus.status.state,
      'RUNNING'
    )
  }
)

test(
  'mock local baixa arquivo, valida hash e inicia impressao pelo Agent',
  async () => {
    const fileContent =
      Buffer.from(
        'PRINTFLOW_MOCK_3MF_FILE_CONTENT',
        'utf8'
      )

    const fileHash =
      crypto
        .createHash(
          'sha256'
        )
        .update(
          fileContent
        )
        .digest(
          'hex'
        )

    const originalGet =
      axios.get

    const requests =
      []

    axios.get =
      async (
        url,
        options
      ) => {
        requests.push({
          url,
          options
        })

        return {
          data:
            Readable.from([
              fileContent
            ])
        }
      }

    try {
      const result =
        await handleCommand(
          command(
            'start_print',
            {
              printer,
              job: {
                id:
                  'job-file-flow-1',

                title:
                  'Produto mock com arquivo',

                quantity:
                  1,

                validationStatus:
                  'validated',

                printFile: {
                  name:
                    'produto-mock.3mf',

                  format:
                    '3mf',

                  hash:
                    fileHash,

                  sizeBytes:
                    fileContent.length,

                  storageKey:
                    'mock/tenant/produto-mock.3mf'
                }
              }
            }
          ),
          {
            apiUrl:
              'http://printflow-api.test',

            credentials: {
              agentId:
                'agent-mock-id',

              agentSecret:
                'agent-mock-secret'
            }
          }
        )

      assert.equal(
        result.success,
        true
      )

      assert.equal(
        result.result.job.id,
        'job-file-flow-1'
      )

      assert.equal(
        result.result.job.printFile.hash,
        fileHash
      )

      assert.equal(
        await fs.readFile(
          result.result.job.printFile.localPath,
          'utf8'
        ),
        fileContent.toString(
          'utf8'
        )
      )

      assert.equal(
        requests.length,
        1
      )

      assert.equal(
        requests[0].url,
        'http://printflow-api.test/api/agents/print-file?key=mock%2Ftenant%2Fproduto-mock.3mf'
      )

      assert.equal(
        requests[0].options.headers['x-agent-id'],
        'agent-mock-id'
      )
    } finally {
      axios.get =
        originalGet
    }
  }
)

test(
  'mock local bloqueia impressao quando hash do arquivo nao confere',
  async () => {
    const originalGet =
      axios.get

    axios.get =
      async () => ({
        data:
          Readable.from([
            Buffer.from(
              'CONTEUDO_DIFERENTE_DO_PRODUTO',
              'utf8'
            )
          ])
      })

    try {
      const result =
        await handleCommand(
          command(
            'start_print',
            {
              printer,
              job: {
                id:
                  'job-file-flow-invalid',

                title:
                  'Produto mock invalido',

                quantity:
                  1,

                validationStatus:
                  'validated',

                printFile: {
                  name:
                    'produto-mock.3mf',

                  format:
                    '3mf',

                  hash:
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',

                  sizeBytes:
                    29,

                  storageKey:
                    'mock/tenant/produto-mock.3mf'
                }
              }
            }
          ),
          {
            apiUrl:
              'http://printflow-api.test',

            credentials: {
              agentId:
                'agent-mock-id',

              agentSecret:
                'agent-mock-secret'
            }
          }
        )

      assert.equal(
        result.success,
        false
      )

      assert.match(
        result.error,
        /Hash do arquivo baixado nao confere/
      )
    } finally {
      axios.get =
        originalGet
    }
  }
)
