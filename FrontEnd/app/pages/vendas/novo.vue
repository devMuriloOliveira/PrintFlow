<script setup lang="ts">
const { orders, createItem, updateItem } = useAppData()
const { notify } = useUi()
const route = useRoute()
const saving = ref(false)
const errors = reactive<Record<string, string>>({})
const form = reactive({ id: '', date: '', client: '', marketplace: '', product: '', qty: 1, gross: 0, fee: 0, shipping: 0, cost: 0, status: 'Novo' })
const editId = computed(() => typeof route.query.id === 'string' ? route.query.id : '')
const isEditing = computed(() => Boolean(editId.value))
const hydrated = ref(false)
const net = computed(() => Number(form.gross || 0) - Number(form.fee || 0) - Number(form.shipping || 0))
const profit = computed(() => net.value - Number(form.cost || 0))
watchEffect(() => {
  if (!editId.value || hydrated.value) return
  const order = orders.value.find(item => item.dbId === editId.value || item.id === editId.value)
  if (!order) return
  Object.assign(form, { id: order.id, date: order.date, client: order.client, marketplace: order.marketplace, product: order.product, qty: order.qty, gross: order.gross, fee: order.fee, shipping: order.shipping, cost: Number(order.net || 0) - Number(order.profit || 0), status: order.status })
  hydrated.value = true
})
const validate = () => {
  Object.keys(errors).forEach((key) => delete errors[key])
  if (!form.date) errors.date = 'Informe a data.'
  if (!form.product.trim()) errors.product = 'Informe o produto.'
  if (!form.gross || form.gross <= 0) errors.gross = 'Informe o valor bruto.'
  return !Object.keys(errors).length
}
const save = async () => {
  if (!validate() || saving.value) return
  saving.value = true
  try {
    const payload = { ...form, dbId: editId.value, id: form.id || `PED-${Date.now()}`, net: net.value, profit: profit.value }
    if (isEditing.value) await updateItem('orders', payload)
    else await createItem('orders', payload)
    notify(isEditing.value ? 'Venda atualizada com sucesso.' : 'Venda cadastrada com sucesso.')
    await navigateTo('/vendas')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Nao foi possivel salvar a venda.', 'info')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <div class="breadcrumb"><span>Vendas</span><UiIcon name="chevron" :size="12" /><strong>{{ isEditing ? 'Editar Venda' : 'Nova Venda' }}</strong></div>
    <PageHeader :title="isEditing ? 'Editar Venda' : 'Nova Venda'" :subtitle="isEditing ? 'Atualize os dados do pedido.' : 'Registre um pedido real para atualizar o dashboard.'" />
    <form class="form-card" @submit.prevent="save">
      <div class="form-grid">
        <div class="field col-3"><label>Numero do pedido</label><input v-model="form.id" placeholder="Automatico"></div>
        <div class="field col-3" :class="{'field--error':errors.date}"><label>Data *</label><input v-model="form.date" type="date"><small v-if="errors.date" class="field__error">{{ errors.date }}</small></div>
        <div class="field col-3"><label>Cliente</label><input v-model="form.client"></div>
        <div class="field col-3"><label>Marketplace</label><input v-model="form.marketplace"></div>
        <div class="field col-6" :class="{'field--error':errors.product}"><label>Produto *</label><input v-model="form.product"><small v-if="errors.product" class="field__error">{{ errors.product }}</small></div>
        <div class="field col-2"><label>Quantidade</label><input v-model.number="form.qty" type="number" min="1"></div>
        <div class="field col-2" :class="{'field--error':errors.gross}"><label>Valor bruto *</label><input v-model.number="form.gross" type="number" step=".01"><small v-if="errors.gross" class="field__error">{{ errors.gross }}</small></div>
        <div class="field col-2"><label>Taxas</label><input v-model.number="form.fee" type="number" step=".01"></div>
        <div class="field col-2"><label>Frete</label><input v-model.number="form.shipping" type="number" step=".01"></div>
        <div class="field col-2"><label>Custo</label><input v-model.number="form.cost" type="number" step=".01"></div>
        <div class="field col-2"><label>Status</label><select v-model="form.status"><option>Novo</option><option>Producao</option><option>Enviado</option><option>Entregue</option><option>Cancelado</option></select></div>
      </div>
      <div class="summary-box"><div class="detail-list__row"><span>Receita liquida</span><strong>{{ formatCurrency(net) }}</strong></div><div class="detail-list__row"><span>Lucro</span><strong>{{ formatCurrency(profit) }}</strong></div></div>
      <div class="form-actions"><NuxtLink class="btn" to="/vendas">Cancelar</NuxtLink><button class="btn btn--primary" :disabled="saving">{{ saving ? 'Salvando...' : isEditing ? 'Salvar Alteracoes' : 'Salvar Venda' }}</button></div>
    </form>
  </div>
</template>
