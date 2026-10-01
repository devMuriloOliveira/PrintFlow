import { withTenant } from '../db/pool.js'
import { decryptField } from '../security/crypto.js'

const number = (value) => Number(value || 0)
const activeStatuses = new Set(['starting', 'printing', 'paused'])
const queuedStatuses = new Set(['queued', 'awaiting_confirmation'])
const awaitingOrderStatuses = new Set(['Novo', 'Pendente', 'Aguardando', 'Aguardando confirmação', 'Aguardando confirmacao'])
const productionOrderStatuses = new Set(['Produção', 'Producao', 'Em producao', 'Impresso', 'Embalando'])
const shippingOrderStatuses = new Set(['Enviado', 'Envio'])
const completedOrderStatuses = new Set(['Entregue', 'Concluido', 'Concluído'])
const expenseColors = ['#1768f2', '#29b6c8', '#f59e0b', '#fb923c', '#c83bb7', '#7d8799']

export const emptyDashboardSummary = () => ({
  totals: { revenue: 0, netRevenue: 0, profit: 0, fees: 0, shipping: 0, manualExpenses: 0, recipeCost: 0, expenseTotal: 0, orderCount: 0, ticket: 0, margin: 0 },
  monthlyRevenue: Array(12).fill(0),
  monthlyExpenses: Array(12).fill(0),
  monthlyOrders: Array(12).fill(0),
  expenseSegments: [],
  productPerformance: [],
  goals: [],
  jobCounts: { active: 0, queued: 0, occupiedPrinters: 0 },
  printerCount: 0,
  queuePrinters: [],
  maintenancePrinters: [],
  orderStages: { awaiting: 0, production: 0, shipping: 0, completed: 0 },
  lowStockItems: [],
  pendingOrders: []
})

const monthIndex = (value) => {
  const raw = String(value || '')
  const parts = raw.split('/').map(Number)
  const month = parts.length >= 2 ? parts[1] : Number(raw.slice(5, 7))
  return month >= 1 && month <= 12 ? month - 1 : -1
}

export const buildDashboardSummary = (data = {}) => {
  const summary = emptyDashboardSummary()
  const products = Array.isArray(data.products) ? data.products : []
  const orders = Array.isArray(data.orders) ? data.orders : []
  const expenses = Array.isArray(data.expenses) ? data.expenses : []
  const filaments = Array.isArray(data.filaments) ? data.filaments : []
  const printers = Array.isArray(data.printers) ? data.printers : []
  const printJobs = Array.isArray(data.printJobs) ? data.printJobs : []
  const goals = Array.isArray(data.goals) ? data.goals : []
  const productsById = new Map()
  const productsByName = new Map()
  for (const product of products) {
    if (product.id && !productsById.has(String(product.id))) productsById.set(String(product.id), product)
    if (!productsByName.has(product.name)) productsByName.set(product.name, product)
  }

  const performance = new Map()
  for (const order of orders) {
    const status = String(order.status || '')
    if (status !== 'Cancelado') {
      const quantity = number(order.qty)
      summary.totals.revenue += number(order.gross)
      summary.totals.netRevenue += number(order.net)
      summary.totals.profit += number(order.profit)
      summary.totals.fees += number(order.fee)
      summary.totals.shipping += number(order.shipping)
      summary.totals.orderCount += 1
      const product = productsById.get(String(order.productId || '')) || productsByName.get(order.product)
      summary.totals.recipeCost += number(product?.cost) * quantity
      const month = monthIndex(order.date)
      if (month >= 0) {
        summary.monthlyRevenue[month] += number(order.gross)
        summary.monthlyOrders[month] += quantity || 1
      }
      const current = performance.get(order.product) || { sales: 0, profit: 0 }
      current.sales += quantity
      current.profit += number(order.profit)
      performance.set(order.product, current)
    }
    if (awaitingOrderStatuses.has(status)) summary.orderStages.awaiting += 1
    if (productionOrderStatuses.has(status)) summary.orderStages.production += 1
    if (shippingOrderStatuses.has(status)) summary.orderStages.shipping += 1
    if (completedOrderStatuses.has(status)) summary.orderStages.completed += 1
  }
  summary.totals.ticket = summary.totals.orderCount ? summary.totals.revenue / summary.totals.orderCount : 0
  summary.totals.margin = summary.totals.revenue ? summary.totals.profit / summary.totals.revenue * 100 : 0

  const categoryTotals = new Map()
  for (const expense of expenses) {
    const value = number(expense.value)
    summary.totals.manualExpenses += value
    categoryTotals.set(expense.category, (categoryTotals.get(expense.category) || 0) + value)
    const month = monthIndex(expense.date)
    if (month >= 0) summary.monthlyExpenses[month] += value
  }
  summary.totals.expenseTotal = summary.totals.manualExpenses + summary.totals.fees + summary.totals.shipping + summary.totals.recipeCost
  summary.expenseSegments = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], index) => ({
    label,
    value: summary.totals.manualExpenses ? Number((value / summary.totals.manualExpenses * 100).toFixed(1)) : 0,
    color: expenseColors[index % expenseColors.length]
  }))
  summary.productPerformance = products.map((product) => {
    const item = performance.get(product.name) || { sales: 0, profit: 0 }
    return { id: String(product.id || ''), name: product.name, sku: product.sku, thumb: product.thumb, margin: number(product.margin), sales: item.sales, orderProfit: item.profit }
  }).sort((a, b) => b.orderProfit - a.orderProfit)
  summary.goals = goals

  const activeJobs = printJobs.filter((job) => activeStatuses.has(String(job.status || '')))
  const queuedJobs = printJobs.filter((job) => queuedStatuses.has(String(job.status || '')))
  summary.jobCounts.active = activeJobs.length
  summary.jobCounts.queued = queuedJobs.length
  summary.jobCounts.occupiedPrinters = new Set(activeJobs.map((job) => String(job.printerId || '')).filter(Boolean)).size
  summary.printerCount = printers.length
  const activeByPrinter = new Map()
  const queuedByPrinter = new Map()
  for (const job of activeJobs) {
    const printerId = String(job.printerId || '')
    if (!activeByPrinter.has(printerId)) activeByPrinter.set(printerId, job)
  }
  for (const job of queuedJobs) {
    const printerId = String(job.printerId || '')
    queuedByPrinter.set(printerId, (queuedByPrinter.get(printerId) || 0) + 1)
  }
  summary.queuePrinters = printers.map((printer) => {
    const printerId = String(printer.id || '')
    const activeJob = activeByPrinter.get(printerId) || null
    const progress = number(activeJob?.agentLastStatus?.progress)
    return { id: printerId, name: printer.name, code: printer.code, activeJob, queued: queuedByPrinter.get(printerId) || 0, progress: Number.isFinite(progress) ? progress : 0 }
  }).sort((a, b) => Number(Boolean(b.activeJob)) - Number(Boolean(a.activeJob)) || b.queued - a.queued).slice(0, 5)
  summary.maintenancePrinters = printers.filter((printer) => /manuten[cç]/i.test(String(printer.status || ''))).map((printer) => ({ name: printer.name }))
  summary.lowStockItems = filaments.filter((filament) => number(filament.remaining) < 300).map((filament) => ({ id: String(filament.id || ''), name: filament.name, remaining: number(filament.remaining) }))
  const jobOrderIds = new Set(printJobs.flatMap((job) => [String(job.orderId || ''), job.trackedSaleId ? `marketplace:${job.trackedSaleId}` : '']))
  summary.pendingOrders = orders.filter((order) => productionOrderStatuses.has(String(order.status || '')) && !jobOrderIds.has(String(order.dbId || order.id || ''))).slice(0, 3).map((order) => ({ id: order.id }))
  return summary
}

const analyticsSql = `
  with product_catalog as (
    select id, name, sku, thumb, margin, cost, created_at from products where tenant_id = $1
  ), product_by_name as (
    select distinct on (name) name, cost from product_catalog order by name, created_at desc
  ), sales as (
    select o.id as resource_id, false as marketplace_order, o.id as direct_order_id, null::bigint as tracked_sale_id, o.external_id,
      o.product_id, o.product_name, o.quantity, o.gross, o.fee, o.shipping, o.net, o.profit, o.status,
      o.order_date::timestamptz as sold_at,
      coalesce(product_by_id.cost, product_by_name.cost, 0) * o.quantity as recipe_cost
    from orders o
    left join product_catalog product_by_id on product_by_id.id = o.product_id
    left join product_by_name on product_by_name.name = o.product_name
    where o.tenant_id = $1
    union all
    select s.id, true, null::bigint, s.id, s.external_order_id, null::bigint, s.product_name, s.quantity,
      s.gross, s.marketplace_fee, s.shipping, s.net, s.profit, s.status, s.sold_at,
      coalesce(product_by_name.cost, 0) * s.quantity
    from tracked_sales s
    left join product_by_name on product_by_name.name = s.product_name
    where s.tenant_id = $1
  ), expense_data as (
    select category, amount, expense_date from expenses where tenant_id = $1
  ), product_sales as (
    select product_name, sum(quantity) as sales, sum(profit) as profit from sales
    where status <> 'Cancelado' group by product_name
  ), goal_metrics as (
    select g.id, sum(s.gross) as revenue, sum(s.profit) as profit, count(s.sold_at)::int as orders, avg(s.gross) as ticket
    from goals g left join sales s on s.status <> 'Cancelado' and g.period_start is not null and g.period_end is not null
      and s.sold_at >= g.period_start and s.sold_at < (g.period_end + interval '1 day')
    where g.tenant_id = $1 group by g.id
  )
  select
    (select jsonb_build_object(
      'revenue', coalesce(sum(gross) filter (where status <> 'Cancelado'), 0),
      'netRevenue', coalesce(sum(net) filter (where status <> 'Cancelado'), 0),
      'profit', coalesce(sum(profit) filter (where status <> 'Cancelado'), 0),
      'fees', coalesce(sum(fee) filter (where status <> 'Cancelado'), 0),
      'shipping', coalesce(sum(shipping) filter (where status <> 'Cancelado'), 0),
      'recipeCost', coalesce(sum(recipe_cost) filter (where status <> 'Cancelado'), 0),
      'orderCount', count(*) filter (where status <> 'Cancelado')
    ) from sales) as sales_totals,
    (select coalesce(sum(amount), 0) from expense_data) as manual_expenses,
    (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'revenue', revenue, 'orders', orders) order by month), '[]'::jsonb)
      from (select extract(month from sold_at)::int as month, sum(gross) as revenue, sum(case when quantity = 0 then 1 else quantity end) as orders
        from sales where status <> 'Cancelado' group by extract(month from sold_at)) monthly) as monthly_sales,
    (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'value', value) order by month), '[]'::jsonb)
      from (select extract(month from expense_date)::int as month, sum(amount) as value from expense_data group by extract(month from expense_date)) monthly) as monthly_expenses,
    (select coalesce(jsonb_agg(jsonb_build_object('label', category, 'total', total) order by total desc), '[]'::jsonb)
      from (select category, sum(amount) as total from expense_data group by category) categories) as expense_categories,
    (select coalesce(jsonb_agg(jsonb_build_object('id', pc.id, 'name', pc.name, 'sku', pc.sku, 'thumb', pc.thumb,
      'margin', pc.margin, 'sales', coalesce(ps.sales, 0), 'orderProfit', coalesce(ps.profit, 0))
      order by coalesce(ps.profit, 0) desc, pc.created_at desc), '[]'::jsonb)
      from product_catalog pc left join product_sales ps on ps.product_name = pc.name) as product_performance,
    (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'goalType', g.goal_type,
      'current', case when g.goal_type = 'revenue' then coalesce(gm.revenue, 0) when g.goal_type = 'profit' then coalesce(gm.profit, 0)
        when g.goal_type = 'orders' then coalesce(gm.orders, 0) when g.goal_type = 'average_ticket' then coalesce(gm.ticket, 0) else g.current_value end,
      'target', g.target_value, 'color', g.color, 'icon', g.icon, 'periodStart', to_char(g.period_start, 'YYYY-MM-DD'),
      'periodEnd', to_char(g.period_end, 'YYYY-MM-DD'), 'status', g.status) order by g.created_at asc), '[]'::jsonb)
      from goals g left join goal_metrics gm on gm.id = g.id where g.tenant_id = $1) as goals,
    (select coalesce(jsonb_object_agg(status, count), '{}'::jsonb) from
      (select coalesce(status, '') as status, count(*)::int as count from sales group by status) stages) as stage_counts,
    (select coalesce(jsonb_agg(jsonb_build_object('id', external_id) order by sold_at desc, resource_id desc), '[]'::jsonb) from
      (select s.external_id, s.sold_at, s.resource_id from sales s where s.status in ('Produção', 'Producao', 'Em producao', 'Impresso', 'Embalando')
        and not exists (select 1 from print_jobs j where j.tenant_id = $1
          and ((s.marketplace_order = false and j.order_id = s.direct_order_id) or (s.marketplace_order = true and j.tracked_sale_id = s.tracked_sale_id)))
        order by s.sold_at desc, s.resource_id desc limit 3) pending) as pending_orders,
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'remaining', remaining_weight) order by created_at desc), '[]'::jsonb)
      from filaments where tenant_id = $1 and remaining_weight < 300) as low_stock_items
`

const operationalSql = `
  with job_counts as (
    select count(*) filter (where status in ('starting', 'printing', 'paused'))::int as active,
      count(*) filter (where status in ('queued', 'awaiting_confirmation'))::int as queued,
      count(distinct printer_id) filter (where status in ('starting', 'printing', 'paused') and printer_id is not null)::int as occupied_printers
    from print_jobs where tenant_id = $1
  ), printer_rows as (
    select p.id, p.name, p.code, p.status, p.created_at,
      active.title as active_title, active.product_name, active.agent_last_status,
      coalesce(queue.queued, 0)::int as queued
    from printers p
    left join lateral (
      select j.title, coalesce(product.name, j.title) as product_name, agent_printer.last_status as agent_last_status
      from print_jobs j
      left join products product on product.id = j.product_id and product.tenant_id = j.tenant_id
      left join agent_printers agent_printer on agent_printer.id = j.agent_printer_id and agent_printer.tenant_id = j.tenant_id
      where j.tenant_id = $1 and j.printer_id = p.id and j.status in ('starting', 'printing', 'paused')
      order by case j.status when 'printing' then 0 when 'paused' then 1 else 7 end, j.priority desc, j.created_at asc
      limit 1
    ) active on true
    left join lateral (
      select count(*)::int as queued from print_jobs j
      where j.tenant_id = $1 and j.printer_id = p.id and j.status in ('queued', 'awaiting_confirmation')
    ) queue on true
    where p.tenant_id = $1
  ), queue_rows as (
    select * from printer_rows order by (active_title is not null) desc, queued desc, created_at desc limit 5
  )
  select jsonb_build_object('active', job_counts.active, 'queued', job_counts.queued, 'occupiedPrinters', job_counts.occupied_printers) as job_counts,
    (select count(*)::int from printer_rows) as printer_count,
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code, 'queued', queued,
      'activeJob', case when active_title is null then null else jsonb_build_object('title', active_title, 'productName', product_name, 'agentLastStatus', coalesce(agent_last_status, '{}'::jsonb)) end)
      order by (active_title is not null) desc, queued desc, created_at desc), '[]'::jsonb) from queue_rows) as queue_printers,
    (select coalesce(jsonb_agg(jsonb_build_object('name', name) order by created_at desc), '[]'::jsonb)
      from printer_rows where lower(status) like '%manutenc%' or lower(status) like '%manutenç%') as maintenance_printers
  from job_counts
`

const mapDatabaseSummary = (analytics, operational) => {
  const summary = emptyDashboardSummary()
  const sales = analytics.sales_totals || {}
  summary.totals = {
    revenue: number(sales.revenue), netRevenue: number(sales.netRevenue), profit: number(sales.profit), fees: number(sales.fees),
    shipping: number(sales.shipping), manualExpenses: number(analytics.manual_expenses), recipeCost: number(sales.recipeCost),
    expenseTotal: 0, orderCount: Number(sales.orderCount || 0), ticket: 0, margin: 0
  }
  summary.totals.expenseTotal = summary.totals.manualExpenses + summary.totals.fees + summary.totals.shipping + summary.totals.recipeCost
  summary.totals.ticket = summary.totals.orderCount ? summary.totals.revenue / summary.totals.orderCount : 0
  summary.totals.margin = summary.totals.revenue ? summary.totals.profit / summary.totals.revenue * 100 : 0
  for (const item of analytics.monthly_sales || []) {
    const index = Number(item.month) - 1
    if (index >= 0 && index < 12) { summary.monthlyRevenue[index] = number(item.revenue); summary.monthlyOrders[index] = number(item.orders) }
  }
  for (const item of analytics.monthly_expenses || []) {
    const index = Number(item.month) - 1
    if (index >= 0 && index < 12) summary.monthlyExpenses[index] = number(item.value)
  }
  const categoryTotal = (analytics.expense_categories || []).reduce((total, item) => total + number(item.total), 0)
  summary.expenseSegments = (analytics.expense_categories || []).map((item, index) => ({ label: item.label, value: categoryTotal ? Number((number(item.total) / categoryTotal * 100).toFixed(1)) : 0, color: expenseColors[index % expenseColors.length] }))
  summary.productPerformance = (analytics.product_performance || []).map((item) => ({ ...item, id: String(item.id), margin: number(item.margin), sales: number(item.sales), orderProfit: number(item.orderProfit) }))
  summary.goals = (analytics.goals || []).map((goal) => ({ ...goal, id: String(goal.id), current: number(goal.current), target: number(goal.target) }))
  const stages = analytics.stage_counts || {}
  summary.orderStages = {
    awaiting: Number(stages.Novo || 0) + Number(stages.Pendente || 0) + Number(stages.Aguardando || 0) + Number(stages['Aguardando confirmação'] || 0) + Number(stages['Aguardando confirmacao'] || 0),
    production: Number(stages['Produção'] || 0) + Number(stages.Producao || 0) + Number(stages['Em producao'] || 0) + Number(stages.Impresso || 0) + Number(stages.Embalando || 0),
    shipping: Number(stages.Enviado || 0) + Number(stages.Envio || 0),
    completed: Number(stages.Entregue || 0) + Number(stages.Concluido || 0) + Number(stages['Concluído'] || 0)
  }
  summary.pendingOrders = (analytics.pending_orders || []).map((order) => ({ id: decryptField(order.id) }))
  summary.lowStockItems = (analytics.low_stock_items || []).map((item) => ({ id: String(item.id), name: item.name, remaining: number(item.remaining) }))
  summary.jobCounts = { active: Number(operational.job_counts?.active || 0), queued: Number(operational.job_counts?.queued || 0), occupiedPrinters: Number(operational.job_counts?.occupiedPrinters || 0) }
  summary.printerCount = Number(operational.printer_count || 0)
  summary.queuePrinters = (operational.queue_printers || []).map((printer) => ({ ...printer, id: String(printer.id), progress: number(printer.activeJob?.agentLastStatus?.progress) }))
  summary.maintenancePrinters = operational.maintenance_printers || []
  return summary
}

export const loadDashboardSummaryWithClient = async (client, tenantId) => {
  const analyticsResult = await client.query(analyticsSql, [tenantId])
  const operationalResult = await client.query(operationalSql, [tenantId])
  return mapDatabaseSummary(analyticsResult.rows[0] || {}, operationalResult.rows[0] || {})
}

export const getDashboardSummary = (tenantId) => withTenant(tenantId, (client) => loadDashboardSummaryWithClient(client, tenantId))
