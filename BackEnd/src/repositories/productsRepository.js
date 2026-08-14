import { tenantQuery, withTenant } from '../db/pool.js'

const mapProduct = (row) => ({
  id: String(row.id),
  name: row.name,
  subtitle: row.subtitle || '',
  sku: row.sku,
  category: row.category || '',
  description: row.description || '',
  printer: row.printer || '',
  price: Number(row.price),
  weight: Number(row.weight),
  time: row.print_time || '',
  layer: Number(row.layer_height),
  infill: Number(row.infill),
  dimensions: row.dimensions || '',
  filament: row.filament || '',
  filamentColor: row.filament_color || '#1768f2',
  packaging: Number(row.packaging_cost),
  materials: Number(row.additional_materials_cost),
  labor: Number(row.labor_cost),
  energy: row.energy_enabled,
  marketplaceFee: Number(row.marketplace_fee),
  desiredMargin: Number(row.desired_margin),
  cost: Number(row.cost),
  profit: Number(row.profit),
  margin: Number(row.margin),
  status: row.status,
  thumb: row.thumb
})

export const listProducts = async (tenantId) => {
  const result = await tenantQuery(tenantId,
    `select id, name, subtitle, sku, category, description, printer, price, weight, print_time,
      layer_height, infill, dimensions, filament, filament_color, packaging_cost,
      additional_materials_cost, labor_cost, energy_enabled, marketplace_fee, desired_margin,
      cost, profit, margin, status, thumb
     from products
     where tenant_id = $1
     order by created_at desc`,
    [tenantId]
  )

  return result.rows.map(mapProduct)
}

export const createProduct = async (tenantId, product) => {
  const result = await withTenant(tenantId, async (client) => {
    await client.query(
      `insert into tenants (id, name)
       values ($1, $1)
       on conflict (id) do nothing`,
      [tenantId]
    )

    return client.query(
    `insert into products (
      tenant_id, name, subtitle, sku, category, description, printer, price, weight, print_time,
      layer_height, infill, dimensions, filament, filament_color, packaging_cost,
      additional_materials_cost, labor_cost, energy_enabled, marketplace_fee, desired_margin,
      cost, profit, margin, status, thumb
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
    on conflict (tenant_id, sku) do update set
      name = excluded.name,
      subtitle = excluded.subtitle,
      category = excluded.category,
      description = excluded.description,
      printer = excluded.printer,
      price = excluded.price,
      weight = excluded.weight,
      print_time = excluded.print_time,
      layer_height = excluded.layer_height,
      infill = excluded.infill,
      dimensions = excluded.dimensions,
      filament = excluded.filament,
      filament_color = excluded.filament_color,
      packaging_cost = excluded.packaging_cost,
      additional_materials_cost = excluded.additional_materials_cost,
      labor_cost = excluded.labor_cost,
      energy_enabled = excluded.energy_enabled,
      marketplace_fee = excluded.marketplace_fee,
      desired_margin = excluded.desired_margin,
      cost = excluded.cost,
      profit = excluded.profit,
      margin = excluded.margin,
      status = excluded.status,
      thumb = excluded.thumb,
      updated_at = now()
    returning id, name, subtitle, sku, category, description, printer, price, weight, print_time,
      layer_height, infill, dimensions, filament, filament_color, packaging_cost,
      additional_materials_cost, labor_cost, energy_enabled, marketplace_fee, desired_margin,
      cost, profit, margin, status, thumb`,
      [
      tenantId,
      product.name,
      product.subtitle || '',
      product.sku,
      product.category || '',
      product.description || '',
      product.printer || '',
      Number(product.price || 0),
      Number(product.weight || 0),
      product.time || '',
      Number(product.layer || 0),
      Number(product.infill || 0),
      product.dimensions || '',
      product.filament || '',
      product.filamentColor || '#1768f2',
      Number(product.packaging || 0),
      Number(product.materials || 0),
      Number(product.labor || 0),
      product.energy !== false,
      Number(product.marketplaceFee || 0),
      Number(product.desiredMargin || 0),
      Number(product.cost || 0),
      Number(product.profit || 0),
      Number(product.margin || 0),
      product.status || 'Ativo',
      product.thumb || 'vase'
      ]
    )
  })

  return mapProduct(result.rows[0])
}
