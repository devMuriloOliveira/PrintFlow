export type Order = {
  dbId?: string;
  id: string; productId?: string; date: string; client: string; marketplace: string; product: string; qty: number;
  gross: number; fee: number; shipping: number; net: number; profit: number; status: string
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
  payment: string; recurrence: string; status: string
}

export type Filament = {
  id?: string;
  name: string; maker: string; material: string; type: string; color: string; colorHex: string;
  initial: number; remaining: number; cost: number; supplier: string; date: string; status: string
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
  ads: number; others: number; gross: number; net: number; orders: number; active: boolean;
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
  lastSyncAt?: string | null
}

export type MarketplaceOrder = {
  id: string;
  integrationId?: string; marketplaceId?: string; platform: string; externalOrderId: string; externalSku: string;
  productName: string; quantity: number; gross: number; marketplaceFee: number; shipping: number; net: number; profit: number;
  status: string; soldAt?: string | null; printJobId?: string; printJobStatus?: string;
  mappedProductId?: string; mappedProductName?: string; suggestedProductId?: string; suggestedProductName?: string
}

export type Client = {
  id?: string;
  name: string; email: string; phone: string; orders: number; revenue: number; ticket: number; last: string
}

export type ChartSegment = {
  label: string; value: number; color: string
}

export type Goal = {
  id?: string;
  name: string; current: number; target: number; color: string; icon: string;
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

export const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
export const formatNumber = (value: number) => new Intl.NumberFormat('pt-BR').format(value)

export const useAppData = () => {
  const config = useRuntimeConfig()
  const apiBase = String(config.public.apiBase || '').replace(/\/$/, '')
  const auth = useAuth()
  const tenantId = useTenantId()
  const data = useState<AppData>('app-data', emptyData)
  const pending = useState('app-data-pending', () => false)
  const loaded = useState('app-data-loaded', () => false)
  const loadedTenant = useState('app-data-loaded-tenant', () => '')
  const error = useState<string | null>('app-data-error', () => null)
  const goals = useState<Goal[]>('goals', () => [])

  const apiUrl = (path: string) => `${apiBase}${path}`

  const loadAppData = async () => {
    pending.value = true
    error.value = null
    try {
      data.value = await $fetch<AppData>(apiUrl('/api/app-data'), {
        headers: auth.authHeaders.value
      })
      goals.value = data.value.goals || []
      loaded.value = true
      loadedTenant.value = tenantId.value
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Não foi possível carregar os dados da API'
    } finally {
      pending.value = false
    }
  }

  if (process.client && loadedTenant.value && loadedTenant.value !== tenantId.value) {
    data.value = emptyData()
    goals.value = []
    loaded.value = false
    loadedTenant.value = ''
  }

  if (process.client && !loaded.value && !pending.value && !error.value) {
    void loadAppData()
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

  const refreshMarketplaceOrders = async () => {
    const list = await $fetch<MarketplaceOrder[]>(apiUrl('/api/marketplace-orders'), {
      headers: resourceHeaders()
    })
    data.value.marketplaceOrders = list
    return list
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
    await loadAppData()
    return list
  }

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
    , uploadProductPrintFile
    , createMarketplaceIntegration
    , startMarketplaceOAuth
    , refreshMarketplaceOrders
    , linkMarketplaceOrderProduct
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
