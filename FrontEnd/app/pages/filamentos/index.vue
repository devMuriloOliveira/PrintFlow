<script setup lang="ts">
const { filaments, deleteItem, createFilamentMovement, listFilamentMovements, refreshAppData } = useAppData()
const metrics = useBusinessMetrics()
const stockPoints = computed(() => filaments.value.map(filament => Number(filament.remaining || 0)))
const stockCostPoints = computed(() => filaments.value.map(filament => filament.initial ? Number(filament.cost || 0) * Number(filament.remaining || 0) / Number(filament.initial) : 0))
const gramCostPoints = computed(() => filaments.value.map(filament => filament.initial ? Number(filament.cost || 0) / Number(filament.initial) : 0))
const { notify } = useUi()
const router = useRouter()
const selectedIndex = ref(0)
const filamentMakerFilter = ref('Todos')
const filamentMaterialFilter = ref('Todos')
const filamentStatusFilter = ref('Todos')
const emptyFilament = { name: '', maker: '', material: '', type: '', color: '', colorHex: '#ccd3df', initial: 1, remaining: 0, cost: 0, supplier: '', date: '', status: '' }
const selected = computed(() => filaments.value[selectedIndex.value] || emptyFilament)
const filamentMakerOptions = computed(() => ['Todos', ...new Set(filaments.value.map((item: any) => String(item.maker || '').trim()).filter(Boolean))])
const filamentMaterialOptions = computed(() => ['Todos', ...new Set(filaments.value.map((item: any) => String(item.material || '').trim()).filter(Boolean))])
const filamentStatusOptions = computed(() => ['Todos', ...new Set(filaments.value.map((item: any) => String(item.status || '').trim()).filter(Boolean))])
const filteredFilaments = computed(() => filaments.value.filter((item: any) =>
  (filamentMakerFilter.value === 'Todos' || item.maker === filamentMakerFilter.value) &&
  (filamentMaterialFilter.value === 'Todos' || item.material === filamentMaterialFilter.value) &&
  (filamentStatusFilter.value === 'Todos' || item.status === filamentStatusFilter.value)
))
const selectFilament = (filament: any) => {
  const index = filaments.value.findIndex((item: any) => String(item.id || item.name) === String(filament.id || filament.name))
  if (index >= 0) selectedIndex.value = index
}
const clearFilamentFilters = () => { filamentMakerFilter.value = 'Todos'; filamentMaterialFilter.value = 'Todos'; filamentStatusFilter.value = 'Todos' }
const pieceWeight = ref(180)
const movement = reactive({ type: 'in' as 'in' | 'out' | 'adjustment', quantity: 0, reason: '' })
const movements = ref<any[]>([])
const movementSaving = ref(false)
const pieceCost = computed(() => selected.value ? selected.value.cost / selected.value.initial * pieceWeight.value : 0)
const displayStatus = (s:string) => s.replace('Atencao', 'Atenção')
const badgeClass = (s:string) => s==='Em estoque'?'badge--green':/Atencao|Atenção/.test(s)?'badge--orange':'badge--red'
const editFilament = (filament: any) => {
  if (!filament.id) return
  router.push(`/filamentos/novo?id=${filament.id}`)
}
const removeFilament = async (filament: any) => {
  if (!filament.id || !window.confirm(`Excluir filamento?\n\n${filament.name}\n\nEsta ação não poderá ser desfeita.`)) return
  await deleteItem('filaments', filament.id)
  notify('Filamento excluído com sucesso.')
}
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
    <div class="metrics-grid metrics-grid--5"><MetricCard label="Rolos em Estoque" :value="formatNumber(metrics.filamentStockCount.value)" icon="spool" note="Dados do banco" :points="filaments.map(filament => Number(filament.remaining || 0) > 0 ? 1 : 0)" /><MetricCard label="Custo Total em Estoque" :value="formatCurrency(metrics.filamentStockCost.value)" icon="money" note="Saldo atual dos rolos" color="green" :points="stockCostPoints" /><MetricCard label="Custo Médio por Grama" :value="formatCurrency(metrics.filamentAverageGramCost.value)" icon="calculator" note="Dados do banco" color="purple" negative :points="gramCostPoints" /><MetricCard label="Material Mais Usado" :value="metrics.mostUsedMaterial.value" icon="chart" note="Por peso em estoque" color="orange" :points="stockPoints" /><MetricCard label="Alertas de Baixo Estoque" :value="formatNumber(metrics.lowStockFilaments.value)" icon="alert" change="rolos abaixo de 300 g" color="red" :points="filaments.map(filament => Number(filament.remaining || 0) < 300 ? 1 : 0)" /></div>
    <div class="filters"><div class="field"><label>Fabricante</label><select v-model="filamentMakerFilter"><option v-for="option in filamentMakerOptions" :key="option">{{option}}</option></select></div><div class="field"><label>Material</label><select v-model="filamentMaterialFilter"><option v-for="option in filamentMaterialOptions" :key="option">{{option}}</option></select></div><div class="field"><label>Status</label><select v-model="filamentStatusFilter"><option v-for="option in filamentStatusOptions" :key="option">{{option}}</option></select></div><button class="btn" type="button" @click="clearFilamentFilters"><UiIcon name="close" :size="15" />Limpar filtros</button></div>
    <div class="split-layout">
      <PanelCard>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th></th><th>Nome</th><th>Fabricante</th><th>Material</th><th>Tipo</th><th>Cor</th><th>Peso Inicial</th><th>Peso Restante</th><th>Custo</th><th>Custo/g</th><th>Fornecedor</th><th>Compra</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr v-for="f in filteredFilaments" :key="f.id || f.name" :class="{selected:String(f.id || f.name)===String(selected.id || selected.name)}" @click="selectFilament(f)">
                <td><input type="radio" :checked="String(f.id || f.name)===String(selected.id || selected.name)"></td>
                <td><div class="table-product table-product--editable"><span class="product-thumb" style="border-radius:50%"><UiIcon name="spool" :size="28" /></span><strong>{{f.name}}</strong><button class="row-action row-action--edit" title="Editar filamento" @click.stop="editFilament(f)"><UiIcon name="edit" :size="15" /></button></div></td>
                <td>{{f.maker}}</td>
                <td>{{f.material}}</td>
                <td>{{f.type}}</td>
                <td><span style="display:flex;align-items:center;gap:6px"><i class="dot" :style="{background:f.colorHex,border:'1px solid #ccd3df'}" />{{f.color}}</span></td>
                <td>{{formatNumber(f.initial)}} g</td>
                <td :class="f.remaining<300?'money-negative':f.remaining<500?'money-positive':''">{{formatNumber(f.remaining)}} g</td>
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
        <div class="table-footer"><span>Mostrando {{filteredFilaments.length}} de {{filaments.length}} filamentos</span><div class="pagination"><button class="page-btn active">1</button></div></div>
      </PanelCard>
      <aside>
        <div class="detail-card"><div class="detail-card__head"><span class="product-thumb" style="border-radius:50%"><UiIcon name="spool" :size="45" /></span><div><h3>{{selected.name}}</h3><p>Fabricante: {{selected.maker}}</p><p>Material: {{selected.material}}</p><p>Peso restante: <b class="money-negative">{{selected.remaining}} g</b></p></div></div></div>
        <PanelCard title="Calculadora de Custo por Grama" style="margin-top:12px"><div class="form-grid"><div class="field col-6"><label>Custo por grama</label><div class="stat-box"><strong>R$ {{(selected.cost/selected.initial).toFixed(3).replace('.',',')}}</strong></div></div><div class="field col-6"><label>Peso de uma peça</label><input v-model.number="pieceWeight" type="number"><strong class="money-positive">= {{formatCurrency(pieceCost)}}</strong></div></div></PanelCard>
        <PanelCard title="Registrar movimentacao" subtitle="Atualize o saldo sem editar o historico anterior." style="margin-top:12px"><div class="form-grid"><div class="field col-12"><label>Tipo</label><select v-model="movement.type"><option value="in">Entrada</option><option value="out">Consumo</option><option value="adjustment">Ajuste para saldo</option></select></div><div class="field col-6"><label>{{movement.type === 'adjustment' ? 'Novo saldo (g)' : 'Quantidade (g)'}}</label><input v-model.number="movement.quantity" type="number" min="0.01" step="0.01"></div><div class="field col-6"><label>Saldo atual</label><div class="stat-box"><strong>{{formatNumber(selected.remaining)}} g</strong></div></div><div class="field col-12"><label>Motivo obrigatorio</label><input v-model="movement.reason" maxlength="240" placeholder="Compra, perda, teste ou producao"></div><div class="col-12"><button class="btn btn--primary btn--wide" :disabled="movementSaving" @click="saveMovement">{{movementSaving ? 'Registrando...' : 'Registrar movimentacao'}}</button></div></div></PanelCard>
        <PanelCard title="Ultimas movimentacoes" style="margin-top:12px"><div v-if="!movements.length" class="empty-state">Nenhuma movimentacao registrada.</div><div v-else class="movement-list"><div v-for="item in movements.slice(0, 6)" :key="item.id" class="movement-row"><span :class="item.type === 'out' ? 'money-negative' : 'money-positive'">{{item.type === 'out' ? '-' : item.type === 'in' ? '+' : '='}}{{formatNumber(item.quantity)}} g</span><div><strong>{{item.reason}}</strong><small>{{new Date(item.createdAt).toLocaleString('pt-BR')}} · saldo {{formatNumber(item.resultingQuantity)}} g</small></div></div></div></PanelCard>
      </aside>
    </div>
    <div class="dashboard-grid" style="grid-template-columns:1fr 1fr 1fr;margin-top:12px"><PanelCard title="Distribuição por Material"><DonutChart :segments="[{label:'PLA',value:62.4,color:'#1768f2'},{label:'PETG',value:18.7,color:'#2fb4c2'},{label:'ASA',value:10.9,color:'#f6ad2e'},{label:'Outros',value:8,color:'#7c3aed'}]" total="38 rolos" /></PanelCard><PanelCard title="Peso Total em Estoque"><div class="empty-state" style="min-height:170px"><div><div class="empty-state__icon"><UiIcon name="spool" /></div><h3>23,45 kg</h3><p>Rolos cheios equivalem a aproximadamente 31,3 kg.</p></div></div></PanelCard><PanelCard title="Alertas e Recomendações"><div class="alerts-list"><div class="alert-row"><span class="alert-row__icon"><UiIcon name="alert" /></span><div><strong>PLA Preto próximo do fim</strong><small>Apenas 180 g restantes</small></div><span class="badge badge--orange">Repor agora</span></div><div class="alert-row"><span class="alert-row__icon"><UiIcon name="bolt" /></span><div><strong>TPU Azul com estoque baixo</strong><small>Somente 260 g restantes</small></div><span class="badge">Ver detalhes</span></div></div></PanelCard></div>
  </div>
</template>
