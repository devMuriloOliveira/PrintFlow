import { db } from '../data.js'

const toDate = (value) => value ? value.split('/').reverse().join('-') : null

const insertProducts = async (client, tenantId) => {
  for (const product of db.products) {
    await client.query(`
      insert into products (tenant_id, name, subtitle, sku, category, description, printer, price, weight,
        print_time, filament, filament_color, cost, profit, margin, status, thumb)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      on conflict (tenant_id, sku) do nothing
    `, [tenantId, product.name, product.subtitle, product.sku, product.category, product.subtitle,
      'Nao informado', product.price, product.weight, product.time, product.filament, product.filamentColor,
      product.cost, product.profit, product.margin, product.status, product.thumb])
  }
}

const insertClients = async (client, tenantId) => {
  for (const item of db.clients) {
    await client.query(`insert into clients (tenant_id, name, email, phone) values ($1,$2,$3,$4)`, [
      tenantId, item.name, item.email, item.phone
    ])
  }
}

const insertMarketplaces = async (client, tenantId) => {
  for (const item of db.marketplaces) {
    await client.query(`
      insert into marketplaces (tenant_id, name, short, color, commission, fixed, financial, ads, others, active)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (tenant_id, name) do nothing
    `, [tenantId, item.name, item.short, item.color, item.commission, item.fixed, item.financial, item.ads, item.others, item.active])
  }
}

const insertOrders = async (client, tenantId) => {
  const clients = await client.query('select id, name from clients where tenant_id = $1', [tenantId])
  const marketplaces = await client.query('select id, name from marketplaces where tenant_id = $1', [tenantId])
  const products = await client.query('select id, name from products where tenant_id = $1', [tenantId])
  const clientByName = new Map(clients.rows.map((row) => [row.name, row.id]))
  const marketplaceByName = new Map(marketplaces.rows.map((row) => [row.name, row.id]))
  const productByName = new Map(products.rows.map((row) => [row.name, row.id]))

  for (const item of db.orders) {
    await client.query(`
      insert into orders (tenant_id, external_id, order_date, client_id, marketplace_id, product_id,
        product_name, quantity, gross, fee, shipping, net, profit, status)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      on conflict (tenant_id, external_id) do nothing
    `, [tenantId, item.id, toDate(item.date), clientByName.get(item.client) || null,
      marketplaceByName.get(item.marketplace) || null, productByName.get(item.product) || null,
      item.product, item.qty, item.gross, item.fee, item.shipping, item.net, item.profit, item.status])
  }
}

const insertExpenses = async (client, tenantId) => {
  for (const item of db.expenses) {
    await client.query(`
      insert into expenses (tenant_id, description, category, supplier, amount, expense_date, payment, recurrence, status)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [tenantId, item.description, item.category, item.supplier, item.value, toDate(item.date), item.payment, item.recurrence, item.status])
  }
}

const insertFilaments = async (client, tenantId) => {
  for (const item of db.filaments) {
    await client.query(`
      insert into filaments (tenant_id, name, maker, material, type, color, color_hex,
        initial_weight, remaining_weight, cost, supplier, purchase_date, status)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      on conflict (tenant_id, name) do nothing
    `, [tenantId, item.name, item.maker, item.material, item.type, item.color, item.colorHex,
      item.initial, item.remaining, item.cost, item.supplier, toDate(item.date), item.status])
  }
}

const insertPrinters = async (client, tenantId) => {
  for (const item of db.printers) {
    await client.query(`
      insert into printers (tenant_id, name, code, maker, model, acquired_at, power_w,
        accumulated_hours, status, last_maintenance_at, serial, location, volume, default_filament)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      on conflict (tenant_id, code) do nothing
    `, [tenantId, item.name, item.code, item.maker, item.model, toDate(item.acquired), item.power,
      item.hours, item.status, toDate(item.maintenance), item.serial, 'Lab Principal', '220 x 220 x 250 mm', 'PLA'])
  }
}

const insertGoals = async (client, tenantId) => {
  const goals = [
    ['Faturamento mensal', 18450, 30000, '#1768f2', 'trend'],
    ['Lucro liquido', 9130, 14000, '#0da566', 'money'],
    ['Quantidade de pedidos', 284, 400, '#7c3aed', 'bag'],
    ['Reducao de despesas', 8, 15, '#f57c1f', 'receipt']
  ]
  for (const [name, current, target, color, icon] of goals) {
    await client.query(`
      insert into goals (tenant_id, name, current_value, target_value, color, icon, period_start, period_end)
      values ($1,$2,$3,$4,$5,$6,'2024-05-01','2024-05-31')
    `, [tenantId, name, current, target, color, icon])
  }
}

export const ensureTenantData = async (client, tenantId) => {
  await client.query(`
    insert into tenants (id, name, is_initialized) values ($1, $1, false)
    on conflict (id) do nothing
  `, [tenantId])

  const result = await client.query('select is_initialized from tenants where id = $1 for update', [tenantId])
  if (result.rows[0]?.is_initialized) return

  await insertProducts(client, tenantId)
  await insertClients(client, tenantId)
  await insertMarketplaces(client, tenantId)
  await insertOrders(client, tenantId)
  await insertExpenses(client, tenantId)
  await insertFilaments(client, tenantId)
  await insertPrinters(client, tenantId)
  await insertGoals(client, tenantId)
  await client.query(`
    insert into company_settings (tenant_id, name, document, phone, email, address, district, city, state, zip, country, currency, timezone, kwh)
    values ($1,'Empresa Demo','documento-demo','nao-informado','nao-informado','Endereco demonstrativo','Bairro Demo','Sao Paulo','SP','cep-demo','Brasil','Real (R$)','(GMT-03:00) Brasilia',0.85)
    on conflict (tenant_id) do nothing
  `, [tenantId])
  await client.query('update tenants set is_initialized = true where id = $1', [tenantId])
}
