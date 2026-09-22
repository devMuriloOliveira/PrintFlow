import { writeAuditEvent } from './operationalEvents.js'

export const createPendingProductionOutput = async ({ client, tenantId, printJobId }) => {
  const job = await client.query(
    `select id, quantity from print_jobs where tenant_id = $1 and id = $2 and status = 'completed' for update`,
    [tenantId, printJobId]
  )
  if (!job.rowCount) return null
  const output = await client.query(
    `insert into production_outputs (tenant_id, print_job_id, expected_quantity)
     values ($1, $2, $3)
     on conflict (tenant_id, print_job_id) do update set updated_at = now()
     returning id, expected_quantity, approved_quantity, rejected_quantity, status`,
    [tenantId, printJobId, Number(job.rows[0].quantity)]
  )
  return output.rows[0]
}

export const approveProductionOutput = async ({ client, tenantId, printJobId, approvedQuantity, rejectedQuantity, audit = null }) => {
  const output = await client.query(
    `select o.expected_quantity, o.status, j.product_id, j.fulfillment_plan_id
       from production_outputs o
       join print_jobs j on j.id = o.print_job_id and j.tenant_id = o.tenant_id
      where o.tenant_id = $1 and o.print_job_id = $2
      for update of o, j`,
    [tenantId, printJobId]
  )
  if (!output.rowCount) throw new Error('Producao concluida aguardando conferencia nao encontrada.')
  const row = output.rows[0]
  if (row.status === 'approved') return { idempotent: true }
  const approved = Number(approvedQuantity)
  const rejected = Number(rejectedQuantity)
  if (!Number.isInteger(approved) || !Number.isInteger(rejected) || approved < 0 || rejected < 0 || approved + rejected !== Number(row.expected_quantity)) {
    throw new Error('Informe aprovadas e refugadas que somem exatamente o lote produzido.')
  }
  const product = await client.query(
    `select p.id, coalesce(i.quantity, 0) as quantity, coalesce(i.reserved_quantity, 0) as reserved_quantity
       from products p left join product_inventory i on i.tenant_id = p.tenant_id and i.product_id = p.id
      where p.tenant_id = $1 and p.id = $2 for update of p`,
    [tenantId, row.product_id]
  )
  if (!product.rowCount) throw new Error('Produto da producao nao encontrado.')
  const inventory = product.rows[0]
  const plan = row.fulfillment_plan_id ? await client.query(
    `select id, requested_quantity, reserved_quantity, production_quantity from sales_fulfillment_plans where tenant_id = $1 and id = $2 for update`,
    [tenantId, row.fulfillment_plan_id]
  ) : { rows: [] }
  const neededForPlan = plan.rows[0] ? Math.max(0, Number(plan.rows[0].requested_quantity) - Number(plan.rows[0].reserved_quantity)) : 0
  const newlyReserved = Math.min(approved, neededForPlan)
  const nextQuantity = Number(inventory.quantity) + approved
  const nextReserved = Number(inventory.reserved_quantity) + newlyReserved
  const status = nextQuantity === 0 ? 'Esgotado' : nextReserved >= nextQuantity ? 'Reservado' : 'Disponivel'
  await client.query(
    `insert into product_inventory (tenant_id, product_id, quantity, reserved_quantity, status)
     values ($1, $2, $3, $4, $5)
     on conflict (tenant_id, product_id) do update set quantity = excluded.quantity, reserved_quantity = excluded.reserved_quantity, status = excluded.status, updated_at = now()`,
    [tenantId, row.product_id, nextQuantity, nextReserved, status]
  )
  if (plan.rows[0]) await client.query(
    `update sales_fulfillment_plans set reserved_quantity = reserved_quantity + $3, status = case when reserved_quantity + $3 >= requested_quantity then 'reserved' else 'partial_production' end, updated_at = now() where tenant_id = $1 and id = $2`,
    [tenantId, row.fulfillment_plan_id, newlyReserved]
  )
  await client.query(
    `update production_outputs set approved_quantity = $3, rejected_quantity = $4, status = 'approved', approved_at = now(), updated_at = now() where tenant_id = $1 and print_job_id = $2`,
    [tenantId, printJobId, approved, rejected]
  )
  if (audit?.actorId) await writeAuditEvent(tenantId, { action: 'production.output_approved', actorType: audit.actorType || 'user', actorId: audit.actorId, entityType: 'print_job', entityId: String(printJobId), details: { approvedQuantity: approved, rejectedQuantity: rejected } }, client)
  return { approvedQuantity: approved, rejectedQuantity: rejected }
}
