import ExcelJS from 'exceljs'
import { getAuthUser } from './auth.js'
import { hasDatabase, withTenant } from '../db/pool.js'
import { sendBuffer, sendJson, sendText } from '../http/response.js'
import { writeAuditEvent } from '../services/operationalEvents.js'
import { decryptField } from '../security/crypto.js'

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`
const dateValue = (value, fallback) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : fallback
const filenameDate = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')

const loadReport = async (tenantId, filters) => withTenant(tenantId, async (client) => {
  const ordersParams = [tenantId, filters.from, filters.to]
  const orderWhere = ['sr.tenant_id = $1', 'sr.order_date >= $2', "sr.order_date < ($3::date + interval '1 day')"]
  if (filters.marketplace) { ordersParams.push(filters.marketplace); orderWhere.push(`sr.marketplace = $${ordersParams.length}`) }
  if (filters.product) { ordersParams.push(filters.product); orderWhere.push(`sr.product = $${ordersParams.length}`) }
  if (filters.channel) { ordersParams.push(filters.channel); orderWhere.push(`sr.channel = $${ordersParams.length}`) }
  const expensesParams = [tenantId, filters.from, filters.to]
  const expenseWhere = ['e.tenant_id = $1', 'e.expense_date >= $2', 'e.expense_date <= $3']
  if (filters.category) { expensesParams.push(filters.category); expenseWhere.push(`e.category = $${expensesParams.length}`) }
  const [orders, expenses, products, filaments, printers, marketplaces, clients, goals, printJobs, integrations, movements, simulations, history] = await Promise.all([
    client.query(`
      with sales_rows as (
        select o.tenant_id, o.id, o.order_date, coalesce(m.name, case when o.sales_channel = 'direct' then 'Venda direta' else 'Sem marketplace' end) as marketplace,
          coalesce(o.sales_channel, case when lower(coalesce(m.name, '')) = 'manual' then 'direct' else 'marketplace' end) as channel,
          o.product_name as product, o.quantity, o.gross, o.fee, o.shipping, o.net, o.profit
        from orders o
        left join marketplaces m on m.id = o.marketplace_id and m.tenant_id = o.tenant_id
        where o.tenant_id = $1

        union all

        select s.tenant_id, s.id, s.sold_at as order_date, coalesce(m.name, s.platform) as marketplace, 'marketplace' as channel,
          s.product_name as product, s.quantity, s.gross, s.marketplace_fee as fee, s.shipping, s.net, s.profit
        from tracked_sales s
        left join marketplaces m on m.id = s.marketplace_id and m.tenant_id = s.tenant_id
        where s.tenant_id = $1
      )
      select to_char(sr.order_date, 'YYYY-MM-DD') as date, sr.marketplace, sr.channel, sr.product, sr.quantity,
        sr.gross, sr.fee, sr.shipping, sr.net, sr.profit
      from sales_rows sr
      where ${orderWhere.join(' and ')}
      order by sr.order_date, sr.id
    `, ordersParams),
    client.query(`select to_char(e.expense_date, 'YYYY-MM-DD') as date, e.description, e.category, e.supplier, e.amount, e.payment, e.recurrence, e.status, to_char(e.next_due_date, 'YYYY-MM-DD') as next_due_date, e.notes from expenses e where ${expenseWhere.join(' and ')} order by e.expense_date, e.id`, expensesParams),
    client.query(`select name, sku, category, price, cost, profit, margin from products where tenant_id = $1 order by name`, [tenantId]),
    client.query(`select name, maker, material, type, color, initial_weight, remaining_weight, min_stock_weight, cost, supplier, purchase_date, status from filaments where tenant_id = $1 order by name`, [tenantId]),
    client.query(`select name, code, maker, model, power_w, accumulated_hours, status, location, volume, default_filament from printers where tenant_id = $1 order by name`, [tenantId]),
    client.query(`select name, platform, commission, fixed, financial, ads, others, active, connection_status from marketplaces where tenant_id = $1 order by name`, [tenantId]),
    client.query(`select c.name, c.email, c.phone, c.origin, c.status, count(o.id) filter (where o.sales_channel = 'direct' or (o.sales_channel is null and lower(coalesce(m.name, '')) = 'manual'))::int as orders, coalesce(sum(o.gross) filter (where o.sales_channel = 'direct' or (o.sales_channel is null and lower(coalesce(m.name, '')) = 'manual')), 0) as revenue, coalesce(avg(o.gross) filter (where o.sales_channel = 'direct' or (o.sales_channel is null and lower(coalesce(m.name, '')) = 'manual')), 0) as ticket, max(o.order_date) filter (where o.sales_channel = 'direct' or (o.sales_channel is null and lower(coalesce(m.name, '')) = 'manual')) as last_order from clients c left join orders o on o.client_id = c.id and o.tenant_id = $1 left join marketplaces m on m.id = o.marketplace_id and m.tenant_id = o.tenant_id where c.tenant_id = $1 group by c.id order by c.name`, [tenantId]),
    client.query(`select name, current_value, target_value, status, period_start, period_end from goals where tenant_id = $1 order by created_at`, [tenantId]),
    client.query(`select j.title, j.source, j.quantity, j.priority, j.status, j.scheduled_at, j.started_at, j.completed_at, coalesce(p.name, j.title) as product from print_jobs j left join products p on p.id = j.product_id and p.tenant_id = j.tenant_id where j.tenant_id = $1 order by j.created_at`, [tenantId]),
    client.query(`select platform, connection_name, status, token_expires_at, last_sync_at, last_error from marketplace_integrations where tenant_id = $1 order by created_at`, [tenantId]),
    client.query(`select f.name as filament, im.movement_type, im.quantity, im.previous_quantity, im.resulting_quantity, im.reason, im.created_at from inventory_movements im left join filaments f on f.id = im.resource_id and f.tenant_id = im.tenant_id where im.tenant_id = $1 and im.created_at >= $2::date and im.created_at < ($3::date + interval '1 day') order by im.created_at`, [tenantId, filters.from, filters.to]),
    client.query(`select name, price_per_kg, weight, duration_minutes, energy_enabled, energy_rate, watts, margin, direct_cost, suggested_price, created_at from calculator_simulations where tenant_id = $1 and created_at >= $2::date and created_at < ($3::date + interval '1 day') order by created_at`, [tenantId, filters.from, filters.to]),
    client.query(`select resource, resource_id, snapshot, source, created_at from financial_history where tenant_id = $1 and created_at >= $2::date and created_at < ($3::date + interval '1 day') order by created_at`, [tenantId, filters.from, filters.to])
  ])
  return {
    orders: orders.rows,
    expenses: expenses.rows,
    products: products.rows,
    filaments: filaments.rows,
    printers: printers.rows,
    marketplaces: marketplaces.rows,
    clients: clients.rows.map((row) => ({ ...row, name: decryptField(row.name), email: decryptField(row.email), phone: decryptField(row.phone) })),
    goals: goals.rows,
    printJobs: printJobs.rows,
    integrations: integrations.rows,
    movements: movements.rows,
    simulations: simulations.rows,
    history: history.rows
  }
})

const summaryRows = (report) => {
  const sum = (field, rows) => rows.reduce((total, row) => total + Number(row[field] || 0), 0)
  const gross = sum('gross', report.orders); const net = sum('net', report.orders); const fees = sum('fee', report.orders)
  const shipping = sum('shipping', report.orders); const expenses = sum('amount', report.expenses); const profit = sum('profit', report.orders) - expenses
  return [['Indicador', 'Valor'], ['Faturamento bruto', gross], ['Receita liquida', net], ['Taxas', fees], ['Frete', shipping], ['Despesas operacionais', expenses], ['Lucro liquido', profit], ['Margem liquida', gross ? `${(profit / gross * 100).toFixed(2)}%` : '0%'], ['Pedidos', report.orders.length]]
}

const csvReport = (report, filters) => {
  const lines = [['Relatorio financeiro PrintFlow'], ['Periodo', filters.from, filters.to], ['Filtros', filters.marketplace || 'Todos', filters.product || 'Todos', filters.channel || 'Todos'], [], ...summaryRows(report), [], ['Vendas'], ['Data', 'Canal', 'Marketplace', 'Produto', 'Quantidade', 'Bruto', 'Taxas', 'Frete', 'Liquido', 'Lucro']]
  for (const row of report.orders) lines.push([row.date, row.channel, row.marketplace, row.product, row.quantity, row.gross, row.fee, row.shipping, row.net, row.profit])
  lines.push([], ['Despesas'], ['Data', 'Descricao', 'Categoria', 'Fornecedor', 'Valor', 'Pagamento', 'Recorrencia', 'Status', 'Proximo vencimento', 'Observacoes'])
  for (const row of report.expenses) lines.push([row.date, row.description, row.category, row.supplier, row.amount, row.payment, row.recurrence, row.status, row.next_due_date, row.notes])
  lines.push([], ['Produtos'], ['Nome', 'SKU', 'Categoria', 'Preco', 'Custo', 'Lucro', 'Margem'])
  for (const row of report.products) lines.push([row.name, row.sku, row.category, row.price, row.cost, row.profit, row.margin])
  lines.push([], ['Filamentos'], ['Nome', 'Fabricante', 'Material', 'Tipo', 'Cor', 'Peso inicial', 'Peso restante', 'Estoque minimo', 'Custo', 'Fornecedor', 'Data compra', 'Status'])
  for (const row of report.filaments) lines.push([row.name, row.maker, row.material, row.type, row.color, row.initial_weight, row.remaining_weight, row.min_stock_weight, row.cost, row.supplier, row.purchase_date, row.status])
  lines.push([], ['Impressoras'], ['Nome', 'Codigo', 'Fabricante', 'Modelo', 'Potencia W', 'Horas acumuladas', 'Status', 'Localizacao', 'Volume', 'Filamento padrao'])
  for (const row of report.printers) lines.push([row.name, row.code, row.maker, row.model, row.power_w, row.accumulated_hours, row.status, row.location, row.volume, row.default_filament])
  lines.push([], ['Marketplaces'], ['Nome', 'Plataforma', 'Comissao %', 'Tarifa fixa', 'Financeira %', 'Anuncios %', 'Outras %', 'Ativo', 'Status conexao'])
  for (const row of report.marketplaces) lines.push([row.name, row.platform, row.commission, row.fixed, row.financial, row.ads, row.others, row.active, row.connection_status])
  lines.push([], ['Clientes'], ['Nome', 'Email', 'Telefone', 'Pedidos', 'Faturamento', 'Ticket medio', 'Ultimo pedido'])
  for (const row of report.clients) lines.push([row.name, row.email, row.phone, row.orders, row.revenue, row.ticket, row.last_order])
  lines.push([], ['Metas'], ['Nome', 'Atual', 'Alvo', 'Status', 'Inicio', 'Fim'])
  for (const row of report.goals) lines.push([row.name, row.current_value, row.target_value, row.status, row.period_start, row.period_end])
  lines.push([], ['Producao'], ['Titulo', 'Produto', 'Origem', 'Quantidade', 'Prioridade', 'Status', 'Agendada', 'Iniciada', 'Concluida'])
  for (const row of report.printJobs) lines.push([row.title, row.product, row.source, row.quantity, row.priority, row.status, row.scheduled_at, row.started_at, row.completed_at])
  lines.push([], ['Conexoes de marketplace'], ['Plataforma', 'Conexao', 'Status', 'Token expira em', 'Ultima sincronizacao', 'Ultimo erro'])
  for (const row of report.integrations) lines.push([row.platform, row.connection_name, row.status, row.token_expires_at, row.last_sync_at, row.last_error])
  lines.push([], ['Movimentacoes de estoque'], ['Filamento', 'Tipo', 'Quantidade', 'Saldo anterior', 'Saldo resultante', 'Motivo', 'Data'])
  for (const row of report.movements) lines.push([row.filament, row.movement_type, row.quantity, row.previous_quantity, row.resulting_quantity, row.reason, row.created_at])
  lines.push([], ['Simulacoes da calculadora'], ['Nome', 'Preco por kg', 'Peso', 'Duracao minutos', 'Energia ativa', 'Tarifa energia', 'Watts', 'Margem', 'Custo direto', 'Preco sugerido', 'Criada em'])
  for (const row of report.simulations) lines.push([row.name, row.price_per_kg, row.weight, row.duration_minutes, row.energy_enabled, row.energy_rate, row.watts, row.margin, row.direct_cost, row.suggested_price, row.created_at])
  lines.push([], ['Historico financeiro'], ['Recurso', 'ID recurso', 'Origem', 'Snapshot', 'Data'])
  for (const row of report.history) lines.push([row.resource, row.resource_id, row.source, JSON.stringify(row.snapshot || {}), row.created_at])
  return `\ufeff${lines.map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`
}

const workbookReport = async (report, filters) => {
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'PrintFlow'; workbook.created = new Date()
  const addSheet = (name, columns, rows) => { const sheet = workbook.addWorksheet(name); sheet.columns = columns.map(([header, key]) => ({ header, key, width: Math.max(14, header.length + 3) })); rows.forEach((row) => sheet.addRow(row)); sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1768F2' } }; sheet.views = [{ state: 'frozen', ySplit: 1 }] }
  addSheet('Resumo', [['Indicador', 'Indicador'], ['Valor', 'Valor']], summaryRows(report).slice(1).map(([label, value]) => ({ Indicador: label, Valor: value })))
  addSheet('Vendas', [['Data', 'date'], ['Canal', 'channel'], ['Marketplace', 'marketplace'], ['Produto', 'product'], ['Quantidade', 'quantity'], ['Bruto', 'gross'], ['Taxas', 'fee'], ['Frete', 'shipping'], ['Liquido', 'net'], ['Lucro', 'profit']], report.orders)
  addSheet('Despesas', [['Data', 'date'], ['Descricao', 'description'], ['Categoria', 'category'], ['Fornecedor', 'supplier'], ['Valor', 'amount'], ['Pagamento', 'payment'], ['Recorrencia', 'recurrence'], ['Status', 'status'], ['Proximo vencimento', 'next_due_date'], ['Observacoes', 'notes']], report.expenses)
  addSheet('Produtos', [['Nome', 'name'], ['SKU', 'sku'], ['Categoria', 'category'], ['Preco', 'price'], ['Custo', 'cost'], ['Lucro', 'profit'], ['Margem', 'margin']], report.products)
  addSheet('Filamentos', [['Nome', 'name'], ['Fabricante', 'maker'], ['Material', 'material'], ['Tipo', 'type'], ['Cor', 'color'], ['Peso inicial', 'initial_weight'], ['Peso restante', 'remaining_weight'], ['Estoque minimo', 'min_stock_weight'], ['Custo', 'cost'], ['Fornecedor', 'supplier'], ['Data compra', 'purchase_date'], ['Status', 'status']], report.filaments)
  addSheet('Impressoras', [['Nome', 'name'], ['Codigo', 'code'], ['Fabricante', 'maker'], ['Modelo', 'model'], ['Potencia W', 'power_w'], ['Horas', 'accumulated_hours'], ['Status', 'status'], ['Localizacao', 'location'], ['Volume', 'volume'], ['Filamento padrao', 'default_filament']], report.printers)
  addSheet('Marketplaces', [['Nome', 'name'], ['Plataforma', 'platform'], ['Comissao %', 'commission'], ['Tarifa fixa', 'fixed'], ['Financeira %', 'financial'], ['Anuncios %', 'ads'], ['Outras %', 'others'], ['Ativo', 'active'], ['Status conexao', 'connection_status']], report.marketplaces)
  addSheet('Clientes', [['Nome', 'name'], ['Email', 'email'], ['Telefone', 'phone'], ['Pedidos', 'orders'], ['Faturamento', 'revenue'], ['Ticket medio', 'ticket'], ['Ultimo pedido', 'last_order']], report.clients)
  addSheet('Metas', [['Nome', 'name'], ['Atual', 'current_value'], ['Alvo', 'target_value'], ['Status', 'status'], ['Inicio', 'period_start'], ['Fim', 'period_end']], report.goals)
  addSheet('Producao', [['Titulo', 'title'], ['Produto', 'product'], ['Origem', 'source'], ['Quantidade', 'quantity'], ['Prioridade', 'priority'], ['Status', 'status'], ['Agendada', 'scheduled_at'], ['Iniciada', 'started_at'], ['Concluida', 'completed_at']], report.printJobs)
  addSheet('Conexoes', [['Plataforma', 'platform'], ['Conexao', 'connection_name'], ['Status', 'status'], ['Token expira em', 'token_expires_at'], ['Ultima sincronizacao', 'last_sync_at'], ['Ultimo erro', 'last_error']], report.integrations)
  addSheet('Estoque', [['Filamento', 'filament'], ['Tipo', 'movement_type'], ['Quantidade', 'quantity'], ['Saldo anterior', 'previous_quantity'], ['Saldo resultante', 'resulting_quantity'], ['Motivo', 'reason'], ['Data', 'created_at']], report.movements)
  addSheet('Calculadora', [['Nome', 'name'], ['Preco por kg', 'price_per_kg'], ['Peso', 'weight'], ['Duracao minutos', 'duration_minutes'], ['Energia ativa', 'energy_enabled'], ['Tarifa energia', 'energy_rate'], ['Watts', 'watts'], ['Margem', 'margin'], ['Custo direto', 'direct_cost'], ['Preco sugerido', 'suggested_price'], ['Criada em', 'created_at']], report.simulations)
  addSheet('Historico financeiro', [['Recurso', 'resource'], ['ID recurso', 'resource_id'], ['Origem', 'source'], ['Snapshot', 'snapshot'], ['Data', 'created_at']], report.history.map((row) => ({ ...row, snapshot: JSON.stringify(row.snapshot || {}) })))
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export const handleFinancialReportExport = async (req, res, url) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })
  if (!hasDatabase) return sendJson(res, 501, { error: 'Exportacao exige banco de dados.' })
  const now = new Date(); const currentYear = String(now.getFullYear())
  const filters = { from: dateValue(url.searchParams.get('from'), `${currentYear}-01-01`), to: dateValue(url.searchParams.get('to'), now.toISOString().slice(0, 10)), marketplace: String(url.searchParams.get('marketplace') || ''), product: String(url.searchParams.get('product') || ''), category: String(url.searchParams.get('category') || ''), channel: ['direct', 'marketplace'].includes(url.searchParams.get('channel')) ? url.searchParams.get('channel') : '' }
  if (filters.from > filters.to) return sendJson(res, 400, { error: 'Periodo invalido' })
  const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv'
  const report = await loadReport(user.tenantId, filters)
  const filename = `Relatorio_Financeiro_${filenameDate()}.${format}`
  const recordCount = Object.values(report).reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0)
  await withTenant(user.tenantId, (client) => client.query('insert into export_history (tenant_id, file_name, export_type, file_format, period_start, period_end, record_count) values ($1, $2, $3, $4, $5, $6, $7)', [user.tenantId, filename, 'financial_report', format, filters.from, filters.to, recordCount]))
  await withTenant(user.tenantId, (client) => writeAuditEvent(user.tenantId, { action: 'reports.financial_exported', actorType: 'user', actorId: user.id, entityType: 'financial_report', entityId: filename, details: { format, recordCount, ...filters } }, client))
  const headers = { 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' }
  if (format === 'xlsx') return sendBuffer(res, 200, await workbookReport(report, filters), { ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  return sendText(res, 200, csvReport(report, filters), { ...headers, 'Content-Type': 'text/csv; charset=utf-8' })
}
