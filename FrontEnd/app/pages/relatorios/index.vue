<script setup lang="ts">
type ReportSection = 'financeiro' | 'produtos' | 'estoque' | 'historico'
type ReportFilters = {
  periodStart: string
  periodEnd: string
  grouping: 'day' | 'week' | 'month'
  marketplace: string
  product: string
  category: string
  channel: 'Todos' | 'direct' | 'marketplace'
}

const { exportFinancialReport, products, orders, expenses } = useAppData()
const { notify } = useUi()
const route = useRoute()
const today = new Date()
const filters = reactive<ReportFilters>({
  periodStart: `${today.getFullYear()}-01-01`,
  periodEnd: today.toISOString().slice(0, 10),
  grouping: 'month',
  marketplace: 'Todos',
  product: 'Todos',
  category: 'Todos',
  channel: 'Todos'
})
const exportFormat = ref<'csv' | 'xlsx'>('xlsx')
const exporting = ref(false)
const sections: Array<{ key: ReportSection; label: string; description: string; icon: string }> = [
  { key: 'financeiro', label: 'Resultado financeiro', description: 'Receitas, despesas e margem', icon: 'wallet' },
  { key: 'produtos', label: 'Produtos e vendas', description: 'Desempenho comercial', icon: 'box' },
  { key: 'estoque', label: 'Movimentações de estoque', description: 'Entradas, saídas e saldos', icon: 'history' },
  { key: 'historico', label: 'Registro de custos e preços', description: 'Alterações cadastrais auditáveis', icon: 'receipt' }
]
const reportSection = computed<ReportSection>(() => {
  const section = String(route.query.secao || 'financeiro')
  return sections.some(item => item.key === section) ? section as ReportSection : 'financeiro'
})
const currentSection = computed(() => sections.find(item => item.key === reportSection.value) || sections[0])
const exportLabel = computed(() => `Exportar ${currentSection.value.label.toLowerCase()}`)
const showCommercialFilters = computed(() => ['financeiro', 'produtos'].includes(reportSection.value))
const marketplaceOptions = computed(() => ['Todos', ...new Set(orders.value.map(item => item.marketplace || 'Sem marketplace'))])
const productOptions = computed(() => ['Todos', ...new Set(products.value.map(item => item.name))])
const categoryOptions = computed(() => ['Todos', ...new Set(expenses.value.map(item => item.category || 'Sem categoria'))])
const invalidPeriod = computed(() => !filters.periodStart || !filters.periodEnd || filters.periodStart > filters.periodEnd)

const clearContextFilters = () => {
  filters.marketplace = 'Todos'
  filters.product = 'Todos'
  filters.category = 'Todos'
  filters.channel = 'Todos'
}

const exportReport = async () => {
  if (invalidPeriod.value || exporting.value) return notify('Informe um período válido para exportar.')
  exporting.value = true
  try {
    const content = await exportFinancialReport({
      from: filters.periodStart,
      to: filters.periodEnd,
      marketplace: filters.marketplace === 'Todos' ? '' : filters.marketplace,
      product: filters.product === 'Todos' ? '' : filters.product,
      category: filters.category === 'Todos' ? '' : filters.category,
      channel: filters.channel === 'Todos' ? '' : filters.channel,
      section: reportSection.value,
      format: exportFormat.value
    })
    const url = URL.createObjectURL(content)
    const link = document.createElement('a')
    link.href = url
    link.download = `printflow-${reportSection.value}-${filters.periodStart}-${filters.periodEnd}.${exportFormat.value}`
    link.click()
    URL.revokeObjectURL(url)
    notify(`${currentSection.value.label} exportado com sucesso.`)
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Não foi possível exportar o relatório.')
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="reports-page">
    <PageHeader title="Relatórios" subtitle="Consulte e exporte somente os dados da área selecionada no menu lateral.">
      <div class="report-export">
        <div class="report-export__copy">
          <span>EXPORTAR VISÃO ATUAL</span>
          <small>{{ currentSection.label }} com o período e os filtros aplicáveis abaixo.</small>
        </div>
        <select v-model="exportFormat" class="report-export-format" aria-label="Formato da exportação">
          <option value="xlsx">XLSX</option>
          <option value="csv">CSV</option>
        </select>
        <button class="btn" :disabled="exporting || invalidPeriod" @click="exportReport">
          <UiIcon name="download" />{{ exporting ? 'Gerando...' : exportLabel }}
        </button>
      </div>
    </PageHeader>

    <section class="report-context" aria-label="Filtros do relatório">
      <div class="report-context__heading">
        <div>
          <small>VISÃO ATUAL</small>
          <h2>{{ currentSection.label }}</h2>
          <p>{{ currentSection.description }} no período selecionado.</p>
        </div>
        <button v-if="showCommercialFilters" class="btn btn--small" type="button" @click="clearContextFilters">
          <UiIcon name="close" :size="15" />Limpar filtros
        </button>
      </div>

      <div class="report-filters" :class="{ 'report-filters--compact': !showCommercialFilters }">
        <label class="field"><span>Início</span><input v-model="filters.periodStart" type="date"></label>
        <label class="field"><span>Fim</span><input v-model="filters.periodEnd" type="date"></label>
        <label v-if="reportSection === 'financeiro'" class="field"><span>Agrupamento</span><select v-model="filters.grouping"><option value="month">Mensal</option><option value="week">Semanal</option><option value="day">Diário</option></select></label>
        <label v-if="showCommercialFilters" class="field"><span>Canal de venda</span><select v-model="filters.channel"><option value="Todos">Todos</option><option value="direct">Venda direta</option><option value="marketplace">Marketplace</option></select></label>
        <label v-if="showCommercialFilters" class="field"><span>Marketplace</span><select v-model="filters.marketplace"><option v-for="item in marketplaceOptions" :key="item">{{ item }}</option></select></label>
        <label v-if="showCommercialFilters" class="field"><span>Produto</span><select v-model="filters.product"><option v-for="item in productOptions" :key="item">{{ item }}</option></select></label>
        <label v-if="reportSection === 'financeiro'" class="field"><span>Categoria de despesa</span><select v-model="filters.category"><option v-for="item in categoryOptions" :key="item">{{ item }}</option></select></label>
      </div>
      <p v-if="invalidPeriod" class="report-period-error"><UiIcon name="info" :size="15" />A data inicial não pode ser posterior à data final.</p>
      <p v-else class="report-filter-note">
        A exportação usa esta seção, este período e somente os filtros aplicáveis mostrados acima.
      </p>
    </section>

    <div v-if="invalidPeriod" class="report-blocked-state">Corrija o período para carregar este relatório.</div>
    <RelatoriosRelatorioFinanceiro v-else-if="reportSection === 'financeiro'" v-model:filters="filters" />
    <RelatoriosRelatorioProdutos v-else-if="reportSection === 'produtos'" :filters="filters" />
    <RelatoriosRelatorioEstoque v-else-if="reportSection === 'estoque'" :period-start="filters.periodStart" :period-end="filters.periodEnd" />
    <RelatoriosRelatorioHistorico v-else :period-start="filters.periodStart" :period-end="filters.periodEnd" />
  </div>
</template>

<style scoped>
.reports-page{display:grid;gap:18px}.report-export{display:flex;align-items:center;justify-content:flex-end;gap:8px;max-width:560px}.report-export__copy{display:grid;margin-right:4px;text-align:right}.report-export__copy span{color:#1768f2;font-size:10px;font-weight:800;letter-spacing:.08em}.report-export__copy small{max-width:280px;color:#687386;font-size:11px;line-height:1.35}.report-export-format{min-width:76px;min-height:38px;border:1px solid #d8deea;border-radius:8px;padding:0 8px;background:#fff}.report-context{padding:17px 18px;border:1px solid #dce4f0;border-radius:14px;background:#fff}.report-context__heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}.report-context__heading small{color:#1768f2;font-size:10px;font-weight:800;letter-spacing:.08em}.report-context__heading h2{margin:2px 0 0;color:#172033;font-size:19px}.report-context__heading p{margin:4px 0 0;color:#687386;font-size:12px}.report-filters{display:grid;grid-template-columns:repeat(7,minmax(118px,1fr));gap:10px}.report-filters--compact{grid-template-columns:repeat(2,minmax(180px,240px))}.report-filter-note,.report-period-error{display:flex;align-items:center;gap:6px;margin:11px 0 0;font-size:11px}.report-filter-note{color:#687386}.report-period-error{color:#b42318;font-weight:700}.report-blocked-state{display:grid;min-height:180px;place-items:center;border:1px dashed #d6deea;border-radius:14px;background:#fafbfd;color:#687386}@media(max-width:1180px){.report-filters{grid-template-columns:repeat(4,minmax(130px,1fr))}}@media(max-width:780px){.report-export{width:100%;justify-content:flex-start;flex-wrap:wrap}.report-export__copy{width:100%;text-align:left}.report-export .btn{flex:1;justify-content:center}.report-context{padding:14px}.report-context__heading{align-items:stretch;flex-direction:column}.report-filters,.report-filters--compact{grid-template-columns:1fr 1fr}}@media(max-width:520px){.report-filters,.report-filters--compact{grid-template-columns:1fr}}
</style>
