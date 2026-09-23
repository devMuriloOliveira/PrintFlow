<script setup lang="ts">
type ReportFilters = { periodStart: string; periodEnd: string; marketplace: string; product: string; channel: 'Todos' | 'direct' | 'marketplace' }
const props = defineProps<{ filters: ReportFilters }>()
const { products, orders } = useAppData()

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
const filteredSales = computed(() => {
  const start = new Date(`${props.filters.periodStart}T00:00:00`)
  const end = new Date(`${props.filters.periodEnd}T23:59:59`)
  return orders.value.filter(order => {
    const date = parseDate(order.date)
    return date && date >= start && date <= end && !isCancelled(order.status) &&
      (props.filters.marketplace === 'Todos' || (order.marketplace || 'Sem marketplace') === props.filters.marketplace) &&
      (props.filters.product === 'Todos' || order.product === props.filters.product) &&
      (props.filters.channel === 'Todos' || order.salesChannel === props.filters.channel)
  }).sort((a, b) => Number(parseDate(b.date)) - Number(parseDate(a.date)))
})
const productRows = computed(() => {
  const totals = new Map<string, { qty: number; orders: number; revenue: number; profit: number }>()
  for (const order of filteredSales.value) {
    const name = order.product || 'Produto não informado'
    const row = totals.get(name) || { qty: 0, orders: 0, revenue: 0, profit: 0 }
    row.qty += Number(order.qty || 0)
    row.orders += 1
    row.revenue += Number(order.gross || 0)
    row.profit += Number(order.profit || 0)
    totals.set(name, row)
  }
  return [...totals.entries()].map(([name, totalsRow]) => {
    const product = products.value.find(item => item.name === name)
    return { name, product, ...totalsRow, realizedMargin: totalsRow.revenue ? totalsRow.profit / totalsRow.revenue * 100 : 0 }
  }).sort((a, b) => b.revenue - a.revenue)
})
const revenueTotal = computed(() => filteredSales.value.reduce((sum, item) => sum + Number(item.gross || 0), 0))
const profitTotal = computed(() => filteredSales.value.reduce((sum, item) => sum + Number(item.profit || 0), 0))
const quantityTotal = computed(() => filteredSales.value.reduce((sum, item) => sum + Number(item.qty || 0), 0))
const averageTicket = computed(() => filteredSales.value.length ? revenueTotal.value / filteredSales.value.length : 0)
const bestProduct = computed(() => productRows.value[0]?.name || 'Sem vendas')
const channelLabel = (value: string) => value === 'direct' ? 'Venda direta' : 'Marketplace'
</script>

<template>
  <div class="product-report">
    <div class="metrics-grid metrics-grid--4">
      <MetricCard label="Vendas" :value="formatNumber(filteredSales.length)" icon="cart" note="Pedidos não cancelados" />
      <MetricCard label="Itens vendidos" :value="formatNumber(quantityTotal)" icon="box" note="Soma das quantidades" color="cyan" />
      <MetricCard label="Faturamento" :value="formatCurrency(revenueTotal)" icon="trend" note="Valor bruto das vendas" color="purple" />
      <MetricCard label="Lucro das vendas" :value="formatCurrency(profitTotal)" icon="money" note="Antes das despesas gerais" :color="profitTotal >= 0 ? 'green' : 'red'" />
    </div>

    <div class="product-report__summary">
      <div><small>Produto líder no período</small><strong>{{ bestProduct }}</strong></div>
      <div><small>Ticket médio</small><strong>{{ formatCurrency(averageTicket) }}</strong></div>
      <div><small>Produtos com venda</small><strong>{{ formatNumber(productRows.length) }}</strong></div>
    </div>

    <PanelCard title="Desempenho por produto" subtitle="Resultado obtido nas vendas do período, não a margem atual do cadastro">
      <div v-if="!productRows.length" class="empty-state"><div><h3>Nenhuma venda encontrada</h3><p>Altere os filtros ou registre uma venda para analisar os produtos.</p></div></div>
      <div v-else class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Produto</th><th>Pedidos</th><th>Qtd.</th><th>Faturamento</th><th>Lucro registrado</th><th>Margem realizada</th></tr></thead>
          <tbody><tr v-for="item in productRows" :key="item.name"><td><div class="table-product"><ProductThumb :type="item.product?.thumb" :size="25" /><div><strong>{{ item.name }}</strong><small>{{ item.product?.sku || 'Sem vínculo com cadastro' }}</small></div></div></td><td>{{ formatNumber(item.orders) }}</td><td>{{ formatNumber(item.qty) }}</td><td>{{ formatCurrency(item.revenue) }}</td><td :class="item.profit >= 0 ? 'money-positive' : 'money-negative'">{{ formatCurrency(item.profit) }}</td><td>{{ item.realizedMargin.toFixed(1) }}%</td></tr></tbody>
        </table>
      </div>
    </PanelCard>

    <PanelCard title="Vendas consideradas" subtitle="Confira quais pedidos compõem os totais acima">
      <div v-if="!filteredSales.length" class="empty-state">Nenhuma venda encontrada no período.</div>
      <div v-else class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Data</th><th>Pedido</th><th>Produto</th><th>Canal</th><th>Qtd.</th><th>Bruto</th><th>Lucro</th><th>Status</th></tr></thead>
          <tbody><tr v-for="sale in filteredSales" :key="sale.dbId || sale.id"><td>{{ sale.date }}</td><td><strong>{{ sale.id }}</strong></td><td>{{ sale.product }}</td><td>{{ channelLabel(sale.salesChannel) }}<small class="sale-marketplace">{{ sale.marketplace }}</small></td><td>{{ formatNumber(Number(sale.qty || 0)) }}</td><td>{{ formatCurrency(Number(sale.gross || 0)) }}</td><td :class="Number(sale.profit || 0) >= 0 ? 'money-positive' : 'money-negative'">{{ formatCurrency(Number(sale.profit || 0)) }}</td><td><span class="badge">{{ sale.status }}</span></td></tr></tbody>
        </table>
      </div>
    </PanelCard>
  </div>
</template>

<style scoped>
.product-report{display:grid;width:100%;max-width:1360px;margin:0 auto;gap:16px}.product-report>.metrics-grid{width:100%;margin-bottom:0}.product-report__summary{display:grid;grid-template-columns:2fr 1fr 1fr;gap:1px;overflow:hidden;border:1px solid #dce4f0;border-radius:12px;background:#dce4f0}.product-report__summary>div{display:grid;gap:3px;padding:13px 16px;background:#fff}.product-report__summary small,.table-product small,.sale-marketplace{display:block;color:#687386;font-size:11px}.product-report__summary strong{overflow:hidden;color:#172033;text-overflow:ellipsis;white-space:nowrap}.table-product>div{display:grid;gap:2px}.sale-marketplace{margin-top:2px}@media(max-width:700px){.product-report__summary{grid-template-columns:1fr}.product-report__summary strong{white-space:normal}}
</style>
