import { withTenant } from '../db/pool.js'

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const toSimulation = (row) => ({
  id: String(row.id),
  name: row.name,
  pricePerKg: number(row.price_per_kg),
  weight: number(row.weight),
  durationMinutes: Number(row.duration_minutes || 0),
  energyEnabled: row.energy_enabled,
  energyRate: number(row.energy_rate),
  watts: number(row.watts),
  margin: number(row.margin),
  directCost: number(row.direct_cost),
  suggestedPrice: number(row.suggested_price),
  snapshot: row.snapshot || {},
  createdBy: row.created_by || null,
  createdAt: row.created_at
})

export const listCalculatorSimulations = (tenantId) => withTenant(tenantId, async (client) => {
  const result = await client.query(
    `select id, name, price_per_kg, weight, duration_minutes, energy_enabled, energy_rate,
            watts, margin, direct_cost, suggested_price, snapshot, created_by, created_at
       from calculator_simulations
      where tenant_id = $1
      order by created_at desc, id desc
      limit 100`,
    [tenantId]
  )
  return result.rows.map(toSimulation)
})

export const createCalculatorSimulation = (tenantId, userId, payload) => withTenant(tenantId, async (client) => {
  const snapshot = payload.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : {}
  const result = await client.query(
    `insert into calculator_simulations
       (tenant_id, name, price_per_kg, weight, duration_minutes, energy_enabled, energy_rate,
        watts, margin, direct_cost, suggested_price, snapshot, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
     returning id, name, price_per_kg, weight, duration_minutes, energy_enabled, energy_rate,
               watts, margin, direct_cost, suggested_price, snapshot, created_by, created_at`,
    [
      tenantId,
      String(payload.name || 'Simulacao sem nome').trim().slice(0, 160) || 'Simulacao sem nome',
      Math.max(0, number(payload.pricePerKg)),
      Math.max(0, number(payload.weight)),
      Math.max(0, Math.floor(number(payload.durationMinutes))),
      payload.energyEnabled !== false,
      Math.max(0, number(payload.energyRate)),
      Math.max(0, number(payload.watts)),
      Math.max(0, number(payload.margin)),
      Math.max(0, number(payload.directCost)),
      Math.max(0, number(payload.suggestedPrice)),
      JSON.stringify(snapshot),
      userId || null
    ]
  )
  return toSimulation(result.rows[0])
})
