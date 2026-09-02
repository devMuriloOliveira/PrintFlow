import { withTenant } from '../db/pool.js'
import { listProducts, createProduct } from './productsRepository.js'
import { listResource } from './appDataRepository.js'
import { blindIndex, encryptField } from '../security/crypto.js'

const number = (value) => Number(value || 0)
const dateOrNull = (value) => value || null
const textOrNull = (value) => {
  const text = String(value || '').trim()
  return text || null
}
const idOrNull = (value) => {
  const id = Number(value || 0)
  return Number.isFinite(id) && id > 0 ? id : null
}

const syncPrinterAgentLink = async (
  client,
  tenantId,
  printerId,
  item
) => {
  const agentPrinterId =
    idOrNull(
      item.agentPrinterId
    )

  if (!agentPrinterId) {
    return
  }

  await client.query(
    `
      update agent_printers
      set
        printer_id = $3,
        updated_at = now()
      where tenant_id = $1
        and id = $2
    `,
    [
      tenantId,
      agentPrinterId,
      printerId
    ]
  )
}

const findOrCreateClientId = async (client, tenantId, name) => {
  const cleanName = textOrNull(name)
  if (!cleanName) return null

  const existing = await client.query(
    'select id from clients where tenant_id = $1 and (name_hash = $2 or lower(name) = lower($3)) order by created_at asc limit 1',
    [tenantId, blindIndex(cleanName), cleanName]
  )
  if (existing.rows[0]) return existing.rows[0].id

  const created = await client.query(
    `insert into clients (tenant_id, name, name_hash, email, phone)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [tenantId, encryptField(cleanName), blindIndex(cleanName), encryptField('nao-informado'), encryptField('nao-informado')]
  )
  return created.rows[0].id
}

const findOrCreateMarketplaceId = async (client, tenantId, name) => {
  const cleanName = textOrNull(name)
  if (!cleanName) return null

  const existing = await client.query(
    'select id from marketplaces where tenant_id = $1 and lower(name) = lower($2) order by created_at asc limit 1',
    [tenantId, cleanName]
  )
  if (existing.rows[0]) return existing.rows[0].id

  const created = await client.query(
    `insert into marketplaces (tenant_id, name, short, color, active)
     values ($1, $2, $3, '#1768f2', true)
     on conflict (tenant_id, name) do update set name = excluded.name
     returning id`,
    [tenantId, cleanName, cleanName.slice(0, 2).toUpperCase()]
  )
  return created.rows[0].id
}

const resourceConfig = {
  products: {
    table: 'products',
    create: createProduct,
    list: listProducts,
    patch: (item) => ({
      name: item.name,
      subtitle: item.subtitle || '',
      sku: item.sku,
      category: item.category || '',
      description: item.description || '',
      printer_id: idOrNull(item.printerId),
      printer: item.printer || '',
      price: number(item.price),
      weight: number(item.weight),
      print_time: item.time || '',
      layer_height: number(item.layer),
      infill: number(item.infill),
      dimensions: item.dimensions || '',
      print_file_name: item.printFileName || '',
      print_file_format: item.printFileFormat || '',
      print_file_hash: item.printFileHash || '',
      print_file_size_bytes: number(item.printFileSizeBytes),
      print_file_storage_key: item.printFileStorageKey || '',
      print_profile: item.printProfile || {},
      compatibility: item.compatibility || {},
      validation_status: item.validationStatus || 'needs_validation',
      validation_message: item.validationMessage || '',
      filament_id: idOrNull(item.filamentId),
      filament: item.filament || '',
      filament_color: item.filamentColor || '#1768f2',
      packaging_cost: number(item.packaging),
      additional_materials_cost: number(item.materials),
      labor_cost: number(item.labor),
      energy_enabled: item.energy !== false,
      marketplace_fee: number(item.marketplaceFee),
      desired_margin: number(item.desiredMargin),
      cost: number(item.cost),
      profit: number(item.profit),
      margin: number(item.margin),
      cost_breakdown: item.costBreakdown || {},
      status: item.status || 'Ativo',
      thumb: item.thumb || 'vase'
    })
  },
  expenses: {
    table: 'expenses',
    patch: (item) => ({
      description: item.description,
      category: item.category || 'Outros',
      supplier: item.supplier || '',
      amount: number(item.value),
      expense_date: dateOrNull(item.date),
      payment: item.payment || '',
      recurrence: item.recurrence || 'Nao recorrente',
      status: item.status || 'Pago'
    })
  },
  filaments: {
    table: 'filaments',
    patch: (item) => ({
      name: item.name,
      maker: item.maker || '',
      material: item.material || '',
      type: item.type || '',
      color: item.color || '',
      color_hex: item.colorHex || '#ccd3df',
      initial_weight: number(item.initial),
      remaining_weight: number(item.remaining),
      cost: number(item.cost),
      supplier: item.supplier || '',
      purchase_date: dateOrNull(item.date),
      status: item.status || 'Em estoque'
    })
  },
  printers: {
    table: 'printers',
    patch: (item) => ({
      name: item.name,
      code: item.code,
      maker: item.maker || '',
      model: item.model || '',
      acquired_at: dateOrNull(item.acquired),
      power_w: number(item.power),
      accumulated_hours: number(item.hours),
      status: item.status || 'Disponivel',
      last_maintenance_at: dateOrNull(item.maintenance),
      serial: item.serial || '',
      location: item.location || '',
      volume: item.volume || '',
      default_filament: item.defaultFilament || '',
      nozzle_mm: number(item.nozzleMm),
      supported_materials: item.supportedMaterials || '',
      min_layer_height: number(item.minLayerHeight),
      max_layer_height: number(item.maxLayerHeight),
      ...(item.agentId !== undefined ? { agent_id: idOrNull(item.agentId) } : {}),
      ...(item.agentPrinterId !== undefined ? { agent_printer_id: idOrNull(item.agentPrinterId) } : {}),
      ...(item.agentConnectionKey !== undefined ? { agent_connection_key: item.agentConnectionKey || '' } : {}),
      ...(item.agentProtocol !== undefined ? { agent_protocol: item.agentProtocol || '' } : {}),
      ...(item.agentConnectionType !== undefined ? { agent_connection_type: item.agentConnectionType || '' } : {})
    })
  },
  marketplaces: {
    table: 'marketplaces',
    patch: (item) => ({
      name: item.name,
      short: item.short || '',
      color: item.color || '#1768f2',
      platform: item.platform || 'custom',
      connection_status: item.connectionStatus || 'manual',
      commission: number(item.commission),
      fixed: number(item.fixed),
      financial: number(item.financial),
      ads: number(item.ads),
      others: number(item.others),
      active: item.active !== false
    })
  },
  clients: {
    table: 'clients',
    patch: (item) => ({
      name: encryptField(item.name),
      name_hash: blindIndex(item.name),
      email: encryptField(item.email || 'nao-informado'),
      phone: encryptField(item.phone || 'nao-informado')
    })
  },
  goals: {
    table: 'goals',
    patch: (item) => ({
      name: item.name,
      current_value: number(item.current),
      target_value: number(item.target),
      color: item.color || '#1768f2',
      icon: item.icon || 'target',
      period_start: dateOrNull(item.periodStart),
      period_end: dateOrNull(item.periodEnd),
      status: item.status || 'Ativa'
    })
  },
  orders: {
    table: 'orders',
    patch: (item) => ({
      external_id: item.id || `PED-${Date.now()}`,
      product_id: idOrNull(item.productId),
      order_date: dateOrNull(item.date),
      product_name: item.product || '',
      quantity: number(item.qty) || 1,
      gross: number(item.gross),
      fee: number(item.fee),
      shipping: number(item.shipping),
      net: number(item.net),
      profit: number(item.profit),
      status: item.status || 'Novo'
    })
  },
  printJobs: {
    table: 'print_jobs',
    patch: (item) => ({
      order_id: idOrNull(item.orderId),
      tracked_sale_id: idOrNull(item.trackedSaleId),
      product_id: idOrNull(item.productId),
      printer_id: idOrNull(item.printerId),
      agent_printer_id: idOrNull(item.agentPrinterId),
      source: item.source || 'manual',
      title: item.title || item.productName || '',
      quantity: number(item.quantity) || 1,
      priority: number(item.priority),
      status: item.status || 'queued',
      notes: item.notes || '',
      scheduled_at: item.scheduledAt || null,
      started_at: item.startedAt || null,
      completed_at: item.completedAt || null,
      cancelled_at: item.cancelledAt || null
    })
  }
}

const configFor = (resource) => {
  const config = resourceConfig[resource]
  if (!config) throw new Error('Recurso invalido')
  return config
}

const writePatch = async (client, tenantId, resource, item, id = null) => {
  const config = configFor(resource)
  if (config.create && !id) return config.create(tenantId, item)

  const values = config.patch(item)
  if (resource === 'orders') {
    values.client_id = await findOrCreateClientId(client, tenantId, item.client)
    values.marketplace_id = await findOrCreateMarketplaceId(client, tenantId, item.marketplace)
  }
  const keys = Object.keys(values).filter((key) => values[key] !== undefined)
  if (!keys.length) throw new Error('Nenhum dado para salvar')

  if (id) {
    const assignments = keys.map((key, index) => `${key} = $${index + 3}`).join(', ')
    const params = [tenantId, id, ...keys.map((key) => values[key])]
    const result = await client.query(
      `update ${config.table} set ${assignments}${config.table === 'products' || config.table === 'clients' || config.table === 'filaments' || config.table === 'printers' || config.table === 'print_jobs' ? ', updated_at = now()' : ''}
       where tenant_id = $1 and id = $2 returning id`,
      params
    )
    if (!result.rowCount) throw new Error('Registro nao encontrado')
    if (resource === 'printers') {
      await syncPrinterAgentLink(client, tenantId, result.rows[0].id, item)
    }
    return null
  }

  const columns = ['tenant_id', ...keys]
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ')
  const conflictClause = resource === 'orders'
    ? ` on conflict (tenant_id, external_id) do update set ${keys.map((key) => `${key} = excluded.${key}`).join(', ')}`
    : ''
  const result = await client.query(
    `insert into ${config.table} (${columns.join(', ')}) values (${placeholders})${conflictClause} returning id`,
    [tenantId, ...keys.map((key) => values[key])]
  )
  if (resource === 'printers') {
    await syncPrinterAgentLink(client, tenantId, result.rows[0].id, item)
  }
  return null
}

export const createResource = async (tenantId, resource, item) => {
  await withTenant(tenantId, async (client) => {
    await client.query('insert into tenants (id, name) values ($1, $1) on conflict (id) do nothing', [tenantId])
    await writePatch(client, tenantId, resource, item)
  })
  return listResource(tenantId, resource)
}

export const updateResource = async (tenantId, resource, id, item) => {
  await withTenant(tenantId, async (client) => writePatch(client, tenantId, resource, item, id))
  return listResource(tenantId, resource)
}

export const assertResourceBelongsToTenant = async (tenantId, resource, id) => {
  const config = configFor(resource)
  await withTenant(tenantId, async (client) => {
    const result = await client.query(`select id from ${config.table} where tenant_id = $1 and id = $2 limit 1`, [tenantId, id])
    if (!result.rowCount) throw new Error('Registro nao encontrado')
  })
}

export const deleteResource = async (tenantId, resource, id) => {
  const config = configFor(resource)
  await withTenant(tenantId, async (client) => {
    const result = await client.query(`delete from ${config.table} where tenant_id = $1 and id = $2`, [tenantId, id])
    if (!result.rowCount) throw new Error('Registro nao encontrado')
  })
  return listResource(tenantId, resource)
}
