<script setup lang="ts">
const { orders, deleteItem } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()
const router = useRouter()
const search = ref('')
const status = ref('Todos')
const filtered = computed(() => orders.value.filter(o => (status.value === 'Todos' || o.status === status.value) && Object.values(o).join(' ').toLowerCase().includes(search.value.toLowerCase())))
const statusColors: Record<string, string> = { Novo: '#1768f2', Producao: '#f6b917', Impresso: '#b23bc1', Embalando: '#f57c1f', Enviado: '#2f77d5', Entregue: '#21aa91', Cancelado: '#ef4444' }
const badgeClass = (s: string) => ({ Novo: '', Producao: 'badge--orange', Impresso: 'badge--purple', Embalando: 'badge--orange', Enviado: '', Entregue: 'badge--green', Cancelado: 'badge--red' }[s] || '')
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
    <div class="metrics-grid metrics-grid--5">
      <MetricCard label="Receita Bruta" :value="formatCurrency(metrics.revenue.value)" icon="money" note="Dados do banco" color="green" />
      <MetricCard label="Receita Liquida" :value="formatCurrency(metrics.netRevenue.value)" icon="wallet" note="Dados do banco" color="blue" />
      <MetricCard label="Lucro Total" :value="formatCurrency(metrics.profit.value)" icon="money" :change="`Margem ${metrics.percent(metrics.margin.value)}`" color="green" />
      <MetricCard label="Pedidos no Mes" :value="formatNumber(metrics.orderCount.value)" icon="bag" note="Dados do banco" color="purple" />
      <MetricCard label="Frete" :value="formatCurrency(metrics.shipping.value)" icon="cart" note="Dados do banco" color="orange" negative />
    </div>
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
          <thead><tr><th>Nº Pedido</th><th>Data</th><th>Cliente</th><th>Marketplace</th><th>Produto</th><th>Qtd.</th><th>Valor Bruto</th><th>Taxa</th><th>Frete</th><th>Receita Liquida</th><th>Lucro</th><th>Status</th><th></th></tr></thead>
          <tbody><tr v-if="!filtered.length"><td colspan="13"><div class="empty-state"><div><div class="empty-state__icon"><UiIcon name="bag"/></div><h3>Nenhuma venda cadastrada</h3><p>Cadastre sua primeira venda para comecar.</p><NuxtLink class="btn btn--primary" to="/vendas/novo">Nova Venda</NuxtLink></div></div></td></tr><tr v-for="o in filtered" :key="o.id"><td><div class="table-product table-product--editable"><strong>{{ o.id }}</strong><button class="row-action row-action--edit" title="Editar pedido" @click.stop="editOrder(o)"><UiIcon name="edit" :size="15"/></button></div></td><td>{{ o.date }}</td><td>{{ o.client }}</td><td>{{ o.marketplace }}</td><td>{{ o.product }}</td><td>{{ o.qty }}</td><td>{{ formatCurrency(o.gross) }}</td><td>{{ formatCurrency(o.fee) }}</td><td>{{ formatCurrency(o.shipping) }}</td><td>{{ formatCurrency(o.net) }}</td><td>{{ formatCurrency(o.profit) }}</td><td><span class="badge" :class="badgeClass(o.status)">{{ o.status }}</span></td><td><button class="row-action" title="Excluir pedido" @click.stop="removeOrder(o)"><UiIcon name="close" :size="16"/></button></td></tr></tbody>
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
