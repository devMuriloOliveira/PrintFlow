import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

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
