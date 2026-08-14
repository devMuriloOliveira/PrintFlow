<script setup lang="ts">
const { products, orders, expenses, expenseSegments, filaments, goals } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()

const revenueLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const monthlyRevenue = computed(() => {
  const values = Array.from({ length: 12 }, () => 0)
  for (const order of orders.value) {
    const parts = String(order.date).split('/').map(Number)
    const month = parts.length >= 2 ? parts[1] : Number(String(order.date).slice(5, 7))
    if (month >= 1 && month <= 12) values[month - 1] += order.gross / 1000
  }
  return values
})
const monthlyExpenses = computed(() => {
  const values = Array.from({ length: 12 }, () => 0)
  for (const expense of expenses.value) {
    const parts = String(expense.date).split('/').map(Number)
    const month = parts.length >= 2 ? parts[1] : Number(String(expense.date).slice(5, 7))
    if (month >= 1 && month <= 12) values[month - 1] += expense.value / 1000
  }
  return values
})
const marketplaceBars = computed(() => {
  const colors = ['#1768f2', '#0da566', '#f59e0b', '#c83bb7', '#29b6c8', '#7d8799']
  const totals = new Map<string, number>()
  for (const order of orders.value) totals.set(order.marketplace || 'Sem marketplace', (totals.get(order.marketplace || 'Sem marketplace') || 0) + order.gross)
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const max = rows[0]?.[1] || 0
  return rows.map(([label, value], index) => ({ label, value, percent: max ? value / max * 100 : 0, color: colors[index % colors.length] }))
})
const productPerformance = computed(() => {
  const totals = new Map<string, { sales: number, profit: number }>()
  for (const order of orders.value) {
    const current = totals.get(order.product) || { sales: 0, profit: 0 }
    current.sales += order.qty
    current.profit += order.profit
    totals.set(order.product, current)
  }
  return products.value.map((product) => {
    const item = totals.get(product.name) || { sales: 0, profit: 0 }
    return { ...product, sales: item.sales, orderProfit: item.profit }
  }).sort((a, b) => b.orderProfit - a.orderProfit)
})
const alerts = computed(() => [
  ...filaments.value.filter(f => f.remaining < 300).map(f => ({ icon: 'box', title: `${f.name} proximo do fim`, text: `Restam ${formatNumber(f.remaining)} g em estoque`, badge: 'Estoque baixo', cls: 'badge--orange' })),
  ...goals.value.filter(g => g.target > 0).map(g => ({ icon: 'target', title: g.title, text: `${metrics.percent(Math.min(g.current / g.target * 100, 100))} da meta`, badge: g.status, cls: 'badge--green' }))
])
</script>

<template>
  <div>
    <PageHeader title="Dashboard" subtitle="Resumo geral do seu negocio de impressao 3D" />

    <div class="metrics-grid">
      <MetricCard label="Faturamento Total" :value="formatCurrency(metrics.revenue.value)" icon="trend" note="Dados do banco" color="blue" :points="monthlyRevenue" />
      <MetricCard label="Despesas Totais" :value="formatCurrency(metrics.expenseTotal.value)" icon="receipt" note="Dados do banco" color="red" negative :points="monthlyExpenses" />
      <MetricCard label="Lucro Liquido" :value="formatCurrency(metrics.profit.value)" icon="money" :change="`Margem ${metrics.percent(metrics.margin.value)}`" color="green" selected :points="monthlyRevenue.map((x, i) => x - monthlyExpenses[i])" />
      <MetricCard label="Pedidos" :value="formatNumber(metrics.orderCount.value)" icon="bag" note="Dados do banco" color="purple" :points="monthlyRevenue" />
      <MetricCard label="Ticket Medio" :value="formatCurrency(metrics.ticket.value)" icon="tag" note="Faturamento / Pedidos" color="orange" :points="monthlyRevenue" />
      <MetricCard label="Taxas de Marketplaces" :value="formatCurrency(metrics.fees.value)" icon="percent" note="Dados do banco" color="cyan" :points="monthlyRevenue" />
    </div>

    <div class="dashboard-grid">
      <PanelCard title="Faturamento Mensal"><LineChart :values="monthlyRevenue" :labels="revenueLabels" /></PanelCard>
      <PanelCard title="Receita x Despesas"><LineChart :values="monthlyRevenue" :second="monthlyExpenses" :labels="revenueLabels" /></PanelCard>
      <PanelCard title="Despesas por Categoria"><DonutChart :segments="expenseSegments" :total="formatCurrency(metrics.expenseTotal.value)" /></PanelCard>
    </div>

    <div class="dashboard-grid dashboard-grid--bottom">
      <PanelCard title="Faturamento por Marketplace">
        <div class="bar-list" style="padding-top:12px">
          <div v-if="!marketplaceBars.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="store"/></div><h3>Nenhuma venda por marketplace</h3><p>Cadastre vendas para preencher este grafico.</p></div></div>
          <div v-for="bar in marketplaceBars" :key="bar.label" class="bar-row"><span>{{ bar.label }}</span><div class="bar-row__track"><div class="bar-row__fill" :style="{ width: `${bar.percent}%`, background: bar.color }"/></div><strong>{{ formatCurrency(bar.value) }}</strong></div>
        </div>
      </PanelCard>
      <PanelCard title="Produtos mais Lucrativos">
        <div class="table-scroll"><table class="data-table"><thead><tr><th>Produto</th><th>Vendas</th><th>Lucro</th><th>Margem</th></tr></thead><tbody><tr v-if="!productPerformance.length"><td colspan="4"><div class="empty-state"><div><div class="empty-state__icon"><UiIcon name="box"/></div><h3>Nenhum produto cadastrado</h3><p>Cadastre produtos e vendas para ver o desempenho.</p></div></div></td></tr><tr v-for="p in productPerformance" :key="p.sku"><td><div class="table-product"><ProductThumb :type="p.thumb" :size="28"/><strong>{{ p.name }}</strong></div></td><td>{{ p.sales }}</td><td class="money-positive">{{ formatCurrency(p.orderProfit) }}</td><td><span class="badge badge--green">{{ metrics.percent(p.margin || 0) }}</span></td></tr></tbody></table></div>
      </PanelCard>
      <PanelCard title="Alertas e Recomendacoes">
        <template #actions><button class="btn btn--ghost" @click="notify('Central de alertas aberta', 'info')">Ver todos</button></template>
        <div class="alerts-list">
          <div v-if="!alerts.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="bell"/></div><h3>Nenhum alerta no momento</h3><p>Os alertas aparecem conforme seus dados forem cadastrados.</p></div></div>
          <div v-for="alert in alerts" :key="alert.title" class="alert-row"><span class="alert-row__icon"><UiIcon :name="alert.icon" :size="17"/></span><div><strong>{{ alert.title }}</strong><small>{{ alert.text }}</small></div><span class="badge" :class="alert.cls">{{ alert.badge }}</span><UiIcon name="chevron" :size="15"/></div>
        </div>
      </PanelCard>
    </div>
  </div>
</template>
