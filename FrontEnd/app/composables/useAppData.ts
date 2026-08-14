export type Order = {
  dbId?: string;
  id: string; date: string; client: string; marketplace: string; product: string; qty: number;
  gross: number; fee: number; shipping: number; net: number; profit: number; status: string
}

export type Product = {
  id?: string;
  name: string; subtitle: string; sku: string; category: string; price: number; weight: number;
  description?: string; printer?: string; layer?: number; infill?: number; dimensions?: string;
  packaging?: number; materials?: number; labor?: number; energy?: boolean; marketplaceFee?: number; desiredMargin?: number;
  time: string; filament: string; filamentColor: string; cost: number; profit: number; margin: number;
  status: string; thumb: string
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
  hours: number; status: string; maintenance: string; serial: string
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
  expenses: Expense[]
  filaments: Filament[]
  printers: Printer[]
  marketplaces: Marketplace[]
  marketplaceIntegrations?: MarketplaceIntegration[]
  clients: Client[]
  expenseSegments: ChartSegment[]
  goals?: Goal[]
  settings?: Record<string, unknown> | null
}

const emptyData = (): AppData => ({
  products: [],
  orders: [],
  expenses: [],
  filaments: [],
  printers: [],
  marketplaces: [],
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
        headers: { 'X-Tenant-Id': tenantId.value, ...auth.authHeaders.value }
      })
      goals.value = data.value.goals || []
      loaded.value = true
      loadedTenant.value = tenantId.value
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Nao foi possivel carregar os dados da API'
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

  const resourceHeaders = () => ({ 'X-Tenant-Id': tenantId.value, ...auth.authHeaders.value })
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

  const createProduct = async (product: Product) => {
    const created = await $fetch<Product>(apiUrl('/api/products'), {
      method: 'POST',
      body: product,
      headers: resourceHeaders()
    })
    data.value.products = [created, ...data.value.products.filter((item) => item.sku !== created.sku)]
    return created
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

  return {
    products: computed(() => data.value.products),
    orders: computed(() => data.value.orders),
    expenses: computed(() => data.value.expenses),
    filaments: computed(() => data.value.filaments),
    printers: computed(() => data.value.printers),
    marketplaces: computed(() => data.value.marketplaces),
    marketplaceIntegrations: computed(() => data.value.marketplaceIntegrations || []),
    clients: computed(() => data.value.clients),
    goals,
    expenseSegments: computed(() => data.value.expenseSegments),
    apiBase,
    tenantId,
    pending,
    error,
    refreshAppData: loadAppData,
    createProduct
    , createMarketplaceIntegration
    , createItem
    , updateItem
    , deleteItem
  }
}
