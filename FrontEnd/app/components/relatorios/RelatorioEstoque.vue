<script setup lang="ts">
const props = defineProps<{ periodStart: string; periodEnd: string }>()
const { loadInventoryOverview } = useAppData()
const loading = ref(true)
const movements = ref<any[]>([])
const total = ref(0)
const page = ref(0)
const search = ref('')
const resource = ref('Todos')
const type = ref('Todos')
const loadError = ref('')
const pageSize = 100
const resourceLabel = (value: string) => value === 'filaments' ? 'Filamento' : 'Produto fabricado'
const resourceUnit = (value: string) => value === 'filaments' ? 'g' : 'un.'
const movementLabel = (value: string) => value === 'in' ? 'Entrada' : value === 'out' ? 'Saída' : 'Ajuste'
const movementSign = (value: string) => value === 'in' ? '+' : value === 'out' ? '−' : '='
const entryCount = computed(() => movements.value.filter(item => item.type === 'in').length)
const exitCount = computed(() => movements.value.filter(item => item.type === 'out').length)
const adjustmentCount = computed(() => movements.value.filter(item => item.type === 'adjustment').length)

const load = async (reset = false) => {
  if (reset) page.value = 0
  loading.value = true
  loadError.value = ''
  try {
    const result = await loadInventoryOverview({ from: props.periodStart, to: props.periodEnd, resource: resource.value === 'Todos' ? '' : resource.value, type: type.value === 'Todos' ? '' : type.value, search: search.value.trim(), limit: pageSize, offset: page.value * pageSize })
    movements.value = result.movements
    total.value = result.total
  } catch (error: any) {
    movements.value = []
    total.value = 0
    loadError.value = error?.data?.error || error?.message || 'Não foi possível carregar as movimentações.'
  } finally {
    loading.value = false
  }
}
const clearFilters = () => {
  search.value = ''
  resource.value = 'Todos'
  type.value = 'Todos'
  load(true)
}
watch(() => [props.periodStart, props.periodEnd], () => load(true), { immediate: true })
</script>

<template>
  <div class="inventory-report">
    <div class="metrics-grid metrics-grid--4 inventory-metrics">
      <MetricCard label="Movimentações" :value="formatNumber(total)" icon="history" note="Encontradas no período" />
      <MetricCard label="Entradas" :value="formatNumber(entryCount)" icon="trend" note="Na página exibida" color="green" />
      <MetricCard label="Saídas" :value="formatNumber(exitCount)" icon="box" note="Na página exibida" color="red" />
      <MetricCard label="Ajustes" :value="formatNumber(adjustmentCount)" icon="settings" note="Na página exibida" color="orange" />
    </div>

    <form class="inventory-search" @submit.prevent="load(true)">
      <label class="field field--search"><span>Buscar item ou motivo</span><div class="search-field"><UiIcon name="search" :size="16" /><input v-model="search" placeholder="Ex.: PLA preto ou produção concluída"></div></label>
      <label class="field"><span>Tipo de estoque</span><select v-model="resource" @change="load(true)"><option>Todos</option><option value="filaments">Filamentos</option><option value="products">Produtos fabricados</option></select></label>
      <label class="field"><span>Operação</span><select v-model="type" @change="load(true)"><option>Todos</option><option value="in">Entradas</option><option value="out">Saídas</option><option value="adjustment">Ajustes</option></select></label>
      <div class="inventory-search__actions">
        <button class="btn btn--primary" type="submit" :disabled="loading"><UiIcon name="search" :size="16" />Buscar</button>
        <button class="btn" type="button" :disabled="loading" @click="clearFilters"><UiIcon name="close" :size="15" />Limpar</button>
      </div>
    </form>

    <PanelCard title="Livro de movimentações" subtitle="Cada linha confirma a alteração e os saldos anterior e resultante">
      <div v-if="loading" class="empty-state">Carregando movimentações...</div>
      <div v-else-if="loadError" class="inventory-error"><UiIcon name="info" /><div><strong>Não foi possível consultar o estoque</strong><p>{{ loadError }}</p><button class="btn btn--small" type="button" @click="load()">Tentar novamente</button></div></div>
      <div v-else-if="!movements.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="history" /></div><h3>Nenhuma movimentação encontrada</h3><p>Altere os filtros ou registre uma movimentação na área de Estoque.</p></div></div>
      <div v-else class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Data</th><th>Item</th><th>Estoque</th><th>Operação</th><th>Alteração</th><th>Saldo anterior</th><th>Saldo resultante</th><th>Motivo</th></tr></thead>
          <tbody><tr v-for="item in movements" :key="item.id"><td>{{ new Date(item.createdAt).toLocaleString('pt-BR') }}</td><td><strong>{{ item.resourceName || 'Item removido' }}</strong><small v-if="item.sku" class="movement-sku">{{ item.sku }}</small></td><td>{{ resourceLabel(item.resource) }}</td><td><span class="badge" :class="item.type === 'in' ? 'badge--green' : item.type === 'out' ? 'badge--red' : 'badge--orange'">{{ movementLabel(item.type) }}</span></td><td :class="item.type === 'out' ? 'money-negative' : item.type === 'in' ? 'money-positive' : ''"><strong>{{ movementSign(item.type) }}{{ formatNumber(item.quantity) }} {{ resourceUnit(item.resource) }}</strong></td><td>{{ formatNumber(item.previousQuantity) }} {{ resourceUnit(item.resource) }}</td><td><strong>{{ formatNumber(item.resultingQuantity) }} {{ resourceUnit(item.resource) }}</strong></td><td>{{ item.reason }}</td></tr></tbody>
        </table>
      </div>
      <div v-if="!loading && !loadError && total > pageSize" class="report-pager"><span>Mostrando {{ page * pageSize + 1 }}–{{ Math.min((page + 1) * pageSize, total) }} de {{ total }}</span><button class="btn btn--small" :disabled="!page" @click="page--; load()">Anterior</button><button class="btn btn--small" :disabled="(page + 1) * pageSize >= total" @click="page++; load()">Próxima</button></div>
    </PanelCard>
  </div>
</template>

<style scoped>
.inventory-report{display:grid;width:100%;max-width:1360px;margin:0 auto;gap:16px}.inventory-metrics{width:100%;margin-bottom:0}.inventory-search{display:grid;grid-template-columns:minmax(260px,1fr) minmax(160px,.35fr) minmax(140px,.3fr) auto;align-items:end;gap:10px;padding:16px;border:1px solid #dce4f0;border-radius:12px;background:#fff}.inventory-search__actions{display:flex;align-items:center;gap:8px}.movement-sku{display:block;margin-top:2px;color:#687386;font-size:10px}.inventory-error{display:flex;align-items:flex-start;gap:12px;padding:22px;color:#b42318}.inventory-error p{margin:4px 0 12px;color:#687386}.report-pager{display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:14px 16px;color:#687386;font-size:12px}@media(max-width:1050px){.inventory-search{grid-template-columns:repeat(2,minmax(0,1fr))}.inventory-search .field--search,.inventory-search__actions{grid-column:1/-1}.inventory-search__actions{justify-content:flex-end}}@media(max-width:620px){.inventory-search{grid-template-columns:1fr}.inventory-search .field--search,.inventory-search__actions{grid-column:auto}.inventory-search__actions{justify-content:stretch}.inventory-search__actions .btn{flex:1;justify-content:center}.report-pager{justify-content:flex-start;flex-wrap:wrap}}
</style>
