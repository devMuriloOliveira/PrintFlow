<script setup lang="ts">
const { filaments, products, printJobs, deleteItem, createFilamentMovement, listFilamentMovements, refreshAppData } = useAppData()
const metrics = useBusinessMetrics()
const stockPoints = computed(() => filaments.value.map(filament => Number(filament.remaining || 0)))
const stockCostPoints = computed(() => filaments.value.map(filament => filament.initial ? Number(filament.cost || 0) * Number(filament.remaining || 0) / Number(filament.initial) : 0))
const gramCostPoints = computed(() => filaments.value.map(filament => filament.initial ? Number(filament.cost || 0) / Number(filament.initial) : 0))
const { notify } = useUi()
const router = useRouter()
const selectedKey = ref('')
const search = ref('')
const currentPage = ref(1)
const perPage = ref(10)
const filamentMakerFilter = ref('Todos')
const filamentMaterialFilter = ref('Todos')
const filamentStatusFilter = ref('Todos')
const emptyFilament = { name: '', maker: '', material: '', type: '', color: '', colorHex: '#ccd3df', initial: 1, remaining: 0, minStock: 300, cost: 0, supplier: '', date: '', status: '' }
const selected = computed(() => filaments.value.find((item: any) => String(item.id || item.name) === selectedKey.value) || filaments.value[0] || emptyFilament)
const filamentMakerOptions = computed(() => ['Todos', ...new Set(filaments.value.map((item: any) => String(item.maker || '').trim()).filter(Boolean))])
const filamentMaterialOptions = computed(() => ['Todos', ...new Set(filaments.value.map((item: any) => String(item.material || '').trim()).filter(Boolean))])
const filamentStatusOptions = computed(() => ['Todos', ...new Set(filaments.value.map((item: any) => String(item.status || '').trim()).filter(Boolean))])
const filteredFilaments = computed(() => filaments.value.filter((item: any) =>
  Object.values(item).join(' ').toLowerCase().includes(search.value.trim().toLowerCase()) &&
  (filamentMakerFilter.value === 'Todos' || item.maker === filamentMakerFilter.value) &&
  (filamentMaterialFilter.value === 'Todos' || item.material === filamentMaterialFilter.value) &&
  (filamentStatusFilter.value === 'Todos' || item.status === filamentStatusFilter.value)
))
const selectFilament = (filament: any) => {
  selectedKey.value = String(filament.id || filament.name)
}
const clearFilamentFilters = () => { search.value = ''; filamentMakerFilter.value = 'Todos'; filamentMaterialFilter.value = 'Todos'; filamentStatusFilter.value = 'Todos' }
const pageCount = computed(() => Math.max(1, Math.ceil(filteredFilaments.value.length / perPage.value)))
const paginatedFilaments = computed(() => filteredFilaments.value.slice((currentPage.value - 1) * perPage.value, currentPage.value * perPage.value))
const totalWeight = computed(() => filaments.value.reduce((sum, item: any) => sum + Number(item.remaining || 0), 0))
const materialSegments = computed(() => {
  const totals = new Map<string, number>()
  for (const item of filaments.value) totals.set(item.material || 'Outro', (totals.get(item.material || 'Outro') || 0) + Number(item.remaining || 0))
  const colors = ['#1768f2', '#2fb4c2', '#f6ad2e', '#7c3aed', '#ef4444']
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], index) => ({ label, value, color: colors[index % colors.length] }))
})
const lowStockFilaments = computed(() => filaments.value.filter((item: any) => Number(item.remaining || 0) <= Number(item.minStock ?? 300)))
const selectedConsumption = computed(() => {
  const filamentId = String(selected.value.id || '')
  const weightForJob = (job: any) => {
    const product = products.value.find((item: any) => String(item.id || '') === String(job.productId || ''))
    return product && String(product.filamentId || '') === filamentId ? Number(product.weight || 0) * Number(job.quantity || 1) : 0
  }
  const total = (statuses: string[]) => printJobs.value.filter((job: any) => statuses.includes(String(job.status || ''))).reduce((sum, job) => sum + weightForJob(job), 0)
  return { completed: total(['completed']), active: total(['starting', 'printing', 'paused']), queued: total(['queued', 'awaiting_confirmation']) }
})
const selectedGramCost = computed(() => selected.value.initial ? Number(selected.value.cost || 0) / Number(selected.value.initial || 1) : 0)
watch([search, filamentMakerFilter, filamentMaterialFilter, filamentStatusFilter, perPage], () => { currentPage.value = 1 })
watch(pageCount, () => { if (currentPage.value > pageCount.value) currentPage.value = pageCount.value })
watch(filaments, (list) => { if (!list.some((item: any) => String(item.id || item.name) === selectedKey.value)) selectedKey.value = list[0] ? String(list[0].id || list[0].name) : '' }, { immediate: true })
const pieceWeight = ref(180)
const movement = reactive({ type: 'in' as 'in' | 'out' | 'adjustment', quantity: 0, reason: '' })
const movements = ref<any[]>([])
const movementTypeFilter = ref('Todos')
const movementFrom = ref('')
const movementTo = ref('')
const movementSaving = ref(false)
const pieceCost = computed(() => selected.value && selected.value.initial ? selected.value.cost / selected.value.initial * pieceWeight.value : 0)
const displayStatus = (s:string) => s
const badgeClass = (s:string) => s === 'Em estoque' ? 'badge--green' : s === 'Baixo estoque' ? 'badge--orange' : 'badge--red'
const filteredMovements = computed(() => movements.value.filter((item: any) => {
  const date = String(item.createdAt || '').slice(0, 10)
  return (movementTypeFilter.value === 'Todos' || item.type === movementTypeFilter.value)
    && (!movementFrom.value || date >= movementFrom.value)
    && (!movementTo.value || date <= movementTo.value)
}))
const editFilament = (filament: any) => {
  if (!filament.id) return
  router.push(`/filamentos/novo?id=${filament.id}`)
}
const removeFilament = async (filament: any) => {
  if (!filament.id || !window.confirm(`Excluir filamento?\n\n${filament.name}\n\nEsta ação não poderá ser desfeita.`)) return
  try { await deleteItem('filaments', filament.id); notify('Filamento excluído com sucesso.') } catch (error: any) { notify(error?.data?.error || error?.message || 'Não foi possível excluir o filamento.') }
}
const editLowStock = (filament: any) => { if (filament?.id) router.push(`/filamentos/novo?id=${filament.id}`) }
const loadMovements = async () => {
  if (!selected.value.id) return
  movements.value = await listFilamentMovements(selected.value.id).catch(() => [])
}
watch(selected, loadMovements, { immediate: true })
const saveMovement = async () => {
  if (!selected.value.id || movementSaving.value || movement.quantity <= 0 || !movement.reason.trim()) return notify('Informe quantidade e motivo da movimentacao.')
  movementSaving.value = true
  try {
    await createFilamentMovement(selected.value.id, { ...movement })
    movement.quantity = 0; movement.reason = ''
    await refreshAppData(); await loadMovements()
    notify('Movimentacao registrada e estoque atualizado.')
  } catch (error: any) { notify(error?.data?.error || error?.message || 'Nao foi possivel registrar a movimentacao.') } finally { movementSaving.value = false }
}
</script>

<template>
  <div>
    <PageHeader title="Filamentos" subtitle="Gerencie seu estoque de filamentos e mantenha o controle de custos por grama."><NuxtLink class="btn btn--primary" to="/filamentos/novo"><UiIcon name="plus" :size="16" />Novo Filamento</NuxtLink></PageHeader>
    <div class="metrics-grid metrics-grid--5"><MetricCard label="Rolos em Estoque" :value="formatNumber(metrics.filamentStockCount.value)" icon="spool" note="Saldo acima de zero" :points="filaments.map(filament => Number(filament.remaining || 0) > 0 ? 1 : 0)" /><MetricCard label="Custo Total em Estoque" :value="formatCurrency(metrics.filamentStockCost.value)" icon="money" note="Valor do saldo atual" color="green" :points="stockCostPoints" /><MetricCard label="Custo Médio por Grama" :value="formatCurrency(metrics.filamentAverageGramCost.value)" icon="calculator" note="Custo ponderado" color="purple" negative :points="gramCostPoints" /><MetricCard label="Material Mais Usado" :value="metrics.mostUsedMaterial.value" icon="chart" note="Por peso em estoque" color="orange" :points="stockPoints" /><MetricCard label="Alertas de Baixo Estoque" :value="formatNumber(lowStockFilaments.length)" icon="alert" change="pelo mínimo configurado" color="red" :points="filaments.map(filament => Number(filament.remaining || 0) <= Number(filament.minStock ?? 300) ? 1 : 0)" /></div>
    <div class="filters"><div class="field field--search"><label>Buscar</label><div class="search-field"><UiIcon name="search" :size="16" /><input v-model="search" placeholder="Nome, fabricante, cor ou fornecedor"></div></div><div class="field"><label>Fabricante</label><select v-model="filamentMakerFilter"><option v-for="option in filamentMakerOptions" :key="option">{{option}}</option></select></div><div class="field"><label>Material</label><select v-model="filamentMaterialFilter"><option v-for="option in filamentMaterialOptions" :key="option">{{option}}</option></select></div><div class="field"><label>Status</label><select v-model="filamentStatusFilter"><option v-for="option in filamentStatusOptions" :key="option">{{option}}</option></select></div><button class="btn" type="button" @click="clearFilamentFilters"><UiIcon name="close" :size="15" />Limpar filtros</button></div>
    <div class="split-layout">
      <PanelCard>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th></th><th>Nome</th><th>Fabricante</th><th>Material</th><th>Tipo</th><th>Cor</th><th>Peso Inicial</th><th>Peso Restante</th><th>Custo</th><th>Custo/g</th><th>Fornecedor</th><th>Compra</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr v-for="f in paginatedFilaments" :key="f.id || f.name" :class="{selected:String(f.id || f.name)===String(selected.id || selected.name)}" @click="selectFilament(f)">
                <td><input type="radio" :checked="String(f.id || f.name)===String(selected.id || selected.name)"></td>
                <td><div class="table-product table-product--editable"><span class="product-thumb" style="border-radius:50%"><UiIcon name="spool" :size="28" /></span><strong>{{f.name}}</strong><button class="row-action row-action--edit" title="Editar filamento" @click.stop="editFilament(f)"><UiIcon name="edit" :size="15" /></button></div></td>
                <td>{{f.maker}}</td>
                <td>{{f.material}}</td>
                <td>{{f.type}}</td>
                <td><span style="display:flex;align-items:center;gap:6px"><i class="dot" :style="{background:f.colorHex,border:'1px solid #ccd3df'}" />{{f.color}}</span></td>
                <td>{{formatNumber(f.initial)}} g</td>
                <td :class="f.remaining<=Number(f.minStock ?? 300)?'money-negative':f.remaining<Number(f.minStock ?? 300)*1.5?'money-positive':''">{{formatNumber(f.remaining)}} g</td>
                <td>{{formatCurrency(f.cost)}}</td>
                <td>R$ {{(f.cost/f.initial).toFixed(3).replace('.',',')}}</td>
                <td>{{f.supplier}}</td>
                <td>{{f.date}}</td>
                <td><span class="badge" :class="badgeClass(f.status)">{{displayStatus(f.status)}}</span></td>
                <td><button class="row-action" title="Excluir filamento" @click.stop="removeFilament(f)"><UiIcon name="close" :size="16" /></button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="table-footer"><span>Mostrando {{paginatedFilaments.length}} de {{filteredFilaments.length}} filamentos</span><div class="pagination"><button v-for="page in pageCount" :key="page" class="page-btn" :class="{active:page===currentPage}" @click="currentPage=page">{{page}}</button></div><select v-model.number="perPage" class="select-compact"><option :value="10">10 por página</option><option :value="20">20 por página</option><option :value="50">50 por página</option></select></div>
      </PanelCard>
      <aside>
        <div class="detail-card"><div class="detail-card__head"><span class="product-thumb" style="border-radius:50%"><UiIcon name="spool" :size="45" /></span><div><h3>{{selected.name}}</h3><p>Fabricante: {{selected.maker}}</p><p>Material: {{selected.material}}</p><p>Peso restante: <b class="money-negative">{{selected.remaining}} g</b></p></div></div></div>
        <PanelCard title="Calculadora de Custo por Grama" style="margin-top:12px"><div class="form-grid"><div class="field col-6"><label>Custo por grama</label><div class="stat-box"><strong>R$ {{(selected.cost/selected.initial).toFixed(3).replace('.',',')}}</strong></div></div><div class="field col-6"><label>Peso de uma peça</label><input v-model.number="pieceWeight" type="number"><strong class="money-positive">= {{formatCurrency(pieceCost)}}</strong></div></div></PanelCard>
        <PanelCard title="Consumo e previsão de filamento" subtitle="Calculado pelos produtos vinculados às impressões." style="margin-top:12px"><div class="detail-list"><div class="detail-list__row"><span>Impressões concluídas</span><strong>{{formatNumber(selectedConsumption.completed)}} g · {{formatCurrency(selectedConsumption.completed * selectedGramCost)}}</strong></div><div class="detail-list__row"><span>Impressões ativas</span><strong>{{formatNumber(selectedConsumption.active)}} g · {{formatCurrency(selectedConsumption.active * selectedGramCost)}}</strong></div><div class="detail-list__row"><span>Previsão da fila</span><strong>{{formatNumber(selectedConsumption.queued)}} g · {{formatCurrency(selectedConsumption.queued * selectedGramCost)}}</strong></div><div class="detail-list__row"><span>Saldo após a fila</span><strong :class="selected.remaining - selectedConsumption.active - selectedConsumption.queued < 0 ? 'money-negative' : 'money-positive'">{{formatNumber(selected.remaining - selectedConsumption.active - selectedConsumption.queued)}} g</strong></div></div><small style="display:block;margin-top:10px;color:var(--muted)">Impressões sem produto vinculado ou sem peso cadastrado não entram na estimativa.</small></PanelCard>
        <PanelCard title="Registrar movimentacao" subtitle="Atualize o saldo sem editar o historico anterior." style="margin-top:12px"><div class="form-grid"><div class="field col-12"><label>Tipo</label><select v-model="movement.type"><option value="in">Entrada</option><option value="out">Consumo</option><option value="adjustment">Ajuste para saldo</option></select></div><div class="field col-6"><label>{{movement.type === 'adjustment' ? 'Novo saldo (g)' : 'Quantidade (g)'}}</label><input v-model.number="movement.quantity" type="number" min="0.01" step="0.01"></div><div class="field col-6"><label>Saldo atual</label><div class="stat-box"><strong>{{formatNumber(selected.remaining)}} g</strong></div></div><div class="field col-12"><label>Motivo obrigatorio</label><input v-model="movement.reason" maxlength="240" placeholder="Compra, perda, teste ou producao"></div><div class="col-12"><button class="btn btn--primary btn--wide" :disabled="movementSaving" @click="saveMovement">{{movementSaving ? 'Registrando...' : 'Registrar movimentacao'}}</button></div></div></PanelCard>
        <PanelCard title="Histórico de movimentações" style="margin-top:12px"><div class="filters" style="padding:0;margin:0 0 10px;display:grid;grid-template-columns:1fr 1fr 1fr"><div class="field"><label>Tipo</label><select v-model="movementTypeFilter"><option>Todos</option><option value="in">Entradas</option><option value="out">Consumos</option><option value="adjustment">Ajustes</option></select></div><div class="field"><label>De</label><input v-model="movementFrom" type="date"></div><div class="field"><label>Até</label><input v-model="movementTo" type="date"></div></div><div v-if="!filteredMovements.length" class="empty-state">Nenhuma movimentação encontrada.</div><div v-else class="movement-list"><div v-for="item in filteredMovements" :key="item.id" class="movement-row"><span :class="item.type === 'out' ? 'money-negative' : 'money-positive'">{{item.type === 'out' ? '-' : item.type === 'in' ? '+' : '='}}{{formatNumber(item.quantity)}} g</span><div><strong>{{item.reason}}</strong><small>{{new Date(item.createdAt).toLocaleString('pt-BR')}} · saldo {{formatNumber(item.resultingQuantity)}} g</small></div></div></div></PanelCard>
      </aside>
    </div>
    <div class="dashboard-grid" style="grid-template-columns:1fr 1fr 1fr;margin-top:12px"><PanelCard title="Distribuição por Material"><DonutChart :segments="materialSegments" :total="`${formatNumber(totalWeight / 1000)} kg`" /></PanelCard><PanelCard title="Peso Total em Estoque"><div class="empty-state" style="min-height:170px"><div><div class="empty-state__icon"><UiIcon name="spool" /></div><h3>{{formatNumber(totalWeight / 1000)}} kg</h3><p>Saldo atual de todos os filamentos cadastrados.</p></div></div></PanelCard><PanelCard title="Alertas e Recomendações"><div class="alerts-list"><div v-if="!lowStockFilaments.length" class="empty-state"><p>Nenhum filamento abaixo do mínimo configurado.</p></div><div v-for="item in lowStockFilaments.slice(0, 5)" :key="item.id" class="alert-row"><span class="alert-row__icon"><UiIcon name="alert" /></span><div><strong>{{item.name}}</strong><small>{{formatNumber(item.remaining)}} g restantes · mínimo {{formatNumber(item.minStock ?? 300)}} g</small></div><button class="btn" type="button" @click="editLowStock(item)">Repor</button></div></div></PanelCard></div>
  </div>
</template>
