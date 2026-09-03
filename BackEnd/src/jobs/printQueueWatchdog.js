import { env } from '../config/env.js'
import { hasDatabase, query, withTenant } from '../db/pool.js'
import { writeAuditEvent, writeOperationalNotification } from '../services/operationalEvents.js'

const timeoutResult = (message) =>
  JSON.stringify({
    success: false,
    error: message
  })

const appendNoteSql = `
  concat_ws(
    E'\\n',
    nullif(notes, ''),
    $3::text
  )
`

export const runPrintQueueWatchdog = async ({
  now = new Date(),
  commandTimeoutMs = env.printCommandTimeoutMs,
  jobStartTimeoutMs = env.printJobStartTimeoutMs
} = {}) => {
  if (!hasDatabase) {
    return {
      expiredCommands: 0,
      restoredJobs: 0
    }
  }

  const tenants = await query('select id from tenants')
  let expiredCommands = 0
  let restoredJobs = 0
  const commandCutoff = new Date(now.getTime() - commandTimeoutMs)
  const jobCutoff = new Date(now.getTime() - jobStartTimeoutMs)

  for (const tenant of tenants.rows) {
    await withTenant(tenant.id, async (client) => {
      const expired = await client.query(
        `with expired_commands as (
           update agent_commands
              set status = 'failed',
                  result = $4::jsonb,
                  completed_at = now()
            where tenant_id = $1
              and command = 'start_print'
              and status in ('pending', 'running')
              and coalesce(started_at, created_at) < $2
          returning payload
         )
         update print_jobs
            set status = 'queued',
                notes = ${appendNoteSql},
                updated_at = now()
          where tenant_id = $1
            and status = 'starting'
            and id in (
              select nullif(payload->>'printJobId', '')::bigint
                from expired_commands
               where nullif(payload->>'printJobId', '') is not null
            )
          returning id`,
        [
          tenant.id,
          commandCutoff,
          'Comando de inicio expirou no Agent. Item devolvido para a fila.',
          timeoutResult('O Agent nao respondeu o inicio da impressao dentro do tempo esperado.')
        ]
      )

      expiredCommands += expired.rowCount
      restoredJobs += expired.rowCount

      for (const job of expired.rows) {
        const printJobId = String(job.id)
        await writeOperationalNotification(tenant.id, {
          type: 'print.start_timeout', severity: 'warning', title: 'Inicio de impressao expirou',
          message: 'O Agent nao confirmou o inicio. O item voltou para a fila para revisao.',
          entityType: 'print_job', entityId: printJobId, dedupeKey: `print-start-timeout:${printJobId}`
        }, client)
        await writeAuditEvent(tenant.id, {
          action: 'print_job.start_timeout', actorType: 'system', entityType: 'print_job', entityId: printJobId
        }, client)
      }

      const restored = await client.query(
        `update print_jobs
            set status = 'queued',
                notes = ${appendNoteSql},
                updated_at = now()
          where tenant_id = $1
            and status = 'starting'
            and updated_at < $2
            and not exists (
              select 1
                from agent_commands c
               where c.tenant_id = print_jobs.tenant_id
                 and c.command = 'start_print'
                 and c.status in ('pending', 'running')
                 and c.payload->>'printJobId' = print_jobs.id::text
            )
          returning id`,
        [
          tenant.id,
          jobCutoff,
          'Inicio de impressao ficou travado. Item devolvido para a fila.'
        ]
      )

      restoredJobs += restored.rowCount
    })
  }

  return {
    expiredCommands,
    restoredJobs
  }
}

export const startPrintQueueWatchdog = () => {
  if (!hasDatabase || env.printQueueWatchdogIntervalMs <= 0) return null

  const run = async () => {
    try {
      await runPrintQueueWatchdog()
    } catch (error) {
      console.error('[PrintQueueWatchdog] Falha ao verificar fila:', error)
    }
  }

  void run()
  return setInterval(run, env.printQueueWatchdogIntervalMs)
}
