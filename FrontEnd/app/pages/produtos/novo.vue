<script setup lang="ts">
const { products, printers, filaments, settings, createProduct, updateItem } = useAppData()
const { notify } = useUi()
const router = useRouter()
const route = useRoute()
const saving = ref(false)
const errors = reactive<Record<string, string>>({})
const editingId = computed(() => String(route.query.id || ''))
const isEditing = computed(() => Boolean(editingId.value))
const hydratedFor = ref('')
const form = reactive({ name: '', sku: '', category: 'Decoracao', description: '', status: 'Ativo', printerId: '', filamentId: '', weight: 0, hours: 0, minutes: 0, packaging: 0, materials: 0, labor: 0, energy: true, marketplaceFee: 0, price: 0, desiredMargin: 40 })
const selectedPrinter = computed(() => printers.value.find((printer) => printer.id === form.printerId))
const selectedFilament = computed(() => filaments.value.find((filament) => filament.id === form.filamentId))
const kwhCost = computed(() => Number(settings.value?.kwh || 0.68))
const filamentCost = computed(() => {
  const filament = selectedFilament.value
  const gramCost = filament?.initial ? Number(filament.cost || 0) / Number(filament.initial || 1) : 0
  return Number(form.weight || 0) * gramCost
})
const energyCost = computed(() => {
  const printer = selectedPrinter.value
  if (!form.energy || !printer) return 0
  return (Number(form.hours || 0) + Number(form.minutes || 0) / 60) * (Number(printer.power || 0) / 1000) * kwhCost.value
})
const marketplaceCost = computed(() => form.price * form.marketplaceFee / 100)
const totalCost = computed(() => filamentCost.value + energyCost.value + form.packaging + form.materials + form.labor + marketplaceCost.value)
const profit = computed(() => form.price - totalCost.value)
const margin = computed(() => form.price ? profit.value / form.price * 100 : 0)
const splitTime = (value = '') => {
  const hours = Number(value.match(/(\d+(?:[.,]\d+)?)\s*h/i)?.[1]?.replace(',', '.') || 0)
  const minutes = Number(value.match(/(\d+(?:[.,]\d+)?)\s*m/i)?.[1]?.replace(',', '.') || 0)
  return { hours, minutes }
}
const hydrateForm = (product: any) => {
  const time = splitTime(product.time)
  Object.assign(form, {
    name: product.name || '',
    sku: product.sku || '',
    category: product.category || 'Decoracao',
    description: product.description || product.subtitle || '',
    status: product.status || 'Ativo',
    printerId: product.printerId || printers.value.find((printer) => printer.name === product.printer)?.id || '',
    filamentId: product.filamentId || filaments.value.find((filament) => filament.name === product.filament)?.id || '',
    weight: Number(product.weight || 0),
    hours: time.hours,
    minutes: time.minutes,
    packaging: Number(product.packaging || 0),
    materials: Number(product.materials || 0),
    labor: Number(product.labor || 0),
    energy: product.energy !== false,
    marketplaceFee: Number(product.marketplaceFee || 0),
    price: Number(product.price || 0),
    desiredMargin: Number(product.desiredMargin || 40)
  })
}
watch([products, editingId], ([list, id]) => {
  if (!id) {
    hydratedFor.value = ''
    return
  }
  if (hydratedFor.value === id) return
  const product = list.find((item) => item.id === id)
  if (product) {
    hydrateForm(product)
    hydratedFor.value = id
  }
}, { immediate: true })
const validate = () => {
  Object.keys(errors).forEach(key => delete errors[key])
  if (!form.name.trim()) errors.name = 'Informe o nome do produto.'
  if (!form.sku.trim()) errors.sku = 'Informe o SKU.'
  if (!form.price || form.price <= 0) errors.price = 'Informe o preco de venda.'
  if (form.weight < 0) errors.weight = 'Informe um peso valido.'
  if (printers.value.length && !form.printerId) errors.printerId = 'Selecione uma impressora cadastrada.'
  if (filaments.value.length && !form.filamentId) errors.filamentId = 'Selecione um filamento cadastrado.'
  return Object.keys(errors).length === 0
}
const save = async () => {
  if (!validate() || saving.value) return
  saving.value = true
  try {
    const payload = { id: editingId.value || undefined, name: form.name, subtitle: form.description.slice(0, 42), sku: form.sku, category: form.category, description: form.description, printerId: form.printerId, printer: selectedPrinter.value?.name || '', price: form.price, weight: form.weight, time: `${form.hours}h ${form.minutes}m`, layer: 0, infill: 0, dimensions: '', filamentId: form.filamentId, filament: selectedFilament.value?.name || '', filamentColor: selectedFilament.value?.colorHex || '#555b64', packaging: form.packaging, materials: form.materials, labor: form.labor, energy: form.energy, marketplaceFee: form.marketplaceFee, desiredMargin: form.desiredMargin, cost: totalCost.value, profit: profit.value, margin: margin.value, status: form.status, thumb: 'vase' }
    if (isEditing.value) await updateItem('products', payload)
    else await createProduct(payload)
    notify(isEditing.value ? 'Produto atualizado com sucesso' : 'Produto salvo com sucesso')
    router.push('/produtos')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Nao foi possivel salvar o produto.', 'info')
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <div>
    <PageHeader :title="isEditing ? 'Editar Produto' : 'Novo Produto'" :subtitle="isEditing ? 'Atualize preco, custos e especificacoes do produto.' : 'Cadastre um novo produto e calcule automaticamente seus custos e margem.'" />
    <div class="split-layout" style="grid-template-columns:minmax(0,1fr) 330px">
      <div>
        <form class="form-card" @submit.prevent="save"><h2 class="form-card__title"><UiIcon name="box"/>1. Informacoes Basicas</h2><div class="form-grid">
          <div class="field col-5" :class="{'field--error':errors.name}"><label>Nome do Produto *</label><input v-model="form.name" required><small v-if="errors.name" class="field__error">{{errors.name}}</small></div><div class="field col-4" :class="{'field--error':errors.sku}"><label>SKU *</label><input v-model="form.sku" required><small v-if="errors.sku" class="field__error">{{errors.sku}}</small></div><div class="field col-3"><label>Status *</label><select v-model="form.status"><option>Ativo</option><option>Rascunho</option></select></div>
          <div class="field col-5"><label>Categoria *</label><select v-model="form.category"><option>Decoracao</option><option>Acessorios</option><option>Brinquedos</option><option>Organizadores</option></select></div><div class="field col-7"><label>Descricao</label><textarea v-model="form.description"/></div>
        </div></form>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="settings"/>2. Especificacoes da Impressao</h2><div class="form-grid"><div class="field col-4" :class="{'field--error':errors.printerId}"><label>Impressora *</label><select v-model="form.printerId"><option value="" disabled>{{ printers.length ? 'Selecione a impressora' : 'Nenhuma impressora cadastrada' }}</option><option v-for="printer in printers" :key="printer.id" :value="printer.id">{{ printer.name }}</option></select><small v-if="errors.printerId" class="field__error">{{errors.printerId}}</small></div><div class="field col-4" :class="{'field--error':errors.filamentId}"><label>Filamento *</label><select v-model="form.filamentId"><option value="" disabled>{{ filaments.length ? 'Selecione o filamento' : 'Nenhum filamento cadastrado' }}</option><option v-for="filament in filaments" :key="filament.id" :value="filament.id">{{ filament.name }} - {{ filament.material }}</option></select><small v-if="errors.filamentId" class="field__error">{{errors.filamentId}}</small></div><div class="field col-4"><label>Peso da peca (g) *</label><input v-model.number="form.weight" type="number"></div><div class="field col-2"><label>Horas</label><input v-model.number="form.hours" type="number"></div><div class="field col-2"><label>Minutos</label><input v-model.number="form.minutes" type="number"></div></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="money"/>3. Custos Adicionais</h2><div class="form-grid"><div class="field col-3"><label>Embalagem (R$)</label><input v-model.number="form.packaging" type="number" step=".1"></div><div class="field col-3"><label>Materiais adicionais (R$)</label><input v-model.number="form.materials" type="number" step=".1"></div><div class="field col-3"><label>Mao de obra (R$)</label><input v-model.number="form.labor" type="number" step=".1"></div><div class="field col-3"><label>Taxa marketplace (%)</label><input v-model.number="form.marketplaceFee" type="number"></div><div class="field col-4"><label>Incluir custo de energia</label><div class="switch-row"><span>{{form.energy?'Ativado':'Desativado'}}</span><button type="button" class="switch" :class="{active:form.energy}" @click="form.energy=!form.energy"/></div></div></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="tag"/>4. Precificacao</h2><div class="form-grid"><div class="field col-4" :class="{'field--error':errors.price}"><label>Preco de venda (R$)</label><input v-model.number="form.price" type="number" step=".1"><small v-if="errors.price" class="field__error">{{errors.price}}</small></div><div class="field col-4"><label>Margem desejada (%)</label><input v-model.number="form.desiredMargin" type="number"></div><div class="col-4" style="display:flex;align-items:end"><button class="btn btn--primary btn--wide" type="button" :disabled="saving" @click="save"><UiIcon name="save" :size="16"/>{{ saving ? 'Salvando...' : isEditing ? 'Atualizar Produto' : 'Salvar Produto' }}</button></div></div></div>
      </div>
      <aside><div class="detail-card"><div class="detail-card__head"><ProductThumb type="vase" :size="110"/><div><h3>{{form.name}}</h3><p>Categoria: {{form.category}}</p><p>Material: {{selectedFilament?.name || '-'}}</p><p>Peso: {{form.weight}} g</p></div></div><div class="detail-card__body"><h3 style="font-size:12px">Resumo Financeiro</h3><div class="detail-list"><div class="detail-list__row"><span><i style="background:#278ba1"/>Filamento</span><strong>{{formatCurrency(filamentCost)}}</strong></div><div class="detail-list__row"><span><i style="background:#f4c43f"/>Energia</span><strong>{{formatCurrency(energyCost)}}</strong></div><div class="detail-list__row"><span><i style="background:#f47b3b"/>Embalagem</span><strong>{{formatCurrency(form.packaging)}}</strong></div><div class="detail-list__row"><span><i style="background:#c43dcc"/>Taxa Marketplace</span><strong>{{formatCurrency(marketplaceCost)}}</strong></div></div><div class="summary-box"><div class="detail-list__row"><span>Custo Total</span><strong>{{formatCurrency(totalCost)}}</strong></div><div class="detail-list__row"><span>Preco de Venda</span><strong>{{formatCurrency(form.price)}}</strong></div><div class="detail-list__row"><span>Lucro Liquido</span><strong class="money-positive">{{formatCurrency(profit)}}</strong></div><div class="detail-list__row"><span>Margem Liquida</span><strong class="money-positive">{{margin.toFixed(1)}}%</strong></div></div><div class="viability"><span class="viability__icon"><UiIcon name="check"/></span><div><h3>Produto viavel</h3><p>Com essa margem, seu produto esta saudavel e pronto para ser vendido.</p></div></div></div></div></aside>
    </div>
  </div>
</template>
