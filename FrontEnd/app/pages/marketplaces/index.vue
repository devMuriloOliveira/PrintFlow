<script setup lang="ts">
const { marketplaces, products, marketplaceOrders, deleteItem, refreshMarketplaceOrders, linkMarketplaceOrderProduct } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()
const router = useRouter()
const saleValue = ref(100)
const selectedName = ref('Shopee')
const linkingOrderId = ref('')
const selectedProductByOrder = reactive<Record<string, string>>({})
const emptyMarketplace = { name: '', short: '', color: '#1768f2', commission: 0, fixed: 0, financial: 0, ads: 0, others: 0, gross: 0, net: 0, orders: 0, active: false }
const selected = computed(() => marketplaces.value.find(m=>m.name===selectedName.value) || marketplaces.value[0] || emptyMarketplace)
const fees = computed(() => selected.value ? ({ commission: saleValue.value*selected.value.commission/100, fixed:selected.value.fixed, financial:saleValue.value*selected.value.financial/100, ads:saleValue.value*selected.value.ads/100, others:saleValue.value*selected.value.others/100 }) : ({ commission: 0, fixed: 0, financial: 0, ads: 0, others: 0 }))
const net = computed(() => saleValue.value-Object.values(fees.value).reduce((a,b)=>a+b,0))
const pendingMarketplaceOrders = computed(() => marketplaceOrders.value.filter((order: any) => !['completed', 'cancelled', 'canceled', 'refunded'].includes(String(order.printJobStatus || order.status || '').toLowerCase())))
const editMarketplace = (marketplace: any) => {
  if (!marketplace.id) return
  router.push(`/marketplaces/novo?id=${marketplace.id}`)
}
const removeMarketplace = async (marketplace: any) => {
  if (!marketplace.id || !window.confirm(`Excluir marketplace?\n\n${marketplace.name}\n\nEsta ação não poderá ser desfeita.`)) return
  await deleteItem('marketplaces', marketplace.id)
  notify('Marketplace excluído com sucesso.')
}
const marketplaceOrderLabel = (order: any) => {
  if (order.printJobStatus === 'awaiting_confirmation') return 'Aguardando confirmação'
  if (order.printJobStatus === 'queued') return 'Liberado para fila'
  if (order.printJobStatus) return order.printJobStatus
  return 'Aguardando vínculo'
}
const marketplaceOrderBadgeClass = (order: any) => {
  if (order.printJobStatus === 'awaiting_confirmation') return 'badge--orange'
  if (order.printJobStatus === 'queued') return 'badge--green'
  if (order.printJobStatus === 'cancelled') return 'badge--red'
  return 'badge--gray'
}
const linkOrderProduct = async (order: any) => {
  const productId = selectedProductByOrder[order.id] || order.suggestedProductId || order.mappedProductId || ''
  if (!order.id || !productId || linkingOrderId.value) return
  linkingOrderId.value = order.id
  try {
    await linkMarketplaceOrderProduct(order.id, productId)
    notify('Pedido vinculado ao produto. Confirme na tela de impressoras antes de imprimir.')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível vincular o pedido.', 'info')
  } finally {
    linkingOrderId.value = ''
  }
}
onMounted(() => {
  void refreshMarketplaceOrders().catch(() => {})
})
</script>

<template>
  <div>
    <PageHeader title="Marketplaces" subtitle="Gerencie seus canais de venda e estruturas de taxas"><a class="btn btn--primary" href="/marketplaces/novo"><UiIcon name="plus" />Novo Marketplace</a></PageHeader>
    <div class="split-layout" style="grid-template-columns:minmax(0,1fr) 330px">
      <div>
        <div class="metrics-grid metrics-grid--4"><MetricCard label="Canais Cadastrados" :value="formatNumber(marketplaces.length)" icon="store" :change="`${metrics.activeMarketplaces.value} ativos`" /><MetricCard label="Taxa Média" :value="metrics.percent(metrics.marketplaceAverageFee.value)" icon="percent" change="Sobre o valor bruto" color="green" /><MetricCard label="Maior Receita Líquida" :value="formatCurrency(metrics.bestMarketplace.value?.net || 0)" icon="trend" :change="metrics.bestMarketplace.value?.name || '-'" color="green" /><MetricCard label="Maior Taxa" :value="metrics.percent((metrics.highestFeeMarketplace.value?.commission || 0) + (metrics.highestFeeMarketplace.value?.financial || 0) + (metrics.highestFeeMarketplace.value?.ads || 0) + (metrics.highestFeeMarketplace.value?.others || 0))" icon="percent" :change="metrics.highestFeeMarketplace.value?.name || '-'" color="orange" /></div>
        <PanelCard>
          <div class="filters" style="border:0;box-shadow:none;margin:-8px -10px 5px"><div class="field"><label>Canal</label><select><option>Todos os canais</option></select></div><div class="field field--search"><label>Buscar</label><div class="search-field"><UiIcon name="search" :size="16" /><input placeholder="Buscar marketplace..."></div></div></div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>Marketplace</th><th>Conexão</th><th>Comissão</th><th>Tarifa Fixa</th><th>Taxa Financeira</th><th>Custo Anúncio</th><th>Outras Tarifas</th><th>Receita Bruta</th><th>Receita Líquida</th><th>Pedidos</th><th>Status</th><th></th></tr></thead>
              <tbody>
                <tr v-for="m in marketplaces" :key="m.id || m.name">
                  <td><div class="table-product table-product--editable"><MarketplaceLogo :platform="m.platform" :name="m.name" :short="m.short" :size="28" /><strong>{{m.name}}</strong><button class="row-action row-action--edit" title="Editar marketplace" @click.stop="editMarketplace(m)"><UiIcon name="edit" :size="15" /></button></div></td>
                  <td><span class="badge" :class="m.connectionStatus==='connected'?'badge--green':'badge--gray'">{{m.connectionStatus==='connected'?'Conectado':'Manual'}}</span></td>
                  <td>{{m.commission}}%</td>
                  <td>{{formatCurrency(m.fixed)}}</td>
                  <td>{{m.financial}}%</td>
                  <td>{{m.ads}}%</td>
                  <td>{{m.others}}%</td>
                  <td>{{formatCurrency(m.gross)}}</td>
                  <td class="money-positive">{{formatCurrency(m.net)}}</td>
                  <td>{{m.orders}}</td>
                  <td><button class="switch" :class="{active:m.active}" /></td>
                  <td><button class="row-action" title="Excluir marketplace" @click.stop="removeMarketplace(m)"><UiIcon name="close" :size="16" /></button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="table-footer"><span>Exibindo {{ marketplaces.length }} de {{ marketplaces.length }} marketplaces</span><div class="pagination"><button class="page-btn active">1</button></div></div>
        </PanelCard>
      </div>
      <aside>
        <PanelCard title="Simulação de taxas" subtitle="Veja o impacto das taxas em uma venda simulada."><div class="field"><label>Valor da venda</label><input v-model.number="saleValue" type="number"></div><div class="field" style="margin-top:10px"><label>Selecionar marketplace</label><select v-model="selectedName"><option v-for="m in marketplaces" :key="m.name">{{m.name}}</option></select></div><div class="detail-list" style="margin-top:8px"><div class="detail-list__row"><span>Comissão ({{selected.commission}}%)</span><strong>- {{formatCurrency(fees.commission)}}</strong></div><div class="detail-list__row"><span>Tarifa fixa</span><strong>- {{formatCurrency(fees.fixed)}}</strong></div><div class="detail-list__row"><span>Taxa financeira</span><strong>- {{formatCurrency(fees.financial)}}</strong></div><div class="detail-list__row"><span>Custo de anúncio</span><strong>- {{formatCurrency(fees.ads)}}</strong></div><div class="detail-list__row"><span>Outras tarifas</span><strong>- {{formatCurrency(fees.others)}}</strong></div></div><div class="summary-box"><small>Receita Líquida</small><strong class="money-positive" style="display:block;font-size:23px;margin-top:6px">{{formatCurrency(net)}}</strong><span class="badge badge--green" style="margin-top:7px">{{(net/saleValue*100).toFixed(1)}}% do bruto</span></div><button class="btn btn--wide" style="margin-top:12px" @click="notify('Comparação calculada com os canais ativos')">Comparar marketplaces</button></PanelCard>
        <PanelCard title="Faturamento por marketplace" style="margin-top:12px"><div class="bar-list"><div v-for="m in marketplaces" :key="m.name" class="bar-row" style="grid-template-columns:75px 1fr auto"><span>{{m.name}}</span><div class="bar-row__track"><div class="bar-row__fill" :style="{width:`${m.gross/(metrics.revenue.value || 1)*100}%`,background:m.color}" /></div><strong>{{formatCurrency(m.gross)}}</strong></div></div></PanelCard>
      </aside>
    </div>
    <PanelCard title="Pedidos recebidos dos marketplaces" subtitle="Revise o pedido, confira o SKU e vincule ao produto antes de liberar para impressão." style="margin-top:12px">
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Pedido</th><th>Canal</th><th>SKU externo</th><th>Produto recebido</th><th>Produto PrintFlow</th><th>Qtd.</th><th>Valor</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr v-for="order in pendingMarketplaceOrders" :key="order.id">
              <td><strong>{{ order.externalOrderId || order.id }}</strong></td>
              <td><div class="market-cell"><MarketplaceLogo :platform="order.platform" :name="order.platform" :size="24" /><span>{{ order.platform }}</span></div></td>
              <td>{{ order.externalSku || '-' }}</td>
              <td>{{ order.productName || '-' }}</td>
              <td>
                <select v-model="selectedProductByOrder[order.id]" :disabled="Boolean(order.printJobId)" style="min-width:190px">
                  <option :value="order.mappedProductId || order.suggestedProductId || ''">{{ order.mappedProductName || order.suggestedProductName || 'Selecionar produto' }}</option>
                  <option v-for="product in products" :key="product.id || product.sku" :value="product.id">{{ product.name }} - {{ product.sku }}</option>
                </select>
              </td>
              <td>{{ order.quantity }}</td>
              <td>{{ formatCurrency(order.gross) }}</td>
              <td><span class="badge" :class="marketplaceOrderBadgeClass(order)">{{ marketplaceOrderLabel(order) }}</span></td>
              <td><button v-if="!order.printJobId" type="button" class="btn btn--primary" :disabled="linkingOrderId !== '' || !(selectedProductByOrder[order.id] || order.suggestedProductId || order.mappedProductId)" @click="linkOrderProduct(order)">Vincular</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="!pendingMarketplaceOrders.length" style="margin-top:10px;color:var(--muted);font-size:10px">Nenhum pedido de marketplace aguardando revisão.</div>
    </PanelCard>
  </div>
</template>

<style scoped>
.market-cell{display:flex;align-items:center;gap:8px;white-space:nowrap}
</style>
