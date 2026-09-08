import ExcelJS from 'exceljs'
import { getAuthUser } from './auth.js'
import { hasDatabase, withTenant } from '../db/pool.js'
import { sendBuffer, sendJson, sendText } from '../http/response.js'
import { writeAuditEvent } from '../services/operationalEvents.js'

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`
const dateValue = (value, fallback) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : fallback
const filenameDate = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')

const loadReport = async (tenantId, filters) => withTenant(tenantId, async (client) => {
  const ordersParams = [tenantId, filters.from, filters.to]
  const orderWhere = ['o.tenant_id = $1', 'o.order_date >= $2', 'o.order_date <= $3']
  if (filters.marketplace) { ordersParams.push(filters.marketplace); orderWhere.push(`coalesce(m.name, 'Sem marketplace') = $${ordersParams.length}`) }
  if (filters.product) { ordersParams.push(filters.product); orderWhere.push(`o.product_name = $${ordersParams.length}`) }
  const expensesParams = [tenantId, filters.from, filters.to]
  const expenseWhere = ['e.tenant_id = $1', 'e.expense_date >= $2', 'e.expense_date <= $3']
  if (filters.category) { expensesParams.push(filters.category); expenseWhere.push(`e.category = $${expensesParams.length}`) }
  const [orders, expenses, products] = await Promise.all([
    client.query(`select to_char(o.order_date, 'YYYY-MM-DD') as date, coalesce(m.name, 'Sem marketplace') as marketplace, o.product_name as product, o.quantity, o.gross, o.fee, o.shipping, o.net, o.profit from orders o left join marketplaces m on m.id = o.marketplace_id and m.tenant_id = o.tenant_id where ${orderWhere.join(' and ')} order by o.order_date, o.id`, ordersParams),
    client.query(`select to_char(e.expense_date, 'YYYY-MM-DD') as date, e.description, e.category, e.supplier, e.amount, e.status from expenses e where ${expenseWhere.join(' and ')} order by e.expense_date, e.id`, expensesParams),
    client.query(`select name, sku, category, price, cost, profit, margin from products where tenant_id = $1 order by name`, [tenantId])
  ])
  return { orders: orders.rows, expenses: expenses.rows, products: products.rows }
})

const summaryRows = (report) => {
  const sum = (field, rows) => rows.reduce((total, row) => total + Number(row[field] || 0), 0)
  const gross = sum('gross', report.orders); const net = sum('net', report.orders); const fees = sum('fee', report.orders)
  const shipping = sum('shipping', report.orders); const expenses = sum('amount', report.expenses); const profit = sum('profit', report.orders) - expenses
  return [['Indicador', 'Valor'], ['Faturamento bruto', gross], ['Receita liquida', net], ['Taxas', fees], ['Frete', shipping], ['Despesas operacionais', expenses], ['Lucro liquido', profit], ['Margem liquida', gross ? `${(profit / gross * 100).toFixed(2)}%` : '0%'], ['Pedidos', report.orders.length]]
}

const csvReport = (report, filters) => {
  const lines = [['Relatorio financeiro PrintFlow'], ['Periodo', filters.from, filters.to], [], ...summaryRows(report), [], ['Vendas'], ['Data', 'Marketplace', 'Produto', 'Quantidade', 'Bruto', 'Taxas', 'Frete', 'Liquido', 'Lucro']]
  for (const row of report.orders) lines.push([row.date, row.marketplace, row.product, row.quantity, row.gross, row.fee, row.shipping, row.net, row.profit])
  lines.push([], ['Despesas'], ['Data', 'Descricao', 'Categoria', 'Fornecedor', 'Valor', 'Status'])
  for (const row of report.expenses) lines.push([row.date, row.description, row.category, row.supplier, row.amount, row.status])
  lines.push([], ['Produtos'], ['Nome', 'SKU', 'Categoria', 'Preco', 'Custo', 'Lucro', 'Margem'])
  for (const row of report.products) lines.push([row.name, row.sku, row.category, row.price, row.cost, row.profit, row.margin])
  return `\ufeff${lines.map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`
}

const workbookReport = async (report, filters) => {
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'PrintFlow'; workbook.created = new Date()
  const addSheet = (name, columns, rows) => { const sheet = workbook.addWorksheet(name); sheet.columns = columns.map(([header, key]) => ({ header, key, width: Math.max(14, header.length + 3) })); rows.forEach((row) => sheet.addRow(row)); sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1768F2' } }; sheet.views = [{ state: 'frozen', ySplit: 1 }] }
  addSheet('Resumo', [['Indicador', 'Indicador'], ['Valor', 'Valor']], summaryRows(report).slice(1).map(([label, value]) => ({ Indicador: label, Valor: value })))
  addSheet('Vendas', [['Data', 'date'], ['Marketplace', 'marketplace'], ['Produto', 'product'], ['Quantidade', 'quantity'], ['Bruto', 'gross'], ['Taxas', 'fee'], ['Frete', 'shipping'], ['Liquido', 'net'], ['Lucro', 'profit']], report.orders)
  addSheet('Despesas', [['Data', 'date'], ['Descricao', 'description'], ['Categoria', 'category'], ['Fornecedor', 'supplier'], ['Valor', 'amount'], ['Status', 'status']], report.expenses)
  addSheet('Produtos', [['Nome', 'name'], ['SKU', 'sku'], ['Categoria', 'category'], ['Preco', 'price'], ['Custo', 'cost'], ['Lucro', 'profit'], ['Margem', 'margin']], report.products)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export const handleFinancialReportExport = async (req, res, url) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })
  if (!hasDatabase) return sendJson(res, 501, { error: 'Exportacao exige banco de dados.' })
  const now = new Date(); const currentYear = String(now.getFullYear())
  const filters = { from: dateValue(url.searchParams.get('from'), `${currentYear}-01-01`), to: dateValue(url.searchParams.get('to'), now.toISOString().slice(0, 10)), marketplace: String(url.searchParams.get('marketplace') || ''), product: String(url.searchParams.get('product') || ''), category: String(url.searchParams.get('category') || '') }
  if (filters.from > filters.to) return sendJson(res, 400, { error: 'Periodo invalido' })
  const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv'
  const report = await loadReport(user.tenantId, filters)
  const filename = `Relatorio_Financeiro_${filenameDate()}.${format}`
  const recordCount = report.orders.length + report.expenses.length + report.products.length
  await withTenant(user.tenantId, (client) => client.query('insert into export_history (tenant_id, file_name, export_type, file_format, period_start, period_end, record_count) values ($1, $2, $3, $4, $5, $6, $7)', [user.tenantId, filename, 'financial_report', format, filters.from, filters.to, recordCount]))
  await withTenant(user.tenantId, (client) => writeAuditEvent(user.tenantId, { action: 'reports.financial_exported', actorType: 'user', actorId: user.id, entityType: 'financial_report', entityId: filename, details: { format, recordCount, ...filters } }, client))
  const headers = { 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' }
  if (format === 'xlsx') return sendBuffer(res, 200, await workbookReport(report, filters), { ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  return sendText(res, 200, csvReport(report, filters), { ...headers, 'Content-Type': 'text/csv; charset=utf-8' })
}
