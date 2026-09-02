export const useBusinessMetrics = () => {
  const { products, orders, expenses, filaments, printers, marketplaces, clients, goals } = useAppData()

  const sum = <T>(items: T[], getter: (item: T) => number) => items.reduce((total, item) => total + getter(item), 0)
  const avg = (total: number, count: number) => count ? total / count : 0
  const percent = (value: number) => `${value.toFixed(1).replace('.', ',')}%`
  const parseProductHours = (time = '') => {
    const hours = Number(time.match(/(\d+(?:[.,]\d+)?)\s*h/i)?.[1]?.replace(',', '.') || 0)
    const minutes = Number(time.match(/(\d+(?:[.,]\d+)?)\s*m/i)?.[1]?.replace(',', '.') || 0)
    return hours + minutes / 60
  }
  const productForOrder = (order: any) => products.value.find((product) => product.id && product.id === order.productId) || products.value.find((product) => product.name === order.product)
  const soldRecipeRows = computed(() => orders.value.map((order) => ({ order, product: productForOrder(order) })).filter((row) => row.product))
  const filamentUsageById = computed(() => {
    const totals = new Map<string, number>()
    for (const { order, product } of soldRecipeRows.value) {
      if (!product?.filamentId) continue
      totals.set(product.filamentId, (totals.get(product.filamentId) || 0) + Number(product.weight || 0) * Number(order.qty || 0))
    }
    return totals
  })
  const printerUsageById = computed(() => {
    const totals = new Map<string, number>()
    for (const { order, product } of soldRecipeRows.value) {
      if (!product?.printerId) continue
      totals.set(product.printerId, (totals.get(product.printerId) || 0) + parseProductHours(product.time) * Number(order.qty || 0))
    }
    return totals
  })
  const orderRecipeCost = computed(() => sum(soldRecipeRows.value, ({ order, product }) => Number(product?.cost || 0) * Number(order.qty || 0)))

  const revenue = computed(() => sum(orders.value, (order) => order.gross))
  const netRevenue = computed(() => sum(orders.value, (order) => order.net))
  const profit = computed(() => sum(orders.value, (order) => order.profit))
  const fees = computed(() => sum(orders.value, (order) => order.fee))
  const shipping = computed(() => sum(orders.value, (order) => order.shipping))
  const manualExpenseTotal = computed(() => sum(expenses.value, (expense) => expense.value))
  const derivedExpenseTotal = computed(() => fees.value + shipping.value + orderRecipeCost.value)
  const expenseTotal = computed(() => manualExpenseTotal.value + derivedExpenseTotal.value)
  const orderCount = computed(() => orders.value.length)
  const ticket = computed(() => avg(revenue.value, orderCount.value))
  const margin = computed(() => revenue.value ? profit.value / revenue.value * 100 : 0)

  const activeProducts = computed(() => products.value.filter((product) => product.status === 'Ativo').length)
  const averagePrice = computed(() => avg(sum(products.value, (product) => product.price), products.value.length))
  const averageCost = computed(() => avg(sum(products.value, (product) => product.cost), products.value.length))
  const averageProductMargin = computed(() => avg(sum(products.value, (product) => product.margin), products.value.length))

  const recurringExpenses = computed(() => expenses.value.filter((expense) => !/nao|não/i.test(expense.recurrence)).reduce((total, expense) => total + expense.value, 0))
  const categoryTotals = computed(() => {
    const totals = new Map<string, number>()
    for (const expense of expenses.value) totals.set(expense.category, (totals.get(expense.category) || 0) + expense.value)
    return [...totals.entries()].sort((a, b) => b[1] - a[1])
  })
  const biggestExpenseCategory = computed(() => categoryTotals.value[0] || ['-', 0])

  const filamentStockCount = computed(() => filaments.value.filter((filament) => filament.status !== 'Esgotado').length)
  const filamentRemainingAfterSales = (filament: any) => Math.max(0, Number(filament.remaining || 0) - Number(filamentUsageById.value.get(String(filament.id)) || 0))
  const filamentStockCost = computed(() => sum(filaments.value, (filament) => filament.initial ? filament.cost * (filamentRemainingAfterSales(filament) / filament.initial) : 0))
  const filamentWeight = computed(() => sum(filaments.value, filamentRemainingAfterSales))
  const filamentAverageGramCost = computed(() => avg(sum(filaments.value, (filament) => filament.cost), sum(filaments.value, (filament) => filament.initial)))
  const filamentMaterialTotals = computed(() => {
    const totals = new Map<string, number>()
    for (const filament of filaments.value) totals.set(filament.material, (totals.get(filament.material) || 0) + filamentRemainingAfterSales(filament))
    return [...totals.entries()].sort((a, b) => b[1] - a[1])
  })
  const mostUsedMaterial = computed(() => filamentMaterialTotals.value[0]?.[0] || '-')
  const lowStockFilaments = computed(() => filaments.value.filter((filament) => filamentRemainingAfterSales(filament) < 300).length)

  const activePrinters = computed(() => printers.value.filter((printer) => /disponivel|impressao|impressão/i.test(printer.status)).length)
  const printingPrinters = computed(() => printers.value.filter((printer) => /impress/i.test(printer.status)).length)
  const maintenancePrinters = computed(() => printers.value.filter((printer) => /manutenc/i.test(printer.status)).length)
  const printerHours = computed(() => sum(printers.value, (printer) => Number(printer.hours || 0) + Number(printerUsageById.value.get(String(printer.id)) || 0)))

  const activeMarketplaces = computed(() => marketplaces.value.filter((marketplace) => marketplace.active).length)
  const marketplaceAverageFee = computed(() => avg(sum(marketplaces.value, (marketplace) => marketplace.commission + marketplace.financial + marketplace.ads + marketplace.others), marketplaces.value.length))
  const bestMarketplace = computed(() => [...marketplaces.value].sort((a, b) => b.net - a.net)[0])
  const highestFeeMarketplace = computed(() => [...marketplaces.value].sort((a, b) => (b.commission + b.financial + b.ads + b.others) - (a.commission + a.financial + a.ads + a.others))[0])

  const bestClient = computed(() => [...clients.value].sort((a, b) => b.revenue - a.revenue)[0])
  const clientTicket = computed(() => avg(sum(clients.value, (client) => client.revenue), sum(clients.value, (client) => client.orders)))

  const activeGoals = computed(() => goals.value.filter((goal) => goal.status !== 'Concluida').length)
  const goalsProgress = computed(() => avg(sum(goals.value, (goal) => goal.target ? Math.min(goal.current / goal.target * 100, 100) : 0), goals.value.length))
  const completedGoals = computed(() => goals.value.filter((goal) => goal.target > 0 && goal.current >= goal.target).length)
  const nextGoal = computed(() => [...goals.value].filter((goal) => goal.target > goal.current).sort((a, b) => (a.target - a.current) - (b.target - b.current))[0])

  return {
    revenue,
    netRevenue,
    profit,
    fees,
    shipping,
    expenseTotal,
    manualExpenseTotal,
    derivedExpenseTotal,
    orderCount,
    ticket,
    margin,
    activeProducts,
    averagePrice,
    averageCost,
    averageProductMargin,
    recurringExpenses,
    biggestExpenseCategory,
    filamentStockCount,
    filamentStockCost,
    filamentWeight,
    filamentAverageGramCost,
    filamentUsageById,
    mostUsedMaterial,
    lowStockFilaments,
    activePrinters,
    printingPrinters,
    maintenancePrinters,
    printerHours,
    printerUsageById,
    activeMarketplaces,
    marketplaceAverageFee,
    bestMarketplace,
    highestFeeMarketplace,
    bestClient,
    clientTicket,
    activeGoals,
    goalsProgress,
    completedGoals,
    nextGoal,
    percent
  }
}
