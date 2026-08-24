<script setup lang="ts">
const { products, printers, filaments, settings, createProduct, updateItem, uploadProductPrintFile } = useAppData()
const { notify } = useUi()
const router = useRouter()
const route = useRoute()
const saving = ref(false)
const errors = reactive<Record<string, string>>({})
const editingId = computed(() => String(route.query.id || ''))
const isEditing = computed(() => Boolean(editingId.value))
const hydratedFor = ref('')
const selectedPrintFile = ref<File | null>(null)
const allowedPrintFileFormats = new Set(['3mf', 'gcode', 'bgcode'])
const form = reactive({ name: '', sku: '', category: 'Decoração', description: '', status: 'Ativo', printerId: '', filamentId: '', weight: 0, hours: 0, minutes: 0, layer: 0.2, infill: 15, dimensions: '', printFileName: '', printFileFormat: '', printFileHash: '', printFileSizeBytes: 0, printFileStorageKey: '', nozzleMm: 0.4, bedTemperature: 60, nozzleTemperature: 205, support: false, scalePercent: 100, allowedMaterials: 'PLA', validationStatus: 'needs_validation', validationMessage: '', packaging: 0, materials: 0, labor: 0, energy: true, shopeeFee: 0, otherMarketplaceFee: 0, marketplaceFee: 0, otherCosts: 0, price: 0, desiredMargin: 40 })
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
const shopeeCost = computed(() => form.price * form.shopeeFee / 100)
const otherMarketplaceCost = computed(() => form.price * form.otherMarketplaceFee / 100)
const marketplaceCost = computed(() => form.price * form.marketplaceFee / 100)
const totalCost = computed(() => filamentCost.value + energyCost.value + form.packaging + form.materials + form.labor + form.otherCosts + shopeeCost.value + otherMarketplaceCost.value + marketplaceCost.value)
const profit = computed(() => form.price - totalCost.value)
const margin = computed(() => form.price ? profit.value / form.price * 100 : 0)
const productionMinutes = computed(() => Number(form.hours || 0) * 60 + Number(form.minutes || 0))
const costBreakdown = computed(() => ({
  materialWeight: Number(form.weight || 0),
  materialName: selectedFilament.value?.name || '',
  materialCost: filamentCost.value,
  packagingCost: Number(form.packaging || 0),
  productionTimeMinutes: productionMinutes.value,
  energyEnabled: form.energy,
  energyCost: energyCost.value,
  additionalMaterialsCost: Number(form.materials || 0),
  laborCost: Number(form.labor || 0),
  otherCosts: Number(form.otherCosts || 0),
  shopeeFeePercent: Number(form.shopeeFee || 0),
  shopeeFeeCost: shopeeCost.value,
  otherMarketplaceFeePercent: Number(form.otherMarketplaceFee || 0),
  otherMarketplaceFeeCost: otherMarketplaceCost.value,
  additionalFeePercent: Number(form.marketplaceFee || 0),
  additionalFeeCost: marketplaceCost.value,
  totalCost: totalCost.value,
  salePrice: Number(form.price || 0),
  profit: profit.value,
  margin: margin.value
}))
const splitTime = (value = '') => {
  const hours = Number(value.match(/(\d+(?:[.,]\d+)?)\s*h/i)?.[1]?.replace(',', '.') || 0)
  const minutes = Number(value.match(/(\d+(?:[.,]\d+)?)\s*m/i)?.[1]?.replace(',', '.') || 0)
  return { hours, minutes }
}
const handlePrintFileSelect = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const format = file.name.split('.').pop()?.toLowerCase() || ''
  if (!allowedPrintFileFormats.has(format)) {
    selectedPrintFile.value = null
    input.value = ''
    notify('Formato não permitido. Use 3MF, G-code ou BGCODE para impressão automática.', 'info')
    return
  }
  selectedPrintFile.value = file
  form.printFileName = file.name
  form.printFileFormat = format
  form.printFileSizeBytes = file.size
  form.printFileHash = ''
  form.printFileStorageKey = ''
  form.validationStatus = 'needs_validation'
  form.validationMessage = 'Arquivo selecionado. Salve para enviar e depois valide a receita.'
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
    layer: Number(product.layer || product.printProfile?.layerHeightMm || 0.2),
    infill: Number(product.infill || product.printProfile?.infillPercent || 15),
    dimensions: product.dimensions || '',
    printFileName: product.printFileName || '',
    printFileFormat: product.printFileFormat || '',
    printFileHash: product.printFileHash || '',
    printFileSizeBytes: Number(product.printFileSizeBytes || 0),
    printFileStorageKey: product.printFileStorageKey || '',
    nozzleMm: Number(product.compatibility?.nozzleMm || 0.4),
    bedTemperature: Number(product.printProfile?.bedTemperature || 60),
    nozzleTemperature: Number(product.printProfile?.nozzleTemperature || 205),
    support: product.printProfile?.support === true,
    scalePercent: Number(product.printProfile?.scalePercent || 100),
    allowedMaterials: Array.isArray(product.compatibility?.materials) ? product.compatibility.materials.join(', ') : 'PLA',
    validationStatus: product.validationStatus || 'needs_validation',
    validationMessage: product.validationMessage || '',
    packaging: Number(product.packaging || 0),
    materials: Number(product.materials || 0),
    labor: Number(product.labor || 0),
    energy: product.energy !== false,
    shopeeFee: Number(product.costBreakdown?.shopeeFeePercent || 0),
    otherMarketplaceFee: Number(product.costBreakdown?.otherMarketplaceFeePercent || 0),
    marketplaceFee: Number(product.marketplaceFee || product.costBreakdown?.additionalFeePercent || 0),
    otherCosts: Number(product.costBreakdown?.otherCosts || 0),
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
  if (!form.dimensions.trim()) errors.dimensions = 'Informe as dimensoes reais em mm.'
  if (!form.printFileName.trim()) errors.printFileName = 'Informe o arquivo de impressão.'
  if (!form.printFileFormat.trim()) errors.printFileFormat = 'Informe o formato do arquivo.'
  if (form.printFileFormat && !allowedPrintFileFormats.has(form.printFileFormat.toLowerCase())) errors.printFileFormat = 'Use 3MF, G-code ou BGCODE.'
  const fileExtension = form.printFileName.split('.').pop()?.toLowerCase() || ''
  if (fileExtension && form.printFileFormat && fileExtension !== form.printFileFormat.toLowerCase()) errors.printFileFormat = 'Formato diferente da extensao do arquivo.'
  if (form.validationStatus === 'validated' && (!form.printFileHash.trim() || !form.dimensions.trim())) errors.validationStatus = 'Para validar, informe dimensoes e hash do arquivo.'
  if (printers.value.length && !form.printerId) errors.printerId = 'Selecione uma impressora cadastrada.'
  if (filaments.value.length && !form.filamentId) errors.filamentId = 'Selecione um filamento cadastrado.'
  return Object.keys(errors).length === 0
}
const save = async () => {
  if (!validate() || saving.value) return
  saving.value = true
  try {
    const allowedMaterials = form.allowedMaterials.split(',').map((item) => item.trim()).filter(Boolean)
    const payload = { id: editingId.value || undefined, name: form.name, subtitle: form.description.slice(0, 42), sku: form.sku, category: form.category, description: form.description, printerId: form.printerId, printer: selectedPrinter.value?.name || '', price: form.price, weight: form.weight, time: `${form.hours}h ${form.minutes}m`, layer: form.layer, infill: form.infill, dimensions: form.dimensions, printFileName: form.printFileName, printFileFormat: form.printFileFormat, printFileHash: form.printFileHash, printFileSizeBytes: form.printFileSizeBytes, printFileStorageKey: form.printFileStorageKey, printProfile: { layerHeightMm: form.layer, infillPercent: form.infill, nozzleTemperature: form.nozzleTemperature, bedTemperature: form.bedTemperature, support: form.support, scalePercent: form.scalePercent }, compatibility: { materials: allowedMaterials, nozzleMm: form.nozzleMm }, validationStatus: form.validationStatus, validationMessage: form.validationMessage, filamentId: form.filamentId, filament: selectedFilament.value?.name || '', filamentColor: selectedFilament.value?.colorHex || '#555b64', packaging: form.packaging, materials: form.materials, labor: form.labor, energy: form.energy, marketplaceFee: form.marketplaceFee, desiredMargin: form.desiredMargin, costBreakdown: costBreakdown.value, cost: totalCost.value, profit: profit.value, margin: margin.value, status: form.status, thumb: 'vase' }
    const saved = isEditing.value ? payload : await createProduct(payload)
    if (isEditing.value) await updateItem('products', payload)
    const productId = String(saved.id || editingId.value || '')
    if (selectedPrintFile.value && productId) {
      const upload = await uploadProductPrintFile(productId, selectedPrintFile.value)
      if (upload.product) hydrateForm(upload.product)
      selectedPrintFile.value = null
    }
    notify(isEditing.value ? 'Produto atualizado com sucesso' : 'Produto salvo com sucesso')
    router.push('/produtos')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível salvar o produto.', 'info')
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <div>
    <PageHeader :title="isEditing ? 'Editar Produto' : 'Novo Produto'" :subtitle="isEditing ? 'Atualize preço, custos e especificações do produto.' : 'Cadastre um novo produto e calcule automaticamente seus custos e margem.'" />
    <div class="split-layout" style="grid-template-columns:minmax(0,1fr) 330px">
      <div>
        <form class="form-card" @submit.prevent="save"><h2 class="form-card__title"><UiIcon name="box"/>1. Informações Básicas</h2><div class="form-grid">
          <div class="field col-5" :class="{'field--error':errors.name}"><label>Nome do Produto *</label><input v-model="form.name" required><small v-if="errors.name" class="field__error">{{errors.name}}</small></div><div class="field col-4" :class="{'field--error':errors.sku}"><label>SKU *</label><input v-model="form.sku" required><small v-if="errors.sku" class="field__error">{{errors.sku}}</small></div><div class="field col-3"><label>Status *</label><select v-model="form.status"><option>Ativo</option><option>Rascunho</option></select></div>
          <div class="field col-5"><label>Categoria *</label><select v-model="form.category"><option>Decoração</option><option>Acessórios</option><option>Brinquedos</option><option>Organizadores</option></select></div><div class="field col-7"><label>Descrição</label><textarea v-model="form.description"/></div>
        </div></form>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="upload"/>Arquivo da Receita</h2><label class="upload-zone"><input type="file" accept=".3mf,.gcode,.bgcode" hidden @change="handlePrintFileSelect"><span><UiIcon name="upload" :size="28"/><strong>{{selectedPrintFile?.name || form.printFileName || 'Selecionar arquivo'}}</strong><small>3MF, G-code ou BGCODE. O banco salva apenas metadados.</small></span></label></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="settings"/>2. Especificações da Impressão</h2><div class="form-grid"><div class="field col-4" :class="{'field--error':errors.printerId}"><label>Impressora *</label><select v-model="form.printerId"><option value="" disabled>{{ printers.length ? 'Selecione a impressora' : 'Nenhuma impressora cadastrada' }}</option><option v-for="printer in printers" :key="printer.id" :value="printer.id">{{ printer.name }}</option></select><small v-if="errors.printerId" class="field__error">{{errors.printerId}}</small></div><div class="field col-4" :class="{'field--error':errors.filamentId}"><label>Filamento *</label><select v-model="form.filamentId"><option value="" disabled>{{ filaments.length ? 'Selecione o filamento' : 'Nenhum filamento cadastrado' }}</option><option v-for="filament in filaments" :key="filament.id" :value="filament.id">{{ filament.name }} - {{ filament.material }}</option></select><small v-if="errors.filamentId" class="field__error">{{errors.filamentId}}</small></div><div class="field col-4"><label>Peso da peça (g) *</label><input v-model.number="form.weight" type="number"></div><div class="field col-2"><label>Horas</label><input v-model.number="form.hours" type="number"></div><div class="field col-2"><label>Minutos</label><input v-model.number="form.minutes" type="number"></div><div class="field col-2"><label>Camada (mm)</label><input v-model.number="form.layer" type="number" step=".01" min="0"></div><div class="field col-2"><label>Preenchimento (%)</label><input v-model.number="form.infill" type="number" min="0" max="100"></div><div class="field col-4" :class="{'field--error':errors.dimensions}"><label>Dimensões (mm) *</label><input v-model="form.dimensions" placeholder="120 x 80 x 45"><small v-if="errors.dimensions" class="field__error">{{errors.dimensions}}</small></div><div class="field col-4" :class="{'field--error':errors.printFileName}"><label>Arquivo validado *</label><input v-model="form.printFileName" placeholder="produto.3mf"><small v-if="errors.printFileName" class="field__error">{{errors.printFileName}}</small></div><div class="field col-2" :class="{'field--error':errors.printFileFormat}"><label>Formato *</label><select v-model="form.printFileFormat"><option value="">Formato</option><option value="3mf">3MF</option><option value="gcode">G-code</option><option value="bgcode">BGCODE</option></select><small v-if="errors.printFileFormat" class="field__error">{{errors.printFileFormat}}</small></div><div class="field col-3"><label>Hash do arquivo</label><input v-model="form.printFileHash" placeholder="sha256..."></div><div class="field col-3"><label>Tamanho (bytes)</label><input v-model.number="form.printFileSizeBytes" type="number" min="0"></div><div class="field col-2"><label>Bico (mm)</label><input v-model.number="form.nozzleMm" type="number" step=".1" min="0"></div><div class="field col-2"><label>Bico (C)</label><input v-model.number="form.nozzleTemperature" type="number" min="0"></div><div class="field col-2"><label>Mesa (C)</label><input v-model.number="form.bedTemperature" type="number" min="0"></div><div class="field col-3"><label>Materiais liberados</label><input v-model="form.allowedMaterials" placeholder="PLA, PETG"></div><div class="field col-3"><label>Status da receita</label><select v-model="form.validationStatus"><option value="needs_validation">Pendente</option><option value="validated">Validado</option><option value="blocked">Bloqueado</option></select><small v-if="errors.validationStatus" class="field__error">{{errors.validationStatus}}</small></div><div class="field col-3"><label>Escala (%)</label><input v-model.number="form.scalePercent" type="number" min="1"></div><div class="field col-3"><label>Suporte</label><div class="switch-row"><span>{{form.support?'Ativado':'Desativado'}}</span><button type="button" class="switch" :class="{active:form.support}" @click="form.support=!form.support"/></div></div><div class="field col-6"><label>Mensagem de validação</label><input v-model="form.validationMessage" placeholder="Perfil conferido no slicer"></div></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="money"/>3. Custos e Taxas Vinculados</h2><div class="form-grid"><div class="field col-3"><label>Embalagem (R$)</label><input v-model.number="form.packaging" type="number" step=".1"></div><div class="field col-3"><label>Materiais adicionais (R$)</label><input v-model.number="form.materials" type="number" step=".1"></div><div class="field col-3"><label>Mão de obra (R$)</label><input v-model.number="form.labor" type="number" step=".1"></div><div class="field col-3"><label>Outros gastos (R$)</label><input v-model.number="form.otherCosts" type="number" step=".1"></div><div class="field col-3"><label>Taxas Shopee (%)</label><input v-model.number="form.shopeeFee" type="number" step=".1"></div><div class="field col-3"><label>Outros marketplaces (%)</label><input v-model.number="form.otherMarketplaceFee" type="number" step=".1"></div><div class="field col-3"><label>Demais taxas (%)</label><input v-model.number="form.marketplaceFee" type="number" step=".1"></div><div class="field col-3"><label>Incluir custo de energia</label><div class="switch-row"><span>{{form.energy?'Ativado':'Desativado'}}</span><button type="button" class="switch" :class="{active:form.energy}" @click="form.energy=!form.energy"/></div></div></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="tag"/>4. Precificação</h2><div class="form-grid"><div class="field col-4" :class="{'field--error':errors.price}"><label>Preço de venda (R$)</label><input v-model.number="form.price" type="number" step=".1"><small v-if="errors.price" class="field__error">{{errors.price}}</small></div><div class="field col-4"><label>Margem desejada (%)</label><input v-model.number="form.desiredMargin" type="number"></div><div class="col-4" style="display:flex;align-items:end"><button class="btn btn--primary btn--wide" type="button" :disabled="saving" @click="save"><UiIcon name="save" :size="16"/>{{ saving ? 'Salvando...' : isEditing ? 'Atualizar Produto' : 'Salvar Produto' }}</button></div></div></div>
      </div>
      <aside><div class="detail-card"><div class="detail-card__head"><ProductThumb type="vase" :size="110"/><div><h3>{{form.name}}</h3><p>Categoria: {{form.category}}</p><p>Material: {{selectedFilament?.name || '-'}}</p><p>Peso: {{form.weight}} g</p></div></div><div class="detail-card__body"><h3 style="font-size:12px">Resumo Financeiro</h3><div class="detail-list"><div class="detail-list__row"><span><i style="background:#278ba1"/>Material/filamento</span><strong>{{formatCurrency(filamentCost)}}</strong></div><div class="detail-list__row"><span><i style="background:#f4c43f"/>Energia</span><strong>{{formatCurrency(energyCost)}}</strong></div><div class="detail-list__row"><span><i style="background:#f47b3b"/>Embalagem</span><strong>{{formatCurrency(form.packaging)}}</strong></div><div class="detail-list__row"><span><i style="background:#c43dcc"/>Materiais adicionais</span><strong>{{formatCurrency(form.materials)}}</strong></div><div class="detail-list__row"><span><i style="background:#697386"/>Mao de obra</span><strong>{{formatCurrency(form.labor)}}</strong></div><div class="detail-list__row"><span><i style="background:#7c3aed"/>Outros gastos</span><strong>{{formatCurrency(form.otherCosts)}}</strong></div><div class="detail-list__row"><span><i style="background:#ee4d2d"/>Taxas Shopee</span><strong>{{formatCurrency(shopeeCost)}}</strong></div><div class="detail-list__row"><span><i style="background:#1768f2"/>Outros marketplaces</span><strong>{{formatCurrency(otherMarketplaceCost)}}</strong></div><div class="detail-list__row"><span><i style="background:#111827"/>Demais taxas</span><strong>{{formatCurrency(marketplaceCost)}}</strong></div></div><div class="summary-box"><div class="detail-list__row"><span>Custo Total</span><strong>{{formatCurrency(totalCost)}}</strong></div><div class="detail-list__row"><span>Preco de Venda</span><strong>{{formatCurrency(form.price)}}</strong></div><div class="detail-list__row"><span>Lucro Liquido</span><strong class="money-positive">{{formatCurrency(profit)}}</strong></div><div class="detail-list__row"><span>Margem Liquida</span><strong class="money-positive">{{margin.toFixed(1)}}%</strong></div></div><div class="viability"><span class="viability__icon"><UiIcon name="check"/></span><div><h3>Produto viavel</h3><p>Com essa margem, seu produto esta saudavel e pronto para ser vendido.</p></div></div></div></div></aside>
    </div>
  </div>
</template>
