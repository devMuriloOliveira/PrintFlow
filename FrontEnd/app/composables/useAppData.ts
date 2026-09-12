export type Order = {
  dbId?: string;
  id: string; productId?: string; clientId?: string; date: string; client: string; marketplace: string; product: string; qty: number;
  gross: number; fee: number; shipping: number; net: number; profit: number; status: string;
  trackingCode?: string; packedAt?: string | null; shippedAt?: string | null; deliveredAt?: string | null; marketplaceOrder?: boolean; salesChannel?: 'direct' | 'marketplace'
}

export type PrintJob = {
  id?: string;
  orderId?: string; externalOrderId?: string; trackedSaleId?: string; productId?: string; productName?: string;
  printerId?: string; printerName?: string; agentPrinterId?: string; agentPrinterStatus?: string;
  printFileName?: string; printFileFormat?: string; validationStatus?: string; validationMessage?: string;
  agentLastStatus?: Record<string, unknown>; source: string; title: string; quantity: number; priority: number;
  status: string; notes?: string; scheduledAt?: string | null; startedAt?: string | null; completedAt?: string | null;
  cancelledAt?: string | null; createdAt?: string | null; updatedAt?: string | null
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
  agentPrinterStatus?: string; agentLastStatus?: Record<string, unknown>; agentLastConnectionError?: string; agentLastSeenAt?: string | null
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

export type StripeBillingSummary = {
  configured: boolean;
  environment: 'sandbox' | 'production';
  plans: Array<{ id: string; code: string; name: string; description: string; monthly: number; yearly: number; monthlyEnabled: boolean; yearlyEnabled: boolean }>;
  subscription: null | { status: string; billingCycle: string; planCode: string; planName: string; currentPeriodEnd: string | null; cancelAtPeriodEnd?: boolean };
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

type AppData = {
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
  export: { enabled: boolean; format: 'json'; excludes: string[] }
  restore: { enabled: false; reason: string }
}
export type SupportRequest = { id: string; status: string; supportStatus?: 'new' | 'in_progress' | 'waiting_customer' | 'waiting_internal' | 'resolved' | 'reopened'; subject: string; category: string; requestKind?: 'support' | 'privacy'; privacyRight?: string; priority: string; requesterRole: string; reason: string; scope: { entityType?: string; entityId?: string }; responsibleId?: string | null; responsibleName?: string; dueAt?: string | null; supportFirstResponseDueAt?: string | null; supportResolutionDueAt?: string | null; supportReopenUntil?: string | null; supportReopenedAt?: string | null; supportParentRequestId?: string | null; decision?: 'approved' | 'rejected' | null; reviewReason?: string; expiresAt?: string | null; chatOpenedAt?: string | null; chatClosedAt?: string | null; createdAt: string; updatedAt?: string }
export type SupportMessage = { id: string; senderType: 'requester' | 'support'; body: string; createdAt: string }
export type SupportAttachment = { id: string; requestId: string; originalName: string; mimeType: string; sizeBytes: number; expiresAt: string; createdAt: string }
export type FinancialHistoryEntry = { id: string; resource: string; resourceId: string; snapshot: Record<string, any>; source: string; createdAt: string }
export type CalculatorSimulation = { id: string; name: string; pricePerKg: number; weight: number; durationMinutes: number; energyEnabled: boolean; energyRate: number; watts: number; margin: number; directCost: number; suggestedPrice: number; snapshot: Record<string, any>; createdAt: string }
export type InventoryMovement = { id: string; type: 'in' | 'out' | 'adjustment'; quantity: number; previousQuantity: number; resultingQuantity: number; reason: string; createdAt: string }
export const formatCurrency = (value: number) => {
  const settings = useState<AppData>('app-data', emptyData).value.settings
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currencyCode(settings?.currency) }).format(value)
}
export const formatNumber = (value: number) => new Intl.NumberFormat('pt-BR').format(value)

export const useAppData = () => {
  const config = useRuntimeConfig()
  const apiBase = String(config.public.apiBase || '').replace(/\/$/, '')
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
    const scopes: Record<string, string[]> = {
      '/': ['products', 'orders', 'expenses', 'expenseSegments', 'filaments', 'goals', 'printers', 'printJobs'],
      '/configuracoes': ['settings'],
      '/clientes': ['clients'],
      '/vendas': ['orders', 'products', 'printers', 'printJobs', 'clients'],
      '/produtos': ['products', 'printers', 'filaments'],
      '/impressoras': ['printers', 'printJobs', 'products', 'filaments'],
      '/filamentos': ['filaments', 'printJobs', 'products'],
      '/despesas': ['expenses', 'expenseSegments'],
      '/metas': ['goals'],
      '/marketplaces': ['marketplaces', 'products'],
      '/relatorios': (() => {
        const section = String(route.query.secao || 'financeiro')
        if (section === 'historico') return []
        if (section === 'produtos') return ['orders', 'products']
        return ['orders', 'products', 'expenses', 'expenseSegments']
      })()
    }
    const match = Object.entries(scopes).find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))
    return match ? match[1] : null
  }

  const loadAppData = async (force = false) => {
    const cacheTtlMs = 15_000
    const scope = resourceScopeForRoute()
    const scopeKey = scope?.slice().sort().join(',') || 'all'
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
    if (!force && loaded.value && loadedTenant.value === tenantId.value && loadedScope.value === scopeKey && Date.now() - loadedAt.value < cacheTtlMs) return data.value
    appDataAbortController?.abort()
    const requestController = process.client ? new AbortController() : null
    appDataAbortController = requestController
    const sequence = ++appDataRequestSequence
    pending.value = true
    error.value = null
    try {
      const nextData = await $fetch<AppData>(apiUrl(`/api/app-data${scope !== null ? `?resources=${encodeURIComponent(scope.join(','))}` : ''}`), {
        headers: auth.authHeaders.value,
        signal: requestController?.signal
      })
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
  const setResource = (resource: keyof AppData, list: any[]) => {
    ;(data.value[resource] as any[]) = list
  }

  const createItem = async <T>(resource: keyof AppData, item: T) => {
    const list = await $fetch<T[]>(apiUrl(`/api/${String(resource)}`), {
      method: 'POST',
      body: item,
      headers: resourceHeaders()
    })
    setResource(resource, list)
    return list[0]
  }

  const updateItem = async <T extends { id?: string; dbId?: string }>(resource: keyof AppData, item: T) => {
    const id = item.dbId || item.id
    if (!id) throw new Error('Registro sem identificador para editar.')
    const list = await $fetch<T[]>(apiUrl(`/api/${String(resource)}/${id}`), {
      method: 'PUT',
      body: item,
      headers: resourceHeaders()
    })
    setResource(resource, list)
    return list
  }

  const deleteItem = async (resource: keyof AppData, id: string) => {
    const list = await $fetch<any[]>(apiUrl(`/api/${String(resource)}/${id}`), {
      method: 'DELETE',
      headers: resourceHeaders()
    })
    setResource(resource, list)
    return list
  }

  const requestPrintJobAction = async (path: string, body: Record<string, unknown> = {}, statusMessage = 'Nao foi possivel atualizar a fila.') => {
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

  const reorderPrintJob = (id: string, direction: 'up' | 'down') =>
    requestPrintJobAction(`/api/print-jobs/${id}/reorder`, { direction }, 'Nao foi possivel atualizar a ordem da fila.')

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

  const createProduct = async (product: Product) => {
    const created = await $fetch<Product>(apiUrl('/api/products'), {
      method: 'POST',
      body: product,
      headers: resourceHeaders()
    })
    data.value.products = [created, ...data.value.products.filter((item) => item.sku !== created.sku)]
    return created
  }

  const uploadProductPrintFile = async (productId: string, file: File) => {
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

  const advanceOrderStage = async (orderId: string, status: string, trackingCode = '') => {
    const result = await $fetch<{ order: { id: string; status: string } }>(apiUrl(`/api/orders/${encodeURIComponent(orderId)}/advance-stage`), {
      method: 'POST', body: { status, trackingCode }, headers: resourceHeaders()
    })
    await loadAppData(true)
    return result.order
  }

  const createMarketplaceIntegration = async (integration: Partial<MarketplaceIntegration> & Record<string, unknown>) => {
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
    const response = await $fetch<{ url: string }>(apiUrl(`/api/marketplace-integrations/${platform}/oauth-start`), {
      method: 'POST',
      headers: resourceHeaders()
    }).catch((err) => {
      throw new Error(err?.data?.error || err?.message || 'Nao foi possivel iniciar OAuth do marketplace.')
    })
    return response.url
  }

  const disconnectMarketplaceIntegration = async (id: string) => {
    await $fetch(apiUrl(`/api/marketplace-integrations/${encodeURIComponent(id)}`), {
      method: 'DELETE', headers: resourceHeaders()
    }).catch((err) => {
      throw new Error(err?.data?.error || err?.message || 'Nao foi possivel desconectar a conta do marketplace.')
    })
    await loadAppData(true)
  }

  const refreshMarketplaceOrders = async () => {
    const list = await $fetch<MarketplaceOrder[]>(apiUrl('/api/marketplace-orders'), {
      headers: resourceHeaders()
    })
    data.value.marketplaceOrders = list
    return list
  }

  const loadMarketplaceOrdersPage = async (params: { limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return $fetch<{ items: MarketplaceOrder[]; total: number; limit: number; offset: number }>(apiUrl(`/api/marketplace-orders${suffix}`), { headers: resourceHeaders() })
  }

  const loadOrdersPage = async (params: { limit?: number; offset?: number; status?: string; salesChannel?: string; search?: string; from?: string; to?: string; clientId?: string } = {}) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return $fetch<OrdersPage>(apiUrl(`/api/orders${suffix}`), { headers: resourceHeaders() })
  }
  const loadClientOrders = (clientId: string) => loadOrdersPage({ clientId, salesChannel: 'direct', limit: 100, offset: 0 })

  const loadOrdersSummary = async () => $fetch<{
    orderCount: number; gross: number; net: number; profit: number; fees: number; shipping: number; ticket: number;
    byStatus: Array<{ status: string; count: number }>
  }>(apiUrl('/api/orders/summary'), { headers: resourceHeaders() })

  const generateRecurringExpenses = async () => {
    const response = await $fetch<{ generated: number; expenses: Expense[] }>(apiUrl('/api/expenses/recurring/generate'), {
      method: 'POST', headers: resourceHeaders()
    })
    data.value.expenses = response.expenses
    return response.generated
  }

  const syncMarketplaceOrder = async (integrationId: string, externalOrderId: string) => {
    await $fetch(apiUrl(`/api/marketplace-integrations/${encodeURIComponent(integrationId)}/sync-order`), {
      method: 'POST', body: { externalOrderId }, headers: resourceHeaders()
    }).catch((err) => {
      throw new Error(err?.data?.error || err?.message || 'Nao foi possivel sincronizar o pedido.')
    })
    await loadAppData(true)
    await refreshMarketplaceOrders()
  }

  const linkMarketplaceOrderProduct = async (id: string, productId: string) => {
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
    const saved = await $fetch<Record<string, unknown>>(apiUrl('/api/settings'), {
      method: 'PUT', body: settings, headers: resourceHeaders()
    })
    data.value.settings = saved
    return saved
  }

  const lookupCompanyByCnpj = (cnpj: string) => $fetch<{
    name: string; legalName: string; phone: string; email: string; address: string; district: string; city: string; state: string; zip: string; status: string
  }>(apiUrl('/api/settings/company-lookup'), { query: { cnpj }, headers: resourceHeaders() })

  const exportTenantData = (groups: string[] = ['all']) => $fetch<Blob>(apiUrl('/api/settings/export'), {
    query: { groups: groups.join(',') }, responseType: 'blob', headers: resourceHeaders()
  })

  const getStripeBilling = () => $fetch<StripeBillingSummary>(apiUrl('/api/billing/stripe'), {
    headers: resourceHeaders()
  })

  const createStripeCheckout = (body: { planCode: string; billingCycle: 'monthly' | 'yearly' }) =>
    $fetch<{ id: string; url: string; expiresAt: string | null }>(apiUrl('/api/billing/stripe/checkout'), {
      method: 'POST', body, headers: resourceHeaders()
    })
  const changeStripeSubscriptionPlan = (billingCycle: 'monthly' | 'yearly') => $fetch<StripeBillingSummary>(apiUrl('/api/billing/stripe/subscription/change-plan'), { method: 'POST', body: { billingCycle }, headers: resourceHeaders() })
  const cancelStripeSubscription = () => $fetch<StripeBillingSummary>(apiUrl('/api/billing/stripe/subscription/cancel'), { method: 'POST', headers: resourceHeaders() })
  const resumeStripeSubscription = () => $fetch<StripeBillingSummary>(apiUrl('/api/billing/stripe/subscription/resume'), { method: 'POST', headers: resourceHeaders() })

  const listSettingsExports = () => $fetch<Array<{ id: string; fileName: string; type: string; format: string; recordCount: number; status: string; createdAt: string }>>(apiUrl('/api/settings/export-history'), {
    headers: resourceHeaders()
  })

  const listFinancialHistory = (resource = '', resourceId = '') => $fetch<FinancialHistoryEntry[]>(apiUrl(`/api/financial-history${resource || resourceId ? `?${new URLSearchParams({ ...(resource ? { resource } : {}), ...(resourceId ? { resourceId } : {}) }).toString()}` : ''}`), {
    headers: resourceHeaders()
  })

  const exportFinancialReport = (filters: Record<string, string>) => $fetch<Blob>(apiUrl('/api/reports/financial-export'), {
    query: filters, responseType: 'blob', headers: resourceHeaders()
  })

  const listCalculatorSimulations = () => $fetch<CalculatorSimulation[]>(apiUrl('/api/calculator/simulations'), { headers: resourceHeaders() })
  const createCalculatorSimulation = (body: Record<string, unknown>) => $fetch<CalculatorSimulation>(apiUrl('/api/calculator/simulations'), { method: 'POST', body, headers: resourceHeaders() })

  const listFilamentMovements = (filamentId: string) => $fetch<InventoryMovement[]>(apiUrl(`/api/filaments/${filamentId}/movements`), { headers: resourceHeaders() })
  const createFilamentMovement = (filamentId: string, body: { type: InventoryMovement['type']; quantity: number; reason: string }) => $fetch<InventoryMovement>(apiUrl(`/api/filaments/${filamentId}/movements`), { method: 'POST', body, headers: resourceHeaders() })

  const loadBackupStatus = () => $fetch<BackupStatus>(apiUrl('/api/settings/backup-status'), {
    headers: resourceHeaders()
  })
  const listSupportRequests = () => $fetch<SupportRequest[]>(apiUrl('/api/support/requests'), { headers: resourceHeaders() })
  const createSupportRequest = (body: Record<string, unknown>) => $fetch<SupportRequest>(apiUrl('/api/support/requests'), { method: 'POST', body, headers: resourceHeaders() })
  const cancelSupportRequest = (id: string) => $fetch(apiUrl(`/api/support/requests/${encodeURIComponent(id)}`), { method: 'DELETE', headers: resourceHeaders() })
  const listSupportMessages = (id: string, since?: string) => $fetch<SupportMessage[]>(apiUrl(`/api/support/requests/${encodeURIComponent(id)}/messages${since ? `?since=${encodeURIComponent(since)}` : ''}`), { headers: resourceHeaders() })
  const getSupportUnread = (since?: string) => $fetch<{ total: number; byRequest: Array<{ requestId: string; total: number }> }>(apiUrl(`/api/support/unread${since ? `?since=${encodeURIComponent(since)}` : ''}`), { headers: resourceHeaders() })
  const sendSupportMessage = (id: string, body: string) => $fetch<{ requestId: string; createdNewProtocol: boolean; previousRequestId?: string | null }>(apiUrl(`/api/support/requests/${encodeURIComponent(id)}/messages`), { method: 'POST', body: { body }, headers: resourceHeaders() })
  const listSupportAttachments = (id: string) => $fetch<SupportAttachment[]>(apiUrl(`/api/support/requests/${encodeURIComponent(id)}/attachments`), { headers: resourceHeaders() })
  const uploadSupportAttachment = async (id: string, file: File) => {
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '').split(',').pop() || ''); reader.onerror = reject; reader.readAsDataURL(file) })
    return $fetch<SupportAttachment>(apiUrl(`/api/support/requests/${encodeURIComponent(id)}/attachments`), { method: 'POST', body: { fileName: file.name, mimeType: file.type, data }, headers: resourceHeaders() })
  }
  const downloadSupportAttachment = async (id: string, attachment: SupportAttachment) => {
    const response = await fetch(apiUrl(`/api/support/requests/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachment.id)}`), { credentials: 'include', headers: resourceHeaders() })
    if (!response.ok) throw new Error('Nao foi possivel baixar o anexo.')
    const link = document.createElement('a'); link.href = URL.createObjectURL(await response.blob()); link.download = attachment.originalName; link.click(); URL.revokeObjectURL(link.href)
  }

  const loadIntegrationsOverview = () => $fetch<IntegrationsOverview>(apiUrl('/api/integrations/overview'), {
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
    createProduct
    , uploadProductPrintFile, generateRecurringExpenses
    , createMarketplaceIntegration
    , advanceOrderStage
    , startMarketplaceOAuth
    , disconnectMarketplaceIntegration
    , refreshMarketplaceOrders, loadMarketplaceOrdersPage, loadOrdersPage, loadClientOrders, loadOrdersSummary
    , syncMarketplaceOrder
    , linkMarketplaceOrderProduct
    , updateSettings
    , lookupCompanyByCnpj
    , exportTenantData
    , getStripeBilling
    , createStripeCheckout, changeStripeSubscriptionPlan
    , cancelStripeSubscription
    , resumeStripeSubscription
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
    , createItem
    , updateItem
    , deleteItem
  }
}
