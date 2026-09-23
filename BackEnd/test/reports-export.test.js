import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { csvReport, workbookReport } from '../src/routes/reports.js'

const emptyReport = () => ({ orders: [], expenses: [], products: [], filaments: [], printers: [], marketplaces: [], clients: [], goals: [], printJobs: [], integrations: [], movements: [], simulations: [], history: [] })

test('financial XLSX includes readable headers, filters and typed financial cells', async () => {
  const report = emptyReport()
  report.orders.push({ date: '2026-09-17', channel: 'direct', marketplace: 'Venda direta', product: 'Peça teste', quantity: 2, gross: 100, fee: 10, shipping: 5, net: 85, profit: -15 })
  const output = await workbookReport(report, { from: '2026-09-01', to: '2026-09-30' })
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(output)
  const sales = workbook.getWorksheet('Vendas')
  assert.equal(workbook.getWorksheet('Resumo').getCell('A1').value, 'PrintFlow 3D · Resumo')
  assert.equal(sales.getCell('A4').value, 'Data')
  assert.equal(sales.autoFilter, 'A4:J4')
  assert.equal(sales.getCell('F5').numFmt, 'R$ #,##0.00')
  assert.equal(sales.getCell('J5').font.color.argb, 'FFB42318')
  assert.equal(sales.getCell('A5').numFmt, 'dd/mm/yyyy')
})

test('section XLSX exports only the selected report data', async () => {
  const report = emptyReport()
  report.movements.push({ resource_name: 'PLA preto', resource: 'filaments', movement_type: 'out', quantity: 20, previous_quantity: 100, resulting_quantity: 80, reason: 'Producao', created_at: '2026-09-20T10:00:00' })
  report.history.push({ resource: 'products', resource_id: '10', source: 'resource', snapshot: { cost: 12 }, created_at: '2026-09-20T11:00:00' })
  const output = await workbookReport(report, { from: '2026-09-01', to: '2026-09-30' }, 'estoque')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(output)
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Estoque'])
  assert.equal(workbook.getWorksheet('Estoque').getCell('A5').value, 'PLA preto')
})

test('section CSV excludes records from reports that were not selected', () => {
  const report = emptyReport()
  report.orders.push({ date: '2026-09-17', channel: 'direct', marketplace: 'Venda direta', product: 'Peca teste', quantity: 1, gross: 50, fee: 0, shipping: 0, net: 50, profit: 20 })
  report.history.push({ resource: 'products', resource_id: '10', source: 'resource', snapshot: { cost: 12 }, created_at: '2026-09-20T11:00:00' })
  const output = csvReport(report, { from: '2026-09-01', to: '2026-09-30' }, 'historico')
  assert.match(output, /Registro de custos e precos/)
  assert.match(output, /products/)
  assert.doesNotMatch(output, /Peca teste/)
  assert.doesNotMatch(output, /Vendas/)
})
