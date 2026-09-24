import { createFilamentMovementWithClient } from '../repositories/inventoryRepository.js'
import {
  consumeProductionMaterialReservation,
  markProductionMaterialPending,
  releaseProductionMaterialReservation
} from './productionInventory.js'
import { createPendingProductionOutput } from './productionOutput.js'
import { syncOrderStatusFromProductionJob } from './productionOrderStatus.js'

const finiteNonNegative = (value) => {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

export const normalizeAgentMetrics = (payload = {}) => {
  const metric = (value, max) => {
    const normalized = finiteNonNegative(value)
    return normalized == null || normalized > max ? null : normalized
  }
  const status = String(payload.status || 'completed').trim().toLowerCase()
  if (!['completed', 'failed', 'cancelled'].includes(status)) throw new Error('Status de Production Job invalido.')
  return {
    status,
    idempotencyKey: String(payload.idempotencyKey || '').trim().slice(0, 160),
    attemptNo: Number.isInteger(Number(payload.attemptNo)) && Number(payload.attemptNo) > 0 ? Number(payload.attemptNo) : 1,
    actualPrintSeconds: metric(payload.actualPrintSeconds, 365 * 24 * 3600),
    actualFilamentGrams: metric(payload.actualFilamentGrams, 100000),
    actualFilamentMillimeters: metric(payload.actualFilamentMillimeters, 10000000)
  }
}

const applyCompletionEffects = async ({ client, tenantId, printJobId, metrics }) => {
  const details = await client.query(
    `select j.quantity, coalesce(j.printer_id, ap.printer_id) as printer_id,
            p.filament_id, p.weight, p.cost_breakdown, f.initial_weight, f.cost,
            pr.power_w, t.kwh_cost
       from print_jobs j
       join tenants t on t.id = j.tenant_id
       left join products p on p.id = j.product_id and p.tenant_id = j.tenant_id
       left join filaments f on f.id = p.filament_id and f.tenant_id = j.tenant_id
       left join agent_printers ap on ap.id = j.agent_printer_id and ap.tenant_id = j.tenant_id
       left join printers pr on pr.id = coalesce(j.printer_id, ap.printer_id) and pr.tenant_id = j.tenant_id
      where j.tenant_id = $1 and j.id = $2
      for update of j`,
    [tenantId, printJobId]
  )
  if (!details.rowCount) return { inventory: 'unavailable' }
  const row = details.rows[0]
  const product = { weight: row.weight, cost_breakdown: row.cost_breakdown || {} }
  const measuredGrams = finiteNonNegative(metrics.actualFilamentGrams)
  const measuredSeconds = finiteNonNegative(metrics.actualPrintSeconds)
  const materialGrams = measuredGrams ?? recipeMaterialGrams(product, row.quantity)
  let inventory = materialGrams == null ? 'recipe_unavailable' : 'estimated'
  if (materialGrams != null && materialGrams > 0 && row.filament_id) {
    try {
      await client.query('savepoint production_inventory_effect')
      const reservation = await consumeProductionMaterialReservation({
        client, tenantId, printJobId, grams: materialGrams,
        reason: `Consumo ${measuredGrams != null ? 'medido' : 'estimado pela receita'} na conclusão da impressão #${printJobId}`
      })
      if (!reservation.consumed && reservation.reason === 'reservation_missing') {
        await createFilamentMovementWithClient(client, tenantId, row.filament_id, {
          type: 'out', quantity: materialGrams,
          reason: `Consumo ${measuredGrams != null ? 'medido' : 'estimado pela receita'} na conclusão da impressão #${printJobId}`
        })
      }
      await client.query('release savepoint production_inventory_effect')
      inventory = 'deducted'
    } catch (error) {
      await client.query('rollback to savepoint production_inventory_effect')
      await client.query('release savepoint production_inventory_effect')
      await markProductionMaterialPending({ client, tenantId, printJobId, grams: materialGrams, error })
      inventory = 'pending'
    }
  }
  const measurements = buildProductionMeasurements({
    job: { quantity: row.quantity },
    product,
    filament: { initial_weight: row.initial_weight, cost: row.cost },
    printer: { power_w: row.power_w },
    energyPricePerKwh: product.cost_breakdown.energyRate ?? product.cost_breakdown.energy_rate ?? row.kwh_cost ?? 0,
    metrics
  })
  await client.query(
    `update print_jobs
        set actual_material_cost = $3::numeric,
            actual_energy_cost = $4::numeric,
            actual_maintenance_hours = $5::numeric,
            updated_at = now()
      where tenant_id = $1 and id = $2`,
    [tenantId, printJobId, measurements.materialCost, measurements.energyCost, measurements.maintenanceHours]
  )
  if (row.printer_id && measuredSeconds != null) {
    await client.query(
      `update printers
          set accumulated_hours = coalesce(accumulated_hours, 0) + ($3::numeric / 3600),
              updated_at = now()
        where tenant_id = $1 and id = $2`,
      [tenantId, row.printer_id, measuredSeconds]
    )
  }
  return { inventory, materialCost: measurements.materialCost, energyCost: measurements.energyCost, maintenanceHours: measurements.maintenanceHours }
}

export const recordProductionJobMetrics = async ({ client, tenantId, agentId, printJobId, payload, applyEffects = true }) => {
  const metrics = normalizeAgentMetrics(payload)
  if (!metrics.idempotencyKey) throw new Error('idempotencyKey obrigatoria.')
  const jobResult = await client.query(
    `select j.id, j.status
       from print_jobs j
       join agent_printers ap on ap.id = j.agent_printer_id and ap.tenant_id = j.tenant_id
      where j.tenant_id = $1 and j.id = $2 and ap.agent_id = $3
      for update`,
    [tenantId, printJobId, agentId]
  )
  if (!jobResult.rowCount) return null
  const currentJobStatus = String(jobResult.rows[0].status || '').toLowerCase()
  const jobAlreadyTerminal = ['completed', 'cancelled', 'failed'].includes(currentJobStatus)

  const existing = await client.query(
    `select id, print_job_id, attempt_no, status, result
       from print_job_attempts
      where tenant_id = $1 and idempotency_key = $2
      limit 1`,
    [tenantId, metrics.idempotencyKey]
  )
  if (existing.rowCount) {
    const row = existing.rows[0]
    if (String(row.print_job_id) !== String(printJobId) || Number(row.attempt_no) !== metrics.attemptNo) {
      const conflict = new Error('idempotencyKey ja foi usada por outra tentativa.')
      conflict.statusCode = 409
      throw conflict
    }
    return { idempotent: true, attempt: row }
  }

  const resultPayload = {
    actualPrintSeconds: metrics.actualPrintSeconds,
    actualFilamentGrams: metrics.actualFilamentGrams,
    actualFilamentMillimeters: metrics.actualFilamentMillimeters
  }
  const attempt = await client.query(
    `insert into print_job_attempts (
       tenant_id, print_job_id, agent_command_id, attempt_no, idempotency_key,
       status, result, completed_at, updated_at
     ) values ($1, $2, null, $3, $4, $5, $6::jsonb, now(), now())
     returning id, print_job_id, attempt_no, status, result`,
    [tenantId, printJobId, metrics.attemptNo, metrics.idempotencyKey, metrics.status, JSON.stringify(resultPayload)]
  )
  await client.query(
    `update print_jobs
        set status = $3,
            actual_print_seconds = coalesce($4::numeric, actual_print_seconds),
            actual_filament_grams = coalesce($5::numeric, actual_filament_grams),
            actual_filament_millimeters = coalesce($6::numeric, actual_filament_millimeters),
            metrics_source = case when $4::numeric is not null or $5::numeric is not null or $6::numeric is not null then 'agent_measured' else metrics_source end,
            metrics_recorded_at = case when $4::numeric is not null or $5::numeric is not null or $6::numeric is not null then now() else metrics_recorded_at end,
            completed_at = case when $3 = 'completed' then coalesce(completed_at, now()) else completed_at end,
            cancelled_at = case when $3 in ('failed', 'cancelled') then coalesce(cancelled_at, now()) else cancelled_at end,
            updated_at = now()
      where tenant_id = $1 and id = $2`,
    [tenantId, printJobId, jobAlreadyTerminal ? currentJobStatus : metrics.status, metrics.actualPrintSeconds, metrics.actualFilamentGrams, metrics.actualFilamentMillimeters]
  )
  const effects = metrics.status === 'completed' && applyEffects && !jobAlreadyTerminal
    ? await applyCompletionEffects({ client, tenantId, printJobId, metrics })
    : metrics.status === 'completed' || jobAlreadyTerminal
      ? { skipped: jobAlreadyTerminal ? 'job_already_terminal' : 'effects_disabled' }
      : { reservation: await releaseProductionMaterialReservation({
        client, tenantId, printJobId,
        reason: `Impressão ${metrics.status}; reserva liberada.`
      }) }
  if (metrics.status === 'completed' && !jobAlreadyTerminal) await createPendingProductionOutput({ client, tenantId, printJobId })
  if (metrics.status === 'completed' && !jobAlreadyTerminal) {
    await syncOrderStatusFromProductionJob({ client, tenantId, printJobId, nextStatus: 'Impresso' })
  }
  return { idempotent: false, attempt: attempt.rows[0], effects }
}

const round = (value, digits = 3) => {
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

export const recipeMaterialGrams = (product, quantity = 1) => {
  const weight = finiteNonNegative(product?.weight ?? product?.cost_breakdown?.materialWeight ?? product?.costBreakdown?.materialWeight)
  if (weight == null || weight <= 0) return null
  const waste = finiteNonNegative(product?.cost_breakdown?.wastePercent ?? product?.costBreakdown?.wastePercent) || 0
  return round(weight * Math.max(1, Math.floor(Number(quantity) || 1)) * (1 + waste / 100))
}

/**
 * Chooses measured Agent metrics when present, otherwise the product recipe.
 * It never mutates stock; callers persist/consume only after an idempotent job
 * transition has been committed.
 */
export const buildProductionMeasurements = ({ job = {}, product = {}, filament = {}, printer = {}, energyPricePerKwh = 0, metrics = {} } = {}) => {
  const recipeGrams = recipeMaterialGrams(product, job.quantity)
  const measuredGrams = finiteNonNegative(metrics.actualFilamentGrams ?? job.actualFilamentGrams)
  const estimatedGrams = finiteNonNegative(metrics.estimatedFilamentGrams ?? job.estimatedFilamentGrams) ?? recipeGrams
  const actualSeconds = finiteNonNegative(metrics.actualPrintSeconds ?? job.actualPrintSeconds)
  const estimatedSeconds = finiteNonNegative(metrics.estimatedPrintSeconds ?? job.estimatedPrintSeconds)
  const grams = measuredGrams != null ? measuredGrams : recipeGrams
  const initialWeight = finiteNonNegative(filament.initial_weight ?? filament.initialWeight)
  const filamentCost = finiteNonNegative(filament.cost)
  const materialCost = grams != null && initialWeight > 0 && filamentCost != null
    ? round((grams / initialWeight) * filamentCost, 2)
    : null
  const seconds = actualSeconds ?? estimatedSeconds
  const powerWatts = finiteNonNegative(printer.power_w ?? printer.power)
  const energyRate = finiteNonNegative(energyPricePerKwh)
  const energyCost = seconds != null && powerWatts != null && energyRate != null
    ? round((seconds / 3600) * (powerWatts / 1000) * energyRate, 2)
    : null

  return {
    source: measuredGrams != null || actualSeconds != null ? 'agent_measured' : 'recipe_estimate',
    estimated: { filamentGrams: estimatedGrams, printSeconds: estimatedSeconds },
    actual: { filamentGrams: measuredGrams, printSeconds: actualSeconds },
    consumptionGrams: grams,
    materialCost,
    energyCost,
    maintenanceHours: seconds == null ? null : round(seconds / 3600, 2)
  }
}
