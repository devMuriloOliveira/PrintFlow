<script setup lang="ts">
import type { ReportSummary } from '~/composables/useAppData'

const props = defineProps<{ report: ReportSummary; loading?: boolean; page: number; pageSize: number }>()
const emit = defineEmits<{ 'update:page': [value: number]; 'update:pageSize': [value: number] }>()
const filteredSales = computed(() => props.report.sales.items)
const productRows = computed(() => props.report.products.map(item => ({ ...item, qty: item.quantity, product: item, realizedMargin: item.revenue ? item.profit / item.revenue * 100 : 0 })))
const revenueTotal = computed(() => props.report.totals.revenue)
const profitTotal = computed(() => props.report.totals.registeredProfit)
const quantityTotal = computed(() => props.report.totals.itemCount)
const averageTicket = computed(() => props.report.totals.ticket)
const bestProduct = computed(() => productRows.value[0]?.name || 'Sem vendas')
const pageCount = computed(() => Math.max(1, Math.ceil(props.report.sales.total / props.pageSize)))
const pageSummary = computed(() => {
  const total = props.report.sales.total
  if (!total) return 'Nenhuma venda encontrada'
  const start = props.page * props.pageSize + 1
  const end = Math.min(start + filteredSales.value.length - 1, total)
  return `Mostrando ${start} a ${end} de ${total} vendas`
})
const changePage = (next: number) => emit('update:page', Math.min(Math.max(0, next), pageCount.value - 1))
const changePageSize = (event: Event) => { emit('update:page', 0); emit('update:pageSize', Number((event.target as HTMLSelectElement).value)) }
const channelLabel = (value: string) => value === 'direct' ? 'Venda direta' : 'Marketplace'
</script>

<template>
  <div class="report-section product-report">
    <div class="metrics-grid metrics-grid--4">
      <MetricCard label="Vendas" :value="formatNumber(report.totals.orderCount)" icon="cart" note="Pedidos não cancelados" />
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
      <div class="table-footer"><span>{{ loading ? 'Carregando vendas...' : pageSummary }}</span><div class="pagination"><button class="page-btn" :disabled="page === 0 || loading" @click="changePage(page - 1)">Anterior</button><button class="page-btn" :disabled="page + 1 >= pageCount || loading" @click="changePage(page + 1)">Próxima</button></div><select class="select-compact" :value="pageSize" :disabled="loading" @change="changePageSize"><option :value="25">25 por página</option><option :value="50">50 por página</option><option :value="100">100 por página</option></select></div>
    </PanelCard>
  </div>
</template>

<style scoped>
.product-report>.metrics-grid{width:100%;margin-bottom:0}.product-report__summary{display:grid;grid-template-columns:2fr 1fr 1fr;gap:1px;overflow:hidden;border:1px solid #dce4f0;border-radius:12px;background:#dce4f0}.product-report__summary>div{display:grid;gap:3px;padding:13px 16px;background:#fff}.product-report__summary small,.table-product small,.sale-marketplace{display:block;color:#687386;font-size:11px}.product-report__summary strong{overflow:hidden;color:#172033;text-overflow:ellipsis;white-space:nowrap}.table-product>div{display:grid;gap:2px}.sale-marketplace{margin-top:2px}@media(max-width:700px){.product-report__summary{grid-template-columns:1fr}.product-report__summary strong{white-space:normal}}
</style>
