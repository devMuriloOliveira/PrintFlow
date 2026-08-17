<script setup lang="ts">
const { products, deleteItem } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()
const router = useRouter()
const search = ref('')
const category = ref('Todas')
const productStatus = ref('Todos')
const selectedProductId = ref('')
const selectedMetric = ref<'active' | 'price' | 'cost' | 'margin'>('active')
const chartPeriod = ref<'week' | 'month' | 'year'>('month')
const currentPage = ref(1)
const perPage = ref(5)

const filtered = computed(() => products.value.filter(p => {
  const matchesCategory = category.value === 'Todas' || p.category === category.value
  const matchesStatus = productStatus.value === 'Todos' || p.status === productStatus.value
  const matchesSearch = `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(search.value.toLowerCase())
  return matchesCategory && matchesStatus && matchesSearch
}))
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / perPage.value)))
const paginatedProducts = computed(() => {
  const start = (currentPage.value - 1) * perPage.value
  return filtered.value.slice(start, start + perPage.value)
})
const selected = computed(() => products.value.find(p => p.id === selectedProductId.value) || paginatedProducts.value[0] || filtered.value[0])
const productCostBreakdown = (product: any) => ({
  materialCost: Number(product.costBreakdown?.materialCost ?? 0),
  packagingCost: Number(product.costBreakdown?.packagingCost ?? product.packaging ?? 0),
  energyCost: Number(product.costBreakdown?.energyCost ?? 0),
  additionalMaterialsCost: Number(product.costBreakdown?.additionalMaterialsCost ?? product.materials ?? 0),
  laborCost: Number(product.costBreakdown?.laborCost ?? product.labor ?? 0),
  otherCosts: Number(product.costBreakdown?.otherCosts ?? 0),
  shopeeFeeCost: Number(product.costBreakdown?.shopeeFeeCost ?? 0),
  otherMarketplaceFeeCost: Number(product.costBreakdown?.otherMarketplaceFeeCost ?? 0),
  additionalFeeCost: Number(product.costBreakdown?.additionalFeeCost ?? 0),
  productionTimeMinutes: Number(product.costBreakdown?.productionTimeMinutes ?? 0),
  materialName: String(product.costBreakdown?.materialName || product.filament || '')
})
const selectedBreakdown = computed(() => selected.value ? productCostBreakdown(selected.value) : null)
const paginationSummary = computed(() => {
  const total = filtered.value.length
  if (!total) return 'Mostrando 0 de 0 produtos'
  const start = (currentPage.value - 1) * perPage.value + 1
  const end = Math.min(start + perPage.value - 1, total)
  if (start === end) return `Mostrando ${start} de ${total} ${total === 1 ? 'produto' : 'produtos'}`
  return `Mostrando ${start} a ${end} de ${total} produtos`
})
const visiblePages = computed<(number | string)[]>(() => {
  const total = pageCount.value
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set([1, total, currentPage.value - 1, currentPage.value, currentPage.value + 1])
  const sorted = [...pages].filter(page => page >= 1 && page <= total).sort((a, b) => a - b)
  return sorted.flatMap((page, i) => i && page - sorted[i - 1] > 1 ? ['...', page] : [page])
})

const metricCards = computed(() => [
  { key: 'active' as const, label: 'Produtos Ativos', value: formatNumber(metrics.activeProducts.value), icon: 'box', note: 'Dados do banco', color: 'blue' },
  { key: 'price' as const, label: 'Preco Medio', value: formatCurrency(metrics.averagePrice.value), icon: 'tag', note: 'Dados do banco', color: 'green' },
  { key: 'cost' as const, label: 'Custo Medio', value: formatCurrency(metrics.averageCost.value), icon: 'money', note: 'Dados do banco', color: 'purple' },
  { key: 'margin' as const, label: 'Margem Media', value: metrics.percent(metrics.averageProductMargin.value), icon: 'percent', note: 'Dados do banco', color: 'orange' }
])
const metricDetails = {
  active: { title: 'Evolucao de Produtos Ativos', color: '#1768f2', totalLabel: 'Produtos ativos', formatter: formatNumber },
  price: { title: 'Evolucao do Preco Medio', color: '#0da566', totalLabel: 'Preco medio atual', formatter: formatCurrency },
  cost: { title: 'Evolucao do Custo Medio', color: '#7c3aed', totalLabel: 'Custo medio atual', formatter: formatCurrency },
  margin: { title: 'Evolucao da Margem Media', color: '#f57c1f', totalLabel: 'Margem media atual', formatter: (value: number) => metrics.percent(value) }
}
const selectedDetail = computed(() => metricDetails[selectedMetric.value])
const parseProductDate = (date?: string) => {
  if (!date) return null
  const parsed = new Date(`${date}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
const dateKey = (date: Date) => {
  if (chartPeriod.value === 'week') {
    const start = new Date(date)
    start.setDate(date.getDate() - date.getDay())
    return start.toISOString().slice(0, 10)
  }
  if (chartPeriod.value === 'year') return String(date.getFullYear())
  return date.toISOString().slice(0, 7)
}
const formatChartLabel = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  if (chartPeriod.value === 'year') return key
  if (chartPeriod.value === 'week') return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`
  return `${String(month).padStart(2, '0')}/${year}`
}
const average = (values: number[]) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0
const detailedChart = computed(() => {
  const groups = new Map<string, typeof products.value>()
  for (const product of products.value) {
    const date = parseProductDate(product.updatedAt || product.createdAt)
    if (!date) continue
    const key = dateKey(date)
    groups.set(key, [...(groups.get(key) || []), product])
  }

  const rows = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  const values = rows.map(([, items]) => {
    if (selectedMetric.value === 'active') return items.filter(product => product.status === 'Ativo').length
    if (selectedMetric.value === 'price') return average(items.map(product => product.price))
    if (selectedMetric.value === 'cost') return average(items.map(product => product.cost))
    return average(items.map(product => product.margin))
  })
  const total = selectedMetric.value === 'active'
    ? metrics.activeProducts.value
    : selectedMetric.value === 'price'
      ? metrics.averagePrice.value
      : selectedMetric.value === 'cost'
        ? metrics.averageCost.value
        : metrics.averageProductMargin.value

  return { labels: rows.map(([key]) => formatChartLabel(key)), values: values.length ? values : [0, 0], total }
})

watch([search, category, productStatus, perPage], () => {
  currentPage.value = 1
})
watch([filtered, perPage], () => {
  currentPage.value = Math.min(currentPage.value, pageCount.value)
  if (!filtered.value.some(product => product.id === selectedProductId.value)) selectedProductId.value = filtered.value[0]?.id || ''
}, { immediate: true })

const editProduct = (product: any) => {
  if (!product.id) return
  router.push(`/produtos/novo?id=${product.id}`)
}
const removeProduct = async (product: any) => {
  if (!product.id || !window.confirm(`Excluir produto?\n\n${product.name}\n\nEsta acao nao podera ser desfeita.`)) return
  await deleteItem('products', product.id)
  notify('Produto excluido com sucesso.')
}
</script>

<template>
  <div>
    <PageHeader title="Produtos" subtitle="Gerencie seu catalogo de produtos e acompanhe a performance">
      <NuxtLink class="btn btn--primary" to="/produtos/novo"><UiIcon name="plus" :size="17"/><span>Novo Produto</span></NuxtLink>
    </PageHeader>
    <div class="metrics-grid metrics-grid--4">
      <MetricCard v-for="card in metricCards" :key="card.key" :label="card.label" :value="card.value" :icon="card.icon" :note="card.note" :color="card.color" :selected="selectedMetric === card.key" interactive @click="selectedMetric = card.key" />
    </div>
    <PanelCard :title="selectedDetail.title" :subtitle="`${selectedDetail.totalLabel}: ${selectedDetail.formatter(detailedChart.total)}`">
      <template #actions>
        <div class="segmented-control" aria-label="Periodo do grafico">
          <button type="button" :class="{ active: chartPeriod === 'week' }" @click="chartPeriod = 'week'">Semana</button>
          <button type="button" :class="{ active: chartPeriod === 'month' }" @click="chartPeriod = 'month'">Mes</button>
          <button type="button" :class="{ active: chartPeriod === 'year' }" @click="chartPeriod = 'year'">Ano</button>
        </div>
      </template>
      <LineChart :values="detailedChart.values" :labels="detailedChart.labels" :color="selectedDetail.color" />
    </PanelCard>
    <div class="filters">
      <div class="field field--search"><label>Produto</label><div class="search-field"><UiIcon name="search" :size="16"/><input v-model="search" placeholder="Buscar produtos..."></div></div>
      <div class="field"><label>Categoria</label><select v-model="category"><option>Todas</option><option>Decoracao</option><option>Acessorios</option><option>Brinquedos</option><option>Organizadores</option></select></div>
      <div class="field"><label>Impressora</label><select><option>Todas</option></select></div>
      <div class="field"><label>Material</label><select><option>Todos</option></select></div>
      <div class="field"><label>Status</label><select v-model="productStatus"><option>Todos</option><option>Ativo</option><option>Rascunho</option></select></div>
      <button class="btn" @click="search='';category='Todas';productStatus='Todos'"><UiIcon name="close" :size="15"/> Limpar</button>
    </div>
    <div class="split-layout">
      <PanelCard>
        <div class="table-scroll"><table class="data-table">
          <thead><tr><th></th><th>Produto</th><th>SKU</th><th>Categoria</th><th>Preco de Venda</th><th>Peso</th><th>Tempo de Impressao</th><th>Filamento</th><th>Custo Total</th><th>Lucro</th><th>Margem</th><th>Status</th><th></th></tr></thead>
          <tbody><tr v-if="!paginatedProducts.length"><td colspan="13"><div class="empty-state"><div><div class="empty-state__icon"><UiIcon name="box"/></div><h3>Nenhum produto encontrado</h3><p>Cadastre produtos ou ajuste os filtros para preencher a lista.</p></div></div></td></tr><tr v-for="p in paginatedProducts" :key="p.sku" :class="{selected: selected?.sku === p.sku}" @click="selectedProductId = p.id || ''"><td><input type="radio" :checked="selected?.sku === p.sku"></td><td><div class="table-product table-product--editable"><ProductThumb :type="p.thumb"/><div><strong>{{p.name}}</strong><small>{{p.subtitle}}</small></div><button class="row-action row-action--edit" title="Editar produto" @click.stop="editProduct(p)"><UiIcon name="edit" :size="15"/></button></div></td><td>{{p.sku}}</td><td>{{p.category}}</td><td><strong>{{formatCurrency(p.price)}}</strong></td><td>{{p.weight}} g</td><td>{{p.time}}</td><td><span style="display:flex;align-items:center;gap:6px"><i class="dot" :style="{background:p.filamentColor}"/>{{p.filament}}</span></td><td>{{formatCurrency(p.cost)}}</td><td class="money-positive">{{formatCurrency(p.profit)}}</td><td class="money-positive">{{p.margin}}%</td><td><span class="badge" :class="p.status === 'Ativo' ? 'badge--green' : ''">{{p.status}}</span></td><td><button class="row-action" title="Excluir produto" @click.stop="removeProduct(p)"><UiIcon name="close" :size="16"/></button></td></tr></tbody>
        </table></div>
        <div class="table-footer"><span>{{ paginationSummary }}</span><div class="pagination"><button v-for="page in visiblePages" :key="page" class="page-btn" :class="{ active: page === currentPage }" :disabled="page === '...'" @click="typeof page === 'number' && (currentPage = page)">{{ page }}</button></div><select v-model.number="perPage" class="select-compact"><option :value="5">5 por pagina</option><option :value="10">10 por pagina</option><option :value="20">20 por pagina</option></select></div>
      </PanelCard>
      <aside v-if="selected" class="detail-card">
        <div class="detail-card__head"><ProductThumb :type="selected.thumb" :size="75"/><div><h3>{{selected.name}} <span class="badge" :class="selected.status === 'Ativo' ? 'badge--green' : ''">{{ selected.status }}</span></h3><p>SKU: {{selected.sku}}</p><p>{{selected.category}}</p><p>Material: {{selected.filament}}</p></div></div>
        <div class="tabs"><button class="tab active">Ficha Financeira</button><button class="tab">Detalhes</button><button class="tab">Historico</button></div>
        <div class="detail-card__body"><div class="detail-list"><div class="detail-list__row"><span><i style="background:#2a8ca1"/>Material ({{selected.weight}} g)</span><strong>{{formatCurrency(selectedBreakdown?.materialCost || 0)}}</strong></div><div class="detail-list__row"><span><i style="background:#f6c344"/>Energia ({{selected.time}})</span><strong>{{formatCurrency(selectedBreakdown?.energyCost || 0)}}</strong></div><div class="detail-list__row"><span><i style="background:#f47b3b"/>Embalagem</span><strong>{{formatCurrency(selectedBreakdown?.packagingCost || 0)}}</strong></div><div class="detail-list__row"><span><i style="background:#c43dcc"/>Materiais adicionais</span><strong>{{formatCurrency(selectedBreakdown?.additionalMaterialsCost || 0)}}</strong></div><div class="detail-list__row"><span><i style="background:#697386"/>Mao de obra</span><strong>{{formatCurrency(selectedBreakdown?.laborCost || 0)}}</strong></div><div class="detail-list__row"><span><i style="background:#7c3aed"/>Outros gastos</span><strong>{{formatCurrency(selectedBreakdown?.otherCosts || 0)}}</strong></div><div class="detail-list__row"><span><i style="background:#ee4d2d"/>Taxas Shopee</span><strong>{{formatCurrency(selectedBreakdown?.shopeeFeeCost || 0)}}</strong></div><div class="detail-list__row"><span><i style="background:#1768f2"/>Outros marketplaces</span><strong>{{formatCurrency(selectedBreakdown?.otherMarketplaceFeeCost || 0)}}</strong></div><div class="detail-list__row"><span><i style="background:#111827"/>Demais taxas</span><strong>{{formatCurrency(selectedBreakdown?.additionalFeeCost || 0)}}</strong></div></div><div class="summary-box"><div class="detail-list__row"><span>Custo Total</span><strong>{{formatCurrency(selected.cost)}}</strong></div><div class="detail-list__row"><span>Preco de Venda</span><strong>{{formatCurrency(selected.price)}}</strong></div><div class="detail-list__row"><span>Lucro Liquido</span><strong class="money-positive">{{formatCurrency(selected.profit)}}</strong></div><div class="detail-list__row"><span>Margem Liquida</span><strong class="money-positive">{{selected.margin}}%</strong></div></div></div>
      </aside>
    </div>
  </div>
</template>
