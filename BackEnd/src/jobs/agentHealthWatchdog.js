import { env } from '../config/env.js'
import { hasDatabase, query, withTenant } from '../db/pool.js'
import { writeAuditEvent, writeOperationalNotification } from '../services/operationalEvents.js'

export const runAgentHealthWatchdog = async ({ now = new Date(), offlineAfterMs = env.agentOfflineAfterMs } = {}) => {
  if (!hasDatabase) return { offlineAgents: 0 }

  const cutoff = new Date(now.getTime() - Math.max(30_000, offlineAfterMs))
  const tenants = await query('select id from tenants')
  let offlineAgents = 0

  for (const tenant of tenants.rows) {
    await withTenant(tenant.id, async (client) => {
      const result = await client.query(`
        update agents
           set status = 'offline', updated_at = now()
         where tenant_id = $1
           and status = 'online'
           and (last_seen_at is null or last_seen_at < $2)
         returning id, machine_name, last_seen_at
      `, [tenant.id, cutoff])

      for (const agent of result.rows) {
        const agentId = String(agent.id)
        await writeOperationalNotification(tenant.id, {
          type: 'agent.offline', severity: 'warning', title: 'PrintFlow Agent offline',
          message: `O Agent ${agent.machine_name || agentId} deixou de responder. As impressoes em andamento devem ser conferidas.`,
          entityType: 'agent', entityId: agentId, dedupeKey: `agent-offline:${agentId}`
        }, client)
        await writeAuditEvent(tenant.id, {
          action: 'agent.offline', actorType: 'system', entityType: 'agent', entityId: agentId,
          details: { lastSeenAt: agent.last_seen_at }
        }, client)
      }
      offlineAgents += result.rowCount
    })
  }

  return { offlineAgents }
}

export const startAgentHealthWatchdog = () => {
  if (!hasDatabase || env.agentHealthWatchdogIntervalMs <= 0) return null
  const run = () => runAgentHealthWatchdog().catch((error) => console.error('[AgentHealthWatchdog] Falha:', error))
  void run()
  const timer = setInterval(run, env.agentHealthWatchdogIntervalMs)
  timer.unref?.()
  return timer
}
