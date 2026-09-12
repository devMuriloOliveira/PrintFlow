<script setup lang="ts">
const { marketplaces, marketplaceIntegrations, products, deleteItem, updateItem, loadMarketplaceOrdersPage, syncMarketplaceOrder, linkMarketplaceOrderProduct, startMarketplaceOAuth, disconnectMarketplaceIntegration } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()
const router = useRouter()
const route = useRoute()
const activeSection = computed(() => ['canais', 'conexoes', 'pedidos'].includes(String(route.query.secao)) ? String(route.query.secao) : 'canais')
const saleValue = ref(100)
const selectedName = ref('Shopee')
const marketplaceFilter = ref('Todos os canais')
const marketplaceSearch = ref('')
const linkingOrderId = ref('')
const changingMarketplaceId = ref('')
const connectionActionId = ref('')
const selectedProductByOrder = reactive<Record<string, string>>({})
const marketplacePageItems = ref<any[]>([])
const marketplacePage = ref(0)
const marketplacePageSize = ref(25)
const marketplaceTotal = ref(0)
const marketplacePageLoading = ref(false)
const emptyMarketplace = { name: '', short: '', color: '#1768f2', commission: 0, fixed: 0, financial: 0, ads: 0, others: 0, gross: 0, net: 0, orders: 0, active: false }
const selected = computed(() => marketplaces.value.find(m=>m.name===selectedName.value) || marketplaces.value[0] || emptyMarketplace)
const marketplaceOptions = computed(() => ['Todos os canais', ...new Set(marketplaces.value.map((marketplace: any) => String(marketplace.name || '').trim()).filter(Boolean))])
const filteredMarketplaces = computed(() => marketplaces.value.filter((marketplace: any) =>
  (marketplaceFilter.value === 'Todos os canais' || marketplace.name === marketplaceFilter.value) &&
  Object.values(marketplace).join(' ').toLowerCase().includes(marketplaceSearch.value.toLowerCase())
))
const clearMarketplaceFilters = () => { marketplaceFilter.value = 'Todos os canais'; marketplaceSearch.value = '' }
const feeRate = (marketplace: any) => marketplace.gross > 0 && marketplace.fees !== undefined ? Number(marketplace.fees || 0) / Number(marketplace.gross) * 100 : Number(marketplace.commission || 0) + Number(marketplace.financial || 0) + Number(marketplace.ads || 0) + Number(marketplace.others || 0)
const fees = computed(() => selected.value ? ({ commission: saleValue.value*selected.value.commission/100, fixed:selected.value.fixed, financial:saleValue.value*selected.value.financial/100, ads:saleValue.value*selected.value.ads/100, others:saleValue.value*selected.value.others/100 }) : ({ commission: 0, fixed: 0, financial: 0, ads: 0, others: 0 }))
const net = computed(() => saleValue.value-Object.values(fees.value).reduce((a,b)=>a+b,0))
const pendingMarketplaceOrders = computed(() => marketplacePageItems.value.filter((order: any) => !['completed', 'cancelled', 'canceled', 'refunded'].includes(String(order.printJobStatus || order.status || '').toLowerCase())))
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
const reconnectConnection = async (integration: any) => {
  if (!integration?.id || connectionActionId.value) return
  connectionActionId.value = integration.id
  try {
    window.location.href = await startMarketplaceOAuth(integration.platform)
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível iniciar a reconexão.', 'info')
    connectionActionId.value = ''
  }
}
const disconnectConnection = async (integration: any) => {
  if (!integration?.id || connectionActionId.value) return
  if (!window.confirm(`Desconectar esta conta do Mercado Livre?\n\n${integration.connectionName || integration.accountExternalId}\n\nO histórico de pedidos será preservado.`)) return
  connectionActionId.value = integration.id
  try {
    await disconnectMarketplaceIntegration(integration.id)
    notify('Conta do Mercado Livre desconectada. O histórico foi preservado.')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível desconectar a conta.', 'info')
  } finally {
    connectionActionId.value = ''
  }
}
const syncConnectionOrder = async (integration: any) => {
  if (!integration?.id || connectionActionId.value) return
  const externalOrderId = window.prompt('Informe o ID do pedido no Mercado Livre:')?.trim()
  if (!externalOrderId) return
  connectionActionId.value = integration.id
  try {
    await syncMarketplaceOrder(integration.id, externalOrderId)
    notify('Pedido sincronizado com sucesso.')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível sincronizar o pedido.', 'info')
  } finally {
    connectionActionId.value = ''
  }
}
const tokenStatusLabel = (integration: any) => {
  if (integration.status === 'error') return 'Erro de conexão'
  if (integration.status === 'disconnected') return 'Desconectada'
  if (integration.tokenExpiresAt && new Date(integration.tokenExpiresAt).getTime() <= Date.now()) return 'Token expirado'
  return 'Conectada'
}
const tokenStatusClass = (integration: any) => ['connected'].includes(integration.status) && tokenStatusLabel(integration) === 'Conectada' ? 'badge--green' : integration.status === 'error' ? 'badge--red' : 'badge--orange'
const formatSyncDate = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Ainda não sincronizada'
const formatTokenExpiry = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'não informado'
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
const loadMarketplacePage = async (reset = true) => {
  if (activeSection.value !== 'pedidos') return
  if (reset) marketplacePage.value = 0
  marketplacePageLoading.value = true
  try {
    const result = await loadMarketplaceOrdersPage({ limit: marketplacePageSize.value, offset: marketplacePage.value * marketplacePageSize.value })
    marketplacePageItems.value = result.items
    marketplaceTotal.value = result.total
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel carregar os pedidos do marketplace.', 'info')
  } finally { marketplacePageLoading.value = false }
}
const changeMarketplacePage = (page: number) => { const maxPage = Math.max(0, Math.ceil(marketplaceTotal.value / marketplacePageSize.value) - 1); marketplacePage.value = Math.min(Math.max(0, page), maxPage); void loadMarketplacePage(false) }
const linkOrderProduct = async (order: any) => {
  const productId = selectedProductByOrder[order.id] || order.suggestedProductId || order.mappedProductId || ''
  if (!order.id || !productId || linkingOrderId.value) return
  linkingOrderId.value = order.id
  try {
    await linkMarketplaceOrderProduct(order.id, productId)
    notify('Pedido vinculado ao produto. Confirme na tela de impressoras antes de imprimir.')
    await loadMarketplacePage(false)
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível vincular o pedido.', 'info')
  } finally {
    linkingOrderId.value = ''
  }
}
const refreshOrdersIfNeeded = () => activeSection.value === 'pedidos' ? loadMarketplacePage() : Promise.resolve()
onMounted(() => {
  void refreshOrdersIfNeeded()
  if (route.query.oauth === 'connected' && route.query.platform === 'mercado_livre') {
    notify('Conta do Mercado Livre conectada com sucesso.')
    void router.replace({ query: {} })
  }
})
watch(() => route.fullPath, () => { void refreshOrdersIfNeeded() })
</script>

<template>
  <div>
    <PageHeader title="Marketplaces" subtitle="Gerencie seus canais de venda e estruturas de taxas"><a class="btn btn--primary" href="/marketplaces/novo"><UiIcon name="plus" />Adicionar canal</a></PageHeader>
    <div v-if="activeSection !== 'pedidos'" class="split-layout" style="grid-template-columns:minmax(0,1fr) 330px">
      <div>
        <div class="metrics-grid metrics-grid--4"><MetricCard label="Canais Cadastrados" :value="formatNumber(marketplaces.length)" icon="store" :change="`${metrics.activeMarketplaces.value} ativos`" :points="marketplaces.map(marketplace => marketplace.active ? 1 : 0)" /><MetricCard label="Taxa Média" :value="metrics.percent(metrics.marketplaceAverageFee.value)" icon="percent" change="Sobre o valor bruto" color="green" :points="marketplaces.map(feeRate)" /><MetricCard label="Maior Receita Líquida" :value="formatCurrency(metrics.bestMarketplace.value?.net || 0)" icon="trend" :change="metrics.bestMarketplace.value?.name || '-'" color="green" :points="marketplaces.map(marketplace => Number(marketplace.net || 0))" /><MetricCard label="Maior Taxa" :value="metrics.percent(metrics.highestFeeMarketplace.value ? feeRate(metrics.highestFeeMarketplace.value) : 0)" icon="percent" :change="metrics.highestFeeMarketplace.value?.name || '-'" color="orange" :points="marketplaces.map(feeRate)" /></div>
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
        <PanelCard v-if="activeSection === 'conexoes'" title="Contas conectadas do Mercado Livre" subtitle="Cada conta OAuth recebe pedidos separadamente; as taxas permanecem configuradas no canal Mercado Livre." style="margin-top:12px">
          <div v-for="integration in marketplaceConnections" :key="integration.id" class="connection-row"><div><strong>{{ integration.connectionName || 'Mercado Livre' }}</strong><small style="display:block;color:var(--muted)">Conta {{ integration.accountExternalId || 'protegida' }} · Última sincronização: {{ formatSyncDate(integration.lastSyncAt) }} · Token expira: {{ formatTokenExpiry(integration.tokenExpiresAt) }}</small><small v-if="integration.lastError" style="display:block;color:var(--danger,#c0392b)">{{ integration.lastError }}</small></div><div class="connection-row__actions"><span class="badge" :class="tokenStatusClass(integration)">{{ tokenStatusLabel(integration) }}</span><button type="button" class="row-action" :disabled="connectionActionId === integration.id" title="Sincronizar pedido por ID" @click="syncConnectionOrder(integration)"><UiIcon name="refresh" :size="15" /></button><button type="button" class="row-action" :disabled="connectionActionId === integration.id" title="Reconectar conta" @click="reconnectConnection(integration)"><UiIcon name="refresh" :size="15" /></button><button type="button" class="row-action" :disabled="connectionActionId === integration.id" title="Desconectar conta" @click="disconnectConnection(integration)"><UiIcon name="close" :size="15" /></button></div></div>
          <div v-if="!marketplaceConnections.length" style="color:var(--muted);font-size:11px">Nenhuma conta OAuth conectada ainda.</div>
        </PanelCard>
      </div>
      <aside>
        <PanelCard title="Simulação de taxas" subtitle="Veja o impacto das taxas em uma venda simulada."><div class="field"><label>Valor da venda</label><input v-model.number="saleValue" type="number"></div><div class="field" style="margin-top:10px"><label>Selecionar marketplace</label><select v-model="selectedName"><option v-for="m in marketplaces" :key="m.name">{{m.name}}</option></select></div><div class="detail-list" style="margin-top:8px"><div class="detail-list__row"><span>Comissão ({{selected.commission}}%)</span><strong>- {{formatCurrency(fees.commission)}}</strong></div><div class="detail-list__row"><span>Tarifa fixa</span><strong>- {{formatCurrency(fees.fixed)}}</strong></div><div class="detail-list__row"><span>Taxa financeira</span><strong>- {{formatCurrency(fees.financial)}}</strong></div><div class="detail-list__row"><span>Custo de anúncio</span><strong>- {{formatCurrency(fees.ads)}}</strong></div><div class="detail-list__row"><span>Outras tarifas</span><strong>- {{formatCurrency(fees.others)}}</strong></div></div><div class="summary-box"><small>Receita Líquida</small><strong class="money-positive" style="display:block;font-size:23px;margin-top:6px">{{formatCurrency(net)}}</strong><span class="badge badge--green" style="margin-top:7px">{{(net/saleValue*100).toFixed(1)}}% do bruto</span></div><button class="btn btn--wide" style="margin-top:12px" @click="notify('Comparação calculada com os canais ativos')">Comparar marketplaces</button></PanelCard>
        <PanelCard title="Faturamento por marketplace" style="margin-top:12px"><div class="bar-list"><div v-for="m in marketplaces" :key="m.name" class="bar-row" style="grid-template-columns:75px 1fr auto"><span>{{m.name}}</span><div class="bar-row__track"><div class="bar-row__fill" :style="{width:`${m.gross/(metrics.revenue.value || 1)*100}%`,background:m.color}" /></div><strong>{{formatCurrency(m.gross)}}</strong></div></div></PanelCard>
      </aside>
    </div>
    <PanelCard v-if="activeSection === 'pedidos'" title="Pedidos recebidos dos marketplaces" subtitle="Revise o pedido, confira o SKU e vincule ao produto antes de liberar para impressão." style="margin-top:12px">
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
      <div class="table-footer" style="margin-top:12px">
        <span>{{ marketplacePageLoading ? 'Carregando pedidos...' : `Exibindo ${marketplaceTotal ? (marketplacePage * marketplacePageSize + 1) : 0}-${Math.min((marketplacePage + 1) * marketplacePageSize, marketplaceTotal)} de ${marketplaceTotal} pedidos` }}</span>
        <div class="pagination">
          <button class="page-btn" type="button" :disabled="marketplacePage === 0 || marketplacePageLoading" @click="changeMarketplacePage(marketplacePage - 1)">Anterior</button>
          <button class="page-btn" type="button" :disabled="(marketplacePage + 1) * marketplacePageSize >= marketplaceTotal || marketplacePageLoading" @click="changeMarketplacePage(marketplacePage + 1)">PrÃ³xima</button>
          <select v-model.number="marketplacePageSize" :disabled="marketplacePageLoading" aria-label="Pedidos por pÃ¡gina" @change="loadMarketplacePage()"><option :value="25">25/pÃ¡gina</option><option :value="50">50/pÃ¡gina</option><option :value="100">100/pÃ¡gina</option></select>
        </div>
      </div>
    </PanelCard>
  </div>
</template>

<style scoped>
.market-cell{display:flex;align-items:center;gap:8px;white-space:nowrap}
.connection-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.connection-row:last-child{border-bottom:0}
.connection-row__actions{display:flex;align-items:center;gap:6px;white-space:nowrap}
.section-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 20px;border-bottom:1px solid var(--line);padding:0 0 10px}
.section-tabs a{flex:0 0 auto;border:1px solid var(--line);border-radius:999px;padding:8px 14px;color:var(--muted);font-size:13px;font-weight:700;text-decoration:none;transition:background .15s ease,border-color .15s ease,color .15s ease}
.section-tabs a:hover,.section-tabs a.active{border-color:#9ebcf8;background:#eef4ff;color:var(--blue)}
.section-tabs a:focus-visible{outline:3px solid rgba(23,104,242,.25);outline-offset:2px}
@media (max-width:780px){.section-tabs{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:thin;padding:4px 2px 12px;margin-bottom:14px}.section-tabs a{white-space:nowrap}.connection-row{align-items:flex-start;flex-direction:column}.connection-row__actions{width:100%;justify-content:flex-end}.table-footer{align-items:flex-start;flex-direction:column;gap:10px}.table-footer .pagination{width:100%;justify-content:space-between}}
</style>
