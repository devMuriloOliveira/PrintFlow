import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  getAgentLocalPaths
} from './localPaths.js'

const parseResult = (
  value
) => {
  try {
    return JSON.parse(
      String(value || '{}')
    )
  } catch {
    return {
      success: false,
      error: 'Resultado local de comando invalido.'
    }
  }
}

const requiredCommandId = (
  commandId
) => {
  const normalized =
    String(commandId || '')
      .trim()

  if (!normalized) {
    throw new Error(
      'command_id local obrigatorio.'
    )
  }

  return normalized
}

const now = () =>
  new Date()
    .toISOString()

const CURRENT_SCHEMA_VERSION =
  4

const migrateSchema = (
  database
) => {
  const current =
    Number(
      database.prepare(
        'pragma user_version'
      ).get().user_version ||
      0
    )

  if (
    current >
    CURRENT_SCHEMA_VERSION
  ) {
    throw new Error(
      'Banco local do Agent foi criado por uma versao mais recente.'
    )
  }

  database.exec(
    `
      begin immediate;

      create table if not exists processed_commands (
        command_id text primary key,
        command_type text not null,
        state text not null check (state in ('processing', 'completed')),
        result_json text,
        created_at text not null,
        completed_at text
      );

      create table if not exists command_completions (
        command_id text primary key,
        result_json text not null,
        created_at text not null
      );

      create index if not exists command_completions_created_idx
        on command_completions (created_at);

      pragma user_version = 1;

      create table if not exists agent_events (
        id integer primary key autoincrement,
        event_type text not null,
        payload_json text not null,
        created_at text not null,
        attempts integer not null default 0
      );

      create index if not exists agent_events_created_idx
        on agent_events (created_at);

      pragma user_version = 2;

      create table if not exists local_states (
        entity_type text not null,
        entity_id text not null,
        state_json text not null,
        updated_at text not null,
        primary key (entity_type, entity_id)
      );

      pragma user_version = 3;

      create table if not exists production_metrics (
        id integer primary key autoincrement,
        print_job_id text not null,
        idempotency_key text not null unique,
        payload_json text not null,
        created_at text not null,
        attempts integer not null default 0
      );

      create index if not exists production_metrics_created_idx
        on production_metrics (created_at);

      pragma user_version = 4;
      commit;
    `
  )

  return CURRENT_SCHEMA_VERSION
}

export const createLocalOperationsDb = (
  {
    databasePath =
      getAgentLocalPaths()
        .database
  } = {}
) => {
  mkdirSync(
    path.dirname(
      databasePath
    ),
    {
      recursive: true
    }
  )

  const database =
    new DatabaseSync(
      databasePath
    )

  database.exec(
    `
      pragma journal_mode = WAL;
      pragma foreign_keys = ON;
      pragma busy_timeout = 5000;
    `
  )

  const schemaVersion =
    migrateSchema(
      database
    )

  const findCommand =
    database.prepare(
      `
        select
          command_id,
          command_type,
          state,
          result_json,
          created_at,
          completed_at
        from processed_commands
        where command_id = ?
        limit 1
      `
    )

  const insertCommand =
    database.prepare(
      `
        insert into processed_commands (
          command_id,
          command_type,
          state,
          created_at
        ) values (?, ?, 'processing', ?)
      `
    )

  const completeCommand =
    database.prepare(
      `
        update processed_commands
        set
          state = 'completed',
          result_json = ?,
          completed_at = ?
        where command_id = ?
          and state = 'processing'
      `
    )

  const upsertCompletion =
    database.prepare(
      `
        insert into command_completions (
          command_id,
          result_json,
          created_at
        ) values (?, ?, ?)
        on conflict (command_id) do update set
          result_json = excluded.result_json
      `
    )

  const listCompletions =
    database.prepare(
      `
        select
          command_id,
          result_json,
          created_at
        from command_completions
        order by created_at asc
        limit ?
      `
    )

  const deleteCompletion =
    database.prepare(
      `
        delete from command_completions
        where command_id = ?
      `
    )

  const listInterruptedCommands =
    database.prepare(
      `
        select
          command_id,
          command_type
        from processed_commands
        where state = 'processing'
        order by created_at asc
      `
    )

  const insertEvent =
    database.prepare(
      `
        insert into agent_events (
          event_type,
          payload_json,
          created_at
        ) values (?, ?, ?)
      `
    )

  const listEvents =
    database.prepare(
      `
        select
          id,
          event_type,
          payload_json,
          created_at,
          attempts
        from agent_events
        order by id asc
        limit ?
      `
    )

  const acknowledgeEvent =
    database.prepare(
      `
        delete from agent_events
        where id = ?
      `
    )

  const incrementEventAttempts =
    database.prepare(
      `
        update agent_events
        set attempts = attempts + 1
        where id = ?
      `
    )

  const insertProductionMetric = database.prepare(`
    insert into production_metrics (print_job_id, idempotency_key, payload_json, created_at)
    values (?, ?, ?, ?)
    on conflict (idempotency_key) do update set payload_json = excluded.payload_json
  `)
  const listProductionMetrics = database.prepare(`
    select id, print_job_id, idempotency_key, payload_json, created_at, attempts
      from production_metrics order by id asc limit ?
  `)
  const incrementProductionMetricAttempts = database.prepare('update production_metrics set attempts = attempts + 1 where id = ?')
  const deleteProductionMetric = database.prepare('delete from production_metrics where id = ?')

  const upsertLocalState =
    database.prepare(
      `
        insert into local_states (
          entity_type,
          entity_id,
          state_json,
          updated_at
        ) values (?, ?, ?, ?)
        on conflict (entity_type, entity_id)
        do update set
          state_json = excluded.state_json,
          updated_at = excluded.updated_at
      `
    )

  const getLocalState =
    database.prepare(
      `
        select
          entity_type,
          entity_id,
          state_json,
          updated_at
        from local_states
        where entity_type = ?
          and entity_id = ?
        limit 1
      `
    )

  const begin = (
    command
  ) => {
    const commandId =
      requiredCommandId(
        command?.id
      )

    const existing =
      findCommand.get(
        commandId
      )

    if (!existing) {
      insertCommand.run(
        commandId,
        String(
          command?.type ||
          'unknown'
        ),
        now()
      )

      return {
        status: 'new'
      }
    }

    if (
      existing.state ===
      'completed'
    ) {
      return {
        status: 'completed',
        result: parseResult(
          existing.result_json
        )
      }
    }

    return {
      status: 'processing'
    }
  }

  const recordResult = (
    commandId,
    result
  ) => {
    const id =
      requiredCommandId(
        commandId
      )

    const serialized =
      JSON.stringify(
        result || {}
      )

    const completedAt = now()

    database.exec(
      'begin immediate'
    )

    try {
      const update =
        completeCommand.run(
          serialized,
          completedAt,
          id
        )

      if (update.changes !== 1) {
        throw new Error(
          'Comando local nao estava em processamento.'
        )
      }

      upsertCompletion.run(
        id,
        serialized,
        completedAt
      )

      database.exec(
        'commit'
      )
    } catch (error) {
      database.exec(
        'rollback'
      )
      throw error
    }
  }

  const queueCompletion = (
    commandId,
    result
  ) => {
    upsertCompletion.run(
      requiredCommandId(
        commandId
      ),
      JSON.stringify(
        result || {}
      ),
      now()
    )
  }

  const recoverInterruptedCommands = () => {
    const interrupted =
      listInterruptedCommands.all()

    for (
      const command
      of interrupted
    ) {
      recordResult(
        command.command_id,
        {
          success: false,
          error:
            'Comando interrompido por reinicio do PrintFlow Agent. A execucao nao foi repetida por seguranca.',
          code:
            'agent_restarted',
          commandType:
            command.command_type
        }
      )
    }

    return interrupted.length
  }

  return {
    databasePath,
    schemaVersion,
    begin,
    recordResult,
    queueCompletion,
    recoverInterruptedCommands,
    queueEvent: (
      eventType,
      payload = {}
    ) => {
      const type =
        String(
          eventType ||
          ''
        ).trim()

      if (!type) {
        throw new Error(
          'Tipo de evento local obrigatorio.'
        )
      }

      const event =
        insertEvent.run(
          type,
          JSON.stringify(
            payload || {}
          ),
          now()
        )

      return Number(
        event.lastInsertRowid
      )
    },
    listPendingEvents: (
      limit = 20
    ) =>
      listEvents.all(
        Math.max(
          1,
          Math.min(
            100,
            Number(limit) || 20
          )
        )
      ).map(
        event => ({
          id:
            Number(event.id),
          eventType:
            event.event_type,
          payload:
            parseResult(
              event.payload_json
            ),
          createdAt:
            event.created_at,
          attempts:
            Number(event.attempts || 0)
        })
      ),
    markEventAttempted: (
      eventId
    ) => {
      incrementEventAttempts.run(
        Number(eventId)
      )
    },
    acknowledgeEvent: (
      eventId
    ) => {
      acknowledgeEvent.run(
        Number(eventId)
      )
    },
    queueProductionMetrics: ({ printJobId, payload } = {}) => {
      const id = String(printJobId || '').trim()
      const key = String(payload?.idempotencyKey || '').trim()
      if (!id || !key) throw new Error('Production metric idempotente invalida.')
      return Number(insertProductionMetric.run(id, key, JSON.stringify(payload), now()).lastInsertRowid)
    },
    listPendingProductionMetrics: (limit = 20) => listProductionMetrics.all(Math.max(1, Math.min(100, Number(limit) || 20))).map((item) => ({
      id: Number(item.id),
      printJobId: item.print_job_id,
      payload: parseResult(item.payload_json),
      createdAt: item.created_at,
      attempts: Number(item.attempts || 0)
    })),
    markProductionMetricAttempted: (id) => { incrementProductionMetricAttempts.run(Number(id)) },
    acknowledgeProductionMetric: (id) => { deleteProductionMetric.run(Number(id)) },
    upsertLocalState: (
      entityType,
      entityId,
      state = {}
    ) => {
      const type =
        String(entityType || '').trim()
      const id =
        String(entityId || '').trim()

      if (!type || !id) {
        return
      }

      upsertLocalState.run(
        type,
        id,
        JSON.stringify(state || {}),
        now()
      )
    },
    getLocalState: (
      entityType,
      entityId
    ) => {
      const state =
        getLocalState.get(
          String(entityType || ''),
          String(entityId || '')
        )

      if (!state) {
        return null
      }

      return {
        entityType:
          state.entity_type,
        entityId:
          state.entity_id,
        state:
          parseResult(
            state.state_json
          ),
        updatedAt:
          state.updated_at
      }
    },
    listPendingCompletions: (
      limit = 20
    ) =>
      listCompletions.all(
        Math.max(
          1,
          Math.min(
            100,
            Number(limit) || 20
          )
        )
      )
        .map(
          completion => ({
            commandId:
              completion.command_id,
            result: parseResult(
              completion.result_json
            ),
            createdAt:
              completion.created_at
          })
        ),
    acknowledgeCompletion: (
      commandId
    ) => {
      deleteCompletion.run(
        requiredCommandId(
          commandId
        )
      )
    },
    close: () =>
      database.close()
  }
}
