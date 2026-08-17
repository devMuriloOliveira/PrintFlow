import { withTenant } from '../db/pool.js'
import { decryptField } from '../security/crypto.js'

const number = (value) => Number(value || 0)
const maskSensitiveIdentifier = (value) => {
  const decrypted = decryptField(value)
  if (!decrypted) return ''
  if (decrypted.length <= 4) return '****'
  return `${decrypted.slice(0, 2)}***${decrypted.slice(-2)}`
}

const mapProduct = (row) => ({
  id: String(row.id), name: row.name, subtitle: row.subtitle || '', sku: row.sku, category: row.category || '',
  description: row.description || '', printerId: row.printer_id ? String(row.printer_id) : '', printer: row.printer_name || row.printer || '', price: number(row.price), weight: number(row.weight),
  time: row.print_time || '', layer: number(row.layer_height), infill: number(row.infill), dimensions: row.dimensions || '',
  filamentId: row.filament_id ? String(row.filament_id) : '', filament: row.filament_name || row.filament || '', filamentColor: row.filament_color || row.linked_filament_color || '#1768f2',
  packaging: number(row.packaging_cost), materials: number(row.additional_materials_cost), labor: number(row.labor_cost),
  energy: row.energy_enabled, marketplaceFee: number(row.marketplace_fee), desiredMargin: number(row.desired_margin),
  cost: number(row.cost), profit: number(row.profit), margin: number(row.margin), costBreakdown: row.cost_breakdown || {}, status: row.status, thumb: row.thumb,
  createdAt: row.created_at || '', updatedAt: row.updated_at || ''
})

const readProducts = async (client, tenantId) => {
  const result = await client.query(`
    select p.id, p.name, p.subtitle, p.sku, p.category, p.description, p.printer_id, p.printer, pr.name as printer_name,
      p.price, p.weight, p.print_time, p.layer_height, p.infill, p.dimensions, p.filament_id, p.filament,
      f.name as filament_name, p.filament_color, f.color_hex as linked_filament_color, p.packaging_cost,
      p.additional_materials_cost, p.labor_cost, p.energy_enabled, p.marketplace_fee, p.desired_margin,
      p.cost, p.profit, p.margin, p.cost_breakdown, p.status, p.thumb,
      to_char(p.created_at, 'YYYY-MM-DD') as created_at, to_char(p.updated_at, 'YYYY-MM-DD') as updated_at
    from products p
    left join printers pr on pr.id = p.printer_id and pr.tenant_id = p.tenant_id
    left join filaments f on f.id = p.filament_id and f.tenant_id = p.tenant_id
    where p.tenant_id = $1 order by p.created_at desc
  `, [tenantId])
  return result.rows.map(mapProduct)
}

const readOrders = async (client, tenantId) => {
  const result = await client.query(`
    select o.id, o.external_id, o.product_id, to_char(o.order_date, 'DD/MM/YYYY') as date, coalesce(c.name, 'Nao informado') as client,
      coalesce(m.name, 'Nao informado') as marketplace, o.product_name as product, o.quantity as qty,
      o.gross, o.fee, o.shipping, o.net, o.profit, o.status
    from orders o
    left join clients c on c.id = o.client_id and c.tenant_id = o.tenant_id
    left join marketplaces m on m.id = o.marketplace_id and m.tenant_id = o.tenant_id
    where o.tenant_id = $1 order by o.order_date desc, o.id desc
  `, [tenantId])
  return result.rows.map((row) => ({ dbId: String(row.id), id: row.external_id, productId: row.product_id ? String(row.product_id) : '', date: row.date, client: decryptField(row.client), marketplace: row.marketplace,
    product: row.product, qty: Number(row.qty), gross: number(row.gross), fee: number(row.fee), shipping: number(row.shipping),
    net: number(row.net), profit: number(row.profit), status: row.status }))
}

const readExpenses = async (client, tenantId) => {
  const result = await client.query(`
    select id, description, category, supplier, amount as value, to_char(expense_date, 'DD/MM/YYYY') as date,
      payment, recurrence, status from expenses where tenant_id = $1 order by expense_date desc, id desc
  `, [tenantId])
  return result.rows.map((row) => ({ ...row, id: String(row.id), value: number(row.value) }))
}

const readFilaments = async (client, tenantId) => {
  const result = await client.query(`
    select id, name, maker, material, type, color, color_hex, initial_weight, remaining_weight, cost, supplier,
      to_char(purchase_date, 'DD/MM/YYYY') as date, status from filaments where tenant_id = $1 order by created_at desc
  `, [tenantId])
  return result.rows.map((row) => ({ id: String(row.id), name: row.name, maker: row.maker, material: row.material, type: row.type,
    color: row.color, colorHex: row.color_hex, initial: number(row.initial_weight), remaining: number(row.remaining_weight),
    cost: number(row.cost), supplier: row.supplier, date: row.date || '', status: row.status }))
}

const readPrinters = async (client, tenantId) => {
  const result = await client.query(`
    select id, name, code, maker, model, to_char(acquired_at, 'DD/MM/YYYY') as acquired, power_w, accumulated_hours,
      status, to_char(last_maintenance_at, 'DD/MM/YYYY') as maintenance, serial, location, volume, default_filament
    from printers where tenant_id = $1 order by created_at desc
  `, [tenantId])
  return result.rows.map((row) => ({ id: String(row.id), name: row.name, code: row.code, maker: row.maker, model: row.model, acquired: row.acquired || '',
    power: number(row.power_w), hours: number(row.accumulated_hours), status: row.status, maintenance: row.maintenance || '',
    serial: row.serial, location: row.location, volume: row.volume, defaultFilament: row.default_filament }))
}

const readMarketplaces = async (client, tenantId) => {
  const result = await client.query(`
    select m.id, m.name, m.short, m.color, m.platform, m.connection_status, m.commission, m.fixed, m.financial, m.ads, m.others, m.active,
      coalesce(o.gross, 0) + coalesce(ts.gross, 0) as gross,
      coalesce(o.net, 0) + coalesce(ts.net, 0) as net,
      (coalesce(o.orders, 0) + coalesce(ts.orders, 0))::int as orders
    from marketplaces m
    left join (
      select marketplace_id, sum(gross) as gross, sum(net) as net, count(id)::int as orders
      from orders where tenant_id = $1 group by marketplace_id
    ) o on o.marketplace_id = m.id
    left join (
      select marketplace_id, sum(gross) as gross, sum(net) as net, count(id)::int as orders
      from tracked_sales where tenant_id = $1 group by marketplace_id
    ) ts on ts.marketplace_id = m.id
    where m.tenant_id = $1
    order by m.created_at asc
  `, [tenantId])
  return result.rows.map((row) => ({ id: String(row.id), name: row.name, short: row.short, color: row.color, commission: number(row.commission),
    fixed: number(row.fixed), financial: number(row.financial), ads: number(row.ads), others: number(row.others),
    gross: number(row.gross), net: number(row.net), orders: Number(row.orders), active: row.active,
    platform: row.platform, connectionStatus: row.connection_status }))
}

const readClients = async (client, tenantId) => {
  const result = await client.query(`
    select c.id, c.name, c.email, c.phone, count(o.id)::int as orders, coalesce(sum(o.gross), 0) as revenue,
      coalesce(avg(o.gross), 0) as ticket, to_char(max(o.order_date), 'DD/MM/YYYY') as last
    from clients c left join orders o on o.client_id = c.id and o.tenant_id = $1
    where c.tenant_id = $1 group by c.id order by c.created_at desc
  `, [tenantId])
  return result.rows.map((row) => ({ id: String(row.id), name: decryptField(row.name), email: decryptField(row.email), phone: decryptField(row.phone), orders: Number(row.orders),
    revenue: number(row.revenue), ticket: number(row.ticket), last: row.last || '' }))
}

const readExpenseSegments = async (client, tenantId) => {
  const result = await client.query(`
    select category as label, sum(amount) as total from expenses where tenant_id = $1 group by category order by total desc
  `, [tenantId])
  const total = result.rows.reduce((sum, row) => sum + number(row.total), 0)
  const colors = ['#1768f2', '#29b6c8', '#f59e0b', '#fb923c', '#c83bb7', '#7d8799']
  return result.rows.map((row, index) => ({ label: row.label, value: total ? Number((number(row.total) / total * 100).toFixed(1)) : 0,
    color: colors[index % colors.length] }))
}

const readGoals = async (client, tenantId) => {
  const result = await client.query(`
    select id, name, current_value, target_value, color, icon, to_char(period_start, 'YYYY-MM-DD') as period_start,
      to_char(period_end, 'YYYY-MM-DD') as period_end, status from goals where tenant_id = $1 order by created_at asc
  `, [tenantId])
  return result.rows.map((row) => ({ id: String(row.id), name: row.name, current: number(row.current_value), target: number(row.target_value),
    color: row.color, icon: row.icon, periodStart: row.period_start, periodEnd: row.period_end, status: row.status }))
}

const readSettings = async (client, tenantId) => {
  const result = await client.query(`select name, document, phone, email, address, district, city, state, zip, country,
    currency, timezone, kwh from company_settings where tenant_id = $1`, [tenantId])
  const row = result.rows[0]
  if (!row) return null
  return {
    ...row,
    name: decryptField(row.name),
    document: decryptField(row.document),
    phone: decryptField(row.phone),
    email: decryptField(row.email),
    address: decryptField(row.address),
    district: decryptField(row.district),
    city: decryptField(row.city),
    state: decryptField(row.state),
    zip: decryptField(row.zip)
  }
}

const readMarketplaceIntegrations = async (client, tenantId) => {
  const result = await client.query(`
    select id, marketplace_id, platform, connection_name, account_external_id, status, scopes,
      access_token, refresh_token, token_expires_at, last_sync_at
    from marketplace_integrations
    where tenant_id = $1
    order by created_at desc
  `, [tenantId])
  return result.rows.map((row) => ({
    id: String(row.id),
    marketplaceId: row.marketplace_id ? String(row.marketplace_id) : '',
    platform: row.platform,
    connectionName: row.connection_name,
    accountExternalId: maskSensitiveIdentifier(row.account_external_id),
    status: row.status,
    scopes: row.scopes || '',
    hasAccessToken: Boolean(row.access_token),
    hasRefreshToken: Boolean(row.refresh_token),
    tokenExpiresAt: row.token_expires_at || null,
    lastSyncAt: row.last_sync_at || null
  }))
}

export const loadAppData = async (tenantId) => withTenant(tenantId, async (client) => {
  const [products, orders, expenses, filaments, printers, marketplaces, clients, expenseSegments, goals, settings, marketplaceIntegrations] = await Promise.all([
    readProducts(client, tenantId), readOrders(client, tenantId), readExpenses(client, tenantId), readFilaments(client, tenantId),
    readPrinters(client, tenantId), readMarketplaces(client, tenantId), readClients(client, tenantId), readExpenseSegments(client, tenantId),
    readGoals(client, tenantId), readSettings(client, tenantId), readMarketplaceIntegrations(client, tenantId)
  ])
  return { products, orders, expenses, filaments, printers, marketplaces, clients, expenseSegments, goals, settings, marketplaceIntegrations }
})

export const listResource = async (tenantId, resource) => {
  const data = await loadAppData(tenantId)
  return data[resource]
}
