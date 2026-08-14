export type Order = {
  id: string; date: string; client: string; marketplace: string; product: string; qty: number;
  gross: number; fee: number; shipping: number; net: number; profit: number; status: string
}

export type Product = {
  name: string; subtitle: string; sku: string; category: string; price: number; weight: number;
  time: string; filament: string; filamentColor: string; cost: number; profit: number; margin: number;
  status: string; thumb: string
}

export type Expense = {
  description: string; category: string; supplier: string; value: number; date: string;
  payment: string; recurrence: string; status: string
}

export type Filament = {
  name: string; maker: string; material: string; type: string; color: string; colorHex: string;
  initial: number; remaining: number; cost: number; supplier: string; date: string; status: string
}

export type Printer = {
  name: string; code: string; maker: string; model: string; acquired: string; power: number;
  hours: number; status: string; maintenance: string; serial: string
}

export type Marketplace = {
  name: string; short: string; color: string; commission: number; fixed: number; financial: number;
  ads: number; others: number; gross: number; net: number; orders: number; active: boolean
}

export type Client = {
  name: string; email: string; phone: string; orders: number; revenue: number; ticket: number; last: string
}

export type ChartSegment = {
  label: string; value: number; color: string
}

type AppData = {
  products: Product[]
  orders: Order[]
  expenses: Expense[]
  filaments: Filament[]
  printers: Printer[]
  marketplaces: Marketplace[]
  clients: Client[]
  expenseSegments: ChartSegment[]
  goals?: Array<{ name: string; current: number; target: number; color: string; icon: string; periodStart: string; periodEnd: string; status: string }>
  settings?: Record<string, unknown> | null
}

const emptyData = (): AppData => ({
  products: [],
  orders: [],
  expenses: [],
  filaments: [],
  printers: [],
  marketplaces: [],
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
  const tenantId = useTenantId()
  const data = useState<AppData>('app-data', emptyData)
  const pending = useState('app-data-pending', () => false)
  const error = useState<string | null>('app-data-error', () => null)

  const apiUrl = (path: string) => `${apiBase}${path}`

  const loadAppData = async () => {
    pending.value = true
    error.value = null
    try {
      data.value = await $fetch<AppData>(apiUrl('/api/app-data'), {
        headers: { 'X-Tenant-Id': tenantId.value }
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Nao foi possivel carregar os dados da API'
    } finally {
      pending.value = false
    }
  }

  if (process.client && !pending.value && data.value.products.length === 0 && !error.value) {
    void loadAppData()
  }

  const createProduct = async (product: Product) => {
    const created = await $fetch<Product>(apiUrl('/api/products'), {
      method: 'POST',
      body: product,
      headers: { 'X-Tenant-Id': tenantId.value }
    })
    data.value.products = [created, ...data.value.products.filter((item) => item.sku !== created.sku)]
    return created
  }

  return {
    products: computed(() => data.value.products),
    orders: computed(() => data.value.orders),
    expenses: computed(() => data.value.expenses),
    filaments: computed(() => data.value.filaments),
    printers: computed(() => data.value.printers),
    marketplaces: computed(() => data.value.marketplaces),
    clients: computed(() => data.value.clients),
    expenseSegments: computed(() => data.value.expenseSegments),
    apiBase,
    tenantId,
    pending,
    error,
    refreshAppData: loadAppData,
    createProduct
  }
}
