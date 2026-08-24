<script setup lang="ts">
const { products, orders, printers, printJobs, createItem, updateItem, deleteItem } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()
const router = useRouter()
const search = ref('')
const status = ref('Todos')
const selectedMetric = ref<'gross' | 'net' | 'profit' | 'orders'>('gross')
const chartPeriod = ref<'week' | 'month' | 'year'>('month')
const manualQuantities = reactive<Record<string, number>>({})
const savingProduct = reactive<Record<string, boolean>>({})
const assigningPrinter = reactive<Record<string, boolean>>({})
const filtered = computed(() => orders.value.filter(o => (status.value === 'Todos' || o.status === status.value) && Object.values(o).join(' ').toLowerCase().includes(search.value.toLowerCase())))
const statusColors: Record<string, string> = { Novo: '#1768f2', Producao: '#f6b917', Impresso: '#b23bc1', Embalando: '#f57c1f', Enviado: '#2f77d5', Entregue: '#21aa91', Cancelado: '#ef4444' }
const metricCards = computed(() => [
  { key: 'gross' as const, label: 'Receita Bruta', value: formatCurrency(metrics.revenue.value), icon: 'money', note: 'Dados do banco', color: 'green' },
  { key: 'net' as const, label: 'Receita Liquida', value: formatCurrency(metrics.netRevenue.value), icon: 'wallet', note: 'Dados do banco', color: 'blue' },
  { key: 'profit' as const, label: 'Lucro Total', value: formatCurrency(metrics.profit.value), icon: 'money', change: `Margem ${metrics.percent(metrics.margin.value)}`, color: 'green' },
  { key: 'orders' as const, label: 'Pedidos no Mes', value: formatNumber(metrics.orderCount.value), icon: 'bag', note: 'Dados do banco', color: 'purple' }
])
const metricDetails = {
  gross: { title: 'Evolucao da Receita Bruta', color: '#0da566', totalLabel: 'Total no periodo', formatter: formatCurrency },
  net: { title: 'Evolucao da Receita Liquida', color: '#1768f2', totalLabel: 'Total no periodo', formatter: formatCurrency },
  profit: { title: 'Evolucao do Lucro Total', color: '#0da566', totalLabel: 'Total no periodo', formatter: formatCurrency },
  orders: { title: 'Quantidade de Pedidos', color: '#7c3aed', totalLabel: 'Pedidos no periodo', formatter: formatNumber }
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
      source: order.marketplace === 'Manual' ? 'manual' : 'marketplace',
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
      client: 'Venda manual',
      marketplace: 'Manual',
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
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Nao foi possivel salvar a venda manual.', 'info')
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
  if (chartPeriod.value === 'week') {
    const start = new Date(date)
    start.setDate(date.getDate() - date.getDay())
    return start.toISOString().slice(0, 10)
  }
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
    const date = parseOrderDate(order.date)
    if (!date) continue
    const key = dateKey(date)
    const value = selectedMetric.value === 'orders' ? 1 : Number(order[selectedMetric.value] || 0)
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
  if (!id || !window.confirm(`Tem certeza que deseja excluir este pedido?\n\n${order.id} - ${order.product}\n\nEsta acao nao podera ser desfeita.`)) return
  await deleteItem('orders', id)
  notify('Pedido excluido com sucesso.')
}
const statusSegments = computed(() => {
  const totals = new Map<string, number>()
  for (const order of orders.value) totals.set(order.status || 'Sem status', (totals.get(order.status || 'Sem status') || 0) + 1)
  return [...totals.entries()].map(([label, count]) => ({ label, value: metrics.orderCount.value ? count / metrics.orderCount.value * 100 : 0, color: statusColors[label] || '#7d8799' }))
})
const marketplaceBars = computed(() => {
  const colors = ['#1768f2', '#0da566', '#f59e0b', '#c83bb7', '#29b6c8', '#7d8799']
  const totals = new Map<string, number>()
  for (const order of orders.value) totals.set(order.marketplace || 'Sem marketplace', (totals.get(order.marketplace || 'Sem marketplace') || 0) + order.gross)
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const max = rows[0]?.[1] || 0
  return rows.map(([label, value], i) => ({ label, value, percent: max ? value / max * 100 : 0, color: colors[i % colors.length] }))
})
</script>
<template>
  <div>
    <PageHeader title="Vendas" subtitle="Gerencie seus pedidos e acompanhe o desempenho das suas vendas."><NuxtLink class="btn btn--primary" to="/vendas/novo"><UiIcon name="plus"/>Nova Venda</NuxtLink></PageHeader>
    <div class="metrics-grid metrics-grid--4">
      <MetricCard
        v-for="card in metricCards"
        :key="card.key"
        :label="card.label"
        :value="card.value"
        :icon="card.icon"
        :note="card.note"
        :change="card.change"
        :color="card.color"
        :selected="selectedMetric === card.key"
        interactive
        @click="selectedMetric = card.key"
      />
    </div>
    <PanelCard :title="selectedDetail.title" :subtitle="`${selectedDetail.totalLabel}: ${selectedDetail.formatter(detailedChart.total)}`">
      <template #actions>
        <div class="segmented-control" aria-label="Periodo do grafico">
          <button type="button" :class="{ active: chartPeriod === 'week' }" @click="chartPeriod = 'week'">Semana</button>
          <button type="button" :class="{ active: chartPeriod === 'month' }" @click="chartPeriod = 'month'">Mes</button>
          <button type="button" :class="{ active: chartPeriod === 'year' }" @click="chartPeriod = 'year'">Ano</button>
        </div>
      </template>
      <LineChart :values="detailedChart.values" :labels="detailedChart.labels" :color="selectedDetail.color" />
    </PanelCard>
    <PanelCard title="Registrar vendas por produto" subtitle="Informe rapidamente as unidades vendidas hoje para cada produto cadastrado.">
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
      <div class="field field--search"><label>Buscar</label><div class="search-field"><UiIcon name="search" :size="16"/><input v-model="search" placeholder="Pedido, cliente ou produto"></div></div>
      <div class="field"><label>Marketplace</label><select><option>Todos Marketplaces</option><option>Shopee</option><option>Mercado Livre</option></select></div>
      <div class="field"><label>Status</label><select v-model="status"><option>Todos</option><option>Novo</option><option>Producao</option><option>Entregue</option><option>Cancelado</option></select></div>
      <div class="field"><label>Produto</label><select><option>Todos Produtos</option></select></div>
      <button class="btn"><UiIcon name="filter" :size="16"/> Filtros</button>
    </div>
    <div class="split-layout">
      <PanelCard title="Pedidos">
        <div class="table-scroll"><table class="data-table">
          <thead><tr><th>Nº Pedido</th><th>Data</th><th>Cliente</th><th>Marketplace</th><th>Produto</th><th>Qtd.</th><th>Impressora</th><th>Valor Bruto</th><th>Taxa</th><th>Frete</th><th>Receita Liquida</th><th>Lucro</th><th>Status</th><th></th></tr></thead>
          <tbody><tr v-if="!filtered.length"><td colspan="14"><div class="empty-state"><div><div class="empty-state__icon"><UiIcon name="bag"/></div><h3>Nenhuma venda cadastrada</h3><p>Cadastre sua primeira venda para comecar.</p><NuxtLink class="btn btn--primary" to="/vendas/novo">Nova Venda</NuxtLink></div></div></td></tr><tr v-for="o in filtered" :key="o.id"><td><div class="table-product table-product--editable"><strong>{{ o.id }}</strong><button class="row-action row-action--edit" title="Editar pedido" @click.stop="editOrder(o)"><UiIcon name="edit" :size="15"/></button></div></td><td>{{ o.date }}</td><td>{{ o.client }}</td><td>{{ o.marketplace }}</td><td>{{ o.product }}</td><td>{{ o.qty }}</td><td><select class="select-compact" :disabled="assigningPrinter[orderKey(o)]" :value="printJobForOrder(o)?.printerId || ''" @change="assignOrderPrinter(o, ($event.target as HTMLSelectElement).value)"><option value="">Fila</option><option v-for="printer in printers" :key="printer.id" :value="printer.id">{{ printer.name }} - {{ printerBusyLabel(printer.id || '') }}</option></select><small v-if="printJobForOrder(o)" style="display:block;margin-top:4px;color:var(--muted)">{{ printJobForOrder(o)?.status }} · {{ printJobForOrder(o)?.printerName || 'Sem impressora' }}</small></td><td>{{ formatCurrency(o.gross) }}</td><td>{{ formatCurrency(o.fee) }}</td><td>{{ formatCurrency(o.shipping) }}</td><td>{{ formatCurrency(o.net) }}</td><td>{{ formatCurrency(o.profit) }}</td><td><span class="badge" :class="badgeClass(o.status)">{{ o.status }}</span></td><td><button class="row-action" title="Excluir pedido" @click.stop="removeOrder(o)"><UiIcon name="close" :size="16"/></button></td></tr></tbody>
        </table></div>
        <div class="table-footer"><span>Mostrando {{ filtered.length ? 1 : 0 }} a {{ filtered.length }} de {{ orders.length }} pedidos</span><div class="pagination"><button class="page-btn active">1</button></div><select class="select-compact"><option>10 por pagina</option></select></div>
      </PanelCard>
      <aside>
        <PanelCard title="Vendas por Status"><DonutChart :segments="statusSegments" :total="formatNumber(metrics.orderCount.value)" caption="Pedidos" /></PanelCard>
        <PanelCard title="Vendas por Marketplace" style="margin-top:12px">
          <div class="bar-list"><div v-if="!marketplaceBars.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="store"/></div><h3>Nenhuma venda por marketplace</h3><p>Cadastre vendas para preencher este grafico.</p></div></div><div v-for="bar in marketplaceBars" :key="bar.label" class="bar-row"><span>{{bar.label}}</span><div class="bar-row__track"><div class="bar-row__fill" :style="{width:`${bar.percent}%`,background:bar.color}"/></div><strong>{{ formatCurrency(bar.value) }}</strong></div></div>
        </PanelCard>
      </aside>
    </div>
  </div>
</template>
