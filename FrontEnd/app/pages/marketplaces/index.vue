<script setup lang="ts">
const { marketplaces, marketplaceIntegrations, products, marketplaceOrders, deleteItem, updateItem, refreshMarketplaceOrders, linkMarketplaceOrderProduct, startMarketplaceOAuth } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()
const router = useRouter()
const route = useRoute()
const saleValue = ref(100)
const selectedName = ref('Shopee')
const marketplaceFilter = ref('Todos os canais')
const marketplaceSearch = ref('')
const linkingOrderId = ref('')
const changingMarketplaceId = ref('')
const oauthLoading = ref(false)
const selectedProductByOrder = reactive<Record<string, string>>({})
const emptyMarketplace = { name: '', short: '', color: '#1768f2', commission: 0, fixed: 0, financial: 0, ads: 0, others: 0, gross: 0, net: 0, orders: 0, active: false }
const selected = computed(() => marketplaces.value.find(m=>m.name===selectedName.value) || marketplaces.value[0] || emptyMarketplace)
const marketplaceOptions = computed(() => ['Todos os canais', ...new Set(marketplaces.value.map((marketplace: any) => String(marketplace.name || '').trim()).filter(Boolean))])
const filteredMarketplaces = computed(() => marketplaces.value.filter((marketplace: any) =>
  (marketplaceFilter.value === 'Todos os canais' || marketplace.name === marketplaceFilter.value) &&
  Object.values(marketplace).join(' ').toLowerCase().includes(marketplaceSearch.value.toLowerCase())
))
const clearMarketplaceFilters = () => { marketplaceFilter.value = 'Todos os canais'; marketplaceSearch.value = '' }
const fees = computed(() => selected.value ? ({ commission: saleValue.value*selected.value.commission/100, fixed:selected.value.fixed, financial:saleValue.value*selected.value.financial/100, ads:saleValue.value*selected.value.ads/100, others:saleValue.value*selected.value.others/100 }) : ({ commission: 0, fixed: 0, financial: 0, ads: 0, others: 0 }))
const net = computed(() => saleValue.value-Object.values(fees.value).reduce((a,b)=>a+b,0))
const pendingMarketplaceOrders = computed(() => marketplaceOrders.value.filter((order: any) => !['completed', 'cancelled', 'canceled', 'refunded'].includes(String(order.printJobStatus || order.status || '').toLowerCase())))
const marketplaceConnections = computed(() => marketplaceIntegrations.value.filter((integration: any) => integration.platform === 'mercado_livre'))
const editMarketplace = (marketplace: any) => {
  if (!marketplace.id) return
  router.push(`/marketplaces/novo?id=${marketplace.id}`)
}
const removeMarketplace = async (marketplace: any) => {
  if (!marketplace.id || !window.confirm(`Excluir marketplace?\n\n${marketplace.name}\n\nEsta ação não poderá ser desfeita.`)) return
  changingMarketplaceId.value = marketplace.id
  try {
    await deleteItem('marketplaces', marketplace.id)
    notify('Marketplace excluído com sucesso.')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível excluir o marketplace.', 'info')
  } finally {
    changingMarketplaceId.value = ''
  }
}
const toggleMarketplace = async (marketplace: any) => {
  if (!marketplace.id || changingMarketplaceId.value) return
  changingMarketplaceId.value = marketplace.id
  try {
    await updateItem('marketplaces', { ...marketplace, active: !marketplace.active })
    notify(marketplace.active ? 'Marketplace desativado.' : 'Marketplace ativado.')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível atualizar o status do marketplace.', 'info')
  } finally {
    changingMarketplaceId.value = ''
  }
}
const connectAnotherMercadoLivreAccount = async () => {
  if (oauthLoading.value) return
  const confirmed = window.confirm('Conectar outra conta do Mercado Livre?\n\nNa próxima página, entre com a conta principal que deseja adicionar. Se autorizar a mesma conta, a conexão existente será atualizada.')
  if (!confirmed) return
  oauthLoading.value = true
  try {
    window.location.href = await startMarketplaceOAuth('mercado_livre')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível iniciar a autorização do Mercado Livre.', 'info')
    oauthLoading.value = false
  }
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
  if (route.query.oauth === 'connected' && route.query.platform === 'mercado_livre') {
    notify('Conta do Mercado Livre conectada com sucesso.')
    void router.replace({ query: {} })
  }
})
</script>

<template>
  <div>
    <PageHeader title="Marketplaces" subtitle="Gerencie seus canais de venda e estruturas de taxas"><div style="display:flex;gap:8px"><button type="button" class="btn" :disabled="oauthLoading" @click="connectAnotherMercadoLivreAccount"><UiIcon name="plus" />{{ oauthLoading ? 'Abrindo...' : 'Conectar conta ML' }}</button><a class="btn btn--primary" href="/marketplaces/novo"><UiIcon name="plus" />Novo Marketplace</a></div></PageHeader>
    <div class="split-layout" style="grid-template-columns:minmax(0,1fr) 330px">
      <div>
        <div class="metrics-grid metrics-grid--4"><MetricCard label="Canais Cadastrados" :value="formatNumber(marketplaces.length)" icon="store" :change="`${metrics.activeMarketplaces.value} ativos`" :points="marketplaces.map(marketplace => marketplace.active ? 1 : 0)" /><MetricCard label="Taxa Média" :value="metrics.percent(metrics.marketplaceAverageFee.value)" icon="percent" change="Sobre o valor bruto" color="green" :points="marketplaces.map(marketplace => Number(marketplace.commission || 0) + Number(marketplace.financial || 0) + Number(marketplace.ads || 0) + Number(marketplace.others || 0))" /><MetricCard label="Maior Receita Líquida" :value="formatCurrency(metrics.bestMarketplace.value?.net || 0)" icon="trend" :change="metrics.bestMarketplace.value?.name || '-'" color="green" :points="marketplaces.map(marketplace => Number(marketplace.net || 0))" /><MetricCard label="Maior Taxa" :value="metrics.percent((metrics.highestFeeMarketplace.value?.commission || 0) + (metrics.highestFeeMarketplace.value?.financial || 0) + (metrics.highestFeeMarketplace.value?.ads || 0) + (metrics.highestFeeMarketplace.value?.others || 0))" icon="percent" :change="metrics.highestFeeMarketplace.value?.name || '-'" color="orange" :points="marketplaces.map(marketplace => Number(marketplace.commission || 0) + Number(marketplace.financial || 0) + Number(marketplace.ads || 0) + Number(marketplace.others || 0))" /></div>
        <PanelCard>
          <div class="filters" style="border:0;box-shadow:none;margin:-8px -10px 5px"><div class="field"><label>Canal</label><select v-model="marketplaceFilter"><option v-for="option in marketplaceOptions" :key="option">{{option}}</option></select></div><div class="field field--search"><label>Buscar</label><div class="search-field"><UiIcon name="search" :size="16" /><input v-model="marketplaceSearch" placeholder="Buscar marketplace..."></div></div><button class="btn" type="button" @click="clearMarketplaceFilters"><UiIcon name="close" />Limpar</button></div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>Marketplace</th><th>Conexão</th><th>Comissão</th><th>Tarifa Fixa</th><th>Taxa Financeira</th><th>Custo Anúncio</th><th>Outras Tarifas</th><th>Receita Bruta</th><th>Receita Líquida</th><th>Pedidos</th><th>Status</th><th></th></tr></thead>
              <tbody>
                <tr v-for="m in filteredMarketplaces" :key="m.id || m.name">
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
                  <td><button class="switch" :class="{active:m.active}" :disabled="changingMarketplaceId === m.id" :title="m.active ? 'Desativar marketplace' : 'Ativar marketplace'" @click.stop="toggleMarketplace(m)" /></td>
                  <td><button class="row-action" :disabled="changingMarketplaceId === m.id" title="Excluir marketplace" @click.stop="removeMarketplace(m)"><UiIcon name="close" :size="16" /></button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="table-footer"><span>Exibindo {{ filteredMarketplaces.length }} de {{ marketplaces.length }} marketplaces</span><div class="pagination"><button class="page-btn active">1</button></div></div>
        </PanelCard>
        <PanelCard title="Contas conectadas do Mercado Livre" subtitle="Cada conta OAuth recebe pedidos separadamente; as taxas permanecem configuradas no canal Mercado Livre." style="margin-top:12px">
          <div v-for="integration in marketplaceConnections" :key="integration.id" class="detail-list__row"><span><strong>{{ integration.connectionName || 'Mercado Livre' }}</strong><small style="display:block;color:var(--muted)">Conta {{ integration.accountExternalId || 'protegida' }}</small></span><span class="badge" :class="integration.status === 'connected' ? 'badge--green' : 'badge--gray'">{{ integration.status === 'connected' ? 'Conectada' : integration.status }}</span></div>
          <div v-if="!marketplaceConnections.length" style="color:var(--muted);font-size:11px">Nenhuma conta OAuth conectada ainda.</div>
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
          <thead><tr><th>Pedido</th><th>Canal</th><th>SKU externo</th><th>Produto recebido</th><th>Produto PrintFlow</th><th>Qtd.</th><th>Valor</th><th>Taxa ML</th><th>Frete</th><th>Status</th><th></th></tr></thead>
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
              <td>{{ formatCurrency(order.marketplaceFee) }}</td>
              <td>{{ formatCurrency(order.shipping) }}</td>
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
