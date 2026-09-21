import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import {
  executeAgentCommand,
  flushPendingCommandCompletions,
  flushPendingEvents,
  flushPendingProductionMetrics
} from '../src/commands/commandExecution.js'

import {
  createLocalOperationsDb
} from '../src/storage/localOperationsDb.js'

const createStore = async () => {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'printflow-agent-operations-'
      )
    )

  return {
    directory,
    operations:
      createLocalOperationsDb({
        databasePath:
          path.join(
            directory,
            'agent-operations.sqlite'
          )
})

  }
}

test(
  'persiste resultado e impede executar novamente o mesmo command_id',
  async () => {
    const {
      directory,
      operations
    } = await createStore()

    const command = {
      id: 'command-idempotente-1',
      type: 'start_print'
    }

    let executions = 0

    const execute = async () => {
      executions += 1
      return {
        success: true,
        printStarted: true
      }
    }

    const first =
      await executeAgentCommand({
        command,
        operations,
        execute
      })

    const second =
      await executeAgentCommand({
        command,
        operations,
        execute
      })

    assert.equal(
      executions,
      1
    )
    assert.deepEqual(
      second,
      first
    )

    operations.close()

    const reopened =
      createLocalOperationsDb({
        databasePath:
          path.join(
            directory,
            'agent-operations.sqlite'
          )
      })

    const afterRestart =
      await executeAgentCommand({
        command,
        operations: reopened,
        execute
      })

    assert.equal(
      executions,
      1
    )
    assert.deepEqual(
      afterRestart,
      first
    )

    reopened.close()
    await fs.rm(
      directory,
      {
        recursive: true,
        force: true
      }
    )
  }
)

test('persiste metricas de conclusao e sincroniza apos falha de rede', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'printflow-agent-metrics-'))
  const operations = createLocalOperationsDb({ databasePath: path.join(directory, 'agent.sqlite') })
  operations.queueProductionMetrics({ printJobId: 'job-1', payload: { status: 'completed', idempotencyKey: 'metric-1', actualPrintSeconds: 10 } })
  let reported = 0
  const synchronized = await flushPendingProductionMetrics({
    operations,
    report: async (printJobId, payload) => { reported += 1; assert.equal(printJobId, 'job-1'); assert.equal(payload.idempotencyKey, 'metric-1') }
  })
  assert.equal(synchronized, 1)
  assert.equal(reported, 1)
  assert.equal(operations.listPendingProductionMetrics().length, 0)
  operations.close()
  await fs.rm(directory, { recursive: true, force: true })
})

test('persiste monitoramento de Production Job para retomar apos reinicio', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'printflow-agent-monitor-'))
  const databasePath = path.join(directory, 'agent.sqlite')
  const operations = createLocalOperationsDb({ databasePath })
  operations.queueProductionJobMonitor({
    printJobId: 'job-monitor-1',
    commandId: 'command-monitor-1',
    printer: { id: 'printer-1', protocol: 'bambu' },
    startedAt: '2026-09-21T12:00:00.000Z'
  })
  operations.close()

  const reopened = createLocalOperationsDb({ databasePath })
  assert.deepEqual(reopened.listPendingProductionJobMonitors(), [{
    printJobId: 'job-monitor-1',
    commandId: 'command-monitor-1',
    printer: { id: 'printer-1', protocol: 'bambu' },
    startedAt: '2026-09-21T12:00:00.000Z',
    createdAt: reopened.listPendingProductionJobMonitors()[0].createdAt
  }])
  reopened.acknowledgeProductionJobMonitor('job-monitor-1')
  assert.equal(reopened.listPendingProductionJobMonitors().length, 0)
  reopened.close()
  await fs.rm(directory, { recursive: true, force: true })
})

test(
  'migra banco local existente para o schema versionado sem perder comando',
  async () => {
    const directory =
      await fs.mkdtemp(
        path.join(
          os.tmpdir(),
          'printflow-agent-schema-'
        )
      )

    const databasePath =
      path.join(
        directory,
        'agent-operations.sqlite'
      )

    const legacy =
      new DatabaseSync(
        databasePath
      )

    legacy.exec(
      `
        create table processed_commands (
          command_id text primary key,
          command_type text not null,
          state text not null,
          result_json text,
          created_at text not null,
          completed_at text
        );
        insert into processed_commands (
          command_id,
          command_type,
          state,
          result_json,
          created_at,
          completed_at
        ) values (
          'legacy-command-1',
          'printer_status',
          'completed',
          '{"success":true}',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z'
        );
      `
    )
    legacy.close()

    const operations =
      createLocalOperationsDb({
        databasePath
      })

    assert.equal(
      operations.schemaVersion,
      5
    )
    assert.deepEqual(
      operations.begin({
        id: 'legacy-command-1',
        type: 'printer_status'
      }),
      {
        status: 'completed',
        result: {
          success: true
        }
      }
    )

    operations.close()
    await fs.rm(
      directory,
      {
        recursive: true,
        force: true
      }
    )
  }
)

test(
  'mantem conclusao no SQLite ate o backend confirmar',
  async () => {
    const {
      directory,
      operations
    } = await createStore()

    await executeAgentCommand({
      command: {
        id: 'command-outbox-1',
        type: 'printer_status'
      },
      operations,
      execute: async () => ({
        success: true,
        status: {
          state: 'idle'
        }
      })
    })

    const attempts = []

    await assert.rejects(
      flushPendingCommandCompletions({
        operations,
        complete: async (
          commandId
        ) => {
          attempts.push(
            commandId
          )
          throw new Error(
            'rede indisponivel'
          )
        }
      }),
      /rede indisponivel/
    )

    assert.equal(
      operations.listPendingCompletions()
        .length,
      1
    )

    const flushed =
      await flushPendingCommandCompletions({
        operations,
        complete: async (
          commandId,
          result
        ) => {
          attempts.push(
            commandId
          )
          assert.equal(
            result.success,
            true
          )
        }
      })

    assert.equal(
      flushed,
      1
    )
    assert.deepEqual(
      attempts,
      [
        'command-outbox-1',
        'command-outbox-1'
      ]
    )
    assert.equal(
      operations.listPendingCompletions()
        .length,
      0
    )

    operations.close()
    await fs.rm(
      directory,
      {
        recursive: true,
        force: true
      }
    )
  }
)

test(
  'conclui com erro seguro comandos interrompidos antes de reiniciar',
  async () => {
    const {
      directory,
      operations
    } = await createStore()

    operations.begin({
      id: 'command-interrompido-1',
      type: 'start_print'
    })

    operations.close()

    const reopened =
      createLocalOperationsDb({
        databasePath:
          path.join(
            directory,
            'agent-operations.sqlite'
          )
      })

    assert.equal(
      reopened.recoverInterruptedCommands(),
      1
    )

    const recovered =
      reopened.begin({
        id: 'command-interrompido-1',
        type: 'start_print'
      })

    assert.equal(
      recovered.status,
      'completed'
    )
    assert.equal(
      recovered.result.code,
      'agent_restarted'
    )
    assert.equal(
      reopened.listPendingCompletions().length,
      1
    )

    reopened.close()
    await fs.rm(
      directory,
      {
        recursive: true,
        force: true
      }
    )
  }
)

test(
  'persiste eventos agregados e os mantém até sincronização',
  async () => {
    const {
      directory,
      operations
    } = await createStore()

    operations.queueEvent(
      'command.completed',
      {
        commandId:
          'command-event-1',
        success:
          true
      }
    )

    await assert.rejects(
      flushPendingEvents({
        operations,
        publish: async () => {
          throw new Error(
            'rede indisponivel'
          )
        }
      }),
      /rede indisponivel/
    )

    assert.equal(
      operations.listPendingEvents().length,
      1
    )
    assert.equal(
      operations.listPendingEvents()[0].attempts,
      1
    )

    const synchronized =
      await flushPendingEvents({
        operations,
        publish: async event => {
          assert.equal(
            event.type,
            'command.completed'
          )
          assert.equal(
            event.payload.commandId,
            'command-event-1'
          )
        }
      })

    assert.equal(
      synchronized,
      1
    )
    assert.equal(
      operations.listPendingEvents().length,
      0
    )

    operations.close()
    await fs.rm(
      directory,
      {
        recursive: true,
        force: true
      }
    )
  }
)

test(
  'persiste ultimo estado local de impressora e job',
  async () => {
    const {
      directory,
      operations
    } = await createStore()

    await executeAgentCommand({
      command: {
        id: 'command-state-1',
        type: 'printer_status',
        payload: {
          agentPrinterId: 'printer-1',
          printJobId: 'job-1'
        }
      },
      operations,
      execute: async () => ({
        success: true,
        status: {
          state: 'printing',
          progress: 42
        }
      })
    })

    assert.equal(
      operations.getLocalState(
        'printer',
        'printer-1'
      ).state.status.state,
      'printing'
    )
    assert.equal(
      operations.getLocalState(
        'job',
        'job-1'
      ).state.status.progress,
      42
    )

    operations.close()
    await fs.rm(
      directory,
      {
        recursive: true,
        force: true
      }
    )
  }
)
