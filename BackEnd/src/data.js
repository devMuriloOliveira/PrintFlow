export const emptyData = () => ({
  products: [],
  orders: [],
  printJobs: [],
  expenses: [],
  filaments: [],
  printers: [],
  marketplaces: [],
  clients: [],
  expenseSegments: [],
  goals: [],
  settings: null
})

export const db = emptyData()

const tenantStores = new Map()

export const getTenantData = (tenantId) => {
  if (!tenantStores.has(tenantId)) {
    tenantStores.set(tenantId, emptyData())
  }

  return tenantStores.get(tenantId)
}
