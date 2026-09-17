<script setup lang="ts">
import { calculatePricing } from '../../../utils/pricing.js'
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
const recipeEnabled = ref(false)
const allowedPrintFileFormats = new Set(['3mf', 'gcode', 'bgcode'])
const form = reactive({ name: '', sku: '', category: 'Decoração', description: '', status: 'Ativo', printerId: '', filamentId: '', weight: 0, wastePercent: 0, failurePercent: 0, hours: 0, minutes: 0, quantity: 1, layer: 0.2, infill: 15, dimensions: '', printFileName: '', printFileFormat: '', printFileHash: '', printFileSizeBytes: 0, printFileStorageKey: '', nozzleMm: 0.4, bedTemperature: 60, nozzleTemperature: 205, support: false, scalePercent: 100, allowedMaterials: 'PLA', validationStatus: 'needs_validation', validationMessage: '', packaging: 0, materials: 0, labor: 0, setupMinutes: 0, postProcessingMinutes: 0, packagingMinutes: 0, laborRatePerHour: 0, printerPurchasePrice: 0, printerLifespanHours: 5000, machineMaintenancePerHour: 0, minimumPrice: 0, energy: true, shopeeFee: 0, otherMarketplaceFee: 0, marketplaceFee: 0, taxPercent: 0, otherCosts: 0, price: 0, desiredMargin: 40 })
const hasPrintRecipe = computed(() => Boolean(selectedPrintFile.value || form.printFileName.trim() || form.printFileStorageKey.trim()))
const selectedPrinter = computed(() => printers.value.find((printer) => printer.id === form.printerId))
const selectedFilament = computed(() => filaments.value.find((filament) => filament.id === form.filamentId))
const kwhCost = computed(() => Number(settings.value?.kwh || 0.68))
const financialDefaults = computed(() => (settings.value?.preferences || {}) as Record<string, unknown>)
const fixedCostPerUnit = computed(() => {
  const fixed = Number(financialDefaults.value.monthlyFixedCost || 0)
  const planned = Number(financialDefaults.value.plannedMonthlyUnits || 0)
  return planned > 0 ? fixed / planned : 0
})
const batchQuantity = computed(() => Math.max(1, Math.floor(Number(form.quantity || 1))))
const batchProductionMinutes = computed(() => Number(form.hours || 0) * 60 + Number(form.minutes || 0))
const unitProductionMinutes = computed(() => batchProductionMinutes.value / batchQuantity.value)
const pricing = computed(() => calculatePricing({ pricePerKg: selectedFilament.value?.initial ? Number(selectedFilament.value.cost || 0) / Number(selectedFilament.value.initial) * 1000 : 0, weight: form.weight, wastePercent: form.wastePercent, failurePercent: form.failurePercent, hours: 0, minutes: unitProductionMinutes.value, energyEnabled: form.energy && Boolean(selectedPrinter.value), energyRate: kwhCost.value, watts: selectedPrinter.value?.power || 0, fixedCostPerUnit: fixedCostPerUnit.value, packaging: form.packaging, materials: form.materials, labor: form.labor, setupMinutes: Number(form.setupMinutes || 0) / batchQuantity.value, postProcessingMinutes: Number(form.postProcessingMinutes || 0) / batchQuantity.value, packagingMinutes: form.packagingMinutes, laborRatePerHour: form.laborRatePerHour, printerPurchasePrice: form.printerPurchasePrice, printerLifespanHours: form.printerLifespanHours, machineMaintenancePerHour: form.machineMaintenancePerHour, minimumPrice: form.minimumPrice, quantity: batchQuantity.value, otherCosts: form.otherCosts, marketplaceFee: Number(form.shopeeFee || 0) + Number(form.otherMarketplaceFee || 0) + Number(form.marketplaceFee || 0), taxPercent: form.taxPercent, desiredMargin: form.desiredMargin, salePrice: form.price }))
const filamentCost = computed(() => pricing.value.materialCost)
const energyCost = computed(() => pricing.value.energyCost)
const shopeeCost = computed(() => form.price * form.shopeeFee / 100)
const otherMarketplaceCost = computed(() => form.price * form.otherMarketplaceFee / 100)
const marketplaceCost = computed(() => form.price * form.marketplaceFee / 100)
const taxCost = computed(() => form.price * form.taxPercent / 100)
const totalCost = computed(() => Number(form.price || 0) > 0 ? pricing.value.totalCost : pricing.value.baseCost)
const profit = computed(() => Number(form.price || 0) > 0 ? Number(form.price) - totalCost.value : 0)
const margin = computed(() => Number(form.price || 0) > 0 ? profit.value / Number(form.price) * 100 : 0)
const costBreakdown = computed(() => ({
  materialWeight: Number(form.weight || 0),
  wastePercent: Number(form.wastePercent || 0),
  failurePercent: Number(form.failurePercent || 0),
  materialName: selectedFilament.value?.name || '',
  materialCost: filamentCost.value,
  packagingCost: Number(form.packaging || 0),
  productionTimeMinutes: unitProductionMinutes.value,
  batchProductionTimeMinutes: batchProductionMinutes.value,
  batchQuantity: batchQuantity.value,
  energyEnabled: form.energy,
  energyCost: energyCost.value,
  fixedCostPerUnit: fixedCostPerUnit.value,
  monthlyFixedCost: Number(financialDefaults.value.monthlyFixedCost || 0),
  plannedMonthlyUnits: Number(financialDefaults.value.plannedMonthlyUnits || 0),
  additionalMaterialsCost: Number(form.materials || 0),
  laborCost: Number(form.labor || 0),
  stagedLaborCost: pricing.value.stagedLaborCost,
  laborMinutes: pricing.value.laborMinutes,
  setupMinutes: Number(form.setupMinutes || 0),
  postProcessingMinutes: Number(form.postProcessingMinutes || 0),
  packagingMinutes: Number(form.packagingMinutes || 0),
  laborRatePerHour: Number(form.laborRatePerHour || 0),
  machineCost: pricing.value.machineCost,
  machineHourlyCost: pricing.value.machineHourlyCost,
  printerPurchasePrice: Number(form.printerPurchasePrice || 0),
  printerLifespanHours: Number(form.printerLifespanHours || 0),
  machineMaintenancePerHour: Number(form.machineMaintenancePerHour || 0),
  failureCost: pricing.value.failureCost,
  quantity: batchQuantity.value,
  minimumPrice: Number(form.minimumPrice || 0),
  otherCosts: Number(form.otherCosts || 0),
  shopeeFeePercent: Number(form.shopeeFee || 0),
  shopeeFeeCost: shopeeCost.value,
  otherMarketplaceFeePercent: Number(form.otherMarketplaceFee || 0),
  otherMarketplaceFeeCost: otherMarketplaceCost.value,
  additionalFeePercent: Number(form.marketplaceFee || 0),
  additionalFeeCost: marketplaceCost.value,
  taxPercent: Number(form.taxPercent || 0),
  taxCost: taxCost.value,
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
const parseDimensions = (value: string) => {
  const parts = String(value || '').replace(/,/g, '.').match(/\d+(?:\.\d+)?/g)?.map(Number).filter((item) => Number.isFinite(item) && item > 0) || []
  return parts.length >= 3 ? { x: parts[0], y: parts[1], z: parts[2] } : null
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
  recipeEnabled.value = true
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
    wastePercent: Number(product.costBreakdown?.wastePercent || 0),
    failurePercent: Number(product.costBreakdown?.failurePercent || 0),
    hours: time.hours,
    minutes: time.minutes,
    quantity: Number(product.costBreakdown?.batchQuantity || product.costBreakdown?.quantity || 1),
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
    setupMinutes: Number(product.costBreakdown?.setupMinutes || 0),
    postProcessingMinutes: Number(product.costBreakdown?.postProcessingMinutes || 0),
    packagingMinutes: Number(product.costBreakdown?.packagingMinutes || 0),
    laborRatePerHour: Number(product.costBreakdown?.laborRatePerHour || 0),
    printerPurchasePrice: Number(product.costBreakdown?.printerPurchasePrice || 0),
    printerLifespanHours: Number(product.costBreakdown?.printerLifespanHours || 5000),
    machineMaintenancePerHour: Number(product.costBreakdown?.machineMaintenancePerHour || 0),
    minimumPrice: Number(product.costBreakdown?.minimumPrice || 0),
    energy: product.energy !== false,
    shopeeFee: Number(product.costBreakdown?.shopeeFeePercent || 0),
    otherMarketplaceFee: Number(product.costBreakdown?.otherMarketplaceFeePercent || 0),
    marketplaceFee: Number(product.marketplaceFee || product.costBreakdown?.additionalFeePercent || 0),
    taxPercent: Number(product.costBreakdown?.taxPercent || 0),
    otherCosts: Number(product.costBreakdown?.otherCosts || 0),
    price: Number(product.price || 0),
    desiredMargin: Number(product.desiredMargin || 40)
  })
  recipeEnabled.value = Boolean(product.printFileName || product.printFileStorageKey || product.dimensions)
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
watch(settings, (value) => {
  if (isEditing.value || hydratedFor.value) return
  const defaultMargin = Number((value?.preferences as Record<string, unknown> | undefined)?.defaultMargin)
  if (Number.isFinite(defaultMargin) && defaultMargin >= 0) form.desiredMargin = defaultMargin
}, { immediate: true })
onMounted(() => {
  if (editingId.value || String(route.query.from || '') !== 'calculator' || !import.meta.client) return
  const raw = sessionStorage.getItem('printflow-calculator-draft')
  if (!raw) return
  try {
    const draft = JSON.parse(raw)
    Object.assign(form, {
      printerId: draft.printerId || '', filamentId: draft.filamentId || '', weight: Number(draft.weight || 0), wastePercent: Number(draft.wastePercent || 0), failurePercent: Number(draft.failurePercent || 0),
      hours: Number(draft.hours || 0), minutes: Number(draft.minutes || 0), quantity: Number(draft.quantity || 1), packaging: Number(draft.packaging || 0),
      materials: Number(draft.materials || 0), labor: Number(draft.labor || 0), setupMinutes: Number(draft.setupMinutes || 0), postProcessingMinutes: Number(draft.postProcessingMinutes || 0), packagingMinutes: Number(draft.packagingMinutes || 0), laborRatePerHour: Number(draft.laborRatePerHour || 0), printerPurchasePrice: Number(draft.printerPurchasePrice || 0), printerLifespanHours: Number(draft.printerLifespanHours || 5000), machineMaintenancePerHour: Number(draft.machineMaintenancePerHour || 0), minimumPrice: Number(draft.minimumPrice || 0), otherCosts: Number(draft.otherCosts || 0),
      energy: draft.energyEnabled !== false, marketplaceFee: Number(draft.marketplaceFee || 0), taxPercent: Number(draft.taxPercent || 0),
      price: Number(draft.suggestedPrice || 0), desiredMargin: Number(draft.desiredMargin || 40)
    })
    sessionStorage.removeItem('printflow-calculator-draft')
    notify('Simulação carregada. Complete apenas os dados necessários para salvar o produto.')
  } catch {
    sessionStorage.removeItem('printflow-calculator-draft')
  }
})
const validate = () => {
  Object.keys(errors).forEach(key => delete errors[key])
  if (!form.name.trim()) errors.name = 'Informe o nome do produto.'
  if (!form.sku.trim()) errors.sku = 'Informe o SKU.'
  if (Number(form.price) < 0) errors.price = 'O preço de venda não pode ser negativo.'
  if (form.weight < 0) errors.weight = 'Informe um peso válido.'
  if (form.dimensions.trim() && !parseDimensions(form.dimensions)) {
    errors.dimensions = 'Use dimensoes no formato 120 x 80 x 45 mm.'
  }
  if (form.printFileName.trim() && !form.printFileFormat.trim()) errors.printFileFormat = 'Informe o formato do arquivo.'
  if (form.printFileFormat.trim() && !form.printFileName.trim()) errors.printFileName = 'Informe o nome do arquivo.'
  if (form.printFileFormat && !allowedPrintFileFormats.has(form.printFileFormat.toLowerCase())) errors.printFileFormat = 'Use 3MF, G-code ou BGCODE.'
  const fileExtension = form.printFileName.split('.').pop()?.toLowerCase() || ''
  if (fileExtension && form.printFileFormat && fileExtension !== form.printFileFormat.toLowerCase()) errors.printFileFormat = 'Formato diferente da extensão do arquivo.'
  if (recipeEnabled.value && (!Number(form.nozzleMm) || Number(form.nozzleMm) <= 0)) errors.nozzleMm = 'Informe o diâmetro do bico usado na receita.'
  if (recipeEnabled.value && (!Number(form.layer) || Number(form.layer) <= 0)) errors.layer = 'Informe a altura de camada.'
  if (recipeEnabled.value && (!Number(form.infill) || Number(form.infill) <= 0 || Number(form.infill) > 100)) errors.infill = 'Informe preenchimento entre 1% e 100%.'
  const printerNozzle = Number((selectedPrinter.value as any)?.nozzleMm || 0)
  if (printerNozzle > 0 && Number(form.nozzleMm) > 0 && Math.abs(Number(form.nozzleMm) - printerNozzle) > 0.01) errors.nozzleMm = `A impressora selecionada está cadastrada com bico de ${printerNozzle} mm.`
  const productDimensions = parseDimensions(form.dimensions)
  const printerVolume = parseDimensions(String(selectedPrinter.value?.volume || ''))
  if (productDimensions && printerVolume && (productDimensions.x > printerVolume.x || productDimensions.y > printerVolume.y || productDimensions.z > printerVolume.z)) errors.dimensions = `Produto maior que o volume da impressora (${selectedPrinter.value?.volume}).`
  if (form.validationStatus === 'validated' && (!hasPrintRecipe.value || !form.printFileHash.trim() || !form.dimensions.trim())) errors.validationStatus = 'Para marcar como validado, envie um arquivo e informe dimensões e hash.'
  return Object.keys(errors).length === 0
}
const save = async () => {
  if (!validate() || saving.value) return
  saving.value = true
  try {
    const hadSelectedPrintFile = Boolean(selectedPrintFile.value)
    const allowedMaterials = form.allowedMaterials.split(',').map((item) => item.trim()).filter(Boolean)
    const payload = {
      id: editingId.value || undefined,
      name: form.name.trim(),
      subtitle: form.description.trim().slice(0, 42),
      sku: form.sku.trim(),
      category: form.category,
      description: form.description.trim(),
      printerId: form.printerId,
      printer: selectedPrinter.value?.name || '',
      price: form.price,
      weight: form.weight,
      time: `${form.hours}h ${form.minutes}m`,
      layer: recipeEnabled.value ? form.layer : 0,
      infill: recipeEnabled.value ? form.infill : 0,
      dimensions: recipeEnabled.value ? form.dimensions : '',
      printFileName: recipeEnabled.value ? form.printFileName : '',
      printFileFormat: recipeEnabled.value ? form.printFileFormat : '',
      printFileHash: recipeEnabled.value ? form.printFileHash : '',
      printFileSizeBytes: recipeEnabled.value ? form.printFileSizeBytes : 0,
      printFileStorageKey: recipeEnabled.value ? form.printFileStorageKey : '',
      printProfile: recipeEnabled.value ? { layerHeightMm: form.layer, infillPercent: form.infill, nozzleTemperature: form.nozzleTemperature, bedTemperature: form.bedTemperature, support: form.support, scalePercent: form.scalePercent } : {},
      compatibility: recipeEnabled.value ? { materials: allowedMaterials, nozzleMm: form.nozzleMm } : {},
      validationStatus: recipeEnabled.value ? form.validationStatus : 'needs_validation',
      validationMessage: recipeEnabled.value ? form.validationMessage : 'Produto cadastrado sem receita de impressão.',
      filamentId: form.filamentId,
      filament: selectedFilament.value?.name || '',
      filamentColor: selectedFilament.value?.colorHex || '#555b64',
      packaging: form.packaging,
      materials: form.materials,
      labor: form.labor,
      energy: form.energy,
      marketplaceFee: form.marketplaceFee,
      desiredMargin: form.desiredMargin,
      costBreakdown: costBreakdown.value,
      cost: totalCost.value,
      profit: profit.value,
      margin: margin.value,
      status: form.status,
      thumb: 'vase'
    }
    const saved = isEditing.value ? payload : await createProduct(payload)
    if (isEditing.value) await updateItem('products', payload)
    const productId = String(saved.id || editingId.value || '')
    if (selectedPrintFile.value && productId) {
      const upload = await uploadProductPrintFile(productId, selectedPrintFile.value)
      if (upload.product) hydrateForm(upload.product)
      selectedPrintFile.value = null
    }
    if (selectedPrintFile.value) {
      // O upload nao foi concluido; mantenha o arquivo selecionado para nova tentativa.
      return
    }
    if (hadSelectedPrintFile && !form.dimensions.trim()) {
      notify('Arquivo enviado, mas nao foi possivel obter as dimensoes automaticamente. Informe-as para revisar a receita.', 'info')
      if (!isEditing.value && productId) await router.replace(`/produtos/novo?id=${productId}`)
      return
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
  <div class="product-editor">
    <PageHeader
      :title="isEditing ? 'Editar produto' : 'Novo produto'"
      :subtitle="isEditing ? 'Atualize os dados comerciais, a produção e a receita do produto.' : 'Comece pelo essencial. Produção, custos detalhados e arquivo de impressão são opcionais.'"
    >
      <NuxtLink class="btn" to="/produtos">Cancelar</NuxtLink>
    </PageHeader>

    <form class="product-editor__layout" @submit.prevent="save">
      <main class="product-editor__main">
        <section class="product-editor__notice">
          <span class="product-editor__notice-icon"><UiIcon name="box" :size="20" /></span>
          <div>
            <strong>Cadastro rápido disponível</strong>
            <p>Somente nome e SKU são obrigatórios. Você pode completar custos e receita de impressão depois.</p>
          </div>
        </section>

        <section class="form-card product-form-section">
          <div class="product-form-section__head">
            <div>
              <span class="product-form-section__eyebrow">Etapa essencial</span>
              <h2>Identificação do produto</h2>
              <p>Dados usados nas vendas, no estoque e nos relatórios.</p>
            </div>
            <span class="badge badge--green">2 campos obrigatórios</span>
          </div>

          <div class="form-grid">
            <div class="field col-6" :class="{ 'field--error': errors.name }">
              <label>Nome do produto *</label>
              <input v-model="form.name" required placeholder="Ex.: Vaso espiral grande">
              <small v-if="errors.name" class="field__error">{{ errors.name }}</small>
            </div>
            <div class="field col-3" :class="{ 'field--error': errors.sku }">
              <label>SKU *</label>
              <input v-model="form.sku" required placeholder="Ex.: VAS-001">
              <small v-if="errors.sku" class="field__error">{{ errors.sku }}</small>
            </div>
            <div class="field col-3">
              <label>Status</label>
              <select v-model="form.status"><option>Ativo</option><option>Rascunho</option></select>
            </div>
            <div class="field col-4">
              <label>Categoria <span class="field__optional">opcional</span></label>
              <select v-model="form.category"><option>Decoração</option><option>Acessórios</option><option>Brinquedos</option><option>Organizadores</option><option>Outros</option></select>
            </div>
            <div class="field col-8">
              <label>Descrição <span class="field__optional">opcional</span></label>
              <textarea v-model="form.description" placeholder="Uma descrição curta para identificar o produto" />
            </div>
          </div>
        </section>

        <details class="product-optional-card" open>
          <summary>
            <span class="product-optional-card__icon"><UiIcon name="settings" :size="19" /></span>
            <span><strong>Produção e custos</strong><small>Opcional — melhora o cálculo de custo e lucro</small></span>
            <span class="product-optional-card__state">Expandir</span>
          </summary>
          <div class="product-optional-card__body">
            <div class="form-grid">
              <div class="field col-4">
                <label>Impressora <span class="field__optional">opcional</span></label>
                <select v-model="form.printerId"><option value="">Sem impressora vinculada</option><option v-for="printer in printers" :key="printer.id" :value="printer.id">{{ printer.name }}</option></select>
              </div>
              <div class="field col-4">
                <label>Filamento <span class="field__optional">opcional</span></label>
                <select v-model="form.filamentId"><option value="">Sem filamento vinculado</option><option v-for="filament in filaments" :key="filament.id" :value="filament.id">{{ filament.name }} — {{ filament.material }}</option></select>
              </div>
              <div class="field col-2">
                <label>Peso por peça (g)</label>
                <input v-model.number="form.weight" type="number" min="0" step="0.1">
              </div>
              <div class="field col-2">
                <label>Peças por lote <span class="field__optional">opcional</span></label>
                <input v-model.number="form.quantity" type="number" min="1" step="1">
                <small>Quantas peças cabem na mesma impressão.</small>
              </div>
              <div class="field col-2"><label>Horas do lote</label><input v-model.number="form.hours" type="number" min="0"></div>
              <div class="field col-2"><label>Minutos do lote</label><input v-model.number="form.minutes" type="number" min="0" max="59"></div>
              <div class="field col-2"><label>Perda de material (%)</label><input v-model.number="form.wastePercent" type="number" min="0" step="0.1"></div>
              <div class="field col-2"><label>Risco de falha (%)</label><input v-model.number="form.failurePercent" type="number" min="0" max="95" step="0.1"></div>
              <div class="field col-2"><label>Embalagem (R$)</label><input v-model.number="form.packaging" type="number" min="0" step="0.01"></div>
              <div class="field col-2"><label>Materiais extras (R$)</label><input v-model.number="form.materials" type="number" min="0" step="0.01"></div>
              <div class="field col-3"><label>Mão de obra fixa (R$) <span class="field__optional">opcional</span></label><input v-model.number="form.labor" type="number" min="0" step="0.01"></div>
              <div class="field col-3"><label>Outros gastos (R$)</label><input v-model.number="form.otherCosts" type="number" min="0" step="0.01"></div>
              <div class="field col-3"><label>Taxas de venda (%)</label><input v-model.number="form.marketplaceFee" type="number" min="0" step="0.1"></div>
              <div class="field col-3"><label>Impostos (%)</label><input v-model.number="form.taxPercent" type="number" min="0" step="0.1"></div>
              <div class="field col-3"><label>Taxa Shopee (%)</label><input v-model.number="form.shopeeFee" type="number" min="0" step="0.1"></div>
              <div class="field col-3"><label>Outros marketplaces (%)</label><input v-model.number="form.otherMarketplaceFee" type="number" min="0" step="0.1"></div>
              <div class="field col-6">
                <label>Energia da impressão</label>
                <div class="switch-row"><span>{{ form.energy ? 'Incluída no custo' : 'Não incluída' }}</span><button type="button" class="switch" :class="{ active: form.energy }" @click="form.energy = !form.energy" /></div>
              </div>
            </div>

            <details class="product-subdetails">
              <summary>Custos avançados de mão de obra e máquina</summary>
              <div class="form-grid">
                <div class="field col-3"><label>Preparação (min)</label><input v-model.number="form.setupMinutes" type="number" min="0"></div>
                <div class="field col-3"><label>Pós-processamento (min)</label><input v-model.number="form.postProcessingMinutes" type="number" min="0"></div>
                <div class="field col-3"><label>Embalagem (min)</label><input v-model.number="form.packagingMinutes" type="number" min="0"></div>
                <div class="field col-3"><label>Valor da hora (R$)</label><input v-model.number="form.laborRatePerHour" type="number" min="0" step="0.01"></div>
                <div class="field col-3"><label>Valor da impressora (R$)</label><input v-model.number="form.printerPurchasePrice" type="number" min="0" step="0.01"></div>
                <div class="field col-3"><label>Vida útil (h)</label><input v-model.number="form.printerLifespanHours" type="number" min="1"></div>
                <div class="field col-3"><label>Manutenção por hora (R$)</label><input v-model.number="form.machineMaintenancePerHour" type="number" min="0" step="0.01"></div>
                <div class="field col-3"><label>Preço mínimo (R$)</label><input v-model.number="form.minimumPrice" type="number" min="0" step="0.01"></div>
              </div>
            </details>
          </div>
        </details>

        <section class="form-card product-form-section product-recipe">
          <div class="product-form-section__head">
            <div>
              <span class="product-form-section__eyebrow">Opcional</span>
              <h2>Receita de impressão</h2>
              <p>Use apenas se quiser vincular um arquivo e parâmetros técnicos ao produto.</p>
            </div>
            <span class="badge" :class="hasPrintRecipe ? 'badge--green' : 'badge--gray'">{{ hasPrintRecipe ? 'Arquivo vinculado' : 'Sem arquivo' }}</span>
          </div>

          <div v-if="!recipeEnabled" class="product-recipe__empty">
            <span><UiIcon name="upload" :size="24" /></span>
            <div><strong>Você pode salvar sem arquivo</strong><p>Adicione 3MF, G-code ou BGCODE agora ou em outro momento.</p></div>
            <button type="button" class="btn" @click="recipeEnabled = true">Adicionar receita</button>
          </div>

          <div v-else class="product-recipe__content">
            <label class="upload-zone">
              <input type="file" accept=".3mf,.gcode,.bgcode" hidden @change="handlePrintFileSelect">
              <span><UiIcon name="upload" :size="28" /><strong>{{ selectedPrintFile?.name || form.printFileName || 'Selecionar arquivo de impressão' }}</strong><small>3MF, G-code ou BGCODE. O arquivo será enviado depois que o produto for criado.</small></span>
            </label>

            <div class="form-grid product-recipe__fields">
              <div class="field col-4" :class="{ 'field--error': errors.dimensions }"><label>Dimensões (mm) <span class="field__optional">opcional</span></label><input v-model="form.dimensions" placeholder="120 x 80 x 45"><small v-if="errors.dimensions" class="field__error">{{ errors.dimensions }}</small></div>
              <div class="field col-2" :class="{ 'field--error': errors.layer }"><label>Camada (mm)</label><input v-model.number="form.layer" type="number" step=".01" min="0"><small v-if="errors.layer" class="field__error">{{ errors.layer }}</small></div>
              <div class="field col-2" :class="{ 'field--error': errors.infill }"><label>Preenchimento (%)</label><input v-model.number="form.infill" type="number" min="0" max="100"><small v-if="errors.infill" class="field__error">{{ errors.infill }}</small></div>
              <div class="field col-2" :class="{ 'field--error': errors.nozzleMm }"><label>Bico (mm)</label><input v-model.number="form.nozzleMm" type="number" step=".1" min="0"><small v-if="errors.nozzleMm" class="field__error">{{ errors.nozzleMm }}</small></div>
              <div class="field col-2"><label>Escala (%)</label><input v-model.number="form.scalePercent" type="number" min="1"></div>
              <div class="field col-3"><label>Temperatura do bico (°C)</label><input v-model.number="form.nozzleTemperature" type="number" min="0"></div>
              <div class="field col-3"><label>Temperatura da mesa (°C)</label><input v-model.number="form.bedTemperature" type="number" min="0"></div>
              <div class="field col-3"><label>Materiais compatíveis</label><input v-model="form.allowedMaterials" placeholder="PLA, PETG"></div>
              <div class="field col-3" :class="{ 'field--error': errors.validationStatus }"><label>Status da receita</label><select v-model="form.validationStatus"><option value="needs_validation">Pendente</option><option value="validated">Validada</option><option value="blocked">Bloqueada</option></select><small v-if="errors.validationStatus" class="field__error">{{ errors.validationStatus }}</small></div>
              <div class="field col-4"><label>Usar suporte</label><div class="switch-row"><span>{{ form.support ? 'Ativado' : 'Desativado' }}</span><button type="button" class="switch" :class="{ active: form.support }" @click="form.support = !form.support" /></div></div>
              <div class="field col-8"><label>Observação da validação</label><input v-model="form.validationMessage" placeholder="Ex.: Perfil conferido no slicer"></div>
            </div>
          </div>
        </section>

        <section class="form-card product-form-section product-price-section">
          <div class="product-form-section__head">
            <div><span class="product-form-section__eyebrow">Finalização</span><h2>Preço de venda</h2><p>Você pode deixar o preço em zero e completar depois.</p></div>
          </div>
          <div class="form-grid">
            <div class="field col-4" :class="{ 'field--error': errors.price }"><label>Preço de venda (R$) <span class="field__optional">opcional</span></label><input v-model.number="form.price" type="number" min="0" step="0.01"><small v-if="errors.price" class="field__error">{{ errors.price }}</small></div>
            <div class="field col-8"><label>Margem desejada: <strong>{{ form.desiredMargin }}%</strong></label><input v-model.number="form.desiredMargin" class="product-margin-range" type="range" min="0" max="80" step="1"><small>O cálculo ao lado é atualizado automaticamente.</small></div>
            <div v-if="pricing.suggestedPrice > 0" class="product-price-suggestion col-12"><span>Preço sugerido pelos custos e margem: <strong>{{ formatCurrency(pricing.suggestedPrice) }}</strong></span><button type="button" class="btn btn--ghost" @click="form.price = pricing.suggestedPrice">Usar preço sugerido</button></div>
          </div>
        </section>
      </main>

      <aside class="product-editor__aside">
        <div class="detail-card product-summary">
          <div class="product-summary__identity">
            <ProductThumb type="vase" :size="64" />
            <div><small>Prévia do produto</small><h3>{{ form.name || 'Produto sem nome' }}</h3><p>{{ form.sku || 'SKU ainda não informado' }} · {{ form.status }}</p></div>
          </div>

          <div class="product-summary__metrics">
            <div><small>Custo estimado</small><strong>{{ formatCurrency(totalCost) }}</strong></div>
            <div><small>Preço de venda</small><strong>{{ form.price > 0 ? formatCurrency(form.price) : 'Pendente' }}</strong></div>
            <div><small>Lucro líquido</small><strong :class="profit >= 0 ? 'money-positive' : 'money-negative'">{{ formatCurrency(profit) }}</strong></div>
            <div><small>Margem líquida</small><strong :class="margin >= 0 ? 'money-positive' : 'money-negative'">{{ margin.toFixed(1) }}%</strong></div>
          </div>

          <div v-if="batchQuantity > 1" class="product-summary__batch">
            <UiIcon name="printer" :size="17" />
            <div><strong>{{ batchQuantity }} peças por impressão</strong><small>{{ batchProductionMinutes }} min por lote · {{ unitProductionMinutes.toFixed(1) }} min rateados por peça</small></div>
          </div>

          <details class="product-summary__breakdown">
            <summary>Ver composição do custo</summary>
            <div class="detail-list">
              <div class="detail-list__row"><span>Material/filamento</span><strong>{{ formatCurrency(filamentCost) }}</strong></div>
              <div class="detail-list__row"><span>Energia</span><strong>{{ formatCurrency(energyCost) }}</strong></div>
              <div class="detail-list__row"><span>Embalagem e extras</span><strong>{{ formatCurrency(Number(form.packaging || 0) + Number(form.materials || 0)) }}</strong></div>
              <div class="detail-list__row"><span>Mão de obra</span><strong>{{ formatCurrency(pricing.laborCost) }}</strong></div>
              <div class="detail-list__row"><span>Taxas e impostos</span><strong>{{ formatCurrency(pricing.feeCost) }}</strong></div>
              <div v-if="batchQuantity > 1" class="detail-list__row"><span>Custo do lote</span><strong>{{ formatCurrency(totalCost * batchQuantity) }}</strong></div>
            </div>
          </details>

          <div class="product-summary__status" :class="{ 'product-summary__status--warning': form.price <= 0 || profit < 0 }">
            <UiIcon :name="form.price > 0 && profit >= 0 ? 'check' : 'info'" :size="18" />
            <div v-if="form.price <= 0"><strong>Preço ainda pendente</strong><p>O produto pode ser salvo como rascunho e precificado depois.</p></div>
            <div v-else-if="profit < 0"><strong>Preço abaixo do custo</strong><p>Revise o preço ou os custos antes de vender.</p></div>
            <div v-else><strong>Preço saudável</strong><p>O preço cobre os custos informados.</p></div>
          </div>

          <button class="btn btn--primary btn--wide product-summary__save" type="submit" :disabled="saving"><UiIcon name="save" :size="16" />{{ saving ? 'Salvando...' : isEditing ? 'Atualizar produto' : 'Salvar produto' }}</button>
          <NuxtLink class="btn btn--ghost btn--wide" to="/produtos">Cancelar</NuxtLink>
        </div>
      </aside>
    </form>
  </div>
</template>
