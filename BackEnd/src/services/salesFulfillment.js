import { releaseProductionMaterialReservation, reserveProductionMaterial } from './productionInventory.js'
import { createProductMovementWithClient } from '../repositories/inventoryRepository.js'

const quantity = (value) => {
  const parsed = Math.floor(Number(value))
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('Quantidade de atendimento invalida.')
  return parsed
}

const sourceColumn = (sourceType) => {
  if (sourceType === 'order') return 'order_id'
  if (sourceType === 'tracked_sale') return 'tracked_sale_id'
  throw new Error('Origem de atendimento invalida.')
}

export const createSalesFulfillmentPlan = async ({ client, tenantId, sourceType, sourceId, productId, requestedQuantity, title = '', notes = '', awaitingConfirmation = false }) => {
  const existing = await client.query(
    `select id, reserved_quantity, production_quantity, status
       from sales_fulfillment_plans
      where tenant_id = $1 and source_type = $2 and source_id = $3
      for update`,
    [tenantId, sourceType, sourceId]
  )
  if (existing.rowCount) return { plan: existing.rows[0], idempotent: true }

  const product = await client.query(
    `select p.id, p.name, p.printer_id, pr.agent_printer_id, coalesce(pi.quantity, 0) as quantity, coalesce(pi.reserved_quantity, 0) as reserved_quantity
       from products p
       left join product_inventory pi on pi.tenant_id = p.tenant_id and pi.product_id = p.id
       left join printers pr on pr.tenant_id = p.tenant_id and pr.id = p.printer_id
      where p.tenant_id = $1 and p.id = $2
      for update of p`,
    [tenantId, productId]
  )
  if (!product.rowCount) throw new Error('Produto nao encontrado para atendimento.')
  const row = product.rows[0]
  const requested = quantity(requestedQuantity)
  const ready = Math.max(0, Number(row.quantity) - Number(row.reserved_quantity))
  const reserved = Math.min(requested, ready)
  const production = requested - reserved

  if (reserved) {
    await client.query(
      `insert into product_inventory (tenant_id, product_id, quantity, reserved_quantity, status)
       values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, product_id) do update set
         reserved_quantity = product_inventory.reserved_quantity + $4,
         status = case when product_inventory.quantity <= product_inventory.reserved_quantity + $4 then 'Reservado' else 'Disponivel' end,
         updated_at = now()`,
      [tenantId, productId, Number(row.quantity), reserved, Number(row.quantity) <= Number(row.reserved_quantity) + reserved ? 'Reservado' : 'Disponivel']
    )
  }

  const plan = await client.query(
    `insert into sales_fulfillment_plans (tenant_id, source_type, source_id, product_id, requested_quantity, reserved_quantity, production_quantity, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, reserved_quantity, production_quantity, status`,
    [tenantId, sourceType, sourceId, productId, requested, reserved, production, production ? 'partial_production' : 'reserved']
  )

  if (!production || !row.printer_id) return { plan: plan.rows[0], productionJobId: null }
  const source = sourceColumn(sourceType)
  const priority = await client.query(
    `select coalesce(max(priority), 0) + 1 as next_priority from print_jobs where tenant_id = $1 and printer_id = $2 and status = 'queued'`,
    [tenantId, row.printer_id]
  )
  const job = await client.query(
    `insert into print_jobs (tenant_id, ${source}, product_id, printer_id, agent_printer_id, fulfillment_plan_id, source, title, quantity, priority, status, notes)
     values ($1, $2, $3, $4, $5, $6, 'fulfillment', $7, $8, $9, $10, $11)
     returning id`,
    [tenantId, sourceId, productId, row.printer_id, row.agent_printer_id || null, plan.rows[0].id, title || row.name, production, Number(priority.rows[0]?.next_priority || 1), awaitingConfirmation ? 'awaiting_confirmation' : 'queued', notes]
  )
  try {
    await reserveProductionMaterial({ client, tenantId, printJobId: job.rows[0].id, productId, quantity: production })
  } catch (error) {
    await client.query(`update sales_fulfillment_plans set status = 'awaiting_material', updated_at = now() where tenant_id = $1 and id = $2`, [tenantId, plan.rows[0].id])
  }
  return { plan: plan.rows[0], productionJobId: job.rows[0].id }
}

export const releaseSalesFulfillmentPlan = async ({ client, tenantId, sourceType, sourceId }) => {
  const plan = await client.query(`select id, product_id, reserved_quantity, status from sales_fulfillment_plans where tenant_id = $1 and source_type = $2 and source_id = $3 for update`, [tenantId, sourceType, sourceId])
  if (!plan.rowCount || !plan.rows[0] || ['cancelled', 'fulfilled'].includes(plan.rows[0].status)) return { released: false }
  const row = plan.rows[0]
  const inventory = await client.query(`select p.id, coalesce(i.quantity, 0) as quantity, coalesce(i.reserved_quantity, 0) as reserved_quantity from products p left join product_inventory i on i.tenant_id = p.tenant_id and i.product_id = p.id where p.tenant_id = $1 and p.id = $2 for update of p`, [tenantId, row.product_id])
  if (!inventory.rowCount) throw new Error('Produto reservado nao encontrado.')
  const nextReserved = Math.max(0, Number(inventory.rows[0].reserved_quantity) - Number(row.reserved_quantity))
  const quantity = Number(inventory.rows[0].quantity)
  await client.query(`update product_inventory set reserved_quantity = $3, status = case when quantity = 0 then 'Esgotado' when $3 >= quantity then 'Reservado' else 'Disponivel' end, updated_at = now() where tenant_id = $1 and product_id = $2`, [tenantId, row.product_id, nextReserved])
  await client.query(`update sales_fulfillment_plans set status = 'cancelled', updated_at = now() where tenant_id = $1 and id = $2`, [tenantId, row.id])
  return { released: true }
}

export const reduceSalesFulfillmentPlan = async ({ client, tenantId, sourceType, sourceId, requestedQuantity }) => {
  const requested = Math.max(0, Math.floor(Number(requestedQuantity)))
  const plan = await client.query(
    `select id, product_id, requested_quantity, reserved_quantity, production_quantity, status
       from sales_fulfillment_plans
      where tenant_id = $1 and source_type = $2 and source_id = $3
      for update`,
    [tenantId, sourceType, sourceId]
  )
  if (!plan.rowCount || !plan.rows[0]) return { reduced: false }
  const row = plan.rows[0]
  if (requested >= Number(row.requested_quantity) || ['cancelled', 'fulfilled'].includes(row.status)) return { reduced: false, unchanged: true }

  const inventory = await client.query(
    `select p.id, coalesce(i.quantity, 0) as quantity, coalesce(i.reserved_quantity, 0) as reserved_quantity
       from products p left join product_inventory i on i.tenant_id = p.tenant_id and i.product_id = p.id
      where p.tenant_id = $1 and p.id = $2
      for update of p`,
    [tenantId, row.product_id]
  )
  if (!inventory.rowCount) throw new Error('Produto reservado nao encontrado.')

  const nextReserved = Math.min(Number(row.reserved_quantity), requested)
  const released = Math.max(0, Number(row.reserved_quantity) - nextReserved)
  const resultingReserved = Math.max(0, Number(inventory.rows[0].reserved_quantity) - released)
  await client.query(
    `update product_inventory
        set reserved_quantity = $3,
            status = case when quantity = 0 then 'Esgotado' when $3 >= quantity then 'Reservado' else 'Disponivel' end,
            updated_at = now()
      where tenant_id = $1 and product_id = $2`,
    [tenantId, row.product_id, resultingReserved]
  )

  const jobs = await client.query(
    `select id, product_id, quantity, status
       from print_jobs
      where tenant_id = $1 and fulfillment_plan_id = $2
      order by id desc
      limit 1
      for update`,
    [tenantId, row.id]
  )
  const nextProduction = Math.max(0, requested - nextReserved)
  const job = jobs.rows[0]
  if (job && ['queued', 'awaiting_confirmation'].includes(String(job.status || ''))) {
    await releaseProductionMaterialReservation({ client, tenantId, printJobId: job.id, reason: 'Quantidade do marketplace reduzida.' })
    if (nextProduction > 0) {
      await client.query(`update print_jobs set quantity = $3, updated_at = now() where tenant_id = $1 and id = $2`, [tenantId, job.id, nextProduction])
      await reserveProductionMaterial({ client, tenantId, printJobId: job.id, productId: job.product_id, quantity: nextProduction })
    } else {
      await client.query(`update print_jobs set status = 'cancelled', updated_at = now() where tenant_id = $1 and id = $2`, [tenantId, job.id])
    }
  }
  await client.query(
    `update sales_fulfillment_plans
        set requested_quantity = $3,
            reserved_quantity = $4,
            production_quantity = $5,
            status = case when $3 = 0 then 'cancelled' when $5 > 0 then 'partial_production' else 'reserved' end,
            updated_at = now()
      where tenant_id = $1 and id = $2`,
    [tenantId, row.id, requested, nextReserved, nextProduction]
  )
  return { reduced: true, requestedQuantity: requested, releasedQuantity: released, productionQuantity: nextProduction }
}

export const fulfillSalesFulfillmentPlan = async ({ client, tenantId, orderId = null, sourceType = 'order', sourceId = orderId, audit = null }) => {
  const plan = await client.query(`select id, product_id, requested_quantity, reserved_quantity, status from sales_fulfillment_plans where tenant_id = $1 and source_type = $2 and source_id = $3 for update`, [tenantId, sourceType, sourceId])
  if (!plan.rowCount || !plan.rows[0]) return null
  const row = plan.rows[0]
  if (row.status === 'fulfilled') return { alreadyFulfilled: true }
  if (Number(row.reserved_quantity) < Number(row.requested_quantity)) throw new Error('Pedido ainda nao possui todas as unidades reservadas para expedicao.')
  const inventory = await client.query(`select p.id, coalesce(i.quantity, 0) as quantity, coalesce(i.reserved_quantity, 0) as reserved_quantity from products p left join product_inventory i on i.tenant_id = p.tenant_id and i.product_id = p.id where p.tenant_id = $1 and p.id = $2 for update of p`, [tenantId, row.product_id])
  if (!inventory.rowCount) throw new Error('Produto reservado nao encontrado.')
  const before = Number(inventory.rows[0].quantity)
  const qty = Number(row.requested_quantity)
  await client.query(`update product_inventory set reserved_quantity = greatest(0, reserved_quantity - $3), status = case when quantity = 0 then 'Esgotado' when greatest(0, reserved_quantity - $3) >= quantity then 'Reservado' else 'Disponivel' end, updated_at = now() where tenant_id = $1 and product_id = $2`, [tenantId, row.product_id, qty])
  const movement = await createProductMovementWithClient(client, tenantId, row.product_id, { type: 'out', quantity: qty, reason: `Expedicao automatica do ${sourceType === 'order' ? 'pedido' : 'marketplace'} #${sourceId}` }, audit)
  await client.query(`update sales_fulfillment_plans set status = 'fulfilled', updated_at = now() where tenant_id = $1 and id = $2`, [tenantId, row.id])
  return { movementId: movement.id, quantity: qty, previousQuantity: before }
}
