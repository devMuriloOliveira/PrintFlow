<script setup lang="ts">
import type { ReportSummary } from '~/composables/useAppData'

type ReportFilters = { periodStart: string; periodEnd: string; grouping: 'day' | 'week' | 'month'; marketplace: string; product: string; category: string; channel: 'Todos' | 'direct' | 'marketplace' }
const filters = defineModel<ReportFilters>('filters', { required: true })
const props = defineProps<{ report: ReportSummary; loading?: boolean }>()
const totals = computed(() => props.report.totals)
const revenueTotal = computed(() => totals.value.revenue)
const feeTotal = computed(() => totals.value.fees)
const shippingTotal = computed(() => totals.value.shipping)
const estimatedCurrentCost = computed(() => totals.value.estimatedCurrentCost)
const expenseTotal = computed(() => totals.value.expenses)
const netTotal = computed(() => totals.value.netRevenue)
const registeredOrderProfit = computed(() => totals.value.registeredProfit)
const profitTotal = computed(() => totals.value.profit)
const margin = computed(() => revenueTotal.value ? profitTotal.value / revenueTotal.value * 100 : 0)
const ticket = computed(() => totals.value.ticket)
const itemCount = computed(() => totals.value.itemCount)
const periodLabel = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  if (!year || !month) return key
  if (filters.value.grouping === 'month') return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' }).format(new Date(year, month - 1, 1)).replace('.', '')
  const date = new Date(year, month - 1, day || 1)
  return `${filters.value.grouping === 'week' ? 'sem. ' : ''}${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date)}`
}
const chartRows = computed(() => props.report.series)
const chartLabels = computed(() => chartRows.value.map(row => periodLabel(row.key)))
const revenueChart = computed(() => chartRows.value.map(row => row.revenue))
const expenseChart = computed(() => chartRows.value.map(row => row.expenses))
const profitChart = computed(() => chartRows.value.map(row => row.profit))
const marketplaceBars = computed(() => {
  const max = props.report.marketplaces[0]?.value || 0
  return props.report.marketplaces.map(item => ({ ...item, percent: max ? item.value / max * 100 : 0 }))
})
const expenseSegments = computed(() => props.report.expenseCategories)
</script>

<template>
  <div class="report-section financial-report">
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
          <div><span>Pedidos</span><strong>{{ formatNumber(totals.orderCount) }}</strong></div>
          <div><span>Itens vendidos</span><strong>{{ formatNumber(itemCount) }}</strong></div>
          <div><span>Ticket médio</span><strong>{{ formatCurrency(ticket) }}</strong></div>
          <div><span>Produtos cadastrados</span><strong>{{ formatNumber(totals.productsCount) }}</strong></div>
        </div>
      </PanelCard>
    </div>
  </div>
</template>

<style scoped>
.financial-definition{display:flex;align-items:flex-start;gap:9px;padding:12px 14px;border:1px solid #cfe0fb;border-radius:11px;background:#f5f9ff;color:#445066;font-size:12px;line-height:1.5}.financial-definition svg{flex:0 0 auto;color:#1768f2}.financial-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.financial-details{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.report-breakdown{display:grid;gap:11px;padding:18px}.report-breakdown div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #edf0f5;padding-bottom:8px}.report-breakdown div:last-child{border-bottom:0}.report-breakdown span{color:#687386}.report-breakdown strong{color:#172033;text-align:right}.report-breakdown__total{margin-top:2px;padding-top:9px;border-top:2px solid #dce4f0}.report-breakdown__reference{font-size:11px}.report-breakdown__reference span,.report-breakdown__reference strong{color:#7b8494}.report-bars{padding:18px}@media(max-width:1180px){.financial-details{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.financial-charts,.financial-details{grid-template-columns:1fr}}
</style>
