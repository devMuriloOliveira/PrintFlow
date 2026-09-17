<script setup lang="ts">
const { products, createProductInventoryMovement, refreshAppData } = useAppData()
const { notify } = useUi()
const router = useRouter()

const saving = ref(false)
const form = reactive({ productId: '', quantity: 1, origin: 'Produção concluída', notes: '' })
const origins = ['Produção concluída', 'Produção excedente', 'Retorno de venda cancelada', 'Devolução de cliente']
const selectedProduct = computed(() => products.value.find(product => String(product.id) === form.productId))
const validQuantity = computed(() => Number.isInteger(Number(form.quantity)) && Number(form.quantity) > 0)
const reason = computed(() => form.notes.trim() ? `${form.origin}: ${form.notes.trim()}`.slice(0, 240) : form.origin)

watch(products, (items) => {
  if (!items.some(product => String(product.id) === form.productId)) form.productId = items[0]?.id ? String(items[0].id) : ''
}, { immediate: true })

const submit = async () => {
  if (saving.value) return
  if (!selectedProduct.value || !validQuantity.value) return notify('Selecione um produto existente e informe uma quantidade inteira maior que zero.', 'info')
  saving.value = true
  try {
    await createProductInventoryMovement(String(selectedProduct.value.id), { type: 'in', quantity: Number(form.quantity), reason: reason.value })
    await refreshAppData()
    notify(`${form.quantity} unidade(s) de ${selectedProduct.value.name} registrada(s) no estoque.`)
    await router.push('/estoque?secao=produtos')
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Não foi possível registrar a produção.', 'info')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="production-entry">
    <PageHeader title="Registrar produção" subtitle="Inclua peças prontas no estoque sem criar outro cadastro de produto.">
      <NuxtLink class="btn" to="/estoque?secao=produtos">Voltar ao estoque</NuxtLink>
    </PageHeader>

    <div class="production-entry__grid">
      <form class="production-entry__form" @submit.prevent="submit">
        <PanelCard title="Peças produzidas" subtitle="Selecione um produto que já existe no seu catálogo.">
          <div v-if="products.length" class="form-grid">
            <div class="field col-12"><label>Produto existente *</label><select v-model="form.productId"><option v-for="product in products" :key="product.id" :value="String(product.id)">{{ product.name }}{{ product.sku ? ` · ${product.sku}` : '' }}</option></select><small>Este lançamento atualiza o saldo do produto escolhido; não cria um novo produto.</small></div>
            <div class="field col-6"><label>Quantidade produzida *</label><input v-model.number="form.quantity" type="number" min="1" step="1"></div>
            <div class="field col-6"><label>Origem *</label><select v-model="form.origin"><option v-for="origin in origins" :key="origin">{{ origin }}</option></select></div>
            <div class="field col-12"><label>Observação <span class="field__optional">opcional</span></label><textarea v-model="form.notes" maxlength="180" rows="3" placeholder="Ex.: lote de setembro, cor ou observação de acabamento"></textarea></div>
            <div class="production-entry__notice col-12"><UiIcon name="info" :size="17"/><span>A entrada será registrada agora no histórico de estoque, com saldo anterior, novo saldo e motivo.</span></div>
            <div class="col-12"><button class="btn btn--primary btn--wide" type="submit" :disabled="saving || !validQuantity">{{ saving ? 'Registrando...' : 'Registrar entrada no estoque' }}</button></div>
          </div>
          <div v-else class="empty-state production-entry__empty"><div><div class="empty-state__icon"><UiIcon name="box"/></div><h3>Nenhum produto cadastrado</h3><p>Crie primeiro o modelo do produto. Depois, volte para registrar as unidades produzidas.</p><NuxtLink class="btn btn--primary" to="/produtos/novo">Cadastrar novo modelo de produto</NuxtLink></div></div>
        </PanelCard>
      </form>
      <aside>
        <PanelCard title="Resumo do lançamento" subtitle="Confira antes de registrar.">
          <div class="production-entry__summary"><div><span>Produto</span><strong>{{ selectedProduct?.name || 'Selecione um produto' }}</strong></div><div><span>Quantidade</span><strong>{{ validQuantity ? `${formatNumber(Number(form.quantity))} un.` : '—' }}</strong></div><div><span>Origem</span><strong>{{ form.origin }}</strong></div></div>
        </PanelCard>
        <PanelCard title="Quando criar um produto?" subtitle="Evite cadastros duplicados." style="margin-top:12px"><p class="production-entry__help">Use “Novo produto” apenas quando for um item diferente, com novo SKU, preço ou receita. Para fabricar novamente uma peça já cadastrada, use esta tela.</p><NuxtLink class="btn btn--ghost btn--wide" to="/produtos/novo">Cadastrar novo modelo</NuxtLink></PanelCard>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.production-entry{padding-bottom:28px}.production-entry__grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.38fr);gap:14px;align-items:start}.production-entry__summary{display:grid;gap:12px}.production-entry__summary div{display:grid;gap:3px;padding-bottom:10px;border-bottom:1px solid var(--line)}.production-entry__summary span{font-size:11px;color:var(--muted)}.production-entry__summary strong{color:var(--text)}.production-entry__notice{display:flex;gap:8px;align-items:flex-start;padding:11px;border:1px solid #d9e6f8;border-radius:9px;background:#f5f9ff;color:#52657d;font-size:12px;line-height:1.45}.production-entry__notice .ui-icon{flex:0 0 auto;color:var(--blue)}.production-entry__help{margin:0 0 12px;color:var(--muted);font-size:12px;line-height:1.55}.production-entry__empty{min-height:250px}@media(max-width:900px){.production-entry__grid{grid-template-columns:1fr}}
</style>
