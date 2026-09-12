<script setup lang="ts">
type ReportFilters = { periodStart: string; periodEnd: string; grouping: 'day' | 'week' | 'month'; marketplace: string; product: string; category: string; channel: string }
const { exportFinancialReport } = useAppData()
const { notify } = useUi()
const route = useRoute()
const today = new Date()
const filters = reactive<ReportFilters>({ periodStart: `${today.getFullYear()}-01-01`, periodEnd: today.toISOString().slice(0, 10), grouping: 'month', marketplace: 'Todos', product: 'Todos', category: 'Todos', channel: 'Todos' })
const exportFormat = ref<'csv' | 'xlsx'>('xlsx')
const exporting = ref(false)
const reportSection = computed(() => { const section = String(route.query.secao || 'financeiro'); return ['financeiro', 'produtos', 'historico'].includes(section) ? section : 'financeiro' })
const exportReport = async () => {
  if (filters.periodStart > filters.periodEnd || exporting.value) return notify('Informe um período válido para exportar.')
  exporting.value = true
  try {
    const content = await exportFinancialReport({ from: filters.periodStart, to: filters.periodEnd, marketplace: filters.marketplace === 'Todos' ? '' : filters.marketplace, product: filters.product === 'Todos' ? '' : filters.product, category: filters.category === 'Todos' ? '' : filters.category, channel: filters.channel === 'Todos' ? '' : filters.channel, format: exportFormat.value })
    const url = URL.createObjectURL(content); const link = document.createElement('a'); link.href = url; link.download = `printflow-relatorio-${filters.periodStart}-${filters.periodEnd}.${exportFormat.value}`; link.click(); URL.revokeObjectURL(url); notify('Relatorio exportado com sucesso.')
  } catch (error: any) { notify(error?.data?.error || error?.message || 'Nao foi possivel exportar o relatorio.') } finally { exporting.value = false }
}
</script>
<template>
  <div>
    <PageHeader title="Relatórios completos" subtitle="Centralize análises e exporte vendas, despesas, produtos, estoque, produção, clientes e conexões em um único arquivo."><div style="display:flex;gap:8px"><select v-model="exportFormat" class="report-export-format" aria-label="Formato da exportação"><option value="xlsx">XLSX</option><option value="csv">CSV</option></select><button class="btn" :disabled="exporting" @click="exportReport"><UiIcon name="download"/>{{ exporting ? 'Gerando...' : 'Exportar relatório' }}</button></div></PageHeader>
    <nav class="report-tabs" aria-label="Seções de relatórios"><NuxtLink to="/relatorios?secao=financeiro" :class="{ active: reportSection === 'financeiro' }">Financeiro</NuxtLink><NuxtLink to="/relatorios?secao=produtos" :class="{ active: reportSection === 'produtos' }">Produtos e vendas</NuxtLink><NuxtLink to="/relatorios?secao=historico" :class="{ active: reportSection === 'historico' }">Histórico financeiro</NuxtLink></nav>
    <LazyRelatorioFinanceiro v-if="reportSection === 'financeiro'" v-model:filters="filters" />
    <LazyRelatorioProdutos v-else-if="reportSection === 'produtos'" :period-start="filters.periodStart" :period-end="filters.periodEnd" />
    <LazyRelatorioHistorico v-else />
  </div>
</template>
<style scoped>
.report-export-format{min-width:76px;border:1px solid #d8deea;border-radius:8px;padding:0 8px;background:#fff}.report-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 20px;border-bottom:1px solid #e5e9f1;padding-bottom:10px}.report-tabs a{border:1px solid #d8deea;border-radius:999px;padding:8px 14px;color:#687386;font-size:13px;font-weight:700;text-decoration:none}.report-tabs a:hover,.report-tabs a.active{border-color:#9ebcf8;background:#eef4ff;color:#1768f2}
</style>
