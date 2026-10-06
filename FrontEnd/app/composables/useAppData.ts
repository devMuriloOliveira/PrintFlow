import {
  getMockBackupStatus,
  getMockCalculatorSimulations,
  getMockFinancialHistory,
  getMockIntegrationsOverview,
  getMockInventoryOverview,
  getMockOrdersPage,
  getMockOrdersSummary,
  getMockPendingProductionMaterial,
  mockAppData,
  mockMarketplaceOrders,
  mockSupportRequests
} from '~/mock/demoData'

const appDataInFlight = new Map<string, Promise<AppData>>()
const cloneMock = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export type Order = {
  dbId?: string;
  id: string; productId?: string; clientId?: string; date: string; client: string; marketplace: string; product: string; qty: number;
  gross: number; fee: number; shipping: number; net: number; profit: number; status: string;
  trackingCode?: string; packedAt?: string | null; shippedAt?: string | null; deliveredAt?: string | null; marketplaceOrder?: boolean; salesChannel?: 'direct' | 'marketplace'
}

export type PrintJob = {
  id?: string;
  orderId?: string; externalOrderId?: string; trackedSaleId?: string; productId?: string; productName?: string; retryOfJobId?: string;
  printerId?: string; printerName?: string; agentPrinterId?: string; agentPrinterStatus?: string;
  printFileName?: string; printFileFormat?: string; validationStatus?: string; validationMessage?: string;
  agentLastStatus?: Record<string, unknown>; source: string; title: string; quantity: number; priority: number;
  status: string; notes?: string; scheduledAt?: string | null; startedAt?: string | null; completedAt?: string | null;
  cancelledAt?: string | null; createdAt?: string | null; updatedAt?: string | null;
  estimatedPrintSeconds?: number | null; attempts?: Array<{ attemptNo: number; status: string; errorCode?: string; createdAt?: string; completedAt?: string | null }>
}

export type Product = {
  id?: string;
  name: string; subtitle: string; sku: string; category: string; price: number; weight: number;
  description?: string; printerId?: string; printer?: string; layer?: number; infill?: number; dimensions?: string;
  printFileName?: string; printFileFormat?: string; printFileHash?: string; printFileSizeBytes?: number; printFileStorageKey?: string;
  printProfile?: Record<string, number | string | boolean | null | undefined>;
  compatibility?: Record<string, number | string | boolean | string[] | null | undefined>;
  validationStatus?: string; validationMessage?: string;
  packaging?: number; materials?: number; labor?: number; energy?: boolean; marketplaceFee?: number; desiredMargin?: number;
  costBreakdown?: Record<string, number | string | boolean | null | undefined>;
  time: string; filamentId?: string; filament: string; filamentColor: string; cost: number; profit: number; margin: number;
  status: string; thumb: string; createdAt?: string; updatedAt?: string
}

export type Expense = {
  id?: string;
  description: string; category: string; supplier: string; value: number; date: string;
  payment: string; recurrence: string; status: string; nextDueDate?: string; notes?: string
}

export type Filament = {
  id?: string;
  name: string; maker: string; material: string; type: string; color: string; colorHex: string;
  initial: number; remaining: number; cost: number; supplier: string; date: string; status: string; minStock?: number
}

export type Printer = {
  id?: string;
  name: string; code: string; maker: string; model: string; acquired: string; power: number;
  hours: number; status: string; maintenance: string; serial: string; location?: string; volume?: string; defaultFilament?: string;
  nozzleMm?: number; supportedMaterials?: string; minLayerHeight?: number; maxLayerHeight?: number;
  agentId?: string; agentPrinterId?: string; agentConnectionKey?: string; agentProtocol?: string; agentConnectionType?: string
  agentPrinterStatus?: string; agentLastStatus?: Record<string, unknown>; agentCapabilities?: Record<string, boolean>; agentLastConnectionError?: string; agentLastSeenAt?: string | null
}

export type Marketplace = {
  id?: string;
  name: string; short: string; color: string; commission: number; fixed: number; financial: number;
  ads: number; others: number; gross: number; net: number; fees?: number; orders: number; active: boolean;
  platform?: string; connectionStatus?: string
}

export type MarketplaceIntegration = {
  id?: string;
  marketplaceId?: string;
  platform: string;
  connectionName: string;
  accountExternalId: string;
  status: string;
  scopes?: string;
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
  tokenExpiresAt?: string | null;
  lastSyncAt?: string | null;
  lastError?: string
}

export type MarketplaceOrder = {
  id: string;
  integrationId?: string; marketplaceId?: string; platform: string; externalOrderId: string; externalSku: string;
  productName: string; quantity: number; gross: number; marketplaceFee: number; shipping: number; net: number; profit: number; feeBreakdown?: Record<string, unknown>;
  status: string; soldAt?: string | null; printJobId?: string; printJobStatus?: string;
  mappedProductId?: string; mappedProductName?: string; suggestedProductId?: string; suggestedProductName?: string
}

export type Client = {
  id?: string;
  name: string; email: string; phone: string; type?: string; document?: string; zip?: string; address?: string; number?: string; complement?: string; district?: string; city?: string; state?: string; origin?: string; notes?: string; tags?: string; status?: string; orders: number; revenue: number; ticket: number; last: string
}

export type MercadoPagoBillingSummary = {
  configured: boolean;
  environment: 'sandbox' | 'production';
  plans: Array<{ id: string; code: string; name: string; description: string; monthly: number; yearly: number; monthlyEnabled: boolean; yearlyEnabled: boolean }>;
  subscription: null | { status: string; billingCycle: string; planCode: string; planName: string; currentPeriodEnd: string | null; graceEndsAt?: string | null; cancelAtPeriodEnd?: boolean };
  checkout: null | { status: string; url: string; expiresAt: string | null; createdAt: string };
}

export type ChartSegment = {
  label: string; value: number; color: string
}

export type Goal = {
  id?: string;
  name: string; goalType?: string; current: number; target: number; color: string; icon: string;
  periodStart?: string; periodEnd?: string; status?: string
}

export type AppData = {
  products: Product[]
  orders: Order[]
  printJobs: PrintJob[]
  expenses: Expense[]
  filaments: Filament[]
  printers: Printer[]
  marketplaces: Marketplace[]
  marketplaceOrders?: MarketplaceOrder[]
  marketplaceIntegrations?: MarketplaceIntegration[]
  clients: Client[]
  expenseSegments: ChartSegment[]
  goals?: Goal[]
  settings?: Record<string, unknown> | null
}

export type SubscriptionAccess = {
  planCode: string;
  status: string;
  mode: 'full' | 'read_only';
  features: Record<string, boolean>;
  limits: Record<string, number>;
  usage: Record<string, { used: number; limit: number }>;
}

export type DashboardSummary = {
  totals: { revenue: number; netRevenue: number; profit: number; fees: number; shipping: number; manualExpenses: number; recipeCost: number; expenseTotal: number; orderCount: number; ticket: number; margin: number }
  monthlyRevenue: number[]
  monthlyExpenses: number[]
  monthlyOrders: number[]
  expenseSegments: ChartSegment[]
  productPerformance: Array<{ id: string; name: string; sku: string; thumb: string; margin: number; sales: number; orderProfit: number }>
  goals: Goal[]
  jobCounts: { active: number; queued: number; occupiedPrinters: number }
  printerCount: number
  queuePrinters: Array<{ id: string; name: string; code: string; queued: number; progress: number; activeJob: null | { title?: string; productName?: string; agentLastStatus?: Record<string, unknown> } }>
  maintenancePrinters: Array<{ name: string }>
  offlinePrinters: Array<{ name: string }>
  overdueOrders: Array<{ id: string }>
  integrationErrors: Array<{ name: string }>
  onboarding: { companyConfigured: boolean; productCount: number; printerMode: '' | 'manual' | 'agent' }
  orderStages: { awaiting: number; production: number; shipping: number; completed: number }
  lowStockItems: Array<{ id: string; name: string; remaining: number; minStock: number }>
  pendingOrders: Array<{ id: string }>
}

export type ReportSummary = {
  filters: { from: string; to: string; grouping: 'day' | 'week' | 'month'; section: 'financeiro' | 'produtos'; marketplace: string; product: string; category: string; channel: string; limit: number; offset: number }
  totals: { revenue: number; netRevenue: number; fees: number; shipping: number; registeredProfit: number; expenses: number; profit: number; estimatedCurrentCost: number; orderCount: number; itemCount: number; ticket: number; productsCount: number }
  series: Array<{ key: string; revenue: number; expenses: number; profit: number }>
  marketplaces: Array<{ name: string; value: number }>
  channels: Array<{ channel: string; orders: number; revenue: number; profit: number }>
  clients: Array<{ id: string; name: string; orders: number; revenue: number; profit: number }>
  productionCostComparison: { jobCount: number; estimatedCurrentRateCost: number; actualRecordedCost: number; variance: number }
  expenseCategories: Array<{ label: string; total: number }>
  products: Array<{ name: string; sku?: string; thumb?: string; orders: number; quantity: number; revenue: number; profit: number }>
  sales: { items: Order[]; total: number; limit: number; offset: number }
  options: { marketplaces: string[]; products: string[]; categories: string[] }
}

const emptyData = (): AppData => ({
  products: [],
  orders: [],
  printJobs: [],
  expenses: [],
  filaments: [],
  printers: [],
  marketplaces: [],
  marketplaceOrders: [],
  marketplaceIntegrations: [],
  clients: [],
  expenseSegments: [],
  goals: [],
  settings: null
})

export const emptyDashboardSummary = (): DashboardSummary => ({
  totals: { revenue: 0, netRevenue: 0, profit: 0, fees: 0, shipping: 0, manualExpenses: 0, recipeCost: 0, expenseTotal: 0, orderCount: 0, ticket: 0, margin: 0 },
  monthlyRevenue: Array(12).fill(0), monthlyExpenses: Array(12).fill(0), monthlyOrders: Array(12).fill(0),
  expenseSegments: [], productPerformance: [], goals: [],
  jobCounts: { active: 0, queued: 0, occupiedPrinters: 0 }, printerCount: 0, queuePrinters: [], maintenancePrinters: [], offlinePrinters: [], overdueOrders: [], integrationErrors: [],
  onboarding: { companyConfigured: false, productCount: 0, printerMode: '' },
  orderStages: { awaiting: 0, production: 0, shipping: 0, completed: 0 }, lowStockItems: [], pendingOrders: []
})

export const emptyReportSummary = (params: Record<string, any> = {}): ReportSummary => ({
  filters: { from: String(params.from || ''), to: String(params.to || ''), grouping: ['day', 'week'].includes(params.grouping) ? params.grouping : 'month', section: params.section === 'produtos' ? 'produtos' : 'financeiro', marketplace: String(params.marketplace || ''), product: String(params.product || ''), category: String(params.category || ''), channel: String(params.channel || ''), limit: Number(params.limit || 50), offset: Number(params.offset || 0) },
  totals: { revenue: 0, netRevenue: 0, fees: 0, shipping: 0, registeredProfit: 0, expenses: 0, profit: 0, estimatedCurrentCost: 0, orderCount: 0, itemCount: 0, ticket: 0, productsCount: 0 },
  series: [], marketplaces: [], expenseCategories: [], products: [],
  sales: { items: [], total: 0, limit: Number(params.limit || 50), offset: Number(params.offset || 0) },
  options: { marketplaces: [], products: [], categories: [] }
})

const mockReportSummary = (source: AppData, params: Record<string, any> = {}): ReportSummary => {
  const result = emptyReportSummary(params)
  const from = new Date(`${result.filters.from || '1970-01-01'}T00:00:00`)
  const to = new Date(`${result.filters.to || '2999-12-31'}T23:59:59`)
  const parseDate = (value: string) => { const parts = String(value || '').split('/'); const date = parts.length === 3 ? new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`) : new Date(value); return Number.isNaN(date.getTime()) ? null : date }
  const productsById = new Map(source.products.map(product => [String(product.id || ''), product]))
  const productsByName = new Map(source.products.map(product => [product.name, product]))
  const sales = source.orders.filter(order => {
    const date = parseDate(order.date)
    return Boolean(date && date >= from && date <= to && order.status !== 'Cancelado'
      && (!result.filters.marketplace || (order.marketplace || 'Sem marketplace') === result.filters.marketplace)
      && (!result.filters.product || order.product === result.filters.product)
      && (!result.filters.channel || order.salesChannel === result.filters.channel))
  }).sort((a, b) => Number(parseDate(b.date)) - Number(parseDate(a.date)))
  const expenses = source.expenses.filter(expense => {
    const date = parseDate(expense.date)
    return Boolean(date && date >= from && date <= to && expense.status !== 'Cancelado' && (!result.filters.category || expense.category === result.filters.category))
  })
  const periodKey = (date: Date) => {
    if (result.filters.grouping === 'week') { const monday = new Date(date); monday.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return monday.toISOString().slice(0, 10) }
    if (result.filters.grouping === 'day') return date.toISOString().slice(0, 10)
    return `${date.toISOString().slice(0, 7)}-01`
  }
  const series = new Map<string, { revenue: number; expenses: number; profit: number }>()
  const marketplaceTotals = new Map<string, number>(), expenseTotals = new Map<string, number>(), productTotals = new Map<string, { orders: number; quantity: number; revenue: number; profit: number }>()
  for (const order of sales) {
    const revenue = Number(order.gross || 0), profit = Number(order.profit || 0), quantity = Number(order.qty || 0)
    result.totals.revenue += revenue; result.totals.netRevenue += Number(order.net || 0); result.totals.fees += Number(order.fee || 0); result.totals.shipping += Number(order.shipping || 0); result.totals.registeredProfit += profit; result.totals.orderCount += 1; result.totals.itemCount += quantity
    const product = productsById.get(String(order.productId || '')) || productsByName.get(order.product); result.totals.estimatedCurrentCost += Number(product?.cost || 0) * quantity
    const date = parseDate(order.date); if (date) { const key = periodKey(date); const row = series.get(key) || { revenue: 0, expenses: 0, profit: 0 }; row.revenue += revenue; row.profit += profit; series.set(key, row) }
    const marketplace = order.marketplace || 'Sem marketplace'; marketplaceTotals.set(marketplace, (marketplaceTotals.get(marketplace) || 0) + revenue)
    const row = productTotals.get(order.product) || { orders: 0, quantity: 0, revenue: 0, profit: 0 }; row.orders += 1; row.quantity += quantity; row.revenue += revenue; row.profit += profit; productTotals.set(order.product, row)
  }
  for (const expense of expenses) { const value = Number(expense.value || 0); result.totals.expenses += value; expenseTotals.set(expense.category, (expenseTotals.get(expense.category) || 0) + value); const date = parseDate(expense.date); if (date) { const key = periodKey(date); const row = series.get(key) || { revenue: 0, expenses: 0, profit: 0 }; row.expenses += value; row.profit -= value; series.set(key, row) } }
  result.totals.profit = result.totals.registeredProfit - result.totals.expenses
  result.totals.ticket = result.totals.orderCount ? result.totals.revenue / result.totals.orderCount : 0
  result.totals.productsCount = source.products.length
  result.series = [...series.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => ({ key, ...row }))
  result.marketplaces = [...marketplaceTotals.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }))
  result.expenseCategories = [...expenseTotals.entries()].sort((a, b) => b[1] - a[1]).map(([label, total]) => ({ label, total }))
  result.products = [...productTotals.entries()].map(([name, totals]) => ({ name, sku: productsByName.get(name)?.sku, thumb: productsByName.get(name)?.thumb, ...totals })).sort((a, b) => b.revenue - a.revenue)
  result.sales = { items: sales.slice(result.filters.offset, result.filters.offset + result.filters.limit), total: sales.length, limit: result.filters.limit, offset: result.filters.offset }
  result.options = { marketplaces: [...new Set(source.orders.map(item => item.marketplace || 'Sem marketplace'))].sort(), products: source.products.map(item => item.name).sort(), categories: [...new Set(source.expenses.map(item => item.category))].sort() }
  return result
}

const mockDashboardSummary = (source: AppData): DashboardSummary => {
  const summary = emptyDashboardSummary()
  const productsById = new Map<string, Product>(), productsByName = new Map<string, Product>()
  for (const product of source.products) {
    if (product.id && !productsById.has(String(product.id))) productsById.set(String(product.id), product)
    if (!productsByName.has(product.name)) productsByName.set(product.name, product)
  }
  const performance = new Map<string, { sales: number; profit: number }>()
  const month = (value: string) => { const parts = String(value || '').split('/').map(Number); const result = parts.length >= 2 ? parts[1] : Number(String(value || '').slice(5, 7)); return result >= 1 && result <= 12 ? result - 1 : -1 }
  const awaitingOrderStatuses = new Set(['Novo', 'Pendente', 'Aguardando', 'Aguardando confirmação', 'Aguardando confirmacao'])
  const activeOrderStatuses = new Set(['Produção', 'Producao', 'Em producao', 'Impresso', 'Embalando'])
  const shippingOrderStatuses = new Set(['Enviado', 'Envio'])
  const completedOrderStatuses = new Set(['Entregue', 'Concluido', 'Concluído'])
  for (const order of source.orders) {
    const status = String(order.status || '')
    if (status !== 'Cancelado') {
      const quantity = Number(order.qty || 0)
      summary.totals.revenue += Number(order.gross || 0); summary.totals.netRevenue += Number(order.net || 0); summary.totals.profit += Number(order.profit || 0)
      summary.totals.fees += Number(order.fee || 0); summary.totals.shipping += Number(order.shipping || 0); summary.totals.orderCount += 1
      const product = productsById.get(String(order.productId || '')) || productsByName.get(order.product)
      summary.totals.recipeCost += Number(product?.cost || 0) * quantity
      const monthIndex = month(order.date)
      if (monthIndex >= 0) { summary.monthlyRevenue[monthIndex] += Number(order.gross || 0); summary.monthlyOrders[monthIndex] += quantity || 1 }
      const item = performance.get(order.product) || { sales: 0, profit: 0 }; item.sales += quantity; item.profit += Number(order.profit || 0); performance.set(order.product, item)
    }
    if (awaitingOrderStatuses.has(status)) summary.orderStages.awaiting += 1
    if (activeOrderStatuses.has(status)) summary.orderStages.production += 1
    if (shippingOrderStatuses.has(status)) summary.orderStages.shipping += 1
    if (completedOrderStatuses.has(status)) summary.orderStages.completed += 1
  }
  summary.totals.ticket = summary.totals.orderCount ? summary.totals.revenue / summary.totals.orderCount : 0
  summary.totals.margin = summary.totals.revenue ? summary.totals.profit / summary.totals.revenue * 100 : 0
  const categories = new Map<string, number>()
  for (const expense of source.expenses) { const value = Number(expense.value || 0); summary.totals.manualExpenses += value; categories.set(expense.category, (categories.get(expense.category) || 0) + value); const monthIndex = month(expense.date); if (monthIndex >= 0) summary.monthlyExpenses[monthIndex] += value }
  summary.totals.expenseTotal = summary.totals.manualExpenses + summary.totals.fees + summary.totals.shipping + summary.totals.recipeCost
  const colors = ['#1768f2', '#29b6c8', '#f59e0b', '#fb923c', '#c83bb7', '#7d8799']
  summary.expenseSegments = [...categories.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], index) => ({ label, value: summary.totals.manualExpenses ? Number((value / summary.totals.manualExpenses * 100).toFixed(1)) : 0, color: colors[index % colors.length] }))
  summary.productPerformance = source.products.map(product => { const item = performance.get(product.name) || { sales: 0, profit: 0 }; return { id: String(product.id || ''), name: product.name, sku: product.sku, thumb: product.thumb, margin: Number(product.margin || 0), sales: item.sales, orderProfit: item.profit } }).sort((a, b) => b.orderProfit - a.orderProfit)
  summary.goals = source.goals || []
  const settings = source.settings && typeof source.settings === 'object' ? source.settings : null
  const preferences = settings?.preferences && typeof settings.preferences === 'object' ? settings.preferences as Record<string, unknown> : {}
  const printerMode = String(preferences.onboardingPrinterMode || '')
  summary.onboarding = {
    companyConfigured: Boolean(settings && String(settings.name || '').trim() && String(settings.email || '').trim()),
    productCount: source.products.length,
    printerMode: printerMode === 'manual' || printerMode === 'agent' ? printerMode : ''
  }
  const activeJobs = source.printJobs.filter(job => ['starting', 'printing', 'paused'].includes(String(job.status || '')))
  const queuedJobs = source.printJobs.filter(job => ['queued', 'awaiting_confirmation'].includes(String(job.status || '')))
  summary.jobCounts = { active: activeJobs.length, queued: queuedJobs.length, occupiedPrinters: new Set(activeJobs.map(job => String(job.printerId || '')).filter(Boolean)).size }
  summary.printerCount = source.printers.length
  const activeByPrinter = new Map<string, PrintJob>(), queuedByPrinter = new Map<string, number>()
  for (const job of activeJobs) { const id = String(job.printerId || ''); if (!activeByPrinter.has(id)) activeByPrinter.set(id, job) }
  for (const job of queuedJobs) { const id = String(job.printerId || ''); queuedByPrinter.set(id, (queuedByPrinter.get(id) || 0) + 1) }
  summary.queuePrinters = source.printers.map(printer => { const id = String(printer.id || ''); const activeJob = activeByPrinter.get(id) || null; return { id, name: printer.name, code: printer.code, activeJob, queued: queuedByPrinter.get(id) || 0, progress: Number((activeJob?.agentLastStatus as any)?.progress || 0) } }).sort((a, b) => Number(Boolean(b.activeJob)) - Number(Boolean(a.activeJob)) || b.queued - a.queued).slice(0, 5)
  summary.maintenancePrinters = source.printers.filter(printer => /manuten[cç]/i.test(String(printer.status || ''))).map(printer => ({ name: printer.name }))
  summary.offlinePrinters = source.printers.filter(printer => /offline|desconect/i.test(`${printer.status || ''} ${printer.agentPrinterStatus || ''}`)).map(printer => ({ name: printer.name }))
  const now = Date.now()
  const orderTimestamp = (value: string) => { const parts = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); const parsed = parts ? new Date(`${parts[3]}-${parts[2]}-${parts[1]}T12:00:00`).getTime() : new Date(value).getTime(); return Number.isFinite(parsed) ? parsed : now }
  summary.overdueOrders = source.orders.filter(order => !['Cancelado', 'Entregue', 'Concluido', 'Concluído'].includes(String(order.status || '')) && now - orderTimestamp(order.date) > 7 * 86400000).slice(0, 3).map(order => ({ id: order.id }))
  summary.integrationErrors = (source.marketplaceIntegrations || []).filter(integration => integration.status === 'error' || integration.lastError).slice(0, 3).map(integration => ({ name: integration.connectionName || integration.platform || 'Marketplace' }))
  summary.lowStockItems = source.filaments.filter(filament => Number(filament.remaining || 0) <= Number(filament.minStock ?? 300)).map(filament => ({ id: String(filament.id || ''), name: filament.name, remaining: Number(filament.remaining || 0), minStock: Number(filament.minStock ?? 300) }))
  const jobOrders = new Set(source.printJobs.flatMap(job => [String(job.orderId || ''), job.trackedSaleId ? `marketplace:${job.trackedSaleId}` : '']))
  summary.pendingOrders = source.orders.filter(order => activeOrderStatuses.has(String(order.status || '')) && !jobOrders.has(String(order.dbId || order.id || ''))).slice(0, 3).map(order => ({ id: order.id }))
  return summary
}

const currencyCode = (value: unknown) => {
  const setting = String(value || '').toLowerCase()
  if (setting.includes('dolar') || setting.includes('usd')) return 'USD'
  if (setting.includes('euro') || setting.includes('eur')) return 'EUR'
  return 'BRL'
}

export type IntegrationsOverview = {
  marketplaces: MarketplaceIntegration[]
  agents: Array<{ id: string; name: string; machineName: string; platform: string; status: string; lastSeenAt?: string | null }>
  email: { provider: string; status: 'connected' | 'not_configured' }
}

export type OrdersPage = {
  items: Order[]
  total: number
  limit: number
  offset: number
}

export type BackupStatus = {
  databaseAvailable: boolean
  export: { enabled: boolean; format: string; excludes: string[] }
  restore: { enabled: false; reason: string }
  operational: { lastCompletedAt: string | null; lastStatus: string; history: Array<{ status: string; startedAt: string | null; completedAt: string | null }> }
}
export type SupportRequest = { id: string; protocolNumber: string; status: string; supportStatus?: 'new' | 'in_progress' | 'waiting_customer' | 'waiting_internal' | 'resolved' | 'reopened'; subject: string; category: string; requestKind?: 'support' | 'privacy'; privacyRight?: string; priority: string; requesterRole: string; reason: string; scope: { entityType?: string; entityId?: string }; responsibleId?: string | null; responsibleName?: string; dueAt?: string | null; supportFirstResponseDueAt?: string | null; supportResolutionDueAt?: string | null; supportReopenUntil?: string | null; supportReopenedAt?: string | null; supportParentRequestId?: string | null; decision?: 'approved' | 'rejected' | null; reviewReason?: string; expiresAt?: string | null; chatOpenedAt?: string | null; chatClosedAt?: string | null; createdAt: string; updatedAt?: string }
export type SupportMessage = { id: string; senderType: 'requester' | 'support'; body: string; createdAt: string }
export type SupportAttachment = { id: string; requestId: string; originalName: string; mimeType: string; sizeBytes: number; expiresAt: string; createdAt: string }
export type FinancialHistoryEntry = { id: string; resource: string; resourceId: string; snapshot: Record<string, any>; source: string; createdAt: string }
export type CalculatorSimulation = { id: string; name: string; pricePerKg: number; weight: number; durationMinutes: number; energyEnabled: boolean; energyRate: number; watts: number; margin: number; directCost: number; suggestedPrice: number; snapshot: Record<string, any>; createdAt: string }
export type InventoryMovement = { id: string; type: 'in' | 'out' | 'adjustment'; quantity: number; previousQuantity: number; resultingQuantity: number; reason: string; createdAt: string }
export type ProductInventory = { id: string; name: string; sku: string; price: number; cost: number; weight: number; quantity: number; reservedQuantity: number; status: string; updatedAt?: string | null }
export type InventoryOverview = { products: ProductInventory[]; movements: Array<InventoryMovement & { resource: 'filaments' | 'products'; resourceId: string; resourceName?: string; productName?: string; sku?: string }>; total: number; limit: number; offset: number }
export type PendingProductionMaterial = { printJobId: string; filamentId: string; filamentName: string; title: string; reservedGrams: number; consumptionGrams: number; lastError: string; updatedAt: string }
export type FinancialHistoryPage = { items: FinancialHistoryEntry[]; total: number; limit: number; offset: number }
export const formatCurrency = (value: number) => {
  const settings = useState<AppData>('app-data', emptyData).value.settings
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currencyCode(settings?.currency) }).format(value)
}
export const formatNumber = (value: number) => new Intl.NumberFormat('pt-BR').format(value)

export const useAppData = () => {
  const config = useRuntimeConfig()
  const apiBase = String(config.public.apiBase || '').replace(/\/$/, '')
  const mockEnabled = import.meta.dev && String(config.public.useMockData || '').toLowerCase() === 'true'
  const auth = useAuth()
  const tenantId = useTenantId()
  const route = useRoute()
  const data = useState<AppData>('app-data', emptyData)
  const pending = useState('app-data-pending', () => false)
  const loaded = useState('app-data-loaded', () => false)
  const loadedTenant = useState('app-data-loaded-tenant', () => '')
  const loadedAt = useState('app-data-loaded-at', () => 0)
  const loadedScope = useState('app-data-loaded-scope', () => '')
  const scopeCache = useState<Record<string, { data: AppData; loadedAt: number }>>('app-data-scope-cache', () => ({}))
  const error = useState<string | null>('app-data-error', () => null)
  const goals = useState<Goal[]>('goals', () => [])
  let appDataAbortController: AbortController | null = null
  let appDataRequestSequence = 0

  const apiUrl = (path: string) => `${apiBase}${path}`

  const resourceScopeForRoute = () => {
    const path = String(route.path || '')
    const editingResource = Boolean(route.query.id || route.query.duplicar)
    const scopes: Record<string, string[]> = {
      '/': ['settings'],
      '/configuracoes': ['settings'],
      '/clientes': path === '/clientes/novo' && !editingResource ? [] : ['clients'],
      '/vendas': path === '/vendas'
        ? ['products', 'printers', 'printJobs', 'clients']
        : path === '/vendas/novo' && !editingResource
          ? ['products', 'clients']
          : ['orders', 'products', 'clients'],
      '/produtos': path === '/produtos/novo' && !editingResource ? ['printers', 'filaments', 'settings'] : ['products', 'printers', 'filaments', 'settings'],
      '/impressoras': ['/impressoras/nova', '/impressoras/novo'].includes(path)
        ? ['printers', 'filaments']
        : ['printers', 'printJobs', 'products', 'filaments'],
      '/filamentos': path === '/filamentos/novo' && !editingResource ? [] : ['filaments', 'printJobs', 'products'],
      '/estoque': (() => {
        if (path === '/estoque/registrar-producao') return ['products']
        const section = String(route.query.secao || 'visao')
        if (section === 'filamentos') return ['filaments']
        if (section === 'produtos') return ['products']
        return ['filaments', 'products']
      })(),
      '/despesas': ['/despesas/nova', '/despesas/novo'].includes(path) && !editingResource ? [] : ['expenses', 'expenseSegments'],
      '/metas': ['/metas/nova', '/metas/novo'].includes(path) && !editingResource ? [] : ['goals'],
      '/marketplaces': path === '/marketplaces/novo' && !editingResource
        ? []
        : path === '/marketplaces/novo'
          ? ['marketplaces']
          : ['marketplaces', 'products'],
      '/calculadora-3d': ['filaments', 'printers', 'products', 'marketplaces', 'settings'],
      '/notificacoes': ['settings'],
      '/perfil': ['settings'],
      '/relatorios': []
    }
    const match = Object.entries(scopes).find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))
    return match ? match[1] : null
  }

  const loadAppData = async (force = false) => {
    if (mockEnabled) {
      const nextData = cloneMock(mockAppData)
      data.value = nextData
      goals.value = nextData.goals || []
      loaded.value = true
      loadedTenant.value = tenantId.value
      loadedAt.value = Date.now()
      loadedScope.value = 'mock'
      pending.value = false
      error.value = null
      return data.value
    }
    const cacheTtlMs = 60_000
    const scope = resourceScopeForRoute()
    const scopeKey = scope === null ? 'all' : scope.slice().sort().join(',') || 'empty'
    const cacheKey = `${tenantId.value}:${scopeKey}`
    const cachedScope = scopeCache.value[cacheKey]
    if (!force && cachedScope && Date.now() - cachedScope.loadedAt < cacheTtlMs) {
      data.value = cachedScope.data
      loaded.value = true
      loadedTenant.value = tenantId.value
      loadedAt.value = cachedScope.loadedAt
      loadedScope.value = scopeKey
      goals.value = data.value.goals || []
      return data.value
    }
    if (scope !== null && scope.length === 0) {
      const nextData = emptyData()
      const now = Date.now()
      data.value = nextData
      goals.value = []
      loaded.value = true
      loadedTenant.value = tenantId.value
      loadedAt.value = now
      loadedScope.value = scopeKey
      scopeCache.value = { ...scopeCache.value, [cacheKey]: { data: nextData, loadedAt: now } }
      pending.value = false
      error.value = null
      return data.value
    }
    if (!force && loaded.value && loadedTenant.value === tenantId.value && loadedScope.value === scopeKey && Date.now() - loadedAt.value < cacheTtlMs) return data.value
    const inFlight = process.client && !force ? appDataInFlight.get(cacheKey) : null
    if (inFlight) {
      try {
        const nextData = await inFlight
        data.value = nextData
        goals.value = nextData.goals || []
        loaded.value = true
        loadedTenant.value = tenantId.value
        loadedAt.value = Date.now()
        loadedScope.value = scopeKey
        return nextData
      } catch (err) {
        error.value = err instanceof Error ? err.message : 'Não foi possível carregar os dados.'
        return data.value
      }
    }
    appDataAbortController?.abort()
    const requestController = process.client ? new AbortController() : null
    appDataAbortController = requestController
    const sequence = ++appDataRequestSequence
    pending.value = true
    error.value = null
    const request = $fetch<AppData>(apiUrl(`/api/app-data${scope !== null ? `?resources=${encodeURIComponent(scope.join(','))}` : ''}`), {
        headers: auth.authHeaders.value,
        signal: requestController?.signal
      })
    if (process.client) appDataInFlight.set(cacheKey, request)
    try {
      const nextData = await request
      if (sequence !== appDataRequestSequence) return data.value
      data.value = nextData
      goals.value = data.value.goals || []
      loaded.value = true
      loadedTenant.value = tenantId.value
      loadedAt.value = Date.now()
      loadedScope.value = scopeKey
      scopeCache.value = { ...scopeCache.value, [cacheKey]: { data: nextData, loadedAt: loadedAt.value } }
    } catch (err) {
      if (requestController?.signal.aborted || sequence !== appDataRequestSequence) return data.value
      error.value = err instanceof Error ? err.message : 'Não foi possível carregar os dados.'
    } finally {
      if (process.client && appDataInFlight.get(cacheKey) === request) appDataInFlight.delete(cacheKey)
      if (sequence === appDataRequestSequence) pending.value = false
      if (appDataAbortController === requestController) appDataAbortController = null
    }
  }

  if (process.client && loadedTenant.value && loadedTenant.value !== tenantId.value) {
    data.value = emptyData()
    goals.value = []
    loaded.value = false
    loadedTenant.value = ''
    loadedAt.value = 0
    loadedScope.value = ''
    scopeCache.value = {}
  }

  if (process.client && !loaded.value && !pending.value && !error.value) {
    void loadAppData()
  }
  if (process.client) {
    watch(() => route.fullPath, () => { void loadAppData() })
  }

  const resourceHeaders = () => auth.authHeaders.value
  const loadDashboardSummary = () => mockEnabled
    ? Promise.resolve(mockDashboardSummary(cloneMock(mockAppData)))
    : $fetch<DashboardSummary>(apiUrl('/api/dashboard-summary'), { headers: resourceHeaders() })
  const loadReportSummary = (params: Record<string, string | number | undefined>) => mockEnabled
    ? Promise.resolve(mockReportSummary(cloneMock(mockAppData), params))
    : $fetch<ReportSummary>(apiUrl('/api/reports/summary'), { query: params, headers: resourceHeaders() })
  const setResource = (resource: keyof AppData, list: any[]) => {
    ;(data.value[resource] as any[]) = list
  }

  const createItem = async <T>(resource: keyof AppData, item: T) => {
    if (mockEnabled) {
      const list = data.value[resource] as any[]
      const created = { ...(item as Record<string, unknown>), id: `${String(resource)}-mock-${Date.now()}` }
      setResource(resource, [created, ...(Array.isArray(list) ? list : [])])
      return created as T
    }
    const list = await $fetch<T[]>(apiUrl(`/api/${String(resource)}`), {
      method: 'POST',
      body: item,
      headers: resourceHeaders()
    })
    setResource(resource, list)
    return list[0]
  }

  const createExpenseInstallments = async (expense: Expense, installmentCount: number) => {
    if (mockEnabled) {
      const total = Number(expense.value || 0)
      const installmentValue = Number((total / installmentCount).toFixed(2))
      const created = Array.from({ length: installmentCount }, (_, index) => ({
        ...expense,
        id: `expense-installment-mock-${Date.now()}-${index}`,
        description: `${expense.description} (${index + 1}/${installmentCount})`,
        value: installmentValue,
        status: index === 0 ? expense.status : 'Pendente'
      }))
      data.value.expenses = [...created, ...data.value.expenses]
      return data.value.expenses
    }
    const list = await $fetch<Expense[]>(apiUrl('/api/expenses/installments'), {
      method: 'POST',
      body: { ...expense, installmentCount },
      headers: resourceHeaders()
    })
    setResource('expenses', list)
    return list
  }

  const updateItem = async <T extends { id?: string; dbId?: string }>(resource: keyof AppData, item: T) => {
    const id = item.dbId || item.id
    if (!id) throw new Error('Registro sem identificador para editar.')
    if (mockEnabled) {
      const list = data.value[resource] as any[]
      setResource(resource, Array.isArray(list) ? list.map((candidate) => String(candidate.dbId || candidate.id) === String(id) ? { ...candidate, ...item } : candidate) : [])
      return data.value[resource] as T[]
    }
    const list = await $fetch<T[]>(apiUrl(`/api/${String(resource)}/${id}`), {
      method: 'PUT',
      body: item,
      headers: resourceHeaders()
    })
    setResource(resource, list)
    return list
  }

  const deleteItem = async (resource: keyof AppData, id: string) => {
    if (mockEnabled) {
      const list = data.value[resource] as any[]
      setResource(resource, Array.isArray(list) ? list.filter((candidate) => String(candidate.dbId || candidate.id) !== String(id)) : [])
      return data.value[resource] as any[]
    }
    const list = await $fetch<any[]>(apiUrl(`/api/${String(resource)}/${id}`), {
      method: 'DELETE',
      headers: resourceHeaders()
    })
    setResource(resource, list)
    return list
  }

  const requestPrintJobAction = async (path: string, body: Record<string, unknown> = {}, statusMessage = 'Nao foi possivel atualizar a fila.') => {
    if (mockEnabled) return data.value.printJobs
    const list = await $fetch<PrintJob[]>(apiUrl(path), {
      method: 'POST',
      body,
      headers: resourceHeaders()
    }).catch((err) => {
      throw new Error(err?.data?.error || err?.message || statusMessage)
    })

    data.value.printJobs = list
    return list
  }

  const enqueuePrintJob = (item: Partial<PrintJob> & Record<string, unknown>) =>
    requestPrintJobAction('/api/print-jobs/enqueue', item, 'Nao foi possivel adicionar na fila.')

  const reorderPrintJob = (id: string, direction: 'up' | 'down', targetId = '') =>
    requestPrintJobAction(`/api/print-jobs/${id}/reorder`, { direction, targetId }, 'Nao foi possivel atualizar a ordem da fila.')

  const movePrintJobPrinter = (id: string, printerId: string, agentPrinterId = '') =>
    requestPrintJobAction(`/api/print-jobs/${id}/move-printer`, { printerId, agentPrinterId }, 'Nao foi possivel mover o item da fila.')

  const cancelQueuedPrintJob = (id: string) =>
    requestPrintJobAction(`/api/print-jobs/${id}/cancel`, {}, 'Nao foi possivel cancelar o item da fila.')

  const approveMarketplacePrintJob = (id: string) =>
    requestPrintJobAction(`/api/print-jobs/${id}/approve`, {}, 'Nao foi possivel liberar o pedido para impressao.')

  const startManualPrintJob = (id: string) =>
    requestPrintJobAction(`/api/print-jobs/${id}/start-manual`, {}, 'Nao foi possivel iniciar o item da fila.')

  const completeQueuedPrintJob = (id: string) =>
    requestPrintJobAction(`/api/print-jobs/${id}/complete`, {}, 'Nao foi possivel concluir o item da fila.')

  const retryPrintJob = (id: string) =>
    requestPrintJobAction(`/api/print-jobs/${id}/retry`, {}, 'Nao foi possivel criar uma nova tentativa.')

  const approveProductionOutput = async (id: string, approvedQuantity: number, rejectedQuantity: number) => {
    await $fetch(apiUrl(`/api/print-jobs/${id}/quality-approve`), { method: 'POST', body: { approvedQuantity, rejectedQuantity }, headers: resourceHeaders() })
    await loadAppData(true)
  }

  const createProduct = async (product: Product) => {
    if (mockEnabled) {
      const created = { ...product, id: `product-mock-${Date.now()}` }
      data.value.products = [created, ...data.value.products]
      return created
    }
    const created = await $fetch<Product>(apiUrl('/api/products'), {
      method: 'POST',
      body: product,
      headers: resourceHeaders()
    })
    data.value.products = [created, ...data.value.products.filter((item) => item.sku !== created.sku)]
    return created
  }

  const uploadProductPrintFile = async (productId: string, file: File) => {
    if (mockEnabled) {
      const product = data.value.products.find((item) => String(item.id) === String(productId)) || null
      return { file: { name: file.name, mock: true }, product }
    }
    const response = await $fetch<{ file: Record<string, unknown>; product: Product | null }>(apiUrl(`/api/products/${productId}/print-file`), {
      method: 'PUT',
      body: file,
      headers: {
        ...resourceHeaders(),
        'Content-Type': 'application/octet-stream',
        'X-PrintFlow-File-Name': encodeURIComponent(file.name),
        'X-PrintFlow-File-Format': file.name.split('.').pop() || ''
      }
    })

    if (response.product) {
      data.value.products = data.value.products.map((item) => String(item.id) === String(productId) ? response.product as Product : item)
    }

    return response
  }

  const uploadProductImage = async (productId: string, file: File) => {
    if (mockEnabled) {
      const product = data.value.products.find((item) => String(item.id) === String(productId)) || null
      return { product }
    }
    const response = await $fetch<{ product: Product | null }>(apiUrl(`/api/products/${encodeURIComponent(productId)}/image`), {
      method: 'PUT',
      body: file,
      headers: {
        ...resourceHeaders(),
        'Content-Type': file.type || 'application/octet-stream'
      }
    })

    if (response.product) {
      data.value.products = data.value.products.map((item) => String(item.id) === String(productId) ? response.product as Product : item)
    }
    return response
  }

  const advanceOrderStage = async (orderId: string, status: string, trackingCode = '') => {
    if (mockEnabled) {
      data.value.orders = data.value.orders.map((item) => String(item.dbId || item.id) === String(orderId) ? { ...item, status, trackingCode } : item)
      return { id: orderId, status }
    }
    const result = await $fetch<{ order: { id: string; status: string } }>(apiUrl(`/api/orders/${encodeURIComponent(orderId)}/advance-stage`), {
      method: 'POST', body: { status, trackingCode }, headers: resourceHeaders()
    })
    await loadAppData(true)
    return result.order
  }

  const createMarketplaceIntegration = async (integration: Partial<MarketplaceIntegration> & Record<string, unknown>) => {
    if (mockEnabled) {
      const created = { id: `integration-mock-${Date.now()}`, platform: 'custom', connectionName: 'Integracao mock', status: 'connected', ...integration } as MarketplaceIntegration
      data.value.marketplaceIntegrations = [created, ...(data.value.marketplaceIntegrations || [])]
      return created
    }
    const created = await $fetch<MarketplaceIntegration>(apiUrl('/api/marketplace-integrations'), {
      method: 'POST',
      body: integration,
      headers: resourceHeaders()
    })
    data.value.marketplaceIntegrations = [
      created,
      ...(data.value.marketplaceIntegrations || []).filter((item) => item.id !== created.id)
    ]
    return created
  }

  const startMarketplaceOAuth = async (platform: string) => {
    if (mockEnabled) throw new Error('OAuth real desativado no modo mock visual.')
    const response = await $fetch<{ url: string }>(apiUrl(`/api/marketplace-integrations/${platform}/oauth-start`), {
      method: 'POST',
      headers: resourceHeaders()
    }).catch((err) => {
      throw new Error(err?.data?.error || err?.message || 'Nao foi possivel iniciar OAuth do marketplace.')
    })
    return response.url
  }

  const disconnectMarketplaceIntegration = async (id: string) => {
    if (mockEnabled) {
      data.value.marketplaceIntegrations = (data.value.marketplaceIntegrations || []).map((item) => item.id === id ? { ...item, status: 'disconnected' } : item)
      return
    }
    await $fetch(apiUrl(`/api/marketplace-integrations/${encodeURIComponent(id)}`), {
      method: 'DELETE', headers: resourceHeaders()
    }).catch((err) => {
      throw new Error(err?.data?.error || err?.message || 'Nao foi possivel desconectar a conta do marketplace.')
    })
    await loadAppData(true)
  }

  const refreshMarketplaceOrders = async () => {
    if (mockEnabled) {
      data.value.marketplaceOrders = cloneMock(mockMarketplaceOrders)
      return data.value.marketplaceOrders
    }
    const list = await $fetch<MarketplaceOrder[]>(apiUrl('/api/marketplace-orders'), {
      headers: resourceHeaders()
    })
    data.value.marketplaceOrders = list
    return list
  }

  const loadMarketplaceOrdersPage = async (params: { limit?: number; offset?: number } = {}) => {
    if (mockEnabled) {
      const offset = Number(params.offset || 0)
      const limit = Number(params.limit || 25)
      return { items: mockMarketplaceOrders.slice(offset, offset + limit), total: mockMarketplaceOrders.length, limit, offset }
    }
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return $fetch<{ items: MarketplaceOrder[]; total: number; limit: number; offset: number }>(apiUrl(`/api/marketplace-orders${suffix}`), { headers: resourceHeaders() })
  }

  const loadOrdersPage = async (params: { limit?: number; offset?: number; status?: string; salesChannel?: string; search?: string; from?: string; to?: string; clientId?: string } = {}) => {
    if (mockEnabled) return getMockOrdersPage(params)
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return $fetch<OrdersPage>(apiUrl(`/api/orders${suffix}`), { headers: resourceHeaders() })
  }
  const loadClientOrders = (clientId: string) => loadOrdersPage({ clientId, salesChannel: 'direct', limit: 100, offset: 0 })

  const loadOrdersSummary = async () => mockEnabled ? getMockOrdersSummary() : $fetch<{
    orderCount: number; gross: number; net: number; profit: number; fees: number; shipping: number; ticket: number; cancelledCount: number; cancelledGross: number;
    byStatus: Array<{ status: string; count: number }>;
    byMarketplace: Array<{ name: string; value: number }>;
    daily: Array<{ key: string; gross: number; net: number; profit: number; orders: number; cancelledGross: number; cancelledOrders: number }>;
    options: { marketplaces: string[]; products: string[] }
  }>(apiUrl('/api/orders/summary'), { headers: resourceHeaders() })

  const generateRecurringExpenses = async () => {
    if (mockEnabled) return 0
    const response = await $fetch<{ generated: number; expenses: Expense[] }>(apiUrl('/api/expenses/recurring/generate'), {
      method: 'POST', headers: resourceHeaders()
    })
    data.value.expenses = response.expenses
    return response.generated
  }

  const syncMarketplaceOrder = async (integrationId: string, externalOrderId: string) => {
    if (mockEnabled) {
      await refreshMarketplaceOrders()
      return
    }
    await $fetch(apiUrl(`/api/marketplace-integrations/${encodeURIComponent(integrationId)}/sync-order`), {
      method: 'POST', body: { externalOrderId }, headers: resourceHeaders()
    }).catch((err) => {
      throw new Error(err?.data?.error || err?.message || 'Nao foi possivel sincronizar o pedido.')
    })
    await loadAppData(true)
    await refreshMarketplaceOrders()
  }

  const linkMarketplaceOrderProduct = async (id: string, productId: string) => {
    if (mockEnabled) {
      data.value.marketplaceOrders = (data.value.marketplaceOrders || []).map((item) => item.id === id ? { ...item, mappedProductId: productId, mappedProductName: data.value.products.find((product) => product.id === productId)?.name || '' } : item)
      return data.value.marketplaceOrders
    }
    const list = await $fetch<MarketplaceOrder[]>(apiUrl(`/api/marketplace-orders/${id}/link-product`), {
      method: 'POST',
      body: { productId },
      headers: resourceHeaders()
    }).catch((err) => {
      throw new Error(err?.data?.error || err?.message || 'Nao foi possivel vincular o pedido ao produto.')
    })
    data.value.marketplaceOrders = list
    await loadAppData(true)
    return list
  }

  const updateSettings = async (settings: Record<string, unknown>) => {
    if (mockEnabled) {
      data.value.settings = { ...(data.value.settings || {}), ...settings }
      return data.value.settings
    }
    const saved = await $fetch<Record<string, unknown>>(apiUrl('/api/settings'), {
      method: 'PUT', body: settings, headers: resourceHeaders()
    })
    data.value.settings = saved
    return saved
  }

  const setOnboardingPrinterMode = async (mode: 'manual' | 'agent') => {
    if (mockEnabled) {
      const current = data.value.settings || {}
      const preferences = current.preferences && typeof current.preferences === 'object' ? current.preferences as Record<string, unknown> : {}
      data.value.settings = { ...current, preferences: { ...preferences, onboardingPrinterMode: mode } }
      return { mode }
    }
    return $fetch<{ mode: 'manual' | 'agent' }>(apiUrl('/api/settings/onboarding-mode'), {
      method: 'PUT', body: { mode }, headers: resourceHeaders()
    })
  }

  const lookupCompanyByCnpj = (cnpj: string) => mockEnabled ? Promise.resolve({
    name: 'Empresa Mock LTDA', legalName: 'Empresa Mock LTDA', phone: '(11) 4000-0000', email: 'mock@example.test',
    address: 'Rua Visual', district: 'Centro', city: 'Sao Paulo', state: 'SP', zip: '01000-000', status: 'Ativa'
  }) : $fetch<{
    name: string; legalName: string; phone: string; email: string; address: string; district: string; city: string; state: string; zip: string; status: string
  }>(apiUrl('/api/settings/company-lookup'), { query: { cnpj }, headers: resourceHeaders() })

  const exportTenantData = (groups: string[] = ['all']) => mockEnabled ? Promise.resolve(new Blob(['mock export'], { type: 'text/plain' })) : $fetch<Blob>(apiUrl('/api/settings/export'), {
    query: { groups: groups.join(',') }, responseType: 'blob', headers: resourceHeaders()
  })

  const getMercadoPagoBilling = () => mockEnabled ? Promise.resolve({
    configured: true,
    environment: 'sandbox' as const,
    plans: [{ id: 'pro', code: 'PRO', name: 'Pro Mock', description: 'Plano ficticio para review', monthly: 79.9, yearly: 799, monthlyEnabled: true, yearlyEnabled: true }],
    subscription: { status: 'active', billingCycle: 'monthly', planCode: 'PRO', planName: 'Pro Mock', currentPeriodEnd: new Date(Date.now() + 20 * 86400000).toISOString() },
    checkout: null
  }) : $fetch<MercadoPagoBillingSummary>(apiUrl('/api/billing/mercado-pago'), {
    headers: resourceHeaders()
  })

  const getSubscriptionAccess = () => mockEnabled ? Promise.resolve({
    planCode: 'starter', status: 'active', mode: 'full' as const,
    features: { coreOperations: true, marketplaces: true, advancedReports: true, manualPrinters: true, agent: true, team: true },
    limits: {}, usage: {}
  }) : $fetch<SubscriptionAccess>(apiUrl('/api/subscription/access'), {
    headers: resourceHeaders(),
    timeout: 15_000
  })

  const createMercadoPagoCheckout = (body: { planCode: string; billingCycle: 'monthly' | 'yearly' }) => mockEnabled ? Promise.resolve({ id: 'checkout-mock', url: '#mock-checkout-disabled', expiresAt: null }) :
    $fetch<{ id: string; url: string; expiresAt: string | null }>(apiUrl('/api/billing/mercado-pago/checkout'), {
      method: 'POST', body, headers: resourceHeaders()
    })
  const updateMercadoPagoSubscription = (action: 'cancel' | 'pause' | 'resume') => mockEnabled ? getMercadoPagoBilling() :
    $fetch<MercadoPagoBillingSummary>(apiUrl(`/api/billing/mercado-pago/subscription/${action}`), { method: 'POST', headers: resourceHeaders() })

  const listSettingsExports = () => mockEnabled ? Promise.resolve([{ id: 'export-mock-1', fileName: 'filamind-mock-export.json', type: 'tenant_data', format: 'json', recordCount: 128, status: 'success', createdAt: new Date().toISOString() }]) : $fetch<Array<{ id: string; fileName: string; type: string; format: string; recordCount: number; status: string; createdAt: string }>>(apiUrl('/api/settings/export-history'), {
    headers: resourceHeaders()
  })

  const listFinancialHistory = (options: { resource?: string; resourceId?: string; from?: string; to?: string; limit?: number; offset?: number } = {}) => mockEnabled ? Promise.resolve(getMockFinancialHistory(options)) : $fetch<FinancialHistoryPage>(apiUrl('/api/financial-history'), { query: options, headers: resourceHeaders() })

  const exportFinancialReport = (filters: Record<string, string>) => mockEnabled ? Promise.resolve(new Blob(['mock report'], { type: 'text/plain' })) : $fetch<Blob>(apiUrl('/api/reports/financial-export'), {
    query: filters, responseType: 'blob', headers: resourceHeaders()
  })

  const listCalculatorSimulations = () => mockEnabled ? Promise.resolve(getMockCalculatorSimulations()) : $fetch<CalculatorSimulation[]>(apiUrl('/api/calculator/simulations'), { headers: resourceHeaders() })
  const createCalculatorSimulation = (body: Record<string, unknown>) => mockEnabled ? Promise.resolve({ ...getMockCalculatorSimulations()[0], id: `calc-mock-${Date.now()}`, snapshot: body }) : $fetch<CalculatorSimulation>(apiUrl('/api/calculator/simulations'), { method: 'POST', body, headers: resourceHeaders() })

  const listFilamentMovements = (filamentId: string) => mockEnabled ? Promise.resolve(getMockInventoryOverview({ resource: 'filaments' }).movements.filter((item) => item.resourceId === filamentId)) : $fetch<InventoryMovement[]>(apiUrl(`/api/filaments/${filamentId}/movements`), { headers: resourceHeaders() })
  const createFilamentMovement = (filamentId: string, body: { type: InventoryMovement['type']; quantity: number; reason: string }) => mockEnabled ? Promise.resolve({ id: `movement-mock-${Date.now()}`, type: body.type, quantity: body.quantity, previousQuantity: 0, resultingQuantity: body.quantity, reason: body.reason, createdAt: new Date().toISOString() }) : $fetch<InventoryMovement>(apiUrl(`/api/filaments/${filamentId}/movements`), { method: 'POST', body, headers: resourceHeaders() })
  const loadInventoryOverview = (options: { from?: string; to?: string; resource?: string; type?: string; search?: string; limit?: number; offset?: number } = {}) => mockEnabled ? Promise.resolve(getMockInventoryOverview(options)) : $fetch<InventoryOverview>(apiUrl('/api/inventory/overview'), { query: options, headers: resourceHeaders() })
  const listPendingProductionMaterial = () => mockEnabled ? Promise.resolve(getMockPendingProductionMaterial()) : $fetch<PendingProductionMaterial[]>(apiUrl('/api/inventory/production-pending'), { headers: resourceHeaders() })
  const reconcilePendingProductionMaterial = (printJobId: string) => mockEnabled ? Promise.resolve({ ok: true }) : $fetch(apiUrl(`/api/inventory/production-pending/${encodeURIComponent(printJobId)}/reconcile`), { method: 'POST', headers: resourceHeaders() })
  const listProductInventoryMovements = (productId: string) => mockEnabled ? Promise.resolve(getMockInventoryOverview({ resource: 'products' }).movements.filter((item) => item.resourceId === productId)) : $fetch<InventoryMovement[]>(apiUrl(`/api/inventory/products/${productId}/movements`), { headers: resourceHeaders() })
  const createProductInventoryMovement = (productId: string, body: { type: InventoryMovement['type']; quantity: number; reason: string }) => mockEnabled ? Promise.resolve({ id: `product-movement-mock-${Date.now()}`, type: body.type, quantity: body.quantity, previousQuantity: 0, resultingQuantity: body.quantity, reason: body.reason, createdAt: new Date().toISOString() }) : $fetch<InventoryMovement>(apiUrl(`/api/inventory/products/${productId}/movements`), { method: 'POST', body, headers: resourceHeaders() })

  const loadBackupStatus = () => mockEnabled ? Promise.resolve(getMockBackupStatus()) : $fetch<BackupStatus>(apiUrl('/api/settings/backup-status'), {
    headers: resourceHeaders()
  })
  const listSupportRequests = () => mockEnabled ? Promise.resolve(mockSupportRequests) : $fetch<SupportRequest[]>(apiUrl('/api/support/requests'), { headers: resourceHeaders() })
  const createSupportRequest = (body: Record<string, unknown>) => mockEnabled ? Promise.resolve({ ...mockSupportRequests[0], id: `support-mock-${Date.now()}`, subject: String(body.subject || 'Chamado mock criado') }) : $fetch<SupportRequest>(apiUrl('/api/support/requests'), { method: 'POST', body, headers: resourceHeaders() })
  const cancelSupportRequest = (id: string) => mockEnabled ? Promise.resolve({ ok: true }) : $fetch(apiUrl(`/api/support/requests/${encodeURIComponent(id)}`), { method: 'DELETE', headers: resourceHeaders() })
  const listSupportMessages = (id: string, since?: string) => mockEnabled ? Promise.resolve([{ id: 'message-mock-1', senderType: 'support' as const, body: 'Mensagem mock para revisar a conversa de suporte.', createdAt: new Date().toISOString() }]) : $fetch<SupportMessage[]>(apiUrl(`/api/support/requests/${encodeURIComponent(id)}/messages${since ? `?since=${encodeURIComponent(since)}` : ''}`), { headers: resourceHeaders() })
  const getSupportUnread = (since?: string) => mockEnabled ? Promise.resolve({ total: 1, byRequest: [{ requestId: 'mock-support-1', total: 1 }] }) : $fetch<{ total: number; byRequest: Array<{ requestId: string; total: number }> }>(apiUrl(`/api/support/unread${since ? `?since=${encodeURIComponent(since)}` : ''}`), { headers: resourceHeaders() })
  const sendSupportMessage = (id: string, body: string) => mockEnabled ? Promise.resolve({ requestId: id, createdNewProtocol: false, previousRequestId: null }) : $fetch<{ requestId: string; createdNewProtocol: boolean; previousRequestId?: string | null }>(apiUrl(`/api/support/requests/${encodeURIComponent(id)}/messages`), { method: 'POST', body: { body }, headers: resourceHeaders() })
  const listSupportAttachments = (id: string) => mockEnabled ? Promise.resolve([]) : $fetch<SupportAttachment[]>(apiUrl(`/api/support/requests/${encodeURIComponent(id)}/attachments`), { headers: resourceHeaders() })
  const uploadSupportAttachment = async (id: string, file: File) => {
    if (mockEnabled) return { id: `attachment-mock-${Date.now()}`, requestId: id, originalName: file.name, mimeType: file.type, sizeBytes: file.size, expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: new Date().toISOString() }
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '').split(',').pop() || ''); reader.onerror = reject; reader.readAsDataURL(file) })
    return $fetch<SupportAttachment>(apiUrl(`/api/support/requests/${encodeURIComponent(id)}/attachments`), { method: 'POST', body: { fileName: file.name, mimeType: file.type, data }, headers: resourceHeaders() })
  }
  const downloadSupportAttachment = async (id: string, attachment: SupportAttachment) => {
    if (mockEnabled) return
    const response = await fetch(apiUrl(`/api/support/requests/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachment.id)}`), { credentials: 'include', headers: resourceHeaders() })
    if (!response.ok) throw new Error('Nao foi possivel baixar o anexo.')
    const link = document.createElement('a'); link.href = URL.createObjectURL(await response.blob()); link.download = attachment.originalName; link.click(); URL.revokeObjectURL(link.href)
  }

  const loadIntegrationsOverview = () => mockEnabled ? Promise.resolve(getMockIntegrationsOverview()) : $fetch<IntegrationsOverview>(apiUrl('/api/integrations/overview'), {
    headers: resourceHeaders()
  })

  return {
    products: computed(() => data.value.products),
    orders: computed(() => data.value.orders),
    printJobs: computed(() => data.value.printJobs),
    expenses: computed(() => data.value.expenses),
    filaments: computed(() => data.value.filaments),
    printers: computed(() => data.value.printers),
    marketplaces: computed(() => data.value.marketplaces),
    marketplaceOrders: computed(() => data.value.marketplaceOrders || []),
    marketplaceIntegrations: computed(() => data.value.marketplaceIntegrations || []),
    clients: computed(() => data.value.clients),
    goals,
    expenseSegments: computed(() => data.value.expenseSegments),
    settings: computed(() => data.value.settings),
    apiBase,
    tenantId,
    pending,
    error,
    refreshAppData: loadAppData,
    loadDashboardSummary,
    loadReportSummary,
    createProduct
    , uploadProductPrintFile, uploadProductImage, generateRecurringExpenses
    , createMarketplaceIntegration
    , loadInventoryOverview, listPendingProductionMaterial, reconcilePendingProductionMaterial, listProductInventoryMovements, createProductInventoryMovement
    , advanceOrderStage
    , startMarketplaceOAuth
    , disconnectMarketplaceIntegration
    , refreshMarketplaceOrders, loadMarketplaceOrdersPage, loadOrdersPage, loadClientOrders, loadOrdersSummary
    , syncMarketplaceOrder
    , linkMarketplaceOrderProduct
    , updateSettings
    , setOnboardingPrinterMode
    , lookupCompanyByCnpj
    , exportTenantData
    , getMercadoPagoBilling
    , getSubscriptionAccess
    , createMercadoPagoCheckout
    , updateMercadoPagoSubscription
    , listSettingsExports
    , listFinancialHistory
    , exportFinancialReport
    , listCalculatorSimulations
    , createCalculatorSimulation
    , listFilamentMovements
    , createFilamentMovement
    , loadBackupStatus
    , listSupportRequests
    , createSupportRequest
    , cancelSupportRequest
    , listSupportAttachments
    , uploadSupportAttachment
    , downloadSupportAttachment
    , listSupportMessages, getSupportUnread
    , sendSupportMessage
    , loadIntegrationsOverview
    , enqueuePrintJob
    , reorderPrintJob
    , movePrintJobPrinter
    , cancelQueuedPrintJob
    , approveMarketplacePrintJob
    , startManualPrintJob
    , completeQueuedPrintJob
    , retryPrintJob
    , approveProductionOutput
    , createItem
    , createExpenseInstallments
    , updateItem
    , deleteItem
  }
}
