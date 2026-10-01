import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyReportSummary, loadReportSummaryWithClient, normalizeReportSummaryOptions } from '../src/repositories/reportSummaryRepository.js'

test('report summary normalizes filters and paging limits', () => {
  const options = normalizeReportSummaryOptions({ from: '2026-01-01', to: '2026-09-30', grouping: 'week', section: 'produtos', channel: 'direct', limit: 500, offset: -9 })
  assert.equal(options.from, '2026-01-01')
  assert.equal(options.to, '2026-09-30')
  assert.equal(options.grouping, 'week')
  assert.equal(options.section, 'produtos')
  assert.equal(options.channel, 'direct')
  assert.equal(options.limit, 100)
  assert.equal(options.offset, 0)
  assert.equal(emptyReportSummary(options).sales.items.length, 0)
})

test('report summary maps aggregate and paginated contracts without raw histories', async () => {
  let queryText = ''
  let queryParams = []
  const client = {
    query: async (text, params) => {
      queryText = text
      queryParams = params
      return { rows: [{
        sales_totals: { revenue: 150, netRevenue: 125, fees: 15, shipping: 10, registeredProfit: 65, estimatedCurrentCost: 40, orderCount: 1, itemCount: 2 },
        expense_total: 30,
        products_count: 4,
        series: [{ key: '2026-09-01', revenue: 150, expenses: 30, profit: 35 }],
        marketplaces: [{ name: 'Venda direta', value: 150 }],
        expense_categories: [{ label: 'Energia', total: 30 }],
        products: [{ name: 'Produto A', sku: 'A-1', thumb: 'vase', orders: 1, quantity: 2, revenue: 150, profit: 65 }],
        sales_items: [{ dbId: 'order:1', id: 'ORDER-A', date: '15/09/2026', marketplace: 'Venda direta', salesChannel: 'direct', product: 'Produto A', qty: 2, gross: 150, fee: 15, shipping: 10, net: 125, profit: 65, status: 'Producao' }],
        sales_total: 1,
        marketplace_options: ['Venda direta'], product_options: ['Produto A'], category_options: ['Energia']
      }] }
    }
  }
  const summary = await loadReportSummaryWithClient(client, 'tenant-a', { from: '2026-09-01', to: '2026-09-30', section: 'produtos', limit: 25 })
  assert.equal(queryParams[0], 'tenant-a')
  assert.equal(queryParams[9], 25)
  assert.match(queryText, /where tenant_id = \$1/)
  assert.equal(summary.totals.profit, 35)
  assert.equal(summary.totals.ticket, 150)
  assert.equal(summary.products[0].quantity, 2)
  assert.equal(summary.sales.items[0].id, 'ORDER-A')
  assert.equal(summary.sales.total, 1)
  assert.deepEqual(summary.options.categories, ['Energia'])
  assert.equal('orders' in summary, false)
  assert.equal('expenses' in summary, false)
})

test('report summary rejects an inverted period before querying', async () => {
  let queried = false
  await assert.rejects(
    loadReportSummaryWithClient({ query: async () => { queried = true } }, 'tenant-a', { from: '2026-10-01', to: '2026-09-01' }),
    /Periodo invalido/
  )
  assert.equal(queried, false)
})
