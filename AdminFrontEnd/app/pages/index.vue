<script setup lang="ts">
const {
  overview, tenants, requests, error, activeRequests, closedRequests,
  supportMetrics, supportSlaRules, tenantFor, formatDate, isChatOpen, load, loadSupportMetrics, loadSupportSlaRules, updateSupportSlaRule
} = usePlatformAdminWorkspace()
const search = ref('')
const slaSaving = ref('')
const slaError = ref('')

const recentRequests = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return requests.value.slice(0, 5)
  return requests.value.filter(request => `${request.id} ${request.reason} ${tenantFor(request.tenantId)?.name || ''}`.toLowerCase().includes(term)).slice(0, 5)
})

const operationalSummary = computed(() => {
  if (!overview.value) return []
  return [
    { label: 'Empresas ativas', value: overview.value.activeTenants, total: overview.value.tenants },
    { label: 'Agents online', value: overview.value.onlineAgents, total: overview.value.agents },
    { label: 'Impressoras conectadas', value: overview.value.connectedPrinters, total: overview.value.printers }
  ].map(item => ({ ...item, percentage: item.total > 0 ? Math.round((item.value / item.total) * 100) : 0 }))
})

const openChat = (requestId: string) => navigateTo({ path: '/chats', query: { protocolo: requestId } })
const saveSlaRule = async (rule: any) => {
  slaSaving.value = rule.id; slaError.value = ''
  try { await updateSupportSlaRule(rule.id, { category: rule.category, priority: rule.priority, firstResponseMinutes: Number(rule.firstResponseMinutes), resolutionMinutes: Number(rule.resolutionMinutes), active: rule.active }) }
  catch (cause: any) { slaError.value = cause?.data?.error || cause?.message || 'Nao foi possivel salvar a regra de SLA.' }
  finally { slaSaving.value = '' }
}
onMounted(async () => {
  await load({ overview: true, tenants: true, requests: true })
  const [metricsResult, slaResult] = await Promise.allSettled([loadSupportMetrics(), loadSupportSlaRules()])
  if (metricsResult.status === 'rejected' && !error.value) error.value = 'Nao foi possivel carregar as metricas do suporte.'
  if (slaResult.status === 'rejected') slaError.value = 'Nao foi possivel carregar as regras de SLA.'
})
</script>

<template>
  <AdminShell v-model:search="search" title="Central da plataforma" subtitle="Indicadores atuais consultados na plataforma" :request-count="activeRequests.length">
    <p v-if="error" class="feedback feedback--error">{{ error }}</p>
    <section v-if="overview" class="metrics-grid">
      <article><span>Solicitacoes</span><strong>{{ requests.length }}</strong><small>{{ activeRequests.length }} aguardando acao</small></article>
      <article><span>Em atendimento</span><strong>{{ requests.filter(request => request.status !== 'pending' && isChatOpen(request.status)).length }}</strong><small>Conversas em andamento</small></article>
      <article><span>Empresas</span><strong>{{ overview.tenants }}</strong><small>{{ overview.activeTenants }} ativas</small></article>
      <article><span>Usuarios ativos</span><strong>{{ tenants.reduce((sum, tenant) => sum + tenant.activeUsers, 0) }}</strong><small>Em todos os tenants</small></article>
      <article><span>Agents online</span><strong>{{ overview.onlineAgents }}</strong><small>de {{ overview.agents }} pareados</small></article>
      <article><span>Impressoras</span><strong>{{ overview.connectedPrinters }}</strong><small>de {{ overview.printers }} conectadas</small></article>
      <article><span>Atencao financeira</span><strong>{{ overview.paymentAttention }}</strong><small>Empresas com pendencias</small></article>
      <article><span>Encerrados</span><strong>{{ closedRequests.length }}</strong><small>Protocolos preservados</small></article>
    </section>
    <section class="dashboard-columns">
      <article class="panel"><div class="panel-head"><div><h2>Disponibilidade operacional</h2><p>Valores retornados pela API nesta consulta</p></div></div><div class="live-summary"><div v-for="item in operationalSummary" :key="item.label" class="live-summary__row"><div><span>{{ item.label }}</span><strong>{{ item.value }} de {{ item.total }}</strong></div><div class="live-summary__track"><span :style="{ width: `${item.percentage}%` }"></span></div><small>{{ item.percentage }}%</small></div><p v-if="!operationalSummary.length" class="empty-state">Dados operacionais indisponiveis.</p></div></article>
      <article class="panel"><div class="panel-head"><div><h2>Solicitacoes recentes</h2><p>Ultimos protocolos abertos</p></div><NuxtLink class="table-action" to="/solicitacoes">Ver todas</NuxtLink></div><button v-for="request in recentRequests" :key="request.id" class="activity-row" @click="openChat(request.id)"><span class="activity-icon">S</span><div><strong>{{ tenantFor(request.tenantId)?.name || request.tenantId }}</strong><small>{{ request.id }}</small></div><time>{{ formatDate(request.createdAt) }}</time></button><p v-if="!recentRequests.length" class="empty-state">Nenhuma solicitacao registrada.</p></article>
    </section>
    <section v-if="supportMetrics" class="dashboard-columns"><article class="panel"><div class="panel-head"><div><h2>Desempenho do suporte</h2><p>Indicadores comerciais separados do SLA de LGPD</p></div></div><div class="metrics-grid metrics-grid--compact"><article><span>1ª resposta média</span><strong>{{ Math.round(supportMetrics.averageFirstResponseMinutes) }} min</strong></article><article><span>Resolução média</span><strong>{{ Math.round(supportMetrics.averageResolutionMinutes) }} min</strong></article><article><span>Em atraso</span><strong>{{ supportMetrics.overdue }}</strong></article><article><span>Reabertos</span><strong>{{ supportMetrics.reopened }}</strong></article></div></article><article class="panel"><div class="panel-head"><div><h2>Fila e conformidade</h2><p>Distribuição atual dos protocolos</p></div></div><div class="live-summary"><div class="live-summary__row"><span>Aguardando cliente</span><strong>{{ supportMetrics.waitingCustomer }}</strong></div><div class="live-summary__row"><span>Aguardando equipe</span><strong>{{ supportMetrics.waitingInternal }}</strong></div><div class="live-summary__row"><span>LGPD dentro do prazo</span><strong>{{ supportMetrics.lgpd.withinDeadline }}</strong></div><div class="live-summary__row"><span>LGPD atrasadas</span><strong>{{ supportMetrics.lgpd.overdue }}</strong></div></div></article></section>
    <section v-if="supportMetrics" class="dashboard-columns"><article class="panel"><div class="panel-head"><div><h2>Volume por empresa</h2><p>Tenants com maior volume de suporte</p></div></div><div class="live-summary"><div v-for="item in supportMetrics.byTenant" :key="item.tenantId" class="live-summary__row"><span>{{ tenantFor(item.tenantId)?.name || item.tenantId }}</span><strong>{{ item.total }}</strong></div><p v-if="!supportMetrics.byTenant.length" class="empty-state">Nenhum atendimento no período.</p></div></article><article class="panel"><div class="panel-head"><div><h2>Volume por responsável</h2><p>Distribuição dos atendimentos</p></div></div><div class="live-summary"><div v-for="item in supportMetrics.byAssignee" :key="item.id || item.name" class="live-summary__row"><span>{{ item.name }}</span><strong>{{ item.total }}</strong></div><p v-if="!supportMetrics.byAssignee.length" class="empty-state">Nenhum atendimento atribuído.</p></div></article></section>
    <section class="panel"><div class="panel-head"><div><h2>Regras de SLA do suporte</h2><p>Prazos comerciais separados dos prazos legais de LGPD.</p></div></div><p v-if="slaError" class="feedback feedback--error">{{ slaError }}</p><div class="table-wrap"><table><thead><tr><th>Categoria</th><th>Prioridade</th><th>1a resposta (min)</th><th>Resolucao (min)</th><th>Ativa</th><th></th></tr></thead><tbody><tr v-for="rule in supportSlaRules" :key="rule.id"><td>{{ rule.category }}</td><td>{{ rule.priority }}</td><td><input v-model.number="rule.firstResponseMinutes" type="number" min="1" max="43200"></td><td><input v-model.number="rule.resolutionMinutes" type="number" min="1" max="43200"></td><td><input v-model="rule.active" type="checkbox"></td><td><button class="table-action" :disabled="slaSaving === rule.id" @click="saveSlaRule(rule)">{{ slaSaving === rule.id ? 'Salvando...' : 'Salvar' }}</button></td></tr><tr v-if="!supportSlaRules.length"><td colspan="6" class="empty-state">Nenhuma regra configurada.</td></tr></tbody></table></div></section>
  </AdminShell>
</template>
