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
