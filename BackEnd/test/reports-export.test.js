import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { workbookReport } from '../src/routes/reports.js'

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
