import { createFilamentMovementWithClient } from '../repositories/inventoryRepository.js'

const gramsFor = (product, quantity) => {
  const filamentId = String(product?.filament_id ?? product?.filamentId ?? '').trim()
  const weight = Number(product?.weight ?? product?.cost_breakdown?.materialWeight ?? product?.costBreakdown?.materialWeight ?? 0)
  const waste = Math.max(0, Number(product?.cost_breakdown?.wastePercent ?? product?.costBreakdown?.wastePercent ?? 0))
  const units = Math.max(1, Math.floor(Number(quantity) || 1))
  const grams = Math.round(weight * units * (1 + waste / 100) * 1000) / 1000
  return { filamentId: filamentId || null, grams }
}

const reservationForUpdate = (client, tenantId, printJobId) => client.query(
  `select id, filament_id, reserved_grams, consumed_grams, status
     from print_job_material_reservations
    where tenant_id = $1 and print_job_id = $2
    for update`,
  [tenantId, printJobId]
)

const lockFilament = async (client, tenantId, filamentId) => {
  const result = await client.query(
    `select id, remaining_weight
       from filaments
      where tenant_id = $1 and id = $2
      for update`,
    [tenantId, filamentId]
  )
  if (!result.rowCount) throw new Error('Filamento da producao nao encontrado.')
  return result.rows[0]
}

const otherActiveReservationGrams = async (client, tenantId, filamentId, printJobId) => {
  const result = await client.query(
    `select coalesce(sum(reserved_grams), 0) as grams
       from print_job_material_reservations
      where tenant_id = $1 and filament_id = $2 and print_job_id <> $3
        and status = 'active'`,
    [tenantId, filamentId, printJobId]
  )
  return Number(result.rows[0]?.grams || 0)
}

export const reserveProductionMaterial = async ({ client, tenantId, printJobId, productId, quantity }) => {
  const existing = await reservationForUpdate(client, tenantId, printJobId)
  if (existing.rowCount) return { reserved: existing.rows[0].status === 'active', reservation: existing.rows[0] }

  const productResult = await client.query(
    `select filament_id, weight, cost_breakdown
       from products where tenant_id = $1 and id = $2`,
    [tenantId, productId]
  )
  if (!productResult.rowCount) throw new Error('Produto nao encontrado para reserva de material.')
  const usage = gramsFor(productResult.rows[0], quantity)
  if (!usage.filamentId || usage.grams <= 0) return { reserved: false, reason: 'recipe_missing' }

  const filament = await lockFilament(client, tenantId, usage.filamentId)
  const committed = await otherActiveReservationGrams(client, tenantId, usage.filamentId, printJobId)
  const available = Number(filament.remaining_weight || 0) - committed
  if (available < usage.grams) throw new Error('Estoque de filamento insuficiente para reservar esta producao.')

  const inserted = await client.query(
    `insert into print_job_material_reservations (tenant_id, print_job_id, filament_id, reserved_grams)
     values ($1, $2, $3, $4)
     returning id, filament_id, reserved_grams, status`,
    [tenantId, printJobId, usage.filamentId, usage.grams]
  )
  return { reserved: true, reservation: inserted.rows[0] }
}

export const releaseProductionMaterialReservation = async ({ client, tenantId, printJobId, reason = '' }) => {
  const result = await client.query(
    `update print_job_material_reservations
        set status = 'released', last_error = $3, released_at = coalesce(released_at, now()), updated_at = now()
      where tenant_id = $1 and print_job_id = $2 and status in ('active', 'pending')
      returning id, filament_id, reserved_grams`,
    [tenantId, printJobId, String(reason).slice(0, 240)]
  )
  return result.rowCount ? { released: true, reservation: result.rows[0] } : { released: false }
}

export const consumeProductionMaterialReservation = async ({ client, tenantId, printJobId, grams, reason, audit = null }) => {
  const reservationResult = await reservationForUpdate(client, tenantId, printJobId)
  if (!reservationResult.rowCount) return { consumed: false, reason: 'reservation_missing' }
  const reservation = reservationResult.rows[0]
  if (reservation.status === 'consumed') return { consumed: true, idempotent: true }
  if (!['active', 'pending'].includes(reservation.status)) return { consumed: false, reason: reservation.status }

  const quantity = Number(grams)
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Consumo de material invalido.')
  const filament = await lockFilament(client, tenantId, reservation.filament_id)
  const committedElsewhere = await otherActiveReservationGrams(client, tenantId, reservation.filament_id, printJobId)
  if (Number(filament.remaining_weight || 0) - committedElsewhere < quantity) {
    throw new Error('Estoque insuficiente para concluir o consumo reservado.')
  }

  const movement = await createFilamentMovementWithClient(client, tenantId, reservation.filament_id, {
    type: 'out', quantity, reason
  }, audit)
  await client.query(
    `update print_job_material_reservations
        set status = 'consumed', consumed_grams = $3, last_error = '', consumed_at = coalesce(consumed_at, now()), updated_at = now()
      where tenant_id = $1 and print_job_id = $2`,
    [tenantId, printJobId, quantity]
  )
  return { consumed: true, movement }
}

export const markProductionMaterialPending = async ({ client, tenantId, printJobId, grams, error }) => {
  const result = await client.query(
    `update print_job_material_reservations
        set status = 'pending', consumed_grams = $3, last_error = $4, updated_at = now()
      where tenant_id = $1 and print_job_id = $2 and status = 'active'
      returning id, filament_id, reserved_grams, consumed_grams`,
    [tenantId, printJobId, Number(grams), String(error?.message || error || '').slice(0, 240)]
  )
  return result.rows[0] || null
}

export const listPendingProductionMaterial = async ({ client, tenantId, limit = 100 }) => {
  const result = await client.query(
    `select r.print_job_id, r.filament_id, r.reserved_grams, r.consumed_grams, r.last_error, r.updated_at,
            f.name as filament_name, j.title as print_job_title
       from print_job_material_reservations r
       join filaments f on f.id = r.filament_id and f.tenant_id = r.tenant_id
       join print_jobs j on j.id = r.print_job_id and j.tenant_id = r.tenant_id
      where r.tenant_id = $1 and r.status = 'pending'
      order by r.updated_at asc
      limit $2`,
    [tenantId, Math.min(100, Math.max(1, Number(limit) || 100))]
  )
  return result.rows.map((row) => ({
    printJobId: String(row.print_job_id), filamentId: String(row.filament_id),
    filamentName: row.filament_name, title: row.print_job_title,
    reservedGrams: Number(row.reserved_grams), consumptionGrams: Number(row.consumed_grams),
    lastError: row.last_error, updatedAt: row.updated_at
  }))
}

export const reconcilePendingProductionMaterial = async ({ client, tenantId, printJobId, audit = null }) => {
  const reservation = await reservationForUpdate(client, tenantId, printJobId)
  if (!reservation.rowCount || reservation.rows[0].status !== 'pending') return { reconciled: false, reason: 'not_pending' }
  const grams = Number(reservation.rows[0].consumed_grams || 0)
  return consumeProductionMaterialReservation({
    client, tenantId, printJobId, grams,
    reason: `Consumo reconciliado da impressao #${printJobId}`,
    audit
  })
}

export { gramsFor }
