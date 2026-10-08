import { withTenant } from '../db/pool.js'
import { decryptField } from '../security/crypto.js'

const number = (value) => Number(value || 0)
const datePattern = /^\d{4}-\d{2}-\d{2}$/

export const normalizeReportSummaryOptions = (options = {}) => {
  const now = new Date()
  const defaultFrom = `${now.getFullYear()}-01-01`
  const defaultTo = now.toISOString().slice(0, 10)
  const from = datePattern.test(String(options.from || '')) ? String(options.from) : defaultFrom
  const to = datePattern.test(String(options.to || '')) ? String(options.to) : defaultTo
  const grouping = ['day', 'week', 'month'].includes(options.grouping) ? options.grouping : 'month'
  const section = options.section === 'produtos' ? 'produtos' : 'financeiro'
  return {
    from,
    to,
    grouping,
    section,
    marketplace: String(options.marketplace || '').slice(0, 160),
    product: String(options.product || '').slice(0, 240),
    category: String(options.category || '').slice(0, 160),
    channel: ['direct', 'marketplace'].includes(options.channel) ? options.channel : '',
    limit: Math.min(100, Math.max(1, Number(options.limit) || 50)),
    offset: Math.max(0, Number(options.offset) || 0)
  }
}

export const emptyReportSummary = (options = {}) => ({
  filters: normalizeReportSummaryOptions(options),
  totals: { revenue: 0, netRevenue: 0, fees: 0, shipping: 0, registeredProfit: 0, expenses: 0, profit: 0, estimatedCurrentCost: 0, orderCount: 0, itemCount: 0, ticket: 0, productsCount: 0 },
  series: [],
  marketplaces: [],
  channels: [],
  clients: [],
  productionCostComparison: { jobCount: 0, estimatedCurrentRateCost: 0, actualRecordedCost: 0, variance: 0 },
  expenseCategories: [],
  products: [],
  sales: { items: [], total: 0, limit: Math.min(100, Math.max(1, Number(options.limit) || 50)), offset: Math.max(0, Number(options.offset) || 0) },
  options: { marketplaces: [], products: [], categories: [] }
})

const reportSummarySql = `
  with product_catalog as (
    select id, name, sku, thumb, cost, created_at from products where tenant_id = $1
  ), product_by_name as (
    select distinct on (name) name, sku, thumb, cost from product_catalog order by name, created_at desc
  ), all_sales as (
    select 'order:' || o.id::text as resource_key, o.external_id, o.order_date::timestamptz as sold_at,
      coalesce(m.name, case when (case when o.marketplace_id is null then 'direct' else coalesce(nullif(o.sales_channel, ''), 'marketplace') end) = 'direct' then 'Venda direta' else 'Sem marketplace' end) as marketplace,
      case when o.marketplace_id is null or lower(coalesce(m.name, '')) = 'manual' then 'direct' else coalesce(nullif(o.sales_channel, ''), 'marketplace') end as channel,
      o.product_name as product, o.quantity, o.gross, o.fee, o.shipping, o.net, o.profit, o.status,
      coalesce(product_by_id.cost, product_by_name.cost, 0) * o.quantity as current_cost,
      o.client_id, client.name as client_name
    from orders o
    left join marketplaces m on m.id = o.marketplace_id and m.tenant_id = o.tenant_id
    left join clients client on client.id = o.client_id and client.tenant_id = o.tenant_id
    left join product_catalog product_by_id on product_by_id.id = o.product_id
    left join product_by_name on product_by_name.name = o.product_name
    where o.tenant_id = $1 and coalesce(o.status, '') <> 'Cancelado'

    union all

    select 'tracked:' || s.id::text, s.external_order_id, s.sold_at,
      coalesce(m.name, nullif(s.platform, ''), 'Sem marketplace'), 'marketplace', s.product_name, s.quantity,
      s.gross, s.marketplace_fee, s.shipping, s.net, s.profit, s.status,
      coalesce(product_by_name.cost, 0) * s.quantity, null::bigint, null::text
    from tracked_sales s
    left join marketplaces m on m.id = s.marketplace_id and m.tenant_id = s.tenant_id
    left join product_by_name on product_by_name.name = s.product_name
    where s.tenant_id = $1 and coalesce(s.status, '') <> 'Cancelado'
  ), filtered_sales as (
    select * from all_sales
    where sold_at >= $2::date and sold_at < ($3::date + interval '1 day')
      and ($4::text = '' or marketplace = $4)
      and ($5::text = '' or product = $5)
      and ($6::text = '' or channel = $6)
  ), all_expenses as (
    select category, amount, expense_date from expenses where tenant_id = $1 and coalesce(status, '') <> 'Cancelado'
  ), filtered_expenses as (
    select * from all_expenses where expense_date >= $2::date and expense_date <= $3::date
      and ($7::text = '' or category = $7)
  ), sales_series as (
    select date_trunc($8::text, sold_at) as period, sum(gross) as revenue, sum(profit) as profit
    from filtered_sales group by date_trunc($8::text, sold_at)
  ), expense_series as (
    select date_trunc($8::text, expense_date::timestamptz) as period, sum(amount) as expenses
    from filtered_expenses group by date_trunc($8::text, expense_date::timestamptz)
  ), series_periods as (
    select period from sales_series union select period from expense_series
  ), product_rows as (
    select product, count(*)::int as orders, sum(quantity) as quantity, sum(gross) as revenue, sum(profit) as profit
    from filtered_sales group by product
  ), client_rows as (
    select client_id, max(client_name) as client_name, count(*)::int as orders,
      sum(gross) as revenue, sum(profit) as profit
    from filtered_sales group by client_id
  ), channel_rows as (
    select channel, count(*)::int as orders, sum(gross) as revenue, sum(profit) as profit
    from filtered_sales group by channel
  ), production_cost_rows as (
    select j.id,
      (j.estimated_filament_grams / nullif(f.initial_weight, 0) * f.cost)
        + (j.estimated_print_seconds / 3600 * pr.power_w / 1000 * tenant.kwh_cost) as estimated_current_rate_cost,
      j.actual_material_cost + j.actual_energy_cost as actual_recorded_cost
    from print_jobs j
    join tenants tenant on tenant.id = j.tenant_id
    join products p on p.id = j.product_id and p.tenant_id = j.tenant_id
    join filaments f on f.id = p.filament_id and f.tenant_id = j.tenant_id
    join printers pr on pr.id = j.printer_id and pr.tenant_id = j.tenant_id
    join filtered_sales sale on sale.resource_key = case
      when j.order_id is not null then 'order:' || j.order_id::text
      when j.tracked_sale_id is not null then 'tracked:' || j.tracked_sale_id::text
      else '' end
    where j.tenant_id = $1 and j.status = 'completed' and j.metrics_source = 'agent_measured'
      and j.estimated_filament_grams > 0 and j.estimated_print_seconds > 0
      and j.actual_filament_grams is not null and j.actual_print_seconds is not null
      and j.actual_material_cost is not null and j.actual_energy_cost is not null
      and f.initial_weight > 0 and f.cost is not null and pr.power_w is not null and tenant.kwh_cost is not null
  )
  select
    (select jsonb_build_object(
      'revenue', coalesce(sum(gross), 0), 'netRevenue', coalesce(sum(net), 0), 'fees', coalesce(sum(fee), 0),
      'shipping', coalesce(sum(shipping), 0), 'registeredProfit', coalesce(sum(profit), 0),
      'estimatedCurrentCost', coalesce(sum(current_cost), 0), 'orderCount', count(*)::int,
      'itemCount', coalesce(sum(quantity), 0)
    ) from filtered_sales) as sales_totals,
    (select coalesce(sum(amount), 0) from filtered_expenses) as expense_total,
    (select count(*)::int from product_catalog) as products_count,
    (select coalesce(jsonb_agg(jsonb_build_object('key', to_char(periods.period, 'YYYY-MM-DD'),
      'revenue', coalesce(sales.revenue, 0), 'expenses', coalesce(expenses.expenses, 0),
      'profit', coalesce(sales.profit, 0) - coalesce(expenses.expenses, 0)) order by periods.period), '[]'::jsonb)
      from series_periods periods left join sales_series sales on sales.period = periods.period
      left join expense_series expenses on expenses.period = periods.period) as series,
    (select coalesce(jsonb_agg(jsonb_build_object('name', marketplace, 'value', value) order by value desc), '[]'::jsonb)
      from (select marketplace, sum(gross) as value from filtered_sales group by marketplace) rows) as marketplaces,
    (select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'orders', orders, 'revenue', revenue, 'profit', profit) order by revenue desc), '[]'::jsonb)
      from channel_rows) as channels,
    (select coalesce(jsonb_agg(jsonb_build_object('id', client_id::text, 'name', client_name, 'orders', orders, 'revenue', revenue, 'profit', profit) order by revenue desc), '[]'::jsonb)
      from (select * from client_rows order by revenue desc limit 20) rows) as clients,
    (select jsonb_build_object('jobCount', count(*)::int,
      'estimatedCurrentRateCost', coalesce(sum(estimated_current_rate_cost), 0),
      'actualRecordedCost', coalesce(sum(actual_recorded_cost), 0),
      'variance', coalesce(sum(actual_recorded_cost - estimated_current_rate_cost), 0))
      from production_cost_rows) as production_cost_comparison,
    (select coalesce(jsonb_agg(jsonb_build_object('label', category, 'total', total) order by total desc), '[]'::jsonb)
      from (select category, sum(amount) as total from filtered_expenses group by category) rows) as expense_categories,
    (select coalesce(jsonb_agg(jsonb_build_object('name', rows.product, 'sku', product_by_name.sku, 'thumb', product_by_name.thumb,
      'orders', rows.orders, 'quantity', rows.quantity, 'revenue', rows.revenue, 'profit', rows.profit)
      order by rows.revenue desc, rows.product), '[]'::jsonb)
      from product_rows rows left join product_by_name on product_by_name.name = rows.product) as products,
    (select coalesce(jsonb_agg(jsonb_build_object('dbId', page.resource_key, 'id', page.external_id,
      'date', to_char(page.sold_at, 'DD/MM/YYYY'), 'marketplace', page.marketplace, 'salesChannel', page.channel,
      'product', page.product, 'qty', page.quantity, 'gross', page.gross, 'fee', page.fee, 'shipping', page.shipping,
      'net', page.net, 'profit', page.profit, 'status', page.status) order by page.sold_at desc, page.resource_key desc), '[]'::jsonb)
      from (select * from filtered_sales where $9::text = 'produtos' order by sold_at desc, resource_key desc limit $10 offset $11) page) as sales_items,
    (select count(*)::int from filtered_sales where $9::text = 'produtos') as sales_total,
    (select coalesce(jsonb_agg(name order by name), '[]'::jsonb) from (select distinct marketplace as name from all_sales) rows) as marketplace_options,
    (select coalesce(jsonb_agg(name order by name), '[]'::jsonb) from product_by_name) as product_options,
    (select coalesce(jsonb_agg(category order by category), '[]'::jsonb) from (select distinct category from all_expenses) rows) as category_options
`

const mapDatabaseReportSummary = (row, options) => {
  const result = emptyReportSummary(options)
  const sales = row.sales_totals || {}
  const expenses = number(row.expense_total)
  const revenue = number(sales.revenue)
  const registeredProfit = number(sales.registeredProfit)
  result.totals = {
    revenue,
    netRevenue: number(sales.netRevenue),
    fees: number(sales.fees),
    shipping: number(sales.shipping),
    registeredProfit,
    expenses,
    profit: registeredProfit - expenses,
    estimatedCurrentCost: number(sales.estimatedCurrentCost),
    orderCount: Number(sales.orderCount || 0),
    itemCount: number(sales.itemCount),
    ticket: Number(sales.orderCount || 0) ? revenue / Number(sales.orderCount) : 0,
    productsCount: Number(row.products_count || 0)
  }
  result.series = (row.series || []).map((item) => ({ key: item.key, revenue: number(item.revenue), expenses: number(item.expenses), profit: number(item.profit) }))
  result.marketplaces = (row.marketplaces || []).map((item) => ({ name: item.name, value: number(item.value) }))
  result.channels = (row.channels || []).map((item) => ({ channel: item.channel, orders: Number(item.orders || 0), revenue: number(item.revenue), profit: number(item.profit) }))
  result.clients = (row.clients || []).map((item) => ({ id: item.id || '', name: decryptField(item.name) || 'Sem cliente vinculado', orders: Number(item.orders || 0), revenue: number(item.revenue), profit: number(item.profit) }))
  const costComparison = row.production_cost_comparison || {}
  result.productionCostComparison = {
    jobCount: Number(costComparison.jobCount || 0),
    estimatedCurrentRateCost: number(costComparison.estimatedCurrentRateCost),
    actualRecordedCost: number(costComparison.actualRecordedCost),
    variance: number(costComparison.variance)
  }
  result.expenseCategories = (row.expense_categories || []).map((item) => ({ label: item.label, total: number(item.total) }))
  result.products = (row.products || []).map((item) => ({ ...item, orders: Number(item.orders || 0), quantity: number(item.quantity), revenue: number(item.revenue), profit: number(item.profit) }))
  result.sales = {
    items: (row.sales_items || []).map((item) => ({ ...item, id: decryptField(item.id), qty: number(item.qty), gross: number(item.gross), fee: number(item.fee), shipping: number(item.shipping), net: number(item.net), profit: number(item.profit) })),
    total: Number(row.sales_total || 0),
    limit: options.limit,
    offset: options.offset
  }
  result.options = {
    marketplaces: row.marketplace_options || [],
    products: row.product_options || [],
    categories: row.category_options || []
  }
  return result
}

export const loadReportSummaryWithClient = async (client, tenantId, rawOptions = {}) => {
  const options = normalizeReportSummaryOptions(rawOptions)
  if (options.from > options.to) throw new Error('Periodo invalido')
  const result = await client.query(reportSummarySql, [
    tenantId, options.from, options.to, options.marketplace, options.product, options.channel,
    options.category, options.grouping, options.section, options.limit, options.offset
  ])
  return mapDatabaseReportSummary(result.rows[0] || {}, options)
}

export const getReportSummary = (tenantId, options = {}) => withTenant(tenantId, (client) => loadReportSummaryWithClient(client, tenantId, options))
