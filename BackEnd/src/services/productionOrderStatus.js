import { writeAuditEvent } from './operationalEvents.js'

export const syncOrderStatusFromProductionJob = async ({ client, tenantId, printJobId, nextStatus }) => {
  const jobResult = await client.query(
    `select id, order_id, fulfillment_plan_id
       from print_jobs
      where tenant_id = $1 and id = $2
      limit 1`,
    [tenantId, printJobId]
  )
  const job = jobResult.rows[0]
  if (!job?.order_id) return { updated: false, reason: 'order_missing' }

  if (nextStatus === 'Impresso' && job.fulfillment_plan_id) {
    const pending = await client.query(
      `select 1
         from print_jobs
        where tenant_id = $1
          and fulfillment_plan_id = $2
          and status not in ('completed', 'cancelled')
          and not (
            status = 'failed' and exists (
              select 1 from print_jobs retry
               where retry.tenant_id = print_jobs.tenant_id
                 and retry.retry_of_job_id = print_jobs.id
            )
          )
        limit 1`,
      [tenantId, job.fulfillment_plan_id]
    )
    if (pending.rowCount) return { updated: false, reason: 'production_pending' }
  }

  const expectedCurrentStatus = nextStatus === 'Producao' ? 'Novo' : 'Producao'
  const result = await client.query(
    `update orders
        set status = $3, updated_at = now()
      where tenant_id = $1 and id = $2 and status = $4
      returning id`,
    [tenantId, job.order_id, nextStatus, expectedCurrentStatus]
  )
  if (result.rowCount) {
    await writeAuditEvent(tenantId, {
      action: 'orders.stage_advanced', actorType: 'system', entityType: 'orders', entityId: String(job.order_id),
      details: { fromStatus: expectedCurrentStatus, toStatus: nextStatus, source: 'agent_metrics', printJobId: String(printJobId) }
    }, client)
  }
  return { updated: Boolean(result.rowCount), reason: result.rowCount ? null : 'status_unchanged' }
}
