<script setup lang="ts">
const { products, orders, expenses, expenseSegments } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()

const labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const revenue = computed(() => {
  const values = Array.from({ length: 12 }, () => 0)
  for (const order of orders.value) {
    const parts = String(order.date).split('/').map(Number)
    const month = parts.length >= 2 ? parts[1] : Number(String(order.date).slice(5, 7))
    if (month >= 1 && month <= 12) values[month - 1] += order.gross / 1000
  }
  return values
})
const expenseValues = computed(() => {
  const values = Array.from({ length: 12 }, () => 0)
  for (const expense of expenses.value) {
    const parts = String(expense.date).split('/').map(Number)
    const month = parts.length >= 2 ? parts[1] : Number(String(expense.date).slice(5, 7))
    if (month >= 1 && month <= 12) values[month - 1] += expense.value / 1000
  }
  return values
})
const marketplaceBars = computed(() => {
  const totals = new Map<string, number>()
  for (const order of orders.value) totals.set(order.marketplace || 'Sem marketplace', (totals.get(order.marketplace || 'Sem marketplace') || 0) + order.gross)
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const max = rows[0]?.[1] || 0
  return rows.map(([name, value]) => ({ name, value, percent: max ? value / max * 100 : 0 }))
})
const productRows = computed(() => {
  const totals = new Map<string, { qty: number, revenue: number, profit: number }>()
  for (const order of orders.value) {
    const row = totals.get(order.product) || { qty: 0, revenue: 0, profit: 0 }
    row.qty += order.qty
    row.revenue += order.gross
    row.profit += order.profit
    totals.set(order.product, row)
  }
  return products.value.map((product) => ({ ...product, ...(totals.get(product.name) || { qty: 0, revenue: 0, profit: 0 }) }))
})
</script>
<template>
  <div><PageHeader title="Relatórios" subtitle="Análises detalhadas para impulsionar o crescimento do seu negócio."><button class="btn" @click="notify('Relatório preparado para exportação')"><UiIcon name="download"/>Exportar</button></PageHeader>
    <div class="filters"><div class="field"><label>Período</label><input value="Período atual"></div><div class="field"><label>Agrupamento</label><select><option>Mensal</option><option>Semanal</option><option>Diário</option></select></div><div v-for="f in ['Marketplace','Produto','Categoria','Impressora']" :key="f" class="field"><label>{{f}}</label><select><option>Todos</option></select></div></div>
    <div class="metrics-grid metrics-grid--5"><MetricCard label="Faturamento" :value="formatCurrency(metrics.revenue.value)" icon="trend" note="Dados do banco"/><MetricCard label="Lucro Líquido" :value="formatCurrency(metrics.profit.value)" icon="money" note="Dados do banco" color="green"/><MetricCard label="Margem Líquida" :value="metrics.percent(metrics.margin.value)" icon="percent" note="Dados do banco" color="green"/><MetricCard label="Ticket Médio" :value="formatCurrency(metrics.ticket.value)" icon="tag" note="Dados do banco" color="orange"/><MetricCard label="Quantidade de Pedidos" :value="formatNumber(metrics.orderCount.value)" icon="bag" note="Dados do banco" color="purple"/></div>
    <div class="dashboard-grid" style="grid-template-columns:1fr 1fr 1fr 1fr"><PanelCard title="Faturamento"><LineChart :values="revenue" :labels="labels"/></PanelCard><PanelCard title="Despesas"><LineChart :values="expenseValues" :labels="labels" color="#ef4444"/></PanelCard><PanelCard title="Receita x Despesas"><LineChart :values="revenue" :second="expenseValues" :labels="labels"/></PanelCard><PanelCard title="Lucro Líquido"><LineChart :values="revenue.map((x,i)=>x-expenseValues[i])" :labels="labels" color="#0da566"/></PanelCard></div>
    <div class="dashboard-grid" style="grid-template-columns:.8fr 1.2fr"><PanelCard title="Despesas por Categoria"><DonutChart :segments="expenseSegments" :total="formatCurrency(metrics.expenseTotal.value)"/></PanelCard><PanelCard title="Faturamento por Marketplace"><div class="bar-list" style="padding:20px"><div v-if="!marketplaceBars.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="store"/></div><h3>Nenhuma venda por marketplace</h3><p>Cadastre vendas para preencher este relatório.</p></div></div><div v-for="x in marketplaceBars" :key="x.name" class="bar-row"><span>{{x.name}}</span><div class="bar-row__track"><div class="bar-row__fill" :style="{width:`${x.percent}%`,background:'#1768f2'}"/></div><strong>{{formatCurrency(x.value)}}</strong></div></div></PanelCard></div>
    <div class="dashboard-grid"><PanelCard title="Produtos mais vendidos"><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Produto</th><th>Qtd.</th><th>Faturamento</th></tr></thead><tbody><tr v-if="!productRows.length"><td colspan="4"><div class="empty-state"><div><div class="empty-state__icon"><UiIcon name="box"/></div><h3>Nenhum produto cadastrado</h3><p>Os relatórios aparecem depois dos cadastros.</p></div></div></td></tr><tr v-for="(p,i) in productRows" :key="p.sku"><td><strong>{{i+1}}</strong></td><td><div class="table-product"><ProductThumb :type="p.thumb" :size="25"/>{{p.name}}</div></td><td>{{p.qty}}</td><td>{{formatCurrency(p.revenue)}}</td></tr></tbody></table></div></PanelCard><PanelCard title="Produtos mais lucrativos"><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Produto</th><th>Lucro Líquido</th><th>Margem</th></tr></thead><tbody><tr v-for="(p,i) in productRows" :key="p.sku"><td><strong>{{i+1}}</strong></td><td>{{p.name}}</td><td>{{formatCurrency(p.profit)}}</td><td><span class="badge badge--green">{{metrics.percent(p.margin || 0)}}</span></td></tr></tbody></table></div></PanelCard><PanelCard title="Produtos com melhor margem"><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Produto</th><th>Margem</th></tr></thead><tbody><tr v-for="(p,i) in [...productRows].sort((a,b)=>(b.margin || 0)-(a.margin || 0))" :key="p.sku"><td><strong>{{i+1}}</strong></td><td>{{p.name}}</td><td class="money-positive">{{metrics.percent(p.margin || 0)}}</td></tr></tbody></table></div></PanelCard></div>
  </div>
</template>
