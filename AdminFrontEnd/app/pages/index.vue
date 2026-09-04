<script setup lang="ts">
const {
  overview, tenants, requests, error, activeRequests, closedRequests,
  tenantFor, formatDate, isChatOpen, load
} = usePlatformAdminWorkspace()
const search = ref('')

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
onMounted(() => void load({ overview: true, tenants: true, requests: true }))
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
  </AdminShell>
</template>
