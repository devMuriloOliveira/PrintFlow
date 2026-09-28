<script setup lang="ts">
const { products, orders, printers, printJobs, clients, apiBase, createItem, updateItem, deleteItem, loadOrdersPage, loadOrdersSummary, advanceOrderStage: advanceOrderStageRequest } = useAppData()
const auth = useAuth()
const metrics = useBusinessMetrics()
const { notify } = useUi()
const router = useRouter()
const search = ref('')
const status = ref('Todos')
const marketplaceFilter = ref('Todos')
const productFilter = ref('Todos')
const operationalFilter = ref('Todos')
const selectedMetric = ref<'gross' | 'net' | 'profit' | 'orders' | 'cancelled'>('gross')
const chartPeriod = ref<'week' | 'month' | 'year'>('month')
const manualQuantities = reactive<Record<string, number>>({})
const savingProduct = reactive<Record<string, boolean>>({})
const manualClientId = ref('')
const assigningPrinter = reactive<Record<string, boolean>>({})
const selectedOrderId = ref('')
const orderStages = ['Novo', 'Producao', 'Impresso', 'Embalando', 'Enviado', 'Entregue']
const trackingDraft = ref('')
const updatingOrderStage = ref(false)
const orderAuditEvents = ref<any[]>([])
const orderAuditLoading = ref(false)
const orderAuditUnavailable = ref(false)
let orderAuditRequest = 0
const tableOrders = ref<any[]>([])
const tablePage = ref(0)
const tablePageSize = ref(25)
const tableTotal = ref(0)
const tableLoading = ref(false)
const ordersSummary = ref<{ orderCount: number; gross: number; net: number; profit: number; cancelledCount: number; cancelledGross: number } | null>(null)
let tableSearchTimer: ReturnType<typeof setTimeout> | null = null
const marketplaceOptions = computed(() => ['Todos', ...new Set(orders.value.map(order => order.marketplace || 'Sem marketplace'))])
const productOptions = computed(() => ['Todos', ...new Set(orders.value.map(order => order.product).filter(Boolean))])
const activeOrders = computed(() => orders.value.filter(order => order.status !== 'Cancelado'))
const cancelledOrders = computed(() => orders.value.filter(order => order.status === 'Cancelado'))
const hasOperationalIssue = (order: any, issue: string) => {
  if (issue === 'product') return !order.marketplaceOrder && (!order.productId || !products.value.some(product => String(product.id || '') === String(order.productId)))
  if (issue === 'printer') return !order.marketplaceOrder && order.status === 'Producao' && !printJobs.value.some((job: any) => String(job.orderId || '') === String(order.dbId || ''))
  if (issue === 'tracking') return !order.marketplaceOrder && order.status === 'Enviado' && !String(order.trackingCode || '').trim()
  return false
}
const filtered = computed(() => tableOrders.value.filter(o =>
  (marketplaceFilter.value === 'Todos' || (o.marketplace || 'Sem marketplace') === marketplaceFilter.value) &&
  (productFilter.value === 'Todos' || o.product === productFilter.value) &&
  (operationalFilter.value === 'Todos' || hasOperationalIssue(o, operationalFilter.value))
))
const loadTableOrders = async (reset = true) => {
  if (reset) tablePage.value = 0
  tableLoading.value = true
  try {
    const result = await loadOrdersPage({ limit: tablePageSize.value, offset: tablePage.value * tablePageSize.value, status: status.value === 'Todos' ? undefined : status.value, search: search.value.trim() || undefined })
    tableOrders.value = result.items
    tableTotal.value = result.total
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel carregar a pagina de vendas.')
  } finally { tableLoading.value = false }
}
const changeTablePage = (page: number) => { const maxPage = Math.max(0, Math.ceil(tableTotal.value / tablePageSize.value) - 1); tablePage.value = Math.min(Math.max(0, page), maxPage); void loadTableOrders(false) }
const loadSummary = async () => {
  try { ordersSummary.value = await loadOrdersSummary() } catch { /* fallback local permanece ativo */ }
}
onMounted(() => { void loadTableOrders(); void loadSummary() })
watch([search, status], () => { if (tableSearchTimer) clearTimeout(tableSearchTimer); tableSearchTimer = setTimeout(() => void loadTableOrders(), 250) })
const statusColors: Record<string, string> = { Novo: '#1768f2', Producao: '#f6b917', Impresso: '#b23bc1', Embalando: '#f57c1f', Enviado: '#2f77d5', Entregue: '#21aa91', Cancelado: '#ef4444' }
const metricCards = computed(() => [
  { key: 'gross' as const, label: 'Receita Bruta', value: formatCurrency(metrics.revenue.value), icon: 'money', note: 'Vendas ativas', color: 'green', points: activeOrders.value.map(order => Number(order.gross || 0)) },
  { key: 'net' as const, label: 'Receita Líquida', value: formatCurrency(metrics.netRevenue.value), icon: 'wallet', note: 'Vendas ativas', color: 'blue', points: activeOrders.value.map(order => Number(order.net || 0)) },
  { key: 'profit' as const, label: 'Lucro Total', value: formatCurrency(metrics.profit.value), icon: 'money', change: `Margem ${metrics.percent(metrics.margin.value)}`, color: 'green', points: activeOrders.value.map(order => Number(order.profit || 0)) },
  { key: 'orders' as const, label: 'Pedidos no Mês', value: formatNumber(metrics.orderCount.value), icon: 'bag', note: 'Pedidos ativos', color: 'purple', points: activeOrders.value.map(() => 1) },
  { key: 'cancelled' as const, label: 'Vendas canceladas', value: formatCurrency(metrics.cancelledGross.value), icon: 'close', note: `${formatNumber(metrics.cancelledOrderCount.value)} pedido(s)`, color: 'red', points: cancelledOrders.value.map(order => Number(order.gross || 0)) }
])
const metricCardsWithSummary = computed(() => {
  const cards = metricCards.value.map((card) => ({ ...card }))
  if (!ordersSummary.value) return cards
  cards[0].value = formatCurrency(ordersSummary.value.gross)
  cards[1].value = formatCurrency(ordersSummary.value.net)
  cards[2].value = formatCurrency(ordersSummary.value.profit)
  cards[3].value = formatNumber(ordersSummary.value.orderCount)
  cards[4].value = formatCurrency(ordersSummary.value.cancelledGross)
  cards[4].note = `${formatNumber(ordersSummary.value.cancelledCount)} pedido(s)`
  return cards
})
const metricDetails = {
  gross: { title: 'Evolução da Receita Bruta', color: '#0da566', totalLabel: 'Total no período', formatter: formatCurrency },
  net: { title: 'Evolução da Receita Líquida', color: '#1768f2', totalLabel: 'Total no período', formatter: formatCurrency },
  profit: { title: 'Evolução do Lucro Total', color: '#0da566', totalLabel: 'Total no período', formatter: formatCurrency },
  orders: { title: 'Quantidade de Pedidos', color: '#7c3aed', totalLabel: 'Pedidos no período', formatter: formatNumber },
  cancelled: { title: 'Vendas Canceladas', color: '#ef4444', totalLabel: 'Valor bruto cancelado', formatter: formatCurrency }
}
const badgeClass = (s: string) => ({ Novo: '', Producao: 'badge--orange', Impresso: 'badge--purple', Embalando: 'badge--orange', Enviado: '', Entregue: 'badge--green', Cancelado: 'badge--red' }[s] || '')
const parseOrderDate = (date: string) => {
  const normalized = date.includes('/') ? date.split('/').reverse().join('-') : date
  const parsed = new Date(`${normalized}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
const today = () => new Date().toISOString().slice(0, 10)
const dateToDisplay = (date: string) => date.split('-').reverse().join('/')
const productKey = (product: any) => String(product.id || product.sku || product.name)
const manualOrderId = (product: any, date = today()) => `MANUAL-${date}-${product.sku || product.id}`
const sameOrderDate = (orderDate: string, isoDate: string) => orderDate === isoDate || orderDate === dateToDisplay(isoDate)
const manualOrderFor = (product: any, date = today()) => orders.value.find(order =>
  order.id === manualOrderId(product, date) || (String(order.id || '').startsWith('MANUAL-') && sameOrderDate(order.date, date) && (order.productId === product.id || order.product === product.name))
)
const manualProductRows = computed(() => products.value.map(product => {
  const qty = Number(manualQuantities[productKey(product)] || 0)
  const gross = Number(product.price || 0) * qty
  const fee = gross * Number(product.marketplaceFee || 0) / 100
  const net = gross - fee
  const cost = Number(product.cost || 0) * qty
  return { product, qty, gross, fee, net, cost, profit: net - cost }
}))
const orderKey = (order: any) => String(order.dbId || order.id || '')
const printJobForOrder = (order: any) => printJobs.value.find((job: any) =>
  String(job.orderId || '') === String(order.dbId || '') ||
  (job.externalOrderId && String(job.externalOrderId) === String(order.id || ''))
)
const selectedOrder = computed(() => orders.value.find((order) => String(order.dbId || order.id) === selectedOrderId.value) || null)
const stageIndex = (order: any) => orderStages.indexOf(String(order?.status || 'Novo'))
const stageLabel = (stage: string) => ({ Producao: 'Produção' }[stage] || stage)
const selectOrder = (order: any) => { selectedOrderId.value = String(order.dbId || order.id || ''); trackingDraft.value = order.trackingCode || '' }
const selectedNextStage = computed(() => {
  const index = selectedOrder.value ? stageIndex(selectedOrder.value) : -1
  return index < 0 ? '' : orderStages[index + 1] || ''
})
const nextStageAction = (stage: string) => ({
  Producao: 'Iniciar produção', Impresso: 'Confirmar impressão', Embalando: 'Concluir embalagem',
  Enviado: 'Registrar envio', Entregue: 'Confirmar entrega'
}[stage] || `Avançar para ${stageLabel(stage)}`)
const canCancelSelectedOrder = computed(() => Boolean(selectedOrder.value && !selectedOrder.value.marketplaceOrder && ['Novo', 'Producao', 'Impresso', 'Embalando'].includes(selectedOrder.value.status)))
const selectedPrintJob = computed(() => selectedOrder.value ? printJobForOrder(selectedOrder.value) : null)
const selectedOrderChecklist = computed(() => {
  const order = selectedOrder.value
  if (!order) return []
  if (order.marketplaceOrder) return [{ label: 'Canal de venda', state: 'info', detail: 'Status e envio são sincronizados pelo marketplace.' }]
  const hasProduct = Boolean(order.productId && products.value.some(product => String(product.id || '') === String(order.productId)))
  const job = selectedPrintJob.value as any
  const queueState = job?.status === 'failed' || job?.status === 'cancelled' ? 'warning' : job ? 'ok' : order.status === 'Producao' ? 'warning' : 'info'
  const queueDetail = job ? `${job.printerName || 'Impressora não identificada'} · ${job.status}` : order.status === 'Producao' ? 'Pedido em produção sem trabalho vinculado à fila.' : 'Nenhum trabalho de impressão vinculado.'
  const trackingPresent = Boolean(String(trackingDraft.value || order.trackingCode || '').trim())
  const trackingState = selectedNextStage.value === 'Enviado' ? (trackingPresent ? 'ok' : 'warning') : (order.trackingCode ? 'ok' : 'info')
  return [
    { label: 'Produto e estoque', state: hasProduct ? 'ok' : 'warning', detail: hasProduct ? 'Produto interno vinculado; a baixa é feita no envio.' : 'Sem produto interno: o envio não poderá baixar estoque automaticamente.' },
    { label: 'Fila de impressão', state: queueState, detail: queueDetail },
    { label: 'Código de rastreio', state: trackingState, detail: selectedNextStage.value === 'Enviado' ? (trackingPresent ? 'Informado e pronto para registrar o envio.' : 'Obrigatório para registrar o envio.') : (order.trackingCode || 'Ainda não informado.') }
  ]
})
const orderHistory = computed(() => orderAuditEvents.value
  .filter(event => event.action === 'orders.stage_advanced' && event.details?.toStatus)
  .map(event => ({
    id: event.id,
    label: `${stageLabel(String(event.details.toStatus))}${event.details.fromStatus ? ` (de ${stageLabel(String(event.details.fromStatus))})` : ''}`,
    at: event.createdAt
  })))
const formatOrderHistoryDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}
const loadOrderHistory = async (order: any) => {
  const request = ++orderAuditRequest
  orderAuditEvents.value = []
  orderAuditUnavailable.value = false
  if (!order || order.marketplaceOrder) { orderAuditLoading.value = false; return }
  orderAuditLoading.value = true
  try {
    const events = await $fetch<any[]>(`${apiBase}/api/operational-audit-events`, {
      query: { limit: 100, entityType: 'orders', entityId: String(order.dbId || order.id) },
      headers: auth.authHeaders.value
    })
    if (request === orderAuditRequest) orderAuditEvents.value = events
  } catch {
    if (request === orderAuditRequest) orderAuditUnavailable.value = true
  } finally {
    if (request === orderAuditRequest) orderAuditLoading.value = false
  }
}
watch(selectedOrder, (order) => {
  trackingDraft.value = order?.trackingCode || ''
  void loadOrderHistory(order)
}, { immediate: true })
const advanceOrderStage = async (stage: string) => {
  const order = selectedOrder.value
  if (!order || updatingOrderStage.value) return
  if (order.marketplaceOrder) return notify('Pedidos do marketplace devem ser gerenciados na tela Marketplaces.')
  const current = stageIndex(order); const target = orderStages.indexOf(stage)
  if (target !== current + 1) return notify('Avance o pedido uma etapa por vez.')
  if (stage === 'Enviado' && !trackingDraft.value.trim()) return notify('Informe o codigo de rastreio antes de enviar.')
  updatingOrderStage.value = true
  try {
    await advanceOrderStageRequest(String(order.dbId || order.id), stage, trackingDraft.value.trim())
    notify(`Pedido atualizado para ${stageLabel(stage)}.`)
    void loadTableOrders(false)
    void loadSummary()
  } catch (error: any) { notify(error?.data?.error || error?.message || 'Nao foi possivel atualizar o pedido.') } finally { updatingOrderStage.value = false }
}
const cancelSelectedOrder = async () => {
  const order = selectedOrder.value
  if (!order || !canCancelSelectedOrder.value || updatingOrderStage.value) return
  const confirmed = window.confirm(`Cancelar o pedido ${order.id}?\n\nAs reservas de produção vinculadas serão liberadas. Esta etapa não permite avanço posterior.`)
  if (!confirmed) return
  updatingOrderStage.value = true
  try {
    await advanceOrderStageRequest(String(order.dbId || order.id), 'Cancelado')
    notify('Pedido cancelado. As reservas vinculadas foram liberadas.')
    void loadTableOrders(false)
    void loadSummary()
  } catch (error: any) { notify(error?.data?.error || error?.message || 'Nao foi possivel cancelar o pedido.') } finally { updatingOrderStage.value = false }
}
const printerQueue = (printerId: string) => printJobs.value.filter((job: any) =>
  String(job.printerId || '') === String(printerId || '') &&
  ['queued', 'printing', 'paused'].includes(String(job.status || ''))
)
const printerBusyLabel = (printerId: string) => {
  if (!printerId) return ''
  const active = printerQueue(printerId)
  const printing = active.find((job: any) => job.status === 'printing')
  if (printing) return 'Ocupada'
  if (active.length) return `${active.length} na fila`
  return 'Livre'
}
const assignOrderPrinter = async (order: any, printerId: string) => {
  if (order.marketplaceOrder) return notify('Vincule o pedido na tela Marketplaces antes de enviar para a fila.')
  const key = orderKey(order)
  if (!key || assigningPrinter[key]) return
  assigningPrinter[key] = true
  try {
    const printer = printers.value.find((item: any) => String(item.id) === String(printerId))
    const currentJob = printJobForOrder(order) as any
    const product = products.value.find((item: any) => String(item.id || '') === String(order.productId || ''))
    if (!printerId) {
      if (currentJob?.id) await deleteItem('printJobs' as any, currentJob.id)
      notify('Pedido removido da fila de impressão.')
      return
    }
    const payload = {
      id: currentJob?.id,
      orderId: order.dbId,
      productId: order.productId || product?.id || '',
      printerId,
      agentPrinterId: (printer as any)?.agentPrinterId || '',
      source: order.salesChannel === 'direct' || order.marketplace === 'Manual' ? 'manual' : 'marketplace',
      title: order.product || product?.name || `Pedido ${order.id}`,
      productName: order.product || product?.name || '',
      quantity: Number(order.qty || 1),
      priority: 0,
      status: currentJob?.status || 'queued',
      notes: `Pedido ${order.id}`
    }
    if (currentJob?.id) await updateItem('printJobs' as any, payload)
    else await createItem('printJobs' as any, payload)
    notify(`Pedido enviado para ${printer?.name || 'a impressora'}.`)
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível atualizar a fila de impressão.', 'info')
  } finally {
    assigningPrinter[key] = false
  }
}
const syncManualQuantities = () => {
  const currentDate = today()
  for (const product of products.value) {
    const key = productKey(product)
    if (savingProduct[key]) continue
    manualQuantities[key] = Number(manualOrderFor(product, currentDate)?.qty || 0)
  }
}
watchEffect(syncManualQuantities)
const saveManualQuantity = async (product: any, rawQty: number) => {
  const key = productKey(product)
  if (savingProduct[key]) return
  const qty = Math.max(0, Math.floor(Number(rawQty || 0)))
  manualQuantities[key] = qty
  savingProduct[key] = true
  try {
    const date = today()
    const existing = manualOrderFor(product, date)
    if (!qty) {
      if (existing?.dbId || existing?.id) await deleteItem('orders', existing.dbId || existing.id)
      notify('Registro de venda atualizado.')
      await loadTableOrders(false)
      return
    }

    const gross = Number(product.price || 0) * qty
    const fee = gross * Number(product.marketplaceFee || 0) / 100
    const net = gross - fee
    const cost = Number(product.cost || 0) * qty
    const payload = {
      id: manualOrderId(product, date),
      dbId: existing?.dbId,
      productId: product.id,
      date,
      clientId: manualClientId.value || undefined,
      client: clients.value.find(client => client.id === manualClientId.value)?.name || 'Venda manual',
      marketplace: '',
      salesChannel: 'direct',
      product: product.name,
      qty,
      gross,
      fee,
      shipping: 0,
      net,
      profit: net - cost,
      status: 'Entregue'
    }
    if (existing?.dbId) await updateItem('orders', payload)
    else await createItem('orders', payload)
    notify('Venda por produto salva.')
    await loadTableOrders(false)
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível salvar a venda manual.', 'info')
    syncManualQuantities()
  } finally {
    savingProduct[key] = false
  }
}
const adjustManualQuantity = (product: any, delta: number) => {
  const current = Number(manualQuantities[productKey(product)] || 0)
  void saveManualQuantity(product, current + delta)
}
const dateKey = (date: Date) => {
  if (chartPeriod.value === 'week') return date.toISOString().slice(0, 10)
  if (chartPeriod.value === 'year') return String(date.getFullYear())
  return date.toISOString().slice(0, 7)
}
const formatChartLabel = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  if (chartPeriod.value === 'year') return key
  if (chartPeriod.value === 'week') return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`
  return `${String(month).padStart(2, '0')}/${year}`
}
const selectedDetail = computed(() => metricDetails[selectedMetric.value])
const detailedChart = computed(() => {
  const totals = new Map<string, number>()
  for (const order of orders.value) {
    const isCancelled = order.status === 'Cancelado'
    if (isCancelled !== (selectedMetric.value === 'cancelled')) continue
    const date = parseOrderDate(order.date)
    if (!date) continue
    const key = dateKey(date)
    const value = selectedMetric.value === 'orders' ? 1 : selectedMetric.value === 'cancelled' ? Number(order.gross || 0) : Number(order[selectedMetric.value] || 0)
    totals.set(key, (totals.get(key) || 0) + value)
  }

  const rows = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))
  const values = rows.map(([, value]) => value)
  return {
    labels: rows.map(([key]) => formatChartLabel(key)),
    values: values.length ? values : [0, 0],
    total: values.reduce((total, value) => total + value, 0)
  }
})
const editOrder = (order: any) => {
  const id = order.dbId || order.id
  if (!id) return
  router.push(`/vendas/novo?id=${id}`)
}
const removeOrder = async (order: any) => {
  const id = order.dbId || order.id
  if (!id || !window.confirm(`Tem certeza que deseja excluir este pedido?\n\n${order.id} - ${order.product}\n\nEsta ação não poderá ser desfeita.`)) return
  await deleteItem('orders', id)
  await loadTableOrders(false)
  notify('Pedido excluído com sucesso.')
}
const statusSegments = computed(() => {
  const totals = new Map<string, number>()
  for (const order of orders.value) totals.set(order.status || 'Sem status', (totals.get(order.status || 'Sem status') || 0) + 1)
  return [...totals.entries()].map(([label, count]) => ({ label, value: metrics.orderCount.value ? count / metrics.orderCount.value * 100 : 0, color: statusColors[label] || '#7d8799' }))
})
const marketplaceBars = computed(() => {
  const colors = ['#1768f2', '#0da566', '#f59e0b', '#c83bb7', '#29b6c8', '#7d8799']
  const totals = new Map<string, number>()
  for (const order of activeOrders.value) totals.set(order.marketplace || 'Sem marketplace', (totals.get(order.marketplace || 'Sem marketplace') || 0) + order.gross)
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const max = rows[0]?.[1] || 0
  return rows.map(([label, value], i) => ({ label, value, percent: max ? value / max * 100 : 0, color: colors[i % colors.length] }))
})
</script>
<template>
  <div>
    <PageHeader title="Vendas" subtitle="Gerencie seus pedidos e acompanhe o desempenho das suas vendas."><NuxtLink class="btn btn--primary" to="/vendas/novo"><UiIcon name="plus"/>Nova Venda</NuxtLink></PageHeader>
    <div class="metrics-grid metrics-grid--5 sales-metrics">
      <MetricCard
        v-for="card in metricCardsWithSummary"
        :key="card.key"
        :label="card.label"
        :value="card.value"
        :icon="card.icon"
        :note="card.note"
        :change="card.change"
        :color="card.color"
        :points="card.points"
        :selected="selectedMetric === card.key"
        interactive
        @click="selectedMetric = card.key"
      />
    </div>
    <PanelCard class="sales-chart-panel" :title="selectedDetail.title" :subtitle="`${selectedDetail.totalLabel}: ${selectedDetail.formatter(detailedChart.total)}`">
      <template #actions>
        <div class="segmented-control" aria-label="Período do gráfico">
          <button type="button" :class="{ active: chartPeriod === 'week' }" @click="chartPeriod = 'week'">Semana</button>
          <button type="button" :class="{ active: chartPeriod === 'month' }" @click="chartPeriod = 'month'">Mês</button>
          <button type="button" :class="{ active: chartPeriod === 'year' }" @click="chartPeriod = 'year'">Ano</button>
        </div>
      </template>
      <LineChart :values="detailedChart.values" :labels="detailedChart.labels" :color="selectedDetail.color" />
    </PanelCard>
    <PanelCard title="Registrar vendas por produto" subtitle="Informe rapidamente as unidades vendidas hoje para cada produto cadastrado.">
      <div class="field" style="max-width:520px;margin-bottom:16px"><label>Cliente da venda direta</label><select v-model="manualClientId"><option value="">Venda avulsa / cliente não cadastrado</option><option v-for="client in clients.filter(c => c.status !== 'inactive')" :key="client.id" :value="client.id">{{ client.name }}{{ client.phone ? ` · ${client.phone}` : '' }}</option></select><small>Use um cliente para vincular histórico e ticket da venda P2P.</small></div>
      <div v-if="!products.length" class="empty-state">
        <div><div class="empty-state__icon"><UiIcon name="box"/></div><h3>Nenhum produto cadastrado.</h3><p>Cadastre seu primeiro produto para registrar vendas por quantidade.</p><NuxtLink class="btn btn--primary" to="/produtos/novo">Cadastrar Produto</NuxtLink></div>
      </div>
      <div v-else class="manual-sales-list">
        <div v-for="row in manualProductRows" :key="productKey(row.product)" class="manual-sales-row">
          <div class="manual-sales-product">
            <ProductThumb :type="row.product.thumb" :size="42"/>
            <div><strong>{{ row.product.name }}</strong><small>SKU: {{ row.product.sku || '-' }} · {{ formatCurrency(row.product.price) }}</small></div>
          </div>
          <div class="manual-sales-meta">
            <span>Qtd. vendida hoje</span>
            <strong>{{ formatCurrency(row.gross) }}</strong>
          </div>
          <div class="quantity-stepper" :aria-label="`Quantidade vendida de ${row.product.name}`">
            <button type="button" :disabled="savingProduct[productKey(row.product)] || row.qty <= 0" @click="adjustManualQuantity(row.product, -1)">-</button>
            <input :value="row.qty" type="number" min="0" :disabled="savingProduct[productKey(row.product)]" @change="saveManualQuantity(row.product, Number(($event.target as HTMLInputElement).value))">
            <button type="button" :disabled="savingProduct[productKey(row.product)]" @click="adjustManualQuantity(row.product, 1)">+</button>
          </div>
          <span class="manual-sales-status">{{ savingProduct[productKey(row.product)] ? 'Salvando...' : 'Salvo' }}</span>
        </div>
      </div>
    </PanelCard>
    <div class="filters">
      <div class="field"><label>Acompanhar pedido</label><select v-model="selectedOrderId"><option value="">Selecione um pedido</option><option v-for="order in orders" :key="order.dbId || order.id" :value="String(order.dbId || order.id)">{{order.id}} · {{order.product}}</option></select></div>
      <div class="field field--search"><label>Buscar</label><div class="search-field"><UiIcon name="search" :size="16"/><input v-model="search" placeholder="Pedido, cliente ou produto"></div></div>
      <div class="field"><label>Marketplace</label><select v-model="marketplaceFilter"><option v-for="item in marketplaceOptions" :key="item">{{item}}</option></select></div>
      <div class="field"><label>Status</label><select v-model="status"><option>Todos</option><option>Novo</option><option>Producao</option><option>Impresso</option><option>Embalando</option><option>Enviado</option><option>Entregue</option><option>Cancelado</option></select></div>
      <div class="field"><label>Produto</label><select v-model="productFilter"><option v-for="item in productOptions" :key="item">{{item}}</option></select></div>
      <div class="field"><label>Pendências operacionais</label><select v-model="operationalFilter"><option value="Todos">Todas</option><option value="product">Sem produto vinculado</option><option value="printer">Produção sem fila</option><option value="tracking">Envio sem rastreio</option></select></div>
      <button class="btn" @click="search='';status='Todos';marketplaceFilter='Todos';productFilter='Todos';operationalFilter='Todos'"><UiIcon name="close" :size="16"/> Limpar filtros</button>
    </div>
    <div class="split-layout">
      <PanelCard title="Pedidos">
        <div class="table-scroll"><table class="data-table">
          <thead><tr><th>Nº Pedido</th><th>Data</th><th>Cliente</th><th>Marketplace</th><th>Produto</th><th>Qtd.</th><th>Impressora</th><th>Valor Bruto</th><th>Taxa</th><th>Frete</th><th>Receita Líquida</th><th>Lucro</th><th>Status</th><th></th></tr></thead>
          <tbody><tr v-if="!filtered.length"><td colspan="14"><div class="empty-state"><div><div class="empty-state__icon"><UiIcon name="bag"/></div><h3>Nenhum pedido encontrado</h3><p>Ajuste os filtros ou cadastre uma nova venda.</p><NuxtLink class="btn btn--primary" to="/vendas/novo">Nova Venda</NuxtLink></div></div></td></tr><tr v-for="o in filtered" :key="o.dbId || o.id"><td><div class="table-product table-product--editable"><strong>{{ o.id }}</strong><button v-if="!o.marketplaceOrder" class="row-action row-action--edit" title="Editar pedido" @click.stop="editOrder(o)"><UiIcon name="edit" :size="15"/></button><span v-else class="badge badge--gray" title="Pedido sincronizado automaticamente">ML</span><button class="order-open-link" @click.stop="selectOrder(o)">Acompanhar</button></div></td><td>{{ o.date }}</td><td>{{ o.client }}</td><td>{{ o.marketplace }}</td><td>{{ o.product }}</td><td>{{ o.qty }}</td><td><select class="select-compact" :disabled="o.marketplaceOrder || assigningPrinter[orderKey(o)]" :value="printJobForOrder(o)?.printerId || ''" @change="assignOrderPrinter(o, ($event.target as HTMLSelectElement).value)"><option value="">{{ o.marketplaceOrder ? 'Gerenciar no canal' : 'Fila' }}</option><option v-for="printer in printers" :key="printer.id" :value="printer.id">{{ printer.name }} - {{ printerBusyLabel(printer.id || '') }}</option></select><small v-if="printJobForOrder(o)" style="display:block;margin-top:4px;color:var(--muted)">{{ printJobForOrder(o)?.status }} · {{ printJobForOrder(o)?.printerName || 'Sem impressora' }}</small></td><td>{{ formatCurrency(o.gross) }}</td><td>{{ formatCurrency(o.fee) }}</td><td>{{ formatCurrency(o.shipping) }}</td><td>{{ formatCurrency(o.net) }}</td><td>{{ formatCurrency(o.profit) }}</td><td><span class="badge" :class="badgeClass(o.status)">{{ o.status }}</span></td><td><button v-if="!o.marketplaceOrder" class="row-action" title="Excluir pedido" @click.stop="removeOrder(o)"><UiIcon name="close" :size="16"/></button></td></tr></tbody>
        </table></div>
        <div class="table-footer"><span>{{ tableLoading ? 'Carregando vendas...' : `Mostrando ${filtered.length ? tablePage * tablePageSize + 1 : 0} a ${tablePage * tablePageSize + filtered.length} de ${tableTotal} pedidos` }}</span><div class="pagination"><button class="page-btn" :disabled="tablePage === 0 || tableLoading" @click="changeTablePage(tablePage - 1)">Anterior</button><button class="page-btn" :disabled="(tablePage + 1) * tablePageSize >= tableTotal || tableLoading" @click="changeTablePage(tablePage + 1)">Próxima</button></div><select v-model.number="tablePageSize" class="select-compact" @change="loadTableOrders()"><option :value="25">25 por página</option><option :value="50">50 por página</option><option :value="100">100 por página</option></select></div>
      </PanelCard>
      <aside>
        <PanelCard v-if="selectedOrder" title="Acompanhamento do pedido" subtitle="Confira as pendências, avance a operação e consulte o histórico.">
          <div class="order-tracking-head"><div><strong>{{selectedOrder.id}}</strong><span class="order-channel">{{ selectedOrder.marketplaceOrder ? `Marketplace · ${selectedOrder.marketplace}` : 'Venda direta' }}</span></div><span class="badge" :class="badgeClass(selectedOrder.status)">{{stageLabel(selectedOrder.status)}}</span></div>
          <div v-if="selectedOrder.marketplaceOrder" class="order-channel-notice"><p>Este pedido é sincronizado pelo canal. Atualize status, rastreio e envio na área de pedidos do marketplace.</p><NuxtLink class="btn btn--compact" to="/marketplaces?secao=pedidos">Abrir pedidos do marketplace</NuxtLink></div>
          <div v-if="selectedOrder.status === 'Cancelado'" class="order-cancelled-notice">Pedido cancelado. As reservas de produção vinculadas foram liberadas.</div>
          <div class="order-timeline"><div v-for="(stage, index) in orderStages" :key="stage" class="order-step" :class="{done: index <= stageIndex(selectedOrder), current: stage === selectedOrder.status}"><span>{{index < stageIndex(selectedOrder) ? '✓' : index + 1}}</span><strong>{{stageLabel(stage)}}</strong></div></div>
          <div v-if="!selectedOrder.marketplaceOrder" class="order-next-action">
            <div><small>PRÓXIMA AÇÃO</small><strong>{{ selectedNextStage ? nextStageAction(selectedNextStage) : selectedOrder.status === 'Cancelado' ? 'Pedido cancelado' : 'Fluxo concluído' }}</strong><p v-if="selectedNextStage === 'Enviado'">Informe o código de rastreio para confirmar o envio.</p></div>
            <button v-if="selectedNextStage" class="btn btn--primary" :disabled="updatingOrderStage || (selectedNextStage === 'Enviado' && !trackingDraft.trim())" @click="advanceOrderStage(selectedNextStage)">{{ updatingOrderStage ? 'Atualizando…' : nextStageAction(selectedNextStage) }}</button>
          </div>
          <div v-if="!selectedOrder.marketplaceOrder" class="order-readiness"><div v-for="item in selectedOrderChecklist" :key="item.label" class="order-readiness__item" :class="`order-readiness__item--${item.state}`"><span>{{ item.state === 'ok' ? '✓' : item.state === 'warning' ? '!' : 'i' }}</span><div><strong>{{item.label}}</strong><small>{{item.detail}}</small></div></div></div>
          <div v-if="!selectedOrder.marketplaceOrder" class="order-queue-control"><label for="order-printer">Fila de impressão</label><select id="order-printer" class="select-compact" :disabled="assigningPrinter[orderKey(selectedOrder)]" :value="selectedPrintJob?.printerId || ''" @change="assignOrderPrinter(selectedOrder, ($event.target as HTMLSelectElement).value)"><option value="">Sem impressora vinculada</option><option v-for="printer in printers" :key="printer.id" :value="printer.id">{{ printer.name }} · {{ printerBusyLabel(printer.id || '') }}</option></select><small>A atribuição cria ou atualiza o trabalho na fila.</small></div>
          <div v-if="selectedOrder.status === 'Impresso' || selectedOrder.status === 'Embalando' || selectedOrder.status === 'Enviado'" class="field order-tracking-field"><label for="order-tracking">Código de rastreio</label><input id="order-tracking" v-model="trackingDraft" maxlength="180" :placeholder="selectedNextStage === 'Enviado' ? 'Obrigatório para registrar o envio' : 'Código de rastreio'"><small v-if="selectedNextStage === 'Enviado' && !trackingDraft.trim()" class="field__hint">O pedido não avança para enviado sem esse código.</small></div>
          <button v-if="canCancelSelectedOrder" class="btn btn--danger order-cancel-button" :disabled="updatingOrderStage" @click="cancelSelectedOrder">Cancelar pedido</button>
          <section v-if="!selectedOrder.marketplaceOrder" class="order-history"><h3>Histórico do pedido</h3><p v-if="orderAuditLoading" class="order-history__empty">Carregando histórico…</p><p v-else-if="orderAuditUnavailable" class="order-history__empty">Histórico indisponível no momento. As ações do pedido continuam funcionando.</p><p v-else-if="!orderHistory.length" class="order-history__empty">Nenhuma mudança de etapa registrada.</p><ol v-else><li v-for="event in orderHistory" :key="event.id"><span>{{event.label}}</span><time>{{formatOrderHistoryDate(event.at)}}</time></li></ol></section>
        </PanelCard>
        <PanelCard title="Vendas por Status"><DonutChart :segments="statusSegments" :total="formatNumber(metrics.orderCount.value)" caption="Pedidos" /></PanelCard>
        <PanelCard title="Vendas por Marketplace" style="margin-top:12px">
          <div class="bar-list"><div v-if="!marketplaceBars.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="store"/></div><h3>Nenhuma venda por marketplace</h3><p>Cadastre vendas para preencher este gráfico.</p></div></div><div v-for="bar in marketplaceBars" :key="bar.label" class="bar-row"><span>{{bar.label}}</span><div class="bar-row__track"><div class="bar-row__fill" :style="{width:`${bar.percent}%`,background:bar.color}"/></div><strong>{{ formatCurrency(bar.value) }}</strong></div></div>
        </PanelCard>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.order-tracking-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.order-timeline { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; margin-bottom: 16px; }
.order-step { min-width: 0; text-align: center; color: var(--muted); font-size: 9px; }
.order-step span { display: grid; place-items: center; width: 25px; height: 25px; margin: 0 auto 5px; border: 1px solid var(--line); border-radius: 50%; background: #fff; }
.order-step strong { display: block; overflow-wrap: anywhere; }
.order-step.done { color: var(--green, #0da566); }
.order-step.done span { border-color: #0da566; background: #eafaf3; }
.order-step.current strong { color: var(--ink); }
.tracking-actions { margin-top: 12px; }
.order-tracking-head > div { display: grid; gap: 4px; }
.order-channel { color: var(--muted); font-size: 10px; }
.order-channel-notice, .order-cancelled-notice { display: grid; gap: 10px; margin: 0 0 14px; border: 1px solid #d9e6f7; border-radius: 9px; background: #f6f9ff; padding: 12px; }
.order-channel-notice p { margin: 0; color: #45536a; font-size: 11px; line-height: 1.5; }
.order-cancelled-notice { display: block; border-color: #ffd5d5; color: #a6262f; background: #fff5f5; font-size: 11px; }
.order-next-action { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 14px; border: 1px solid #dce7f6; border-radius: 9px; background: #f8fbff; padding: 12px; }
.order-next-action > div { min-width: 0; }
.order-next-action small, .order-next-action strong { display: block; }
.order-next-action small { color: var(--blue); font-size: 9px; font-weight: 800; letter-spacing: .07em; }
.order-next-action strong { margin-top: 4px; color: #172033; font-size: 12px; }
.order-next-action p { margin: 4px 0 0; color: #9a6400; font-size: 10px; }
.order-next-action .btn { flex: 0 0 auto; }
.order-readiness { display: grid; gap: 8px; margin: 0 0 14px; }
.order-readiness__item { display: grid; grid-template-columns: 20px 1fr; align-items: start; gap: 8px; }
.order-readiness__item > span { display: grid; width: 19px; height: 19px; place-items: center; border-radius: 50%; color: #536176; background: #edf1f6; font-size: 11px; font-weight: 800; }
.order-readiness__item--ok > span { color: #087b54; background: #e5f7ef; }
.order-readiness__item--warning > span { color: #9a6400; background: #fff1cf; }
.order-readiness__item strong, .order-readiness__item small { display: block; }
.order-readiness__item strong { color: #29364a; font-size: 10px; }
.order-readiness__item small { margin-top: 2px; color: var(--muted); font-size: 9px; line-height: 1.4; }
.order-queue-control { display: grid; gap: 5px; margin: 0 0 12px; }
.order-queue-control label { color: #273449; font-size: 10px; font-weight: 700; }
.order-queue-control small { color: var(--muted); font-size: 9px; }
.order-tracking-field { margin: 12px 0 0; }
.order-cancel-button { width: 100%; margin-top: 12px; }
.order-history { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 13px; }
.order-history h3 { margin: 0 0 9px; color: #273449; font-size: 11px; }
.order-history ol { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.order-history li { display: flex; justify-content: space-between; gap: 10px; color: #344258; font-size: 10px; }
.order-history time { color: var(--muted); white-space: nowrap; }
.order-history__empty { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.5; }
.order-open-link { border: 0; color: var(--blue); background: transparent; padding: 0; font-size: 9px; font-weight: 700; cursor: pointer; }
.order-open-link:hover { text-decoration: underline; }
@media (max-width: 800px) { .order-timeline { grid-template-columns: repeat(3, 1fr); row-gap: 12px; } }
@media (max-width: 540px) { .order-next-action { align-items: stretch; flex-direction: column; } .order-next-action .btn { width: 100%; } .order-history li { align-items: flex-start; flex-direction: column; gap: 2px; } }
</style>
