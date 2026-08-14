import { db } from '../data.js'
import { query } from '../db/pool.js'
import { createProduct, listProducts } from './productsRepository.js'

const ensureTenant = async (tenantId) => {
  await query(
    `insert into tenants (id, name)
     values ($1, $1)
     on conflict (id) do nothing`,
    [tenantId]
  )
}

const countRows = async (tenantId, table) => {
  const result = await query(`select count(*)::int as count from ${table} where tenant_id = $1`, [tenantId])
  return result.rows[0].count
}

const seedDemoData = async (tenantId) => {
  await ensureTenant(tenantId)

  if (await countRows(tenantId, 'products') === 0) {
    for (const product of db.products) {
      await createProduct(tenantId, product)
    }
  }

  if (await countRows(tenantId, 'expenses') === 0) {
    for (const item of db.expenses) {
      await query(
        `insert into expenses (
          tenant_id, description, value, category, supplier_name, expense_date,
          payment_method, is_recurring, recurrence_frequency, status
        ) values ($1, $2, $3, $4, $5, to_date($6, 'DD/MM/YYYY'), $7, $8, $9, $10)`,
        [
          tenantId,
          item.description,
          item.value,
          item.category,
          item.supplier,
          item.date,
          item.payment,
          item.recurrence === 'Recorrente',
          item.recurrence,
          item.status
        ]
      )
    }
  }

  if (await countRows(tenantId, 'filaments') === 0) {
    for (const item of db.filaments) {
      await query(
        `insert into filaments (
          tenant_id, name, maker, material, diameter, color, color_hex,
          initial_weight_g, remaining_weight_g, roll_cost, supplier_name,
          purchase_date, status
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_date($12, 'DD/MM/YYYY'), $13)
        on conflict (tenant_id, name, maker, color) do nothing`,
        [tenantId, item.name, item.maker, item.material, item.type, item.color, item.colorHex, item.initial, item.remaining, item.cost, item.supplier, item.date, item.status]
      )
    }
  }

  if (await countRows(tenantId, 'printers') === 0) {
    for (const item of db.printers) {
      await query(
        `insert into printers (
          tenant_id, name, code, maker, model, acquired_at, power_w,
          accumulated_hours, status, last_maintenance_at, serial
        ) values ($1, $2, $3, $4, $5, to_date($6, 'DD/MM/YYYY'), $7, $8, $9, to_date($10, 'DD/MM/YYYY'), $11)
        on conflict (tenant_id, code) do nothing`,
        [tenantId, item.name, item.code, item.maker, item.model, item.acquired, item.power, item.hours, item.status, item.maintenance, item.serial]
      )
    }
  }

  if (await countRows(tenantId, 'marketplaces') === 0) {
    for (const item of db.marketplaces) {
      const marketplace = await query(
        `insert into marketplaces (tenant_id, name, short, color, active)
         values ($1, $2, $3, $4, $5)
         on conflict (tenant_id, name) do update set short = excluded.short
         returning id`,
        [tenantId, item.name, item.short, item.color, item.active]
      )
      await query(
        `insert into marketplace_fee_versions (
          tenant_id, marketplace_id, commission_percent, fixed_fee,
          financial_percent, ads_percent, other_percent, starts_at
        ) values ($1, $2, $3, $4, $5, $6, $7, current_date)
        on conflict (tenant_id, marketplace_id, starts_at) do nothing`,
        [tenantId, marketplace.rows[0].id, item.commission, item.fixed, item.financial, item.ads, item.others]
      )
    }
  }

  if (await countRows(tenantId, 'clients') === 0) {
    for (const item of db.clients) {
      await query(
        `insert into clients (tenant_id, name, email, phone)
         values ($1, $2, $3, $4)`,
        [tenantId, item.name, item.email, item.phone]
      )
    }
  }

  if (await countRows(tenantId, 'orders') === 0) {
    for (const item of db.orders) {
      const order = await query(
        `insert into orders (
          tenant_id, external_code, order_date, client_name, marketplace_name,
          gross, fee, shipping, net, profit, status
        ) values ($1, $2, to_date($3, 'DD/MM/YYYY'), $4, $5, $6, $7, $8, $9, $10, $11)
        on conflict (tenant_id, external_code) do update set status = excluded.status
        returning id`,
        [tenantId, item.id, item.date, item.client, item.marketplace, item.gross, item.fee, item.shipping, item.net, item.profit, item.status]
      )
      await query(
        `insert into order_items (tenant_id, order_id, product_name, quantity)
         values ($1, $2, $3, $4)`,
        [tenantId, order.rows[0].id, item.product, item.qty]
      )
    }
  }

  if (await countRows(tenantId, 'goals') === 0) {
    const goals = [
      { name: 'Faturamento mensal', type: 'Faturamento', current: 18450, target: 30000, color: '#1768f2', icon: 'trend' },
      { name: 'Lucro liquido', type: 'Lucro', current: 9130, target: 14000, color: '#0da566', icon: 'money' },
      { name: 'Quantidade de pedidos', type: 'Pedidos', current: 284, target: 400, color: '#7c3aed', icon: 'bag' },
      { name: 'Reducao de despesas', type: 'Reducao de Despesas', current: 8, target: 15, color: '#f57c1f', icon: 'receipt' }
    ]
    for (const item of goals) {
      await query(
        `insert into goals (tenant_id, type, name, current_value, target, starts_at, ends_at, color, icon)
         values ($1, $2, $3, $4, $5, date_trunc('month', current_date), (date_trunc('month', current_date) + interval '1 month - 1 day')::date, $6, $7)`,
        [tenantId, item.type, item.name, item.current, item.target, item.color, item.icon]
      )
    }
  }
}

export const listExpenses = async (tenantId) => {
  await seedDemoData(tenantId)
  const result = await query(
    `select description, category, coalesce(supplier_name, 'Nao informado') as supplier,
      value, to_char(expense_date, 'DD/MM/YYYY') as date, payment_method as payment,
      case when is_recurring then coalesce(recurrence_frequency, 'Recorrente') else 'Nao recorrente' end as recurrence,
      status
     from expenses where tenant_id = $1 order by created_at desc`,
    [tenantId]
  )
  return result.rows.map((row) => ({ ...row, value: Number(row.value) }))
}

export const listFilaments = async (tenantId) => {
  await seedDemoData(tenantId)
  const result = await query(
    `select name, maker, material, diameter as type, color, color_hex as "colorHex",
      initial_weight_g as initial, remaining_weight_g as remaining, roll_cost as cost,
      coalesce(supplier_name, 'Nao informado') as supplier,
      coalesce(to_char(purchase_date, 'DD/MM/YYYY'), '-') as date, status
     from filaments where tenant_id = $1 order by created_at desc`,
    [tenantId]
  )
  return result.rows.map((row) => ({ ...row, initial: Number(row.initial), remaining: Number(row.remaining), cost: Number(row.cost) }))
}

export const listPrinters = async (tenantId) => {
  await seedDemoData(tenantId)
  const result = await query(
    `select name, code, maker, model, coalesce(to_char(acquired_at, 'DD/MM/YYYY'), '-') as acquired,
      power_w as power, accumulated_hours as hours, status,
      coalesce(to_char(last_maintenance_at, 'DD/MM/YYYY'), '-') as maintenance,
      coalesce(serial, '-') as serial
     from printers where tenant_id = $1 order by created_at desc`,
    [tenantId]
  )
  return result.rows.map((row) => ({ ...row, power: Number(row.power), hours: Number(row.hours) }))
}

export const listMarketplaces = async (tenantId) => {
  await seedDemoData(tenantId)
  const result = await query(
    `select m.name, m.short, m.color, f.commission_percent as commission,
      f.fixed_fee as fixed, f.financial_percent as financial, f.ads_percent as ads,
      f.other_percent as others, 0::numeric as gross, 0::numeric as net, 0::int as orders,
      m.active
     from marketplaces m
     left join lateral (
       select * from marketplace_fee_versions f
       where f.tenant_id = m.tenant_id and f.marketplace_id = m.id
       order by f.starts_at desc limit 1
     ) f on true
     where m.tenant_id = $1
     order by m.created_at desc`,
    [tenantId]
  )
  return result.rows.map((row) => ({
    ...row,
    commission: Number(row.commission || 0),
    fixed: Number(row.fixed || 0),
    financial: Number(row.financial || 0),
    ads: Number(row.ads || 0),
    others: Number(row.others || 0),
    gross: Number(row.gross),
    net: Number(row.net)
  }))
}

export const listClients = async (tenantId) => {
  await seedDemoData(tenantId)
  const result = await query(
    `select c.name, coalesce(c.email, 'nao-informado') as email, coalesce(c.phone, 'nao-informado') as phone,
      count(o.id)::int as orders, coalesce(sum(o.gross), 0) as revenue,
      case when count(o.id) = 0 then 0 else coalesce(sum(o.gross), 0) / count(o.id) end as ticket,
      coalesce(to_char(max(o.order_date), 'DD/MM/YYYY'), '-') as last
     from clients c
     left join orders o on o.tenant_id = c.tenant_id and o.client_name = c.name
     where c.tenant_id = $1
     group by c.id
     order by c.created_at desc`,
    [tenantId]
  )
  return result.rows.map((row) => ({ ...row, revenue: Number(row.revenue), ticket: Number(row.ticket) }))
}

export const listOrders = async (tenantId) => {
  await seedDemoData(tenantId)
  const result = await query(
    `select o.external_code as id, to_char(o.order_date, 'DD/MM/YYYY') as date,
      o.client_name as client, o.marketplace_name as marketplace,
      coalesce(oi.product_name, 'Produto') as product, coalesce(oi.quantity, 1) as qty,
      o.gross, o.fee, o.shipping, o.net, o.profit, o.status
     from orders o
     left join order_items oi on oi.tenant_id = o.tenant_id and oi.order_id = o.id
     where o.tenant_id = $1
     order by o.order_date desc, o.created_at desc`,
    [tenantId]
  )
  return result.rows.map((row) => ({
    ...row,
    qty: Number(row.qty),
    gross: Number(row.gross),
    fee: Number(row.fee),
    shipping: Number(row.shipping),
    net: Number(row.net),
    profit: Number(row.profit)
  }))
}

export const listGoals = async (tenantId) => {
  await seedDemoData(tenantId)
  const result = await query(
    `select name, current_value as current, target, color, icon
     from goals where tenant_id = $1 order by created_at desc`,
    [tenantId]
  )
  return result.rows.map((row) => ({ ...row, current: Number(row.current), target: Number(row.target) }))
}

export const readAppData = async (tenantId) => ({
  products: await listProducts(tenantId),
  orders: await listOrders(tenantId),
  expenses: await listExpenses(tenantId),
  filaments: await listFilaments(tenantId),
  printers: await listPrinters(tenantId),
  marketplaces: await listMarketplaces(tenantId),
  clients: await listClients(tenantId),
  goals: await listGoals(tenantId),
  expenseSegments: db.expenseSegments
})
