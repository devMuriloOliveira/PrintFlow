<script setup lang="ts">
const { orders, products, clients, createItem, updateItem } = useAppData()
const { notify } = useUi()
const subscription = useSubscriptionAccess()
const route = useRoute()
const saving = ref(false)
const errors = reactive<Record<string, string>>({})
const localToday = () => {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}
const form = reactive({
  id: '', date: localToday(), clientId: '', client: '', marketplace: '', productId: '', product: '',
  salesChannel: 'direct' as 'direct' | 'marketplace', qty: 1, gross: 0, fee: 0, shipping: 0, cost: 0, status: 'Novo'
})
const editId = computed(() => typeof route.query.id === 'string' ? route.query.id : '')
const isEditing = computed(() => Boolean(editId.value))
const monthlyLimitReached = computed(() => !isEditing.value && subscription.isLimitReached('ordersMonthly'))
const hydrated = ref(false)
const selectedProduct = computed(() => products.value.find(item => String(item.id || '') === form.productId))
const net = computed(() => Number(form.gross || 0) - Number(form.fee || 0) - Number(form.shipping || 0))
const profit = computed(() => net.value - Number(form.cost || 0))
const margin = computed(() => Number(form.gross || 0) > 0 ? profit.value / Number(form.gross) * 100 : 0)
const totalDeductions = computed(() => Number(form.fee || 0) + Number(form.shipping || 0) + Number(form.cost || 0))
const resultClass = computed(() => profit.value < 0 ? 'money-negative' : 'money-positive')

watchEffect(() => {
  if (!editId.value || hydrated.value) return
  const order = orders.value.find(item => item.dbId === editId.value || item.id === editId.value)
  if (!order) return
  Object.assign(form, {
    id: order.id, date: toDateInputValue(order.date), clientId: String(order.clientId || ''), client: order.client,
    marketplace: order.marketplace, productId: String(order.productId || ''), product: order.product,
    salesChannel: order.salesChannel || (order.marketplace ? 'marketplace' : 'direct'), qty: order.qty, gross: order.gross,
    fee: order.fee, shipping: order.shipping, cost: Number(order.net || 0) - Number(order.profit || 0), status: order.status
  })
  hydrated.value = true
})

watch(() => form.clientId, (id) => {
  const client = clients.value.find(item => String(item.id || '') === id)
  if (client) form.client = client.name
})

watch(() => form.productId, (id, previousId) => {
  const product = products.value.find(item => String(item.id || '') === id)
  if (!product) return
  form.product = product.name
  if (!previousId && !isEditing.value && !form.gross && !form.cost) applyCatalogValues()
})

watch(() => form.salesChannel, (channel) => {
  if (channel === 'direct') form.marketplace = ''
})

const applyCatalogValues = () => {
  const product = selectedProduct.value
  if (!product) return
  const quantity = Math.max(1, Number(form.qty || 1))
  form.gross = Number(product.price || 0) * quantity
  form.cost = Number(product.cost || 0) * quantity
}

const validate = () => {
  Object.keys(errors).forEach((key) => delete errors[key])
  if (!form.date) errors.date = 'Informe a data.'
  if (!form.product.trim()) errors.product = 'Selecione ou informe o produto.'
  if (!Number.isInteger(Number(form.qty)) || Number(form.qty) <= 0) errors.qty = 'Use uma quantidade inteira maior que zero.'
  if (!form.gross || form.gross <= 0) errors.gross = 'Informe o valor bruto.'
  return !Object.keys(errors).length
}

const save = async () => {
  if (!validate() || saving.value) return
  saving.value = true
  try {
    const payload = {
      ...form, clientId: form.clientId || undefined, productId: form.productId || undefined,
      marketplace: form.salesChannel === 'marketplace' ? form.marketplace : '', dbId: editId.value,
      id: form.id || `PED-${Date.now()}`, net: net.value, profit: profit.value
    }
    if (isEditing.value) await updateItem('orders', payload)
    else await createItem('orders', payload)
    notify(isEditing.value ? 'Venda atualizada com sucesso.' : 'Venda cadastrada com sucesso.')
    await navigateTo('/vendas')
  } catch (error: any) {
    const message = error?.data?.error || (error instanceof Error ? error.message : '')
    const limitReached = await subscription.refreshAfterLimitError(error)
    if (limitReached) {
      notify('Limite do plano FREE atingido. Revise o aviso ou conheça o PRO.', 'info')
      return
    }
    notify(message || 'Não foi possível salvar a venda.', 'info')
  } finally {
    saving.value = false
  }
}
onMounted(() => { void subscription.load() })
</script>

<template>
  <div class="sale-editor">
    <div class="breadcrumb"><span>Vendas</span><UiIcon name="chevron" :size="12" /><strong>{{ isEditing ? 'Editar venda' : 'Nova venda' }}</strong></div>
    <PageHeader :title="isEditing ? 'Editar venda' : 'Nova venda'" :subtitle="isEditing ? 'Atualize os dados comerciais sem alterar a etapa operacional.' : 'Registre o pedido e confira o resultado antes de salvar.'" />
    <PlanLimitNotice v-if="!isEditing" resource="ordersMonthly" label="pedidos deste mês" remaining-text="Pedidos já registrados, produção, envio e histórico continuam disponíveis normalmente." />

    <div class="sale-editor__layout">
      <form class="sale-editor__form" @submit.prevent="save">
        <section class="form-card sale-section">
          <div class="sale-section__heading"><span><UiIcon name="receipt" :size="18" /></span><div><small>Identificação</small><h2>Dados da venda direta</h2></div></div>
          <div class="info-note sale-direct-note"><UiIcon name="info" :size="17" /><span>Use esta tela para vendas próprias. Pedidos dos marketplaces conectados entram automaticamente e são revisados na área de <strong>Marketplaces</strong>.</span></div>
          <div class="form-grid sale-section__fields">
            <div class="field col-4"><label>Número do pedido</label><input v-model="form.id" placeholder="Gerado automaticamente"><small class="field__hint">Pode usar o código do seu atendimento.</small></div>
            <div class="field col-4" :class="{'field--error':errors.date}"><label>Data da venda *</label><UiDateInput v-model="form.date" aria-label="Data da venda" /><small v-if="errors.date" class="field__error">{{ errors.date }}</small></div>
            <div class="field col-4"><label>Origem</label><input value="Venda direta" readonly aria-readonly="true"><small class="field__hint">Balcão, redes sociais ou pedido próprio.</small></div>
          </div>
        </section>

        <section class="form-card sale-section">
          <div class="sale-section__heading"><span><UiIcon name="box" :size="18" /></span><div><small>Pedido</small><h2>Produto e cliente</h2></div></div>
          <div class="form-grid">
            <div class="field col-6"><label>Produto cadastrado</label><select v-model="form.productId"><option value="">Item avulso / não cadastrado</option><option v-for="product in products" :key="product.id || product.sku" :value="String(product.id || '')">{{ product.name }}{{ product.sku ? ` · ${product.sku}` : '' }}</option></select><small class="field__hint">Vincular o produto conecta estoque e produção ao pedido.</small></div>
            <div class="field col-6"><label>Cliente cadastrado</label><select v-model="form.clientId"><option value="">Venda avulsa / cliente não cadastrado</option><option v-for="client in clients" :key="client.id || client.name" :value="String(client.id || '')">{{ client.name }}</option></select><small class="field__hint">O vínculo alimenta o histórico e o ticket do cliente.</small></div>
            <div v-if="!form.productId" class="field col-8" :class="{'field--error':errors.product}"><label>Descrição do produto *</label><input v-model="form.product" placeholder="Ex.: Suporte articulado personalizado"><small v-if="errors.product" class="field__error">{{ errors.product }}</small></div>
            <div v-if="!form.clientId" class="field" :class="form.productId ? 'col-8' : 'col-4'"><label>Nome do cliente</label><input v-model="form.client" placeholder="Opcional"><small class="field__hint">Se preenchido, o cadastro básico pode ser criado ao salvar.</small></div>
            <div class="field col-4" :class="{'field--error':errors.qty}"><label>Quantidade *</label><input v-model.number="form.qty" type="number" min="1" step="1"><small v-if="errors.qty" class="field__error">{{ errors.qty }}</small></div>
          </div>
          <div v-if="selectedProduct" class="catalog-product">
            <ProductThumb :type="selectedProduct.thumb" :size="46" /><div><strong>{{ selectedProduct.name }}</strong><small>{{ selectedProduct.sku || 'Sem SKU' }} · {{ formatCurrency(selectedProduct.price) }} por unidade · custo {{ formatCurrency(selectedProduct.cost) }}</small></div>
            <button type="button" class="btn btn--compact" @click="applyCatalogValues">Usar preço e custo</button>
          </div>
          <div v-else-if="form.product" class="info-note"><UiIcon name="info" :size="17" /><span>Este item será salvo apenas pelo nome. Sem produto vinculado, o pedido não reserva estoque nem cria atendimento para produção.</span></div>
        </section>

        <section class="form-card sale-section">
          <div class="sale-section__heading"><span><UiIcon name="money" :size="18" /></span><div><small>Financeiro</small><h2>Valores da venda</h2></div></div>
          <div class="form-grid">
            <div class="field col-3" :class="{'field--error':errors.gross}"><label>Valor bruto *</label><div class="money-input"><span>R$</span><input v-model.number="form.gross" type="number" min="0" step=".01"></div><small v-if="errors.gross" class="field__error">{{ errors.gross }}</small></div>
            <div class="field col-3"><label>Taxas</label><div class="money-input"><span>R$</span><input v-model.number="form.fee" type="number" min="0" step=".01"></div></div>
            <div class="field col-3"><label>Frete pago</label><div class="money-input"><span>R$</span><input v-model.number="form.shipping" type="number" min="0" step=".01"></div></div>
            <div class="field col-3"><label>Custo do pedido</label><div class="money-input"><span>R$</span><input v-model.number="form.cost" type="number" min="0" step=".01"></div></div>
          </div>
          <div class="sale-financial-strip">
            <div><span>Receita líquida</span><strong>{{ formatCurrency(net) }}</strong></div><div><span>Deduções + custo</span><strong>{{ formatCurrency(totalDeductions) }}</strong></div><div><span>Resultado estimado</span><strong :class="resultClass">{{ formatCurrency(profit) }}</strong></div>
          </div>
        </section>

        <div class="form-actions sale-editor__actions"><NuxtLink class="btn" to="/vendas">Cancelar</NuxtLink><NuxtLink v-if="monthlyLimitReached" class="btn btn--primary" :to="subscription.upgradePath"><UiIcon name="lock" :size="16" />Conhecer o PRO</NuxtLink><button v-else class="btn btn--primary" :disabled="saving"><UiIcon name="check" :size="16" />{{ saving ? 'Salvando...' : isEditing ? 'Salvar alterações' : 'Salvar venda' }}</button></div>
      </form>

      <aside class="sale-summary">
        <div class="detail-card sale-summary__card">
          <div class="sale-summary__hero"><span><UiIcon name="money" :size="20" /></span><div><small>Resultado da venda</small><strong :class="resultClass">{{ formatCurrency(profit) }}</strong><p>Margem de {{ margin.toFixed(1).replace('.', ',') }}%</p></div></div>
          <div class="sale-summary__body">
            <div class="sale-summary__line"><span>Valor bruto</span><strong>{{ formatCurrency(form.gross) }}</strong></div><div class="sale-summary__line"><span>Taxas e frete</span><strong>- {{ formatCurrency(Number(form.fee || 0) + Number(form.shipping || 0)) }}</strong></div><div class="sale-summary__line"><span>Custo</span><strong>- {{ formatCurrency(form.cost) }}</strong></div><div class="sale-summary__line sale-summary__line--total"><span>Receita líquida</span><strong>{{ formatCurrency(net) }}</strong></div>
          </div>
        </div>

        <div class="form-card sale-connections">
          <h3><UiIcon name="bolt" :size="17" /> O que será atualizado</h3>
          <div><span class="active"><UiIcon name="check" :size="13" /></span><p><strong>Vendas e Dashboard</strong><small>Receita, lucro e quantidade entram nos indicadores.</small></p></div>
          <div><span :class="{ active: Boolean(form.clientId || form.client) }"><UiIcon :name="form.clientId || form.client ? 'check' : 'info'" :size="13" /></span><p><strong>{{ form.clientId || form.client ? 'Histórico do cliente' : 'Venda sem cliente vinculado' }}</strong><small>{{ form.clientId || form.client ? 'A venda ficará associada ao cliente.' : 'Opcional: selecione ou informe um cliente para criar o histórico.' }}</small></p></div>
          <div><span :class="{ active: Boolean(form.productId) }"><UiIcon :name="form.productId ? 'check' : 'info'" :size="13" /></span><p><strong>{{ form.productId ? 'Estoque e produção conectados' : 'Item sem vínculo com estoque' }}</strong><small>{{ form.productId ? 'O pedido poderá reservar estoque e planejar produção.' : 'Opcional: selecione um produto cadastrado para conectar.' }}</small></p></div>
          <div><span class="active"><UiIcon name="check" :size="13" /></span><p><strong>Origem da venda</strong><small>Registrada como venda direta, sem duplicar pedidos automáticos.</small></p></div>
        </div>
        <div class="info-note sale-summary__note"><UiIcon name="info" :size="17" /><span>A etapa começa em <strong>Novo</strong> e avança depois pela tela de Vendas. Salvar aqui não baixa estoque imediatamente.</span></div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.sale-editor{width:min(100%,1280px);margin:0 auto}.sale-editor__layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;align-items:start;gap:16px}.sale-editor__form{display:grid;gap:12px}.sale-section{padding:20px;box-shadow:none}.sale-section__heading{display:flex;align-items:center;gap:11px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid #edf1f6}.sale-section__heading>span{display:grid;width:36px;height:36px;flex:0 0 auto;place-items:center;border-radius:10px;color:var(--blue);background:var(--blue-soft)}.sale-section__heading small{display:block;color:var(--blue);margin-bottom:2px;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.sale-section__heading h2{margin:0;color:#172033;font-size:15px}.sale-section__fields{margin-top:16px}.sale-channel-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.sale-channel{position:relative;display:grid;grid-template-columns:40px 1fr 16px;align-items:center;gap:11px;min-height:76px;border:1px solid var(--line);border-radius:11px;color:#172033;background:#fff;padding:12px;text-align:left;cursor:pointer;transition:border-color .16s,background .16s,box-shadow .16s}.sale-channel:hover{border-color:#bdd0ee}.sale-channel.active{border-color:var(--blue);background:#f6f9ff;box-shadow:inset 0 0 0 1px rgba(23,104,242,.12)}.sale-channel>span{display:grid;width:40px;height:40px;place-items:center;border-radius:10px;color:#5d6d84;background:#f0f3f7}.sale-channel.active>span{color:var(--blue);background:#e7f0ff}.sale-channel strong,.sale-channel small{display:block}.sale-channel strong{font-size:12px}.sale-channel small{color:var(--muted);margin-top:4px;font-size:9px;line-height:1.4}.sale-channel>i{width:14px;height:14px;border:1px solid #bdc7d5;border-radius:50%}.sale-channel.active>i{border:4px solid var(--blue)}.field__hint{display:block;color:var(--muted);margin-top:5px;font-size:9px;line-height:1.4}.catalog-product{display:flex;align-items:center;gap:11px;margin-top:14px;border:1px solid #dbe6f7;border-radius:10px;background:#f8fbff;padding:10px}.catalog-product>div{min-width:0;flex:1}.catalog-product strong,.catalog-product small{display:block}.catalog-product strong{color:#172033;font-size:11px}.catalog-product small{overflow:hidden;color:var(--muted);margin-top:3px;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.money-input{display:flex;align-items:center;overflow:hidden;border:1px solid var(--line);border-radius:7px;background:#fff}.money-input:focus-within{border-color:var(--blue);box-shadow:0 0 0 3px rgba(23,104,242,.08)}.money-input span{color:#6a778a;padding-left:10px;font-size:10px;font-weight:750}.money-input input{border:0;box-shadow:none!important;padding-left:6px}.field--error .money-input{border-color:var(--red)}.sale-financial-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;overflow:hidden;margin-top:16px;border:1px solid #e2e8f1;border-radius:10px;background:#e2e8f1}.sale-financial-strip>div{display:grid;gap:4px;background:#f9fbfd;padding:11px 13px}.sale-financial-strip span{color:var(--muted);font-size:9px}.sale-financial-strip strong{font-size:12px}.sale-editor__actions{position:sticky;bottom:12px;z-index:5;margin-top:0;box-shadow:0 10px 30px rgba(25,44,84,.1)}.sale-summary{position:sticky;top:84px;display:grid;gap:12px}.sale-summary__card{overflow:hidden;box-shadow:none}.sale-summary__hero{display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line);background:linear-gradient(145deg,#fff,#f6f9ff);padding:18px}.sale-summary__hero>span{display:grid;width:42px;height:42px;flex:0 0 auto;place-items:center;border-radius:12px;color:var(--blue);background:#e8f1ff}.sale-summary__hero small,.sale-summary__hero strong,.sale-summary__hero p{display:block;margin:0}.sale-summary__hero small{color:var(--muted);font-size:9px}.sale-summary__hero strong{margin-top:3px;font-size:21px}.sale-summary__hero p{color:var(--muted);margin-top:3px;font-size:9px}.sale-summary__body{padding:10px 16px 14px}.sale-summary__line{display:flex;justify-content:space-between;gap:12px;padding:8px 0;color:var(--muted);font-size:10px}.sale-summary__line strong{color:#283449}.sale-summary__line--total{margin-top:4px;border-top:1px solid var(--line);color:#172033;font-weight:750}.sale-connections{display:grid;gap:12px;box-shadow:none}.sale-connections h3{display:flex;align-items:center;gap:7px;margin:0 0 2px;color:#172033;font-size:12px}.sale-connections>div{display:grid;grid-template-columns:22px 1fr;align-items:start;gap:8px}.sale-connections>div>span{display:grid;width:20px;height:20px;place-items:center;border-radius:50%;color:#5d6d84;background:#eaf0f7}.sale-connections>div>span.active{color:#087b54;background:#e5f7ef}.sale-connections>div>span.pending{color:#9a6400;background:#fff1cf}.sale-connections p,.sale-connections strong,.sale-connections small{display:block;margin:0}.sale-connections strong{color:#29364a;font-size:10px}.sale-connections small{color:var(--muted);margin-top:2px;font-size:8.5px;line-height:1.45}.sale-summary__note{font-size:9px}.money-positive{color:#087b54!important}.money-negative{color:var(--red)!important}
@media(max-width:980px){.sale-editor__layout{grid-template-columns:1fr}.sale-summary{position:static;grid-template-columns:1fr 1fr}.sale-summary__note{grid-column:1/-1}}
@media(max-width:700px){.sale-editor__layout{gap:12px}.sale-section{padding:16px}.sale-channel-grid,.sale-financial-strip,.sale-summary{grid-template-columns:1fr}.form-grid>.field{grid-column:1/-1}.catalog-product{align-items:flex-start;flex-wrap:wrap}.catalog-product .btn{width:100%}.sale-editor__actions{position:static}.sale-editor__actions .btn{flex:1}.sale-summary__note{grid-column:auto}}
</style>
