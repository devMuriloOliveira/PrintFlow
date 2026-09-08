import { withTenant } from '../db/pool.js'

const financialFields = {
  products: ['price', 'packaging_cost', 'additional_materials_cost', 'labor_cost', 'energy_enabled', 'marketplace_fee', 'desired_margin', 'cost', 'profit', 'margin', 'cost_breakdown'],
  filaments: ['cost', 'initial_weight', 'remaining_weight', 'purchase_date'],
  printers: ['power_w', 'accumulated_hours'],
  marketplaces: ['commission', 'fixed', 'financial', 'ads', 'others']
}

const comparable = (value) => JSON.stringify(value ?? null)

export const buildFinancialSnapshot = (resource, row = {}) => {
  const fields = financialFields[resource]
  if (!fields) return null
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]))
}

export const recordFinancialSnapshot = async (client, tenantId, resource, resourceId, row, source = 'resource') => {
  const snapshot = buildFinancialSnapshot(resource, row)
  if (!snapshot || !resourceId) return

  const previous = await client.query(
    `select snapshot
       from financial_history
      where tenant_id = $1 and resource = $2 and resource_id = $3
      order by created_at desc, id desc
      limit 1`,
    [tenantId, resource, String(resourceId)]
  )

  if (previous.rows[0] && comparable(previous.rows[0].snapshot) === comparable(snapshot)) return

  await client.query(
    `insert into financial_history (tenant_id, resource, resource_id, snapshot, source)
     values ($1, $2, $3, $4::jsonb, $5)`,
    [tenantId, resource, String(resourceId), JSON.stringify(snapshot), source]
  )
}

export const listFinancialHistory = async (tenantId, resource, resourceId) => withTenant(tenantId, async (client) => {
  const params = [tenantId]
  const filters = ['tenant_id = $1']
  if (resource) {
    params.push(resource)
    filters.push(`resource = $${params.length}`)
  }
  if (resourceId) {
    params.push(String(resourceId))
    filters.push(`resource_id = $${params.length}`)
  }

  const result = await client.query(
    `select id, resource, resource_id, snapshot, source, created_at
       from financial_history
      where ${filters.join(' and ')}
      order by created_at desc, id desc
      limit 200`,
    params
  )
  return result.rows.map((row) => ({
    id: String(row.id),
    resource: row.resource,
    resourceId: row.resource_id,
    snapshot: row.snapshot || {},
    source: row.source,
    createdAt: row.created_at
  }))
})
