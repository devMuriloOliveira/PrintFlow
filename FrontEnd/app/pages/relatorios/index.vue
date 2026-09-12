<script setup lang="ts">
const { products, orders, expenses, listFinancialHistory, exportFinancialReport } = useAppData()
const { notify } = useUi()
const route = useRoute()

const today = new Date()
const periodStart = ref(`${today.getFullYear()}-01-01`)
const periodEnd = ref(today.toISOString().slice(0, 10))
const grouping = ref<'day' | 'week' | 'month'>('month')
const marketplaceFilter = ref('Todos')
const productFilter = ref('Todos')
const categoryFilter = ref('Todos')
const channelFilter = ref('Todos')
const history = ref<any[]>([])
const historyLoading = ref(false)
const historyError = ref('')
const exportFormat = ref<'csv' | 'xlsx'>('xlsx')
const exporting = ref(false)
const reportSection = computed(() => {
  const section = String(route.query.secao || 'financeiro')
  return ['financeiro', 'produtos', 'historico'].includes(section) ? section : 'financeiro'
})

const parseDate = (value: unknown) => {
  const text = String(value || '')
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
    const [day, month, year] = text.split('/').map(Number)
    return new Date(year, month - 1, day)
  }
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}
const inPeriod = (value: unknown) => {
  const date = parseDate(value)
  if (!date) return false
  const start = new Date(`${periodStart.value}T00:00:00`)
  const end = new Date(`${periodEnd.value}T23:59:59`)
  return date >= start && date <= end
}
const filteredOrders = computed(() => orders.value.filter((order) => inPeriod(order.date)
  && (marketplaceFilter.value === 'Todos' || (order.marketplace || 'Sem marketplace') === marketplaceFilter.value)
  && (productFilter.value === 'Todos' || order.product === productFilter.value)
  && (channelFilter.value === 'Todos' || (channelFilter.value === 'Diretas' ? order.salesChannel === 'direct' : order.salesChannel === 'marketplace'))))
const filteredExpenses = computed(() => expenses.value.filter((expense) => inPeriod(expense.date)
  && (categoryFilter.value === 'Todos' || expense.category === categoryFilter.value)))
const revenueTotal = computed(() => filteredOrders.value.reduce((sum, item) => sum + Number(item.gross || 0), 0))
const feeTotal = computed(() => filteredOrders.value.reduce((sum, item) => sum + Number(item.fee || 0), 0))
const shippingTotal = computed(() => filteredOrders.value.reduce((sum, item) => sum + Number(item.shipping || 0), 0))
const costTotal = computed(() => filteredOrders.value.reduce((sum, item) => {
  const product = products.value.find(candidate => String(candidate.id || '') === String(item.productId || '') || candidate.name === item.product)
  return sum + Number(product?.cost || 0) * Number(item.qty || 0)
}, 0))
const netTotal = computed(() => filteredOrders.value.reduce((sum, item) => sum + Number(item.net || 0), 0))
const expenseTotal = computed(() => filteredExpenses.value.reduce((sum, item) => sum + Number(item.value || 0), 0))
const profitTotal = computed(() => filteredOrders.value.reduce((sum, item) => sum + Number(item.profit || 0), 0) - expenseTotal.value)
const margin = computed(() => revenueTotal.value ? profitTotal.value / revenueTotal.value * 100 : 0)
const ticket = computed(() => filteredOrders.value.length ? revenueTotal.value / filteredOrders.value.length : 0)

const periodKey = (value: unknown) => {
  const date = parseDate(value)
  if (!date) return ''
  if (grouping.value === 'day') return date.toISOString().slice(0, 10)
  if (grouping.value === 'week') return `${date.toISOString().slice(0, 7)}-S${Math.ceil(date.getDate() / 7)}`
  return date.toISOString().slice(0, 7)
}
const chartRows = computed(() => {
  const rows = new Map<string, { revenue: number, net: number, expenses: number, profit: number }>()
  for (const order of filteredOrders.value) {
    const key = periodKey(order.date); const row = rows.get(key) || { revenue: 0, net: 0, expenses: 0, profit: 0 }
    row.revenue += Number(order.gross || 0); row.net += Number(order.net || 0); row.profit += Number(order.profit || 0); rows.set(key, row)
  }
  for (const expense of filteredExpenses.value) {
    const key = periodKey(expense.date); const row = rows.get(key) || { revenue: 0, net: 0, expenses: 0, profit: 0 }
    row.expenses += Number(expense.value || 0); row.profit -= Number(expense.value || 0); rows.set(key, row)
  }
  return [...rows.entries()]
})
const chartLabels = computed(() => chartRows.value.map(([key]) => key))
const revenueChart = computed(() => chartRows.value.map(([, row]) => row.revenue / 1000))
const expenseChart = computed(() => chartRows.value.map(([, row]) => row.expenses / 1000))
const profitChart = computed(() => chartRows.value.map(([, row]) => row.profit / 1000))
const marketplaceOptions = computed(() => ['Todos', ...new Set(orders.value.map((item) => item.marketplace || 'Sem marketplace'))])
const productOptions = computed(() => ['Todos', ...new Set(products.value.map((item) => item.name))])
const categoryOptions = computed(() => ['Todos', ...new Set(expenses.value.map((item) => item.category))])
const marketplaceBars = computed(() => {
  const totals = new Map<string, number>()
  for (const order of filteredOrders.value) totals.set(order.marketplace || 'Sem marketplace', (totals.get(order.marketplace || 'Sem marketplace') || 0) + Number(order.gross || 0))
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]); const max = rows[0]?.[1] || 0
  return rows.map(([name, value]) => ({ name, value, percent: max ? value / max * 100 : 0 }))
})
const expenseSegments = computed(() => {
  const totals = new Map<string, number>()
  for (const expense of filteredExpenses.value) totals.set(expense.category || 'Outros', (totals.get(expense.category || 'Outros') || 0) + Number(expense.value || 0))
  return [...totals.entries()].map(([label, total]) => ({ label, total }))
})
const productRows = computed(() => {
  const totals = new Map<string, { qty: number, revenue: number, profit: number }>()
  for (const order of filteredOrders.value) {
    const row = totals.get(order.product) || { qty: 0, revenue: 0, profit: 0 }
    row.qty += Number(order.qty || 0); row.revenue += Number(order.gross || 0); row.profit += Number(order.profit || 0); totals.set(order.product, row)
  }
  return products.value.map((product) => ({ ...product, ...(totals.get(product.name) || { qty: 0, revenue: 0, profit: 0 }) })).sort((a, b) => b.revenue - a.revenue)
})
const resourceLabel = (resource: string) => ({ products: 'Produto', filaments: 'Filamento', printers: 'Impressora', marketplaces: 'Marketplace' }[resource] || resource)
const historyTitle = (entry: any) => `${resourceLabel(entry.resource)} #${entry.resourceId}`
const loadHistory = async () => {
  historyLoading.value = true; historyError.value = ''
  try { history.value = await listFinancialHistory() } catch (error: any) { historyError.value = error?.data?.error || 'Historico financeiro indisponivel para este perfil.' } finally { historyLoading.value = false }
}
watch(reportSection, section => { if (section === 'historico' && !history.value.length) void loadHistory() }, { immediate: true })
const exportReport = async () => {
  if (periodStart.value > periodEnd.value || exporting.value) return notify('Informe um período válido para exportar.')
  exporting.value = true
  try {
    const content = await exportFinancialReport({ from: periodStart.value, to: periodEnd.value, marketplace: marketplaceFilter.value === 'Todos' ? '' : marketplaceFilter.value, product: productFilter.value === 'Todos' ? '' : productFilter.value, category: categoryFilter.value === 'Todos' ? '' : categoryFilter.value, channel: channelFilter.value === 'Todos' ? '' : channelFilter.value === 'Diretas' ? 'direct' : 'marketplace', format: exportFormat.value })
    const url = URL.createObjectURL(content); const link = document.createElement('a'); link.href = url; link.download = `printflow-relatorio-${periodStart.value}-${periodEnd.value}.${exportFormat.value}`; link.click(); URL.revokeObjectURL(url)
    notify('Relatorio exportado com sucesso.')
  } catch (error: any) { notify(error?.data?.error || error?.message || 'Nao foi possivel exportar o relatorio.') } finally { exporting.value = false }
}
</script>

<template>
  <div>
    <PageHeader title="Relatórios completos" subtitle="Centralize análises e exporte vendas, despesas, produtos, estoque, produção, clientes e conexões em um único arquivo."><div style="display:flex;gap:8px"><select v-model="exportFormat" class="report-export-format" aria-label="Formato da exportação"><option value="xlsx">XLSX</option><option value="csv">CSV</option></select><button class="btn" @click="exportReport"><UiIcon name="download"/>Exportar todos os relatórios</button></div></PageHeader>
    <nav class="report-tabs" aria-label="Seções de relatórios"><NuxtLink to="/relatorios?secao=financeiro" :class="{ active: reportSection === 'financeiro' }">Financeiro</NuxtLink><NuxtLink to="/relatorios?secao=produtos" :class="{ active: reportSection === 'produtos' }">Produtos e vendas</NuxtLink><NuxtLink to="/relatorios?secao=historico" :class="{ active: reportSection === 'historico' }">Histórico financeiro</NuxtLink></nav>
    <template v-if="reportSection === 'financeiro'">
    <div class="filters">
      <div class="field"><label>Início</label><input v-model="periodStart" type="date"></div>
      <div class="field"><label>Fim</label><input v-model="periodEnd" type="date"></div>
      <div class="field"><label>Agrupamento</label><select v-model="grouping"><option value="month">Mensal</option><option value="week">Semanal</option><option value="day">Diário</option></select></div>
      <div class="field"><label>Marketplace</label><select v-model="marketplaceFilter"><option v-for="item in marketplaceOptions" :key="item">{{ item }}</option></select></div>
      <div class="field"><label>Canal de venda</label><select v-model="channelFilter"><option>Todos</option><option>Diretas</option><option>Marketplace</option></select></div>
      <div class="field"><label>Produto</label><select v-model="productFilter"><option v-for="item in productOptions" :key="item">{{ item }}</option></select></div>
      <div class="field"><label>Categoria de despesa</label><select v-model="categoryFilter"><option v-for="item in categoryOptions" :key="item">{{ item }}</option></select></div>
    </div>
    <div class="metrics-grid metrics-grid--5">
      <MetricCard label="Faturamento bruto" :value="formatCurrency(revenueTotal)" icon="trend" note="Período filtrado" :points="revenueChart"/>
      <MetricCard label="Receita líquida" :value="formatCurrency(netTotal)" icon="wallet" note="Após taxas e frete" color="cyan" :points="chartRows.map(([, row]) => row.net / 1000)"/>
      <MetricCard label="Custos e despesas" :value="formatCurrency(costTotal + expenseTotal)" icon="money" note="Produção + operação" color="orange" :points="expenseChart"/>
      <MetricCard label="Lucro líquido" :value="formatCurrency(profitTotal)" icon="chart" note="Resultado do período" :color="profitTotal >= 0 ? 'green' : 'red'" :points="profitChart"/>
      <MetricCard label="Margem líquida" :value="`${margin.toFixed(1)}%`" icon="percent" note="Lucro / faturamento" color="purple" :points="chartRows.map(([, row]) => row.revenue ? row.profit / row.revenue * 100 : 0)"/>
    </div>
    <div class="dashboard-grid" style="grid-template-columns:1fr 1fr 1fr 1fr">
      <PanelCard title="Faturamento"><LineChart :values="revenueChart" :labels="chartLabels"/></PanelCard>
      <PanelCard title="Taxas e frete"><LineChart :values="filteredOrders.map((x) => (Number(x.fee || 0) + Number(x.shipping || 0)) / 1000)" :labels="filteredOrders.map((x) => periodKey(x.date))" color="#f5a623"/></PanelCard>
      <PanelCard title="Receita x despesas"><LineChart :values="revenueChart" :second="expenseChart" :labels="chartLabels"/></PanelCard>
      <PanelCard title="Lucro líquido"><LineChart :values="profitChart" :labels="chartLabels" color="#0da566"/></PanelCard>
    </div>
    <div class="dashboard-grid" style="grid-template-columns:1fr 1fr 1fr 1fr">
      <PanelCard title="Composição financeira"><div class="report-breakdown"><div><span>Taxas ML</span><strong>{{formatCurrency(feeTotal)}}</strong></div><div><span>Frete</span><strong>{{formatCurrency(shippingTotal)}}</strong></div><div><span>Custo de produção</span><strong>{{formatCurrency(costTotal)}}</strong></div><div><span>Despesas operacionais</span><strong>{{formatCurrency(expenseTotal)}}</strong></div><div><span>Ticket médio</span><strong>{{formatCurrency(ticket)}}</strong></div></div></PanelCard>
      <PanelCard title="Despesas por categoria"><DonutChart :segments="expenseSegments" :total="formatCurrency(expenseTotal)"/></PanelCard>
      <PanelCard title="Faturamento por marketplace"><div class="bar-list" style="padding:20px"><div v-if="!marketplaceBars.length" class="empty-state"><div><h3>Nenhuma venda no período</h3></div></div><div v-for="item in marketplaceBars" :key="item.name" class="bar-row"><span>{{item.name}}</span><div class="bar-row__track"><div class="bar-row__fill" :style="{width:`${item.percent}%`,background:'#1768f2'}"/></div><strong>{{formatCurrency(item.value)}}</strong></div></div></PanelCard>
      <PanelCard title="Indicadores"><div class="report-breakdown"><div><span>Pedidos</span><strong>{{formatNumber(filteredOrders.length)}}</strong></div><div><span>Itens vendidos</span><strong>{{formatNumber(filteredOrders.reduce((sum, item) => sum + Number(item.qty || 0), 0))}}</strong></div><div><span>Produtos ativos</span><strong>{{formatNumber(products.length)}}</strong></div><div><span>Período</span><strong>{{periodStart}} a {{periodEnd}}</strong></div></div></PanelCard>
    </div>
    </template>
    <template v-else-if="reportSection === 'produtos'"><div class="dashboard-grid"><PanelCard title="Produtos mais relevantes"><div class="table-scroll"><table class="data-table"><thead><tr><th>Produto</th><th>Qtd.</th><th>Faturamento</th><th>Lucro</th><th>Margem cadastrada</th></tr></thead><tbody><tr v-if="!productRows.length"><td colspan="5">Nenhum produto cadastrado.</td></tr><tr v-for="item in productRows.slice(0, 10)" :key="item.sku"><td><div class="table-product"><ProductThumb :type="item.thumb" :size="25"/>{{item.name}}</div></td><td>{{item.qty}}</td><td>{{formatCurrency(item.revenue)}}</td><td :class="item.profit >= 0 ? 'money-positive' : 'money-negative'">{{formatCurrency(item.profit)}}</td><td>{{Number(item.margin || 0).toFixed(1)}}%</td></tr></tbody></table></div></PanelCard></div></template>
    <template v-else>
    <PanelCard title="Histórico de alterações financeiras" subtitle="Versões registradas de custos, preços e taxas. Os valores não sobrescrevem vendas já realizadas."><div v-if="historyLoading" class="empty-state">Carregando histórico...</div><div v-else-if="historyError" class="empty-state">{{historyError}}</div><div v-else-if="!history.length" class="empty-state">Ainda não há alterações financeiras registradas.</div><div v-else class="table-scroll"><table class="data-table"><thead><tr><th>Data</th><th>Recurso</th><th>Origem</th><th>Valores registrados</th></tr></thead><tbody><tr v-for="entry in history" :key="entry.id"><td>{{new Date(entry.createdAt).toLocaleString('pt-BR')}}</td><td>{{historyTitle(entry)}}</td><td>{{entry.source}}</td><td><span v-for="(value, key) in entry.snapshot" :key="key" class="history-value">{{key}}: {{typeof value === 'number' ? formatCurrency(value) : value}}</span></td></tr></tbody></table></div></PanelCard>
    </template>
  </div>
</template>

<style scoped>
.report-breakdown { display: grid; gap: 12px; padding: 18px; }
.report-breakdown div { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid #edf0f5; padding-bottom: 8px; }
.report-breakdown span { color: #687386; }
.report-breakdown strong { color: #172033; text-align: right; }
.history-value { display: inline-block; margin: 2px 6px 2px 0; padding: 4px 7px; border-radius: 6px; background: #f1f4f8; font-size: 12px; }
.report-export-format { min-width: 76px; border: 1px solid #d8deea; border-radius: 8px; padding: 0 8px; background: #fff; }
.report-tabs { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 20px; border-bottom:1px solid #e5e9f1; padding-bottom:10px; }
.report-tabs a { border:1px solid #d8deea; border-radius:999px; padding:8px 14px; color:#687386; font-size:13px; font-weight:700; text-decoration:none; }
.report-tabs a:hover, .report-tabs a.active { border-color:#9ebcf8; background:#eef4ff; color:#1768f2; }
</style>
