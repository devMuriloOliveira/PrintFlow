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
  printFileName: row.print_file_name || '', printFileFormat: row.print_file_format || '', printFileHash: row.print_file_hash || '',
  printFileSizeBytes: number(row.print_file_size_bytes), printFileStorageKey: row.print_file_storage_key || '', printProfile: row.print_profile || {},
  compatibility: row.compatibility || {}, validationStatus: row.validation_status || 'needs_validation', validationMessage: row.validation_message || '',
  filamentId: row.filament_id ? String(row.filament_id) : '', filament: row.filament_name || row.filament || '', filamentColor: row.filament_color || row.linked_filament_color || '#1768f2',
  packaging: number(row.packaging_cost), materials: number(row.additional_materials_cost), labor: number(row.labor_cost),
  energy: row.energy_enabled, marketplaceFee: number(row.marketplace_fee), desiredMargin: number(row.desired_margin),
  cost: number(row.cost), profit: number(row.profit), margin: number(row.margin), costBreakdown: row.cost_breakdown || {}, status: row.status, thumb: row.thumb,
  createdAt: row.created_at || '', updatedAt: row.updated_at || ''
})

const readProducts = async (client, tenantId) => {
  const result = await client.query(`
    select p.id, p.name, p.subtitle, p.sku, p.category, p.description, p.printer_id, p.printer, pr.name as printer_name,
      p.price, p.weight, p.print_time, p.layer_height, p.infill, p.dimensions,
      p.print_file_name, p.print_file_format, p.print_file_hash, p.print_file_size_bytes,
      p.print_file_storage_key, p.print_profile, p.compatibility, p.validation_status, p.validation_message,
      p.filament_id, p.filament,
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
    select o.id, o.external_id, o.product_id, o.client_id, to_char(o.order_date, 'DD/MM/YYYY') as date, coalesce(c.name, 'Nao informado') as client,
      coalesce(m.name, case when o.sales_channel = 'direct' then 'Venda direta' else 'Nao informado' end) as marketplace, o.product_name as product, o.quantity as qty,
      o.gross, o.fee, o.shipping, o.net, o.profit, o.status, o.delivery_tracking_code,
      o.packed_at, o.shipped_at, o.delivered_at, o.sales_channel, false as marketplace_order, o.order_date as sort_date
    from orders o
    left join clients c on c.id = o.client_id and c.tenant_id = o.tenant_id
    left join marketplaces m on m.id = o.marketplace_id and m.tenant_id = o.tenant_id
    where o.tenant_id = $1

    union all

    select s.id, s.external_order_id as external_id, null as product_id, null as client_id,
      to_char(s.sold_at, 'DD/MM/YYYY') as date, 'Marketplace' as client,
      coalesce(m.name, s.platform) as marketplace, s.product_name as product, s.quantity as qty,
      s.gross, s.marketplace_fee as fee, s.shipping, s.net, s.profit, s.status, '' as delivery_tracking_code,
      null as packed_at, null as shipped_at, null as delivered_at, 'marketplace' as sales_channel, true as marketplace_order, s.sold_at as sort_date
    from tracked_sales s
    left join marketplaces m on m.id = s.marketplace_id and m.tenant_id = s.tenant_id
    where s.tenant_id = $1

    order by sort_date desc, id desc
  `, [tenantId])
  return result.rows.map((row) => ({ dbId: row.marketplace_order ? `marketplace:${row.id}` : String(row.id), id: decryptField(row.external_id), productId: row.product_id ? String(row.product_id) : '', clientId: row.client_id ? String(row.client_id) : '', date: row.date, client: decryptField(row.client), marketplace: row.marketplace,
    product: row.product, qty: Number(row.qty), gross: number(row.gross), fee: number(row.fee), shipping: number(row.shipping),
    net: number(row.net), profit: number(row.profit), status: row.status, trackingCode: row.delivery_tracking_code || '',
    packedAt: row.packed_at || null, shippedAt: row.shipped_at || null, deliveredAt: row.delivered_at || null,
    marketplaceOrder: Boolean(row.marketplace_order), salesChannel: row.sales_channel || (row.marketplace_order ? 'marketplace' : 'direct') }))
}

const readPrintJobs = async (client, tenantId) => {
  const result = await client.query(`
    select
      j.id,
      j.order_id,
      o.external_id,
      j.tracked_sale_id,
      s.external_order_id as tracked_external_order_id,
      j.product_id,
      coalesce(p.name, j.title) as product_name,
      j.printer_id,
      pr.name as printer_name,
      j.agent_printer_id,
      ap.status as agent_printer_status,
      ap.last_status as agent_last_status,
      p.print_file_name,
      p.print_file_format,
      p.validation_status,
      p.validation_message,
      j.source,
      j.title,
      j.quantity,
      j.priority,
      j.status,
      j.notes,
      j.scheduled_at,
      j.started_at,
      j.completed_at,
      j.cancelled_at,
      j.created_at,
      j.updated_at
    from print_jobs j
    left join orders o on o.id = j.order_id and o.tenant_id = j.tenant_id
    left join tracked_sales s on s.id = j.tracked_sale_id and s.tenant_id = j.tenant_id
    left join products p on p.id = j.product_id and p.tenant_id = j.tenant_id
    left join printers pr on pr.id = j.printer_id and pr.tenant_id = j.tenant_id
    left join agent_printers ap on ap.id = j.agent_printer_id and ap.tenant_id = j.tenant_id
    where j.tenant_id = $1
    order by
      case j.status
        when 'printing' then 0
        when 'paused' then 1
        when 'awaiting_confirmation' then 2
        when 'queued' then 3
        when 'completed' then 4
        when 'cancelled' then 5
        else 6
      end,
      j.priority desc,
      j.created_at asc
  `, [tenantId])

  return result.rows.map((row) => ({
    id: String(row.id),
    orderId: row.order_id ? String(row.order_id) : '',
    externalOrderId: row.external_id || decryptField(row.tracked_external_order_id) || '',
    trackedSaleId: row.tracked_sale_id ? String(row.tracked_sale_id) : '',
    productId: row.product_id ? String(row.product_id) : '',
    productName: row.product_name || '',
    printerId: row.printer_id ? String(row.printer_id) : '',
    printerName: row.printer_name || '',
    agentPrinterId: row.agent_printer_id ? String(row.agent_printer_id) : '',
    agentPrinterStatus: row.agent_printer_status || '',
    agentLastStatus: row.agent_last_status || {},
    printFileName: row.print_file_name || '',
    printFileFormat: row.print_file_format || '',
    validationStatus: row.validation_status || 'needs_validation',
    validationMessage: row.validation_message || '',
    source: row.source || 'manual',
    title: row.title || '',
    quantity: Number(row.quantity || 1),
    priority: Number(row.priority || 0),
    status: row.status || 'queued',
    notes: row.notes || '',
    scheduledAt: row.scheduled_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    cancelledAt: row.cancelled_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  }))
}

const readExpenses = async (client, tenantId) => {
  const result = await client.query(`
    select id, description, category, supplier, amount as value, to_char(expense_date, 'DD/MM/YYYY') as date,
      payment, recurrence, status, to_char(next_due_date, 'DD/MM/YYYY') as next_due_date,
      notes from expenses where tenant_id = $1 order by expense_date desc, id desc
  `, [tenantId])
  return result.rows.map((row) => ({ ...row, id: String(row.id), value: number(row.value) }))
}

const readFilaments = async (client, tenantId) => {
  const result = await client.query(`
    select id, name, maker, material, type, color, color_hex, initial_weight, remaining_weight, min_stock_weight, cost, supplier,
      to_char(purchase_date, 'DD/MM/YYYY') as date, status from filaments where tenant_id = $1 order by created_at desc
  `, [tenantId])
  return result.rows.map((row) => ({ id: String(row.id), name: row.name, maker: row.maker, material: row.material, type: row.type,
    color: row.color, colorHex: row.color_hex, initial: number(row.initial_weight), remaining: number(row.remaining_weight),
    minStock: number(row.min_stock_weight) || 300, cost: number(row.cost), supplier: row.supplier, date: row.date || '', status: row.status }))
}

const readPrinters = async (client, tenantId) => {
  const result = await client.query(`
    select
      p.id,
      p.name,
      p.code,
      p.maker,
      p.model,
      to_char(p.acquired_at, 'DD/MM/YYYY') as acquired,
      p.power_w,
      p.accumulated_hours,
      p.status,
      to_char(p.last_maintenance_at, 'DD/MM/YYYY') as maintenance,
      p.serial,
      p.location,
      p.volume,
      p.default_filament,
      p.nozzle_mm,
      p.supported_materials,
      p.min_layer_height,
      p.max_layer_height,
      p.agent_id,
      p.agent_printer_id,
      p.agent_connection_key,
      p.agent_protocol,
      p.agent_connection_type,
      ap.status as agent_printer_status,
      ap.last_status as agent_last_status,
      ap.last_connection_error as agent_last_connection_error,
      ap.last_seen_at as agent_last_seen_at
    from printers p
    left join agent_printers ap on ap.id = p.agent_printer_id and ap.tenant_id = p.tenant_id
    where p.tenant_id = $1
    order by p.created_at desc
  `, [tenantId])
  return result.rows.map((row) => ({ id: String(row.id), name: row.name, code: row.code, maker: row.maker, model: row.model, acquired: row.acquired || '',
    power: number(row.power_w), hours: number(row.accumulated_hours), status: row.status, maintenance: row.maintenance || '',
    serial: row.serial, location: row.location, volume: row.volume, defaultFilament: row.default_filament,
    nozzleMm: number(row.nozzle_mm), supportedMaterials: row.supported_materials || '',
    minLayerHeight: number(row.min_layer_height), maxLayerHeight: number(row.max_layer_height),
    agentId: row.agent_id ? String(row.agent_id) : '', agentPrinterId: row.agent_printer_id ? String(row.agent_printer_id) : '',
    agentConnectionKey: row.agent_connection_key || '', agentProtocol: row.agent_protocol || '', agentConnectionType: row.agent_connection_type || '',
    agentPrinterStatus: row.agent_printer_status || '', agentLastStatus: row.agent_last_status || {},
    agentLastConnectionError: row.agent_last_connection_error || '', agentLastSeenAt: row.agent_last_seen_at || null }))
}

const readMarketplaces = async (client, tenantId) => {
  const result = await client.query(`
    select m.id, m.name, m.short, m.color, m.platform, m.connection_status, m.commission, m.fixed, m.financial, m.ads, m.others, m.active,
      coalesce(o.gross, 0) + coalesce(ts.gross, 0) as gross,
      coalesce(o.net, 0) + coalesce(ts.net, 0) as net,
      coalesce(o.fees, 0) + coalesce(ts.fees, 0) as fees,
      (coalesce(o.orders, 0) + coalesce(ts.orders, 0))::int as orders
    from marketplaces m
    left join (
      select marketplace_id, sum(gross) as gross, sum(net) as net, sum(fee) as fees, count(id)::int as orders
      from orders where tenant_id = $1 group by marketplace_id
    ) o on o.marketplace_id = m.id
    left join (
      select marketplace_id, sum(gross) as gross, sum(net) as net, sum(marketplace_fee) as fees, count(id)::int as orders
      from tracked_sales where tenant_id = $1 group by marketplace_id
    ) ts on ts.marketplace_id = m.id
    where m.tenant_id = $1
    order by m.created_at asc
  `, [tenantId])
  return result.rows.map((row) => ({ id: String(row.id), name: row.name, short: row.short, color: row.color, commission: number(row.commission),
    fixed: number(row.fixed), financial: number(row.financial), ads: number(row.ads), others: number(row.others),
    gross: number(row.gross), net: number(row.net), fees: number(row.fees), orders: Number(row.orders), active: row.active,
    platform: row.platform, connectionStatus: row.connection_status }))
}

const readClients = async (client, tenantId) => {
  const result = await client.query(`
    select c.id, c.name, c.email, c.phone, c.client_type, c.document, c.zip, c.address, c.address_number,
      c.complement, c.district, c.city, c.state, c.origin, c.notes, c.tags, c.status,
      count(o.id) filter (where o.sales_channel = 'direct' or (o.sales_channel is null and lower(coalesce(m.name, '')) = 'manual'))::int as orders,
      coalesce(sum(o.gross) filter (where o.sales_channel = 'direct' or (o.sales_channel is null and lower(coalesce(m.name, '')) = 'manual')), 0) as revenue,
      coalesce(avg(o.gross) filter (where o.sales_channel = 'direct' or (o.sales_channel is null and lower(coalesce(m.name, '')) = 'manual')), 0) as ticket,
      to_char(max(o.order_date) filter (where o.sales_channel = 'direct' or (o.sales_channel is null and lower(coalesce(m.name, '')) = 'manual')), 'DD/MM/YYYY') as last
    from clients c left join orders o on o.client_id = c.id and o.tenant_id = $1
      left join marketplaces m on m.id = o.marketplace_id and m.tenant_id = o.tenant_id
    where c.tenant_id = $1 group by c.id order by c.created_at desc
  `, [tenantId])
  return result.rows.map((row) => ({ id: String(row.id), name: decryptField(row.name), email: decryptField(row.email), phone: decryptField(row.phone),
    type: row.client_type || 'Pessoa Fisica', document: decryptField(row.document), zip: decryptField(row.zip), address: decryptField(row.address), number: decryptField(row.address_number), complement: decryptField(row.complement), district: decryptField(row.district), city: decryptField(row.city), state: decryptField(row.state), origin: row.origin || 'Outro', notes: decryptField(row.notes), tags: row.tags || '', status: row.status || 'active', orders: Number(row.orders),
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
    select g.id, g.name, g.goal_type, g.current_value, g.target_value, g.color, g.icon,
      to_char(g.period_start, 'YYYY-MM-DD') as period_start, to_char(g.period_end, 'YYYY-MM-DD') as period_end, g.status,
      case when g.goal_type = 'revenue' then coalesce(k.revenue, 0) when g.goal_type = 'profit' then coalesce(k.profit, 0)
        when g.goal_type = 'orders' then coalesce(k.orders, 0) when g.goal_type = 'average_ticket' then coalesce(k.ticket, 0)
        else g.current_value end as calculated_current
    from goals g
    left join lateral (
      select sum(s.gross) as revenue, sum(s.profit) as profit, count(*)::int as orders, avg(s.gross) as ticket
      from (select o.gross, o.profit, o.order_date from orders o where o.tenant_id = g.tenant_id and o.status <> 'Cancelado'
        union all select ts.gross, ts.profit, ts.sold_at as order_date from tracked_sales ts where ts.tenant_id = g.tenant_id and ts.status <> 'Cancelado') s
      where g.period_start is not null and g.period_end is not null and s.order_date >= g.period_start and s.order_date < (g.period_end + interval '1 day')
    ) k on true
    where g.tenant_id = $1 order by g.created_at asc
  `, [tenantId])
  return result.rows.map((row) => ({ id: String(row.id), name: row.name, goalType: row.goal_type || 'revenue', current: number(row.calculated_current), target: number(row.target_value),
    color: row.color, icon: row.icon, periodStart: row.period_start, periodEnd: row.period_end, status: row.status }))
}

const readSettings = async (client, tenantId) => {
  const result = await client.query(`select name, document, phone, email, address, district, city, state, zip, country,
    currency, timezone, kwh, preferences from company_settings where tenant_id = $1`, [tenantId])
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
    zip: decryptField(row.zip),
    preferences: row.preferences || {}
  }
}

const readMarketplaceIntegrations = async (client, tenantId) => {
  const result = await client.query(`
    select id, marketplace_id, platform, connection_name, account_external_id, status, scopes,
      access_token, refresh_token, token_expires_at, last_sync_at, last_error
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
    lastSyncAt: row.last_sync_at || null, lastError: row.last_error || ''
  }))
}

export const loadAppData = async (tenantId, requestedResources = null) => withTenant(tenantId, async (client) => {
  const selected = requestedResources instanceof Set && requestedResources.size ? requestedResources : new Set(Object.keys(resourceReaders))
  const read = (resource) => selected.has(resource) ? resourceReaders[resource](client, tenantId) : Promise.resolve([])
  const [products, orders, printJobs, expenses, filaments, printers, marketplaces, clients, expenseSegments, goals, settings, marketplaceIntegrations] = await Promise.all([
    read('products'), read('orders'), read('printJobs'), read('expenses'), read('filaments'), read('printers'),
    read('marketplaces'), read('clients'), read('expenseSegments'), read('goals'),
    selected.has('settings') ? readSettings(client, tenantId) : Promise.resolve(null),
    read('marketplaceIntegrations')
  ])
  return { products, orders, printJobs, expenses, filaments, printers, marketplaces, clients, expenseSegments, goals, settings, marketplaceIntegrations }
})

const resourceReaders = {
  products: readProducts,
  orders: readOrders,
  printJobs: readPrintJobs,
  expenses: readExpenses,
  filaments: readFilaments,
  printers: readPrinters,
  marketplaces: readMarketplaces,
  clients: readClients,
  expenseSegments: readExpenseSegments,
  goals: readGoals,
  settings: readSettings,
  marketplaceIntegrations: readMarketplaceIntegrations
}

export const listResource = async (tenantId, resource) => {
  const reader = resourceReaders[resource]
  if (!reader) return undefined
  return withTenant(tenantId, (client) => reader(client, tenantId))
}
