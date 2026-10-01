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

test('lista metricas locais por tipo com limite seguro para heartbeat', async () => {
  const { directory, operations } = await createStore()
  try {
    operations.upsertLocalState('operational_metric', 'printer_status:moonraker', { category: 'printer_status', count: 4 })
    operations.upsertLocalState('other', 'private', { password: 'not-selected' })

    assert.deepEqual(operations.listLocalStatesByType('operational_metric', 50).map(item => ({
      entityType: item.entityType,
      entityId: item.entityId,
      state: item.state
    })), [{
      entityType: 'operational_metric',
      entityId: 'printer_status:moonraker',
      state: { category: 'printer_status', count: 4 }
    }])
    assert.equal(operations.listLocalStatesByType('operational_metric', 0).length, 1)
  } finally {
    operations.close()
    await fs.rm(directory, { recursive: true, force: true })
  }
})

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
      8
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

    const initialTime = Date.now()
    const failed = await flushPendingCommandCompletions({
      operations,
      now: () => initialTime,
      complete: async commandId => {
        attempts.push(commandId)
        throw new Error('rede indisponivel')
      }
    })
    assert.equal(failed, 0)

    assert.equal(
      operations.listPendingCompletions(20, new Date(initialTime + 10_000).toISOString())
        .length,
      1
    )

    const flushed =
      await flushPendingCommandCompletions({
        operations,
        now: () => initialTime + 10_000,
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

    const initialTime = Date.now()
    const failed = await flushPendingEvents({
      operations,
      now: () => initialTime,
      random: () => 0.5,
      publish: async () => { throw new Error('rede indisponivel') }
    })
    assert.equal(failed, 0)

    assert.equal(
      operations.listPendingEvents(20, new Date(initialTime + 10_000).toISOString()).length,
      1
    )
    assert.equal(
      operations.listPendingEvents(20, new Date(initialTime + 10_000).toISOString())[0].attempts,
      1
    )

    const synchronized =
      await flushPendingEvents({
        operations,
        now: () => initialTime + 10_000,
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

test('evento defeituoso vai para dead-letter e não bloqueia eventos posteriores', async () => {
  const { directory, operations } = await createStore()
  operations.queueEvent('test.valid.first', { order: 1 })
  operations.queueEvent('test.invalid', { order: 2 })
  operations.queueEvent('test.valid.last', { order: 3 })
  const delivered = []

  const synchronized = await flushPendingEvents({
    operations,
    publish: async event => {
      if (event.type === 'test.invalid') {
        const error = new Error('payload rejected')
        error.statusCode = 400
        throw error
      }
      delivered.push(event.type)
    }
  })

  assert.equal(synchronized, 2)
  assert.deepEqual(delivered, ['test.valid.first', 'test.valid.last'])
  assert.deepEqual(operations.getOutboxEventCounts(), { pending: 0, retrying: 0, dead_letter: 1 })
  assert.deepEqual(operations.listPendingEvents(), [])
  assert.equal(operations.listDeadLetterEvents()[0].eventType, 'test.invalid')
  assert.deepEqual(operations.listDeadLetterEvents()[0].payload, { order: 2 })

  operations.close()
  await fs.rm(directory, { recursive: true, force: true })
})

test('falha de uma métrica ou conclusão não bloqueia os itens seguintes', async () => {
  const { directory, operations } = await createStore()
  operations.queueProductionMetrics({ printJobId: 'job-a', payload: { idempotencyKey: 'metric-a' } })
  operations.queueProductionMetrics({ printJobId: 'job-b', payload: { idempotencyKey: 'metric-b' } })
  const metricResult = await flushPendingProductionMetrics({
    operations,
    report: async (_id, payload) => {
      if (payload.idempotencyKey === 'metric-a') {
        const error = new Error('invalid metric')
        error.statusCode = 422
        throw error
      }
    }
  })
  assert.equal(metricResult, 1)
  assert.equal(operations.getDeadLetterProductionMetricCount(), 1)
  assert.equal(operations.listPendingProductionMetrics().length, 0)

  for (const commandId of ['completion-a', 'completion-b']) {
    await executeAgentCommand({ command: { id: commandId, type: 'printer_status' }, operations, execute: async () => ({ success: true }) })
  }
  const completed = []
  const completionResult = await flushPendingCommandCompletions({ operations, complete: async id => {
    if (id === 'completion-a') throw new Error('temporarily offline')
    completed.push(id)
  } })
  assert.equal(completionResult, 1)
  assert.deepEqual(completed, ['completion-b'])
  assert.equal(operations.listPendingCompletions(20, new Date(Date.now() + 10_000).toISOString()).length, 1)

  operations.close()
  await fs.rm(directory, { recursive: true, force: true })
})

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

test('remove estados locais antigos sem tocar em filas pendentes', async () => {
  const { directory, operations } = await createStore()
  operations.upsertLocalState('job', 'old-job', { status: 'completed' })
  operations.upsertLocalState('job', 'recent-job', { status: 'printing' })
  operations.queueEvent('test.pending', { retained: true })

  const legacy = new DatabaseSync(operations.databasePath)
  legacy.prepare('update local_states set updated_at = ? where entity_id = ?')
    .run(new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(), 'old-job')
  legacy.close()

  assert.equal(operations.pruneLocalStates(), 1)
  assert.equal(operations.getLocalState('job', 'old-job'), null)
  assert.deepEqual(operations.getLocalState('job', 'recent-job').state, { status: 'printing' })
  assert.equal(operations.listPendingEvents().length, 1)

  operations.close()
  await fs.rm(directory, { recursive: true, force: true })
})

test('retencao apaga comandos reconhecidos pelo backend e preserva conclusoes pendentes', async () => {
  const { directory, operations } = await createStore()
  for (const commandId of ['acked-old', 'acked-middle', 'acked-new', 'pending-old']) {
    operations.begin({ id: commandId, type: 'printer_status' })
    operations.recordResult(commandId, { success: true, commandId })
  }
  operations.acknowledgeCompletion('acked-old')
  operations.acknowledgeCompletion('acked-middle')
  operations.acknowledgeCompletion('acked-new')

  const legacy = new DatabaseSync(operations.databasePath)
  const setCompletedAt = legacy.prepare('update processed_commands set completed_at = ? where command_id = ?')
  setCompletedAt.run('2025-01-01T00:00:00.000Z', 'acked-old')
  setCompletedAt.run('2026-09-27T00:00:00.000Z', 'acked-middle')
  setCompletedAt.run('2026-09-28T00:00:00.000Z', 'acked-new')
  setCompletedAt.run('2025-01-03T00:00:00.000Z', 'pending-old')
  legacy.close()

  const result = operations.pruneLocalData({
    now: Date.parse('2026-09-29T00:00:00.000Z'),
    completedCommandMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
    maxCompletedCommands: 1
  })
  assert.equal(result.processedCommandsRemoved, 2)
  assert.equal(operations.begin({ id: 'acked-old', type: 'printer_status' }).status, 'new')
  assert.equal(operations.begin({ id: 'acked-middle', type: 'printer_status' }).status, 'new')
  assert.equal(operations.begin({ id: 'acked-new', type: 'printer_status' }).status, 'completed')
  assert.deepEqual(operations.begin({ id: 'pending-old', type: 'printer_status' }), {
    status: 'completed',
    result: { success: true, commandId: 'pending-old' }
  })
  assert.equal(operations.listPendingCompletions().length, 1)
  operations.queueEvent('retention.pending')
  operations.queueProductionMetrics({
    printJobId: 'job-pending',
    payload: { status: 'completed', idempotencyKey: 'metric-pending' }
  })
  assert.deepEqual(operations.getPendingCounts(), {
    completions: 1,
    events: 1,
    metrics: 1,
    total: 3
  })

  operations.close()
  await fs.rm(directory, { recursive: true, force: true })
})
