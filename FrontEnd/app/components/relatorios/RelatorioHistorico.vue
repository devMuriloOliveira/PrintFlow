<script setup lang="ts">
const props = defineProps<{ periodStart: string; periodEnd: string }>()
const { listFinancialHistory, products, filaments, printers, marketplaces } = useAppData()
const history = ref<any[]>([])
const total = ref(0)
const page = ref(0)
const resource = ref('Todos')
const search = ref('')
const historyLoading = ref(false)
const historyError = ref('')
const pageSize = 100

const resourceLabels: Record<string, string> = { products: 'Produto', filaments: 'Filamento', printers: 'Impressora', marketplaces: 'Marketplace' }
const sourceLabels: Record<string, string> = { resource: 'Edição do cadastro', create: 'Criação', update: 'Atualização', calculator: 'Calculadora' }
const fieldLabels: Record<string, string> = {
  price: 'Preço de venda', packaging_cost: 'Embalagem', additional_materials_cost: 'Materiais adicionais', labor_cost: 'Mão de obra', energy_enabled: 'Energia incluída', marketplace_fee: 'Taxa de marketplace', desired_margin: 'Margem desejada', cost: 'Custo', profit: 'Lucro unitário', margin: 'Margem calculada', cost_breakdown: 'Composição do custo', initial_weight: 'Peso inicial', remaining_weight: 'Peso restante', purchase_date: 'Data da compra', power_w: 'Potência', accumulated_hours: 'Horas acumuladas', commission: 'Comissão', fixed: 'Tarifa fixa', financial: 'Taxa financeira', ads: 'Publicidade', others: 'Outras taxas'
}
const currencyFields = new Set(['price', 'packaging_cost', 'additional_materials_cost', 'labor_cost', 'marketplace_fee', 'cost', 'profit', 'fixed'])
const percentFields = new Set(['desired_margin', 'margin', 'commission', 'financial', 'ads', 'others'])
const resourceCollections = computed<Record<string, any[]>>(() => ({ products: products.value, filaments: filaments.value, printers: printers.value, marketplaces: marketplaces.value }))
const resourceLabel = (value: string) => resourceLabels[value] || value
const resourceName = (entry: any) => {
  const item = (resourceCollections.value[entry.resource] || []).find(candidate => String(candidate.dbId || candidate.id) === String(entry.resourceId))
  return item?.name || item?.code || `${resourceLabel(entry.resource)} removido ou indisponível`
}
const formatValue = (field: string, value: any) => {
  if (value === null || value === undefined || value === '') return 'Não informado'
  if (currencyFields.has(field)) return formatCurrency(Number(value || 0))
  if (percentFields.has(field)) return `${Number(value || 0).toFixed(2)}%`
  if (field === 'energy_enabled') return value ? 'Sim' : 'Não'
  if (field === 'power_w') return `${formatNumber(Number(value || 0))} W`
  if (field === 'accumulated_hours') return `${formatNumber(Number(value || 0))} h`
  if (field === 'initial_weight' || field === 'remaining_weight') return `${formatNumber(Number(value || 0))} g`
  if (field === 'purchase_date') return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('pt-BR')
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${fieldLabels[key] || key}: ${formatValue(key, item)}`).join(' · ')
  return String(value)
}
const changesFor = (entry: any, index: number) => {
  const previous = history.value.slice(index + 1).find(candidate => candidate.resource === entry.resource && String(candidate.resourceId) === String(entry.resourceId))
  return Object.entries(entry.snapshot || {}).filter(([key, value]) => !previous || JSON.stringify(previous.snapshot?.[key] ?? null) !== JSON.stringify(value ?? null)).map(([key, value]) => ({ key, label: fieldLabels[key] || key, value: formatValue(key, value), previous: previous ? formatValue(key, previous.snapshot?.[key]) : '' }))
}
const visibleHistory = computed(() => {
  const term = search.value.trim().toLocaleLowerCase('pt-BR')
  if (!term) return history.value
  return history.value.filter(entry => `${resourceName(entry)} ${entry.resourceId} ${resourceLabel(entry.resource)} ${sourceLabels[entry.source] || entry.source}`.toLocaleLowerCase('pt-BR').includes(term))
})
const load = async (reset = false) => {
  if (reset) page.value = 0
  historyLoading.value = true
  historyError.value = ''
  try {
    const result = await listFinancialHistory({ from: props.periodStart, to: props.periodEnd, resource: resource.value === 'Todos' ? '' : resource.value, limit: pageSize, offset: page.value * pageSize })
    history.value = Array.isArray(result) ? result : result.items
    total.value = Array.isArray(result) ? result.length : result.total
  } catch (error: any) {
    history.value = []
    total.value = 0
    historyError.value = error?.data?.error || error?.message || 'Registro de custos e preços indisponível para este perfil.'
  } finally {
    historyLoading.value = false
  }
}
watch(() => [props.periodStart, props.periodEnd], () => load(true), { immediate: true })
</script>

<template>
  <div class="cost-history">
    <div class="cost-history__explanation">
      <span class="cost-history__explanation-icon"><UiIcon name="info" :size="18" /></span>
      <div><strong>Este registro não é um extrato financeiro.</strong><p>Ele preserva quando custos, preços, margens, pesos, potência ou taxas foram alterados nos cadastros. Receitas e despesas ficam no relatório “Resultado financeiro”.</p></div>
    </div>

    <div class="cost-history__toolbar">
      <label class="field field--search"><span>Buscar cadastro</span><div class="search-field"><UiIcon name="search" :size="16" /><input v-model="search" placeholder="Nome ou código do cadastro"></div></label>
      <label class="field"><span>Tipo de cadastro</span><select v-model="resource" @change="load(true)"><option>Todos</option><option value="products">Produtos</option><option value="filaments">Filamentos</option><option value="printers">Impressoras</option><option value="marketplaces">Marketplaces</option></select></label>
      <button class="btn" type="button" :disabled="historyLoading" @click="load()"><UiIcon name="refresh" :size="15" />Atualizar</button>
    </div>

    <PanelCard title="Alterações de custos e parâmetros" :subtitle="`${formatNumber(total)} registro(s) no período selecionado`">
      <div v-if="historyLoading" class="empty-state">Carregando alterações...</div>
      <div v-else-if="historyError" class="history-error"><UiIcon name="info" /><div><strong>Não foi possível consultar o registro</strong><p>{{ historyError }}</p><button class="btn btn--small" type="button" @click="load()">Tentar novamente</button></div></div>
      <div v-else-if="!visibleHistory.length" class="empty-state"><div><h3>Nenhuma alteração encontrada</h3><p>Não houve mudança cadastral compatível com o período e os filtros.</p></div></div>
      <div v-else class="history-list">
        <article v-for="(entry, index) in visibleHistory" :key="entry.id" class="history-entry">
          <div class="history-entry__identity"><span class="history-entry__resource">{{ resourceLabel(entry.resource) }}</span><strong>{{ resourceName(entry) }}</strong><small>ID {{ entry.resourceId }} · {{ sourceLabels[entry.source] || entry.source }}</small></div>
          <div class="history-entry__changes">
            <div v-for="change in changesFor(entry, index)" :key="change.key" class="history-change"><span>{{ change.label }}</span><div><small v-if="change.previous">{{ change.previous }}</small><UiIcon v-if="change.previous" name="chevron" :size="12" /><strong>{{ change.value }}</strong></div></div>
            <span v-if="!changesFor(entry, index).length" class="history-entry__unchanged">Nenhuma diferença financeira em relação ao registro anterior.</span>
          </div>
          <time :datetime="entry.createdAt">{{ new Date(entry.createdAt).toLocaleString('pt-BR') }}</time>
        </article>
      </div>
      <div v-if="!historyLoading && !historyError && total > pageSize" class="history-pager"><span>Mostrando {{ page * pageSize + 1 }}–{{ Math.min((page + 1) * pageSize, total) }} de {{ total }}</span><button class="btn btn--small" :disabled="!page" @click="page--; load()">Anterior</button><button class="btn btn--small" :disabled="(page + 1) * pageSize >= total" @click="page++; load()">Próxima</button></div>
    </PanelCard>
  </div>
</template>

<style scoped>
.cost-history{display:grid;gap:16px}.cost-history__explanation{display:flex;align-items:flex-start;gap:11px;padding:14px 16px;border:1px solid #cfe0fb;border-radius:12px;background:#f5f9ff}.cost-history__explanation-icon{display:grid;place-items:center;flex:0 0 34px;height:34px;border-radius:9px;background:#e5efff;color:#1768f2}.cost-history__explanation strong{color:#172033}.cost-history__explanation p{margin:4px 0 0;color:#58657a;font-size:12px;line-height:1.5}.cost-history__toolbar{display:grid;grid-template-columns:minmax(260px,1fr) minmax(180px,.35fr) auto;align-items:end;gap:10px;padding:14px;border:1px solid #dce4f0;border-radius:12px;background:#fff}.history-list{display:grid}.history-entry{display:grid;grid-template-columns:minmax(190px,.65fr) minmax(320px,1.35fr) auto;align-items:start;gap:18px;padding:16px 18px;border-bottom:1px solid #edf0f5}.history-entry:last-child{border-bottom:0}.history-entry__identity{display:grid;gap:3px}.history-entry__identity strong{color:#172033}.history-entry__identity small,.history-entry time{color:#687386;font-size:11px}.history-entry__resource{width:max-content;padding:3px 7px;border-radius:6px;background:#edf3ff;color:#1768f2;font-size:10px;font-weight:800;text-transform:uppercase}.history-entry__changes{display:flex;flex-wrap:wrap;gap:7px}.history-change{display:grid;gap:3px;padding:7px 9px;border:1px solid #e2e7ef;border-radius:8px;background:#fafbfd}.history-change>span{color:#687386;font-size:10px}.history-change>div{display:flex;align-items:center;gap:5px}.history-change small{color:#8b95a5;text-decoration:line-through}.history-change strong{color:#172033;font-size:12px}.history-entry__unchanged{color:#687386;font-size:11px}.history-error{display:flex;align-items:flex-start;gap:12px;padding:22px;color:#b42318}.history-error p{margin:4px 0 12px;color:#687386}.history-pager{display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:14px 16px;color:#687386;font-size:12px}@media(max-width:800px){.cost-history__toolbar,.history-entry{grid-template-columns:1fr}.history-entry time{grid-row:1}.history-pager{justify-content:flex-start;flex-wrap:wrap}}
</style>
