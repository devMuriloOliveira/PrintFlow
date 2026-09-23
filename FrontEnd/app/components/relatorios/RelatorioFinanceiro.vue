<script setup lang="ts">
type ReportFilters = { periodStart: string; periodEnd: string; grouping: 'day' | 'week' | 'month'; marketplace: string; product: string; category: string; channel: 'Todos' | 'direct' | 'marketplace' }
const filters = defineModel<ReportFilters>('filters', { required: true })
const { products, orders, expenses } = useAppData()

const parseDate = (value: unknown) => {
  const text = String(value || '')
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
    const [day, month, year] = text.split('/').map(Number)
    return new Date(year, month - 1, day)
  }
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}
const isCancelled = (value: unknown) => String(value || '').trim().toLowerCase() === 'cancelado'
const inPeriod = (value: unknown) => {
  const date = parseDate(value)
  return Boolean(date && date >= new Date(`${filters.value.periodStart}T00:00:00`) && date <= new Date(`${filters.value.periodEnd}T23:59:59`))
}
const filteredOrders = computed(() => orders.value.filter(order =>
  inPeriod(order.date) &&
  !isCancelled(order.status) &&
  (filters.value.marketplace === 'Todos' || (order.marketplace || 'Sem marketplace') === filters.value.marketplace) &&
  (filters.value.product === 'Todos' || order.product === filters.value.product) &&
  (filters.value.channel === 'Todos' || order.salesChannel === filters.value.channel)
))
const filteredExpenses = computed(() => expenses.value.filter(expense =>
  inPeriod(expense.date) && !isCancelled(expense.status) &&
  (filters.value.category === 'Todos' || expense.category === filters.value.category)
))

const revenueTotal = computed(() => filteredOrders.value.reduce((sum, item) => sum + Number(item.gross || 0), 0))
const feeTotal = computed(() => filteredOrders.value.reduce((sum, item) => sum + Number(item.fee || 0), 0))
const shippingTotal = computed(() => filteredOrders.value.reduce((sum, item) => sum + Number(item.shipping || 0), 0))
const estimatedCurrentCost = computed(() => filteredOrders.value.reduce((sum, item) => {
  const product = products.value.find(candidate => String(candidate.id || '') === String(item.productId || '') || candidate.name === item.product)
  return sum + Number(product?.cost || 0) * Number(item.qty || 0)
}, 0))
const expenseTotal = computed(() => filteredExpenses.value.reduce((sum, item) => sum + Number(item.value || 0), 0))
const netTotal = computed(() => filteredOrders.value.reduce((sum, item) => sum + Number(item.net || 0), 0))
const registeredOrderProfit = computed(() => filteredOrders.value.reduce((sum, item) => sum + Number(item.profit || 0), 0))
const profitTotal = computed(() => registeredOrderProfit.value - expenseTotal.value)
const margin = computed(() => revenueTotal.value ? profitTotal.value / revenueTotal.value * 100 : 0)
const ticket = computed(() => filteredOrders.value.length ? revenueTotal.value / filteredOrders.value.length : 0)
const itemCount = computed(() => filteredOrders.value.reduce((sum, item) => sum + Number(item.qty || 0), 0))

const periodKey = (value: unknown) => {
  const date = parseDate(value)
  if (!date) return ''
  if (filters.value.grouping === 'day') return date.toISOString().slice(0, 10)
  if (filters.value.grouping === 'week') {
    const monday = new Date(date)
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7))
    return monday.toISOString().slice(0, 10)
  }
  return date.toISOString().slice(0, 7)
}
const periodLabel = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  if (!year || !month) return key
  if (filters.value.grouping === 'month') return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' }).format(new Date(year, month - 1, 1)).replace('.', '')
  const date = new Date(year, month - 1, day || 1)
  return `${filters.value.grouping === 'week' ? 'sem. ' : ''}${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date)}`
}
const chartRows = computed(() => {
  const rows = new Map<string, { revenue: number; expenses: number; profit: number }>()
  for (const order of filteredOrders.value) {
    const key = periodKey(order.date)
    const row = rows.get(key) || { revenue: 0, expenses: 0, profit: 0 }
    row.revenue += Number(order.gross || 0)
    row.profit += Number(order.profit || 0)
    rows.set(key, row)
  }
  for (const expense of filteredExpenses.value) {
    const key = periodKey(expense.date)
    const row = rows.get(key) || { revenue: 0, expenses: 0, profit: 0 }
    row.expenses += Number(expense.value || 0)
    row.profit -= Number(expense.value || 0)
    rows.set(key, row)
  }
  return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b))
})
const chartLabels = computed(() => chartRows.value.map(([key]) => periodLabel(key)))
const revenueChart = computed(() => chartRows.value.map(([, row]) => row.revenue))
const expenseChart = computed(() => chartRows.value.map(([, row]) => row.expenses))
const profitChart = computed(() => chartRows.value.map(([, row]) => row.profit))
const marketplaceBars = computed(() => {
  const totals = new Map<string, number>()
  for (const order of filteredOrders.value) totals.set(order.marketplace || 'Sem marketplace', (totals.get(order.marketplace || 'Sem marketplace') || 0) + Number(order.gross || 0))
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const max = rows[0]?.[1] || 0
  return rows.map(([name, value]) => ({ name, value, percent: max ? value / max * 100 : 0 }))
})
const expenseSegments = computed(() => {
  const totals = new Map<string, number>()
  for (const expense of filteredExpenses.value) totals.set(expense.category || 'Outros', (totals.get(expense.category || 'Outros') || 0) + Number(expense.value || 0))
  return [...totals.entries()].map(([label, total]) => ({ label, total }))
})
</script>

<template>
  <div class="financial-report">
    <div class="metrics-grid metrics-grid--5">
      <MetricCard label="Faturamento bruto" :value="formatCurrency(revenueTotal)" icon="trend" note="Total vendido" :points="revenueChart" />
      <MetricCard label="Receita após taxas" :value="formatCurrency(netTotal)" icon="wallet" note="Líquido informado nas vendas" color="cyan" :points="revenueChart" />
      <MetricCard label="Despesas operacionais" :value="formatCurrency(expenseTotal)" icon="receipt" note="Despesas não canceladas" color="orange" :points="expenseChart" />
      <MetricCard label="Resultado final" :value="formatCurrency(profitTotal)" icon="chart" note="Lucro das vendas menos despesas" :color="profitTotal >= 0 ? 'green' : 'red'" :points="profitChart" />
      <MetricCard label="Margem final" :value="`${margin.toFixed(1)}%`" icon="percent" note="Resultado / faturamento" color="purple" :points="profitChart" />
    </div>

    <div class="financial-definition">
      <UiIcon name="info" :size="17" />
      <span><strong>Como o resultado é calculado:</strong> somamos o lucro registrado em cada venda e descontamos as despesas operacionais do período. O custo atual dos produtos aparece abaixo apenas como referência, pois pode ter mudado depois da venda.</span>
    </div>

    <div class="financial-charts">
      <PanelCard title="Faturamento x despesas" subtitle="Evolução conforme o agrupamento selecionado">
        <div v-if="!chartRows.length" class="empty-state">Nenhum lançamento encontrado no período.</div>
        <LineChart v-else :values="revenueChart" :second="expenseChart" :labels="chartLabels" />
      </PanelCard>
      <PanelCard title="Resultado final" subtitle="Lucro registrado nas vendas menos despesas">
        <div v-if="!chartRows.length" class="empty-state">Nenhum resultado encontrado no período.</div>
        <LineChart v-else :values="profitChart" :labels="chartLabels" :color="profitTotal >= 0 ? '#0da566' : '#b42318'" />
      </PanelCard>
    </div>

    <div class="financial-details">
      <PanelCard title="Conciliação do período" subtitle="Valores que explicam o resultado">
        <div class="report-breakdown">
          <div><span>Faturamento bruto</span><strong>{{ formatCurrency(revenueTotal) }}</strong></div>
          <div><span>Taxas de venda</span><strong>{{ formatCurrency(feeTotal) }}</strong></div>
          <div><span>Frete</span><strong>{{ formatCurrency(shippingTotal) }}</strong></div>
          <div><span>Lucro registrado nas vendas</span><strong>{{ formatCurrency(registeredOrderProfit) }}</strong></div>
          <div><span>Despesas operacionais</span><strong class="money-negative">− {{ formatCurrency(expenseTotal) }}</strong></div>
          <div class="report-breakdown__total"><span>Resultado final</span><strong :class="profitTotal >= 0 ? 'money-positive' : 'money-negative'">{{ formatCurrency(profitTotal) }}</strong></div>
          <div class="report-breakdown__reference"><span>Custo atual estimado dos itens</span><strong>{{ formatCurrency(estimatedCurrentCost) }}</strong></div>
        </div>
      </PanelCard>
      <PanelCard title="Despesas por categoria" subtitle="Distribuição das despesas filtradas">
        <div v-if="!expenseSegments.length" class="empty-state">Nenhuma despesa no período.</div>
        <DonutChart v-else :segments="expenseSegments" :total="formatCurrency(expenseTotal)" />
      </PanelCard>
      <PanelCard title="Faturamento por canal" subtitle="Comparação entre marketplaces e venda direta">
        <div class="bar-list report-bars">
          <div v-if="!marketplaceBars.length" class="empty-state">Nenhuma venda no período.</div>
          <div v-for="item in marketplaceBars" :key="item.name" class="bar-row"><span>{{ item.name }}</span><div class="bar-row__track"><div class="bar-row__fill" :style="{ width: `${item.percent}%`, background: '#1768f2' }" /></div><strong>{{ formatCurrency(item.value) }}</strong></div>
        </div>
      </PanelCard>
      <PanelCard title="Volume comercial" subtitle="Indicadores do conjunto filtrado">
        <div class="report-breakdown">
          <div><span>Pedidos</span><strong>{{ formatNumber(filteredOrders.length) }}</strong></div>
          <div><span>Itens vendidos</span><strong>{{ formatNumber(itemCount) }}</strong></div>
          <div><span>Ticket médio</span><strong>{{ formatCurrency(ticket) }}</strong></div>
          <div><span>Produtos cadastrados</span><strong>{{ formatNumber(products.length) }}</strong></div>
        </div>
      </PanelCard>
    </div>
  </div>
</template>

<style scoped>
.financial-report{display:grid;gap:16px}.financial-definition{display:flex;align-items:flex-start;gap:9px;padding:12px 14px;border:1px solid #cfe0fb;border-radius:11px;background:#f5f9ff;color:#445066;font-size:12px;line-height:1.5}.financial-definition svg{flex:0 0 auto;color:#1768f2}.financial-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.financial-details{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.report-breakdown{display:grid;gap:11px;padding:18px}.report-breakdown div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #edf0f5;padding-bottom:8px}.report-breakdown div:last-child{border-bottom:0}.report-breakdown span{color:#687386}.report-breakdown strong{color:#172033;text-align:right}.report-breakdown__total{margin-top:2px;padding-top:9px;border-top:2px solid #dce4f0}.report-breakdown__reference{font-size:11px}.report-breakdown__reference span,.report-breakdown__reference strong{color:#7b8494}.report-bars{padding:18px}@media(max-width:1180px){.financial-details{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.financial-charts,.financial-details{grid-template-columns:1fr}}
</style>
