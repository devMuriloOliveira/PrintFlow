import { tenantQuery, withTenant } from '../db/pool.js'

const mapProduct = (row) => ({
  id: String(row.id),
  name: row.name,
  subtitle: row.subtitle || '',
  sku: row.sku,
  category: row.category || '',
  price: Number(row.price),
  weight: Number(row.weight),
  time: row.print_time || '',
  filament: row.filament || '',
  filamentColor: row.filament_color || '#1768f2',
  cost: Number(row.cost),
  profit: Number(row.profit),
  margin: Number(row.margin),
  status: row.status,
  thumb: row.thumb
})

export const listProducts = async (tenantId) => {
  const result = await tenantQuery(tenantId,
    `select id, name, subtitle, sku, category, price, weight, print_time, filament,
      filament_color, cost, profit, margin, status, thumb
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
      tenant_id, name, subtitle, sku, category, price, weight, print_time,
      filament, filament_color, cost, profit, margin, status, thumb
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    on conflict (tenant_id, sku) do update set
      name = excluded.name,
      subtitle = excluded.subtitle,
      category = excluded.category,
      price = excluded.price,
      weight = excluded.weight,
      print_time = excluded.print_time,
      filament = excluded.filament,
      filament_color = excluded.filament_color,
      cost = excluded.cost,
      profit = excluded.profit,
      margin = excluded.margin,
      status = excluded.status,
      thumb = excluded.thumb,
      updated_at = now()
    returning id, name, subtitle, sku, category, price, weight, print_time, filament,
      filament_color, cost, profit, margin, status, thumb`,
      [
      tenantId,
      product.name,
      product.subtitle || '',
      product.sku,
      product.category || '',
      Number(product.price || 0),
      Number(product.weight || 0),
      product.time || '',
      product.filament || '',
      product.filamentColor || '#1768f2',
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
