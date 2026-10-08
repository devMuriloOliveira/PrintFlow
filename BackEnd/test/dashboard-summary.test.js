import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDashboardSummary, emptyDashboardSummary, loadDashboardSummaryWithClient } from '../src/repositories/dashboardRepository.js'

test('resumo do dashboard preserva totais, series e exclusao de cancelados', () => {
  const summary = buildDashboardSummary({
    products: [
      { id: '1', name: 'Produto A', sku: 'A', thumb: 'box', cost: 10, margin: 40 },
      { id: '2', name: 'Produto B', sku: 'B', thumb: 'vase', cost: 5, margin: 30 }
    ],
    orders: [
      { dbId: '10', id: 'PED-10', productId: '1', product: 'Produto A', qty: 2, gross: 100, net: 88, profit: 30, fee: 5, shipping: 7, status: 'Producao', date: '15/01/2026' },
      { dbId: '11', id: 'PED-11', productId: '2', product: 'Produto B', qty: 3, gross: 60, net: 55, profit: 15, fee: 2, shipping: 3, status: 'Pendente', date: '2026-02-10' },
      { dbId: '12', id: 'PED-12', productId: '1', product: 'Produto A', qty: 9, gross: 900, net: 800, profit: 300, fee: 50, shipping: 20, status: 'Cancelado', date: '20/02/2026' },
      { dbId: 'marketplace:50', id: 'ML-50', product: 'Sem cadastro', qty: 0, gross: 0, net: 0, profit: 0, fee: 0, shipping: 0, status: 'Producao', date: '20/02/2026' }
    ],
    expenses: [
      { category: 'Energia', value: 20, date: '03/01/2026' },
      { category: 'Insumos', value: 30, date: '2026-02-04' }
    ],
    filaments: [{ id: '1', name: 'PLA', remaining: 120 }, { id: '2', name: 'PETG', remaining: 500, minStock: 300 }, { id: '3', name: 'ABS', remaining: 400, minStock: 500 }],
    printers: [{ id: '1', name: 'A1', code: 'A1', status: 'Disponivel' }, { id: '2', name: 'K1', code: 'K1', status: 'Manutenção' }, { id: '3', name: 'P1', code: 'P1', status: 'Offline' }],
    printJobs: [
      { id: 'job-1', orderId: '10', printerId: '1', status: 'printing', title: 'Produto A', agentLastStatus: { progress: 42 } },
      { id: 'job-2', orderId: 'other', printerId: '1', status: 'queued', title: 'Fila' },
      { id: 'job-3', trackedSaleId: '50', printerId: '1', status: 'completed', title: 'Marketplace' }
    ],
    settings: { name: 'Empresa', email: 'contato@example.test', preferences: { onboardingPrinterMode: 'agent' } },
    marketplaceIntegrations: [{ connectionName: 'Loja ML', status: 'error', lastError: 'timeout' }],
    goals: [{ id: '1', name: 'Meta', current: 100, target: 200, color: '#fff', icon: 'target', status: 'Ativa' }]
  })

  assert.deepEqual(summary.totals, {
    revenue: 160, netRevenue: 143, profit: 45, fees: 7, shipping: 10, manualExpenses: 50,
    recipeCost: 35, expenseTotal: 102, orderCount: 3, ticket: 160 / 3, margin: 28.125
  })
  assert.equal(summary.monthlyRevenue[0], 100)
  assert.equal(summary.monthlyRevenue[1], 60)
  assert.equal(summary.monthlyOrders[0], 2)
  assert.equal(summary.monthlyOrders[1], 4)
  assert.equal(summary.monthlyExpenses[0], 20)
  assert.equal(summary.monthlyExpenses[1], 30)
  assert.deepEqual(summary.orderStages, { awaiting: 1, production: 2, shipping: 0, completed: 0 })
  assert.equal(summary.productPerformance[0].name, 'Produto A')
  assert.equal(summary.productPerformance[0].sales, 2)
  assert.equal(summary.productPerformance[0].orderProfit, 30)
  assert.deepEqual(summary.jobCounts, { active: 1, queued: 1, occupiedPrinters: 1 })
  assert.equal(summary.queuePrinters[0].progress, 42)
  assert.deepEqual(summary.maintenancePrinters, [{ name: 'K1' }])
  assert.deepEqual(summary.offlinePrinters, [{ name: 'P1' }])
  assert.deepEqual(summary.integrationErrors, [{ name: 'Loja ML' }])
  assert.deepEqual(summary.lowStockItems, [{ id: '1', name: 'PLA', remaining: 120, minStock: 300 }, { id: '3', name: 'ABS', remaining: 400, minStock: 500 }])
  assert.deepEqual(summary.pendingOrders, [])
  assert.deepEqual(summary.onboarding, { companyConfigured: true, productCount: 2, printerMode: 'agent' })
  assert.equal(summary.expenseSegments.reduce((total, item) => total + item.value, 0), 100)
})

test('resumo identifica pedido em producao sem fila e retorna forma vazia estavel', () => {
  const summary = buildDashboardSummary({
    products: [], expenses: [], filaments: [], printers: [], printJobs: [], goals: [],
    orders: [{ dbId: '21', id: 'PED-21', product: 'Sem produto', qty: 1, gross: 0, net: 0, profit: 0, fee: 0, shipping: 0, status: 'Embalando', date: '01/03/2026' }]
  })
  assert.deepEqual(summary.pendingOrders, [{ id: 'PED-21' }])
  assert.equal(summary.orderStages.production, 1)
  assert.deepEqual(buildDashboardSummary(), emptyDashboardSummary())
})

test('alerta de estoque usa mínimo configurado por filamento e inclui igualdade', () => {
  const summary = buildDashboardSummary({
    filaments: [
      { id: 'at-minimum', name: 'PLA', remaining: 250, minStock: 250 },
      { id: 'under-custom', name: 'ABS', remaining: 400, minStock: 500 },
      { id: 'above-custom', name: 'PETG', remaining: 400, minStock: 300 }
    ]
  })

  assert.deepEqual(summary.lowStockItems, [
    { id: 'at-minimum', name: 'PLA', remaining: 250, minStock: 250 },
    { id: 'under-custom', name: 'ABS', remaining: 400, minStock: 500 }
  ])
})

test('consultas agregadas usam parametro de tenant e mapeiam somente o contrato resumido', async () => {
  const calls = []
  const rows = [
    {
      sales_totals: { revenue: 100, netRevenue: 90, profit: 30, fees: 5, shipping: 5, recipeCost: 20, orderCount: 2 },
      manual_expenses: 10,
      monthly_sales: [{ month: 1, revenue: 100, orders: 2 }],
      monthly_expenses: [{ month: 1, value: 10 }],
      expense_categories: [{ label: 'Energia', total: 10 }],
      product_performance: [{ id: 1, name: 'Produto', sku: 'P', thumb: 'box', margin: 30, sales: 2, orderProfit: 30 }],
      goals: [], stage_counts: { Novo: 1, Producao: 1 }, pending_orders: [{ id: 'PED-1' }], low_stock_items: [{ id: 1, name: 'PLA', remaining: 100, minStock: 250 }], overdue_orders: [{ id: 'PED-2' }], integration_errors: [{ name: 'Mercado Livre' }],
      product_count: 1, onboarding: { companyConfigured: true, printerMode: 'manual' }
    },
    {
      job_counts: { active: 1, queued: 2, occupiedPrinters: 1 }, printer_count: 2,
      queue_printers: [{ id: 1, name: 'A1', code: 'A1', queued: 2, activeJob: { title: 'Job', productName: 'Produto', agentLastStatus: { progress: 50 } } }],
      maintenance_printers: [], offline_printers: [{ name: 'A1' }]
    }
  ]
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params })
      return { rows: [rows[calls.length - 1]] }
    }
  }

  const summary = await loadDashboardSummaryWithClient(client, 'tenant-a')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map((call) => call.params), [['tenant-a'], ['tenant-a']])
  assert.ok(calls.every((call) => call.sql.includes('$1')))
  assert.equal(summary.totals.expenseTotal, 40)
  assert.equal(summary.monthlyRevenue[0], 100)
  assert.deepEqual(summary.orderStages, { awaiting: 1, production: 1, shipping: 0, completed: 0 })
  assert.equal(summary.queuePrinters[0].progress, 50)
  assert.deepEqual(summary.lowStockItems, [{ id: '1', name: 'PLA', remaining: 100, minStock: 250 }])
  assert.deepEqual(summary.offlinePrinters, [{ name: 'A1' }])
  assert.deepEqual(summary.overdueOrders, [{ id: 'PED-2' }])
  assert.deepEqual(summary.integrationErrors, [{ name: 'Mercado Livre' }])
  assert.deepEqual(summary.onboarding, { companyConfigured: true, productCount: 1, printerMode: 'manual' })
  assert.equal(summary.orders, undefined)
})
