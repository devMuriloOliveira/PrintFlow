import { withTenant } from '../db/pool.js'
import { writeAuditEvent } from '../services/operationalEvents.js'

const movementTypes = new Set(['in', 'out', 'adjustment'])

export const createFilamentMovementWithClient = async (client, tenantId, filamentId, payload, audit = null) => {
  const type = String(payload?.type || '')
  const quantity = Number(payload?.quantity || 0)
  const reason = String(payload?.reason || '').trim().slice(0, 240)
  if (!movementTypes.has(type)) throw new Error('Tipo de movimentacao invalido')
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('A quantidade deve ser maior que zero')
  if (!reason) throw new Error('Informe o motivo da movimentacao')

  const current = await client.query('select id, remaining_weight, min_stock_weight from filaments where tenant_id = $1 and id = $2 for update', [tenantId, filamentId])
  if (!current.rowCount) throw new Error('Registro nao encontrado')
  const previousWeight = Number(current.rows[0].remaining_weight || 0)
  const resultingWeight = type === 'in' ? previousWeight + quantity : type === 'out' ? previousWeight - quantity : quantity
  if (resultingWeight < 0) throw new Error('Estoque insuficiente para esse consumo')

  const updated = await client.query(
    `update filaments set remaining_weight = $3,
       status = case when $3 = 0 then 'Esgotado' when $3 <= min_stock_weight then 'Baixo estoque' else 'Em estoque' end,
       updated_at = now() where tenant_id = $1 and id = $2 returning status`,
    [tenantId, filamentId, resultingWeight]
  )
  const movement = await client.query(
    `insert into inventory_movements (tenant_id, resource, resource_id, movement_type, quantity, previous_quantity, resulting_quantity, reason, created_by)
     values ($1, 'filaments', $2, $3, $4, $5, $6, $7, $8)
     returning id, movement_type, quantity, previous_quantity, resulting_quantity, reason, created_at`,
    [tenantId, filamentId, type, quantity, previousWeight, resultingWeight, reason, audit?.actorId || null]
  )
  if (audit?.actorId) await writeAuditEvent(tenantId, {
    action: `filaments.stock_${type}`, actorType: audit.actorType || 'user', actorId: audit.actorId,
    entityType: 'filaments', entityId: String(filamentId),
    details: { movementType: type, quantity, previousQuantity: previousWeight, resultingQuantity: resultingWeight, reason }
  }, client)
  return { ...movement.rows[0], status: updated.rows[0].status }
}

export const createFilamentMovement = async (tenantId, filamentId, payload, audit = null) => withTenant(tenantId, async (client) =>
  createFilamentMovementWithClient(client, tenantId, filamentId, payload, audit)
)

export const listFilamentMovements = async (tenantId, filamentId) => withTenant(tenantId, async (client) => {
  const result = await client.query(
    `select id, movement_type, quantity, previous_quantity, resulting_quantity, reason, created_at
       from inventory_movements where tenant_id = $1 and resource = 'filaments' and resource_id = $2
       order by created_at desc, id desc limit 200`,
    [tenantId, filamentId]
  )
  return result.rows.map((row) => ({ id: String(row.id), type: row.movement_type, quantity: Number(row.quantity), previousQuantity: Number(row.previous_quantity), resultingQuantity: Number(row.resulting_quantity), reason: row.reason, createdAt: row.created_at }))
})

const productMovementTypes = new Set(['in', 'out', 'adjustment'])

export const createProductMovement = async (tenantId, productId, payload, audit = null) => withTenant(tenantId, async (client) => {
  const type = String(payload?.type || '')
  const quantity = Number(payload?.quantity || 0)
  const reason = String(payload?.reason || '').trim().slice(0, 240)
  if (!productMovementTypes.has(type)) throw new Error('Tipo de movimentacao invalido')
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('A quantidade deve ser maior que zero')
  if (!reason) throw new Error('Informe o motivo da movimentacao')

  const current = await client.query(
    `select p.id, coalesce(pi.quantity, 0) as quantity, coalesce(pi.reserved_quantity, 0) as reserved_quantity
       from products p left join product_inventory pi on pi.product_id = p.id and pi.tenant_id = p.tenant_id
      where p.tenant_id = $1 and p.id = $2 for update of p`,
    [tenantId, productId]
  )
  if (!current.rowCount) throw new Error('Registro nao encontrado')
  const previousQuantity = Number(current.rows[0].quantity || 0)
  const reservedQuantity = Number(current.rows[0].reserved_quantity || 0)
  const resultingQuantity = type === 'in' ? previousQuantity + quantity : type === 'out' ? previousQuantity - quantity : quantity
  if (resultingQuantity < reservedQuantity) throw new Error('O saldo nao pode ficar abaixo da quantidade reservada')

  const status = resultingQuantity === 0 ? 'Esgotado' : reservedQuantity >= resultingQuantity ? 'Reservado' : 'Disponivel'
  await client.query(
    `insert into product_inventory (tenant_id, product_id, quantity, reserved_quantity, status)
     values ($1, $2, $3, $4, $5)
     on conflict (tenant_id, product_id) do update set quantity = excluded.quantity, status = excluded.status, updated_at = now()`,
    [tenantId, productId, resultingQuantity, reservedQuantity, status]
  )
  const movement = await client.query(
    `insert into inventory_movements (tenant_id, resource, resource_id, movement_type, quantity, previous_quantity, resulting_quantity, reason, created_by)
     values ($1, 'products', $2, $3, $4, $5, $6, $7, $8)
     returning id, resource, resource_id, movement_type, quantity, previous_quantity, resulting_quantity, reason, created_at`,
    [tenantId, productId, type, quantity, previousQuantity, resultingQuantity, reason, audit?.actorId || null]
  )
  if (audit?.actorId) await writeAuditEvent(tenantId, {
    action: `products.stock_${type}`, actorType: audit.actorType || 'user', actorId: audit.actorId,
    entityType: 'products', entityId: String(productId),
    details: { movementType: type, quantity, previousQuantity, resultingQuantity, reason }
  }, client)
  return { ...movement.rows[0], id: String(movement.rows[0].id), resourceId: String(productId), quantity, previousQuantity, resultingQuantity, type, status }
})

export const listProductMovements = async (tenantId, productId = '') => withTenant(tenantId, async (client) => {
  const result = await client.query(
    `select im.id, im.resource, im.resource_id, im.movement_type, im.quantity, im.previous_quantity, im.resulting_quantity, im.reason, im.created_at,
            p.name as product_name, p.sku
       from inventory_movements im left join products p on p.id = im.resource_id and p.tenant_id = im.tenant_id
      where im.tenant_id = $1 and im.resource = 'products' ${productId ? 'and im.resource_id = $2' : ''}
      order by im.created_at desc, im.id desc limit 300`,
    productId ? [tenantId, productId] : [tenantId]
  )
  return result.rows.map((row) => ({ id: String(row.id), resource: row.resource, resourceId: String(row.resource_id), type: row.movement_type, quantity: Number(row.quantity), previousQuantity: Number(row.previous_quantity), resultingQuantity: Number(row.resulting_quantity), reason: row.reason, productName: row.product_name || '', sku: row.sku || '', createdAt: row.created_at }))
})

export const listInventoryOverview = async (tenantId) => withTenant(tenantId, async (client) => {
  const [products, movements] = await Promise.all([
    client.query(`select p.id, p.name, p.sku, p.price, p.cost, p.weight, coalesce(pi.quantity, 0) as quantity, coalesce(pi.reserved_quantity, 0) as reserved_quantity, coalesce(pi.status, 'Esgotado') as status, pi.updated_at from products p left join product_inventory pi on pi.product_id = p.id and pi.tenant_id = p.tenant_id where p.tenant_id = $1 order by p.name`, [tenantId]),
    client.query(`select im.id, im.resource, im.resource_id, im.movement_type, im.quantity, im.previous_quantity, im.resulting_quantity, im.reason, im.created_at, coalesce(p.name, f.name, '') as resource_name from inventory_movements im left join products p on im.resource = 'products' and p.id = im.resource_id and p.tenant_id = im.tenant_id left join filaments f on im.resource = 'filaments' and f.id = im.resource_id and f.tenant_id = im.tenant_id where im.tenant_id = $1 order by im.created_at desc, im.id desc limit 300`, [tenantId])
  ])
  return {
    products: products.rows.map((row) => ({ id: String(row.id), name: row.name, sku: row.sku || '', price: Number(row.price || 0), cost: Number(row.cost || 0), weight: Number(row.weight || 0), quantity: Number(row.quantity || 0), reservedQuantity: Number(row.reserved_quantity || 0), status: row.status, updatedAt: row.updated_at })),
    movements: movements.rows.map((row) => ({ id: String(row.id), resource: row.resource, resourceId: String(row.resource_id), type: row.movement_type, quantity: Number(row.quantity), previousQuantity: Number(row.previous_quantity), resultingQuantity: Number(row.resulting_quantity), reason: row.reason, resourceName: row.resource_name, createdAt: row.created_at }))
  }
})
