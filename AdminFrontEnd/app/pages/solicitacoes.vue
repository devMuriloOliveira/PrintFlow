<script setup lang="ts">
const {
  requests, error, activeRequests, tenantFor, formatDate, statusLabel, statusClass,
  isChatOpen, load, refreshRequests
} = usePlatformAdminWorkspace()
const search = ref('')
const requestFilter = ref('all')
const categoryFilter = ref('all')
const refreshing = ref(false)

const filteredRequests = computed(() => {
  const term = search.value.trim().toLowerCase()
  return requests.value.filter(request => {
    const matchesStatus = requestFilter.value === 'all' || request.status === requestFilter.value
    const matchesCategory = categoryFilter.value === 'all' || request.category === categoryFilter.value
    const content = `${request.id} ${request.subject} ${request.reason} ${request.category} ${request.requesterName} ${request.status} ${tenantFor(request.tenantId)?.name || request.tenantId}`.toLowerCase()
    return matchesStatus && matchesCategory && (!term || content.includes(term))
  })
})

const update = async () => {
  refreshing.value = true
  try { await refreshRequests() } finally { refreshing.value = false }
}
const openChat = (requestId: string) => navigateTo({ path: '/chats', query: { protocolo: requestId } })
const categoryLabel = (category: string) => ({ technical: 'Tecnico', financial: 'Financeiro', integration: 'Integracao', account: 'Conta', data_backup: 'Backup e dados', audit: 'Auditoria' }[category] || category)
onMounted(() => void load({ tenants: true, requests: true }))
</script>

<template>
  <AdminShell v-model:search="search" title="Solicitacoes" subtitle="Gerencie suporte e auditorias solicitados pelos usuarios" :request-count="activeRequests.length">
    <template #actions><select v-model="categoryFilter" aria-label="Filtrar categoria"><option value="all">Todas as categorias</option><option value="technical">Tecnico</option><option value="financial">Financeiro</option><option value="integration">Integracoes</option><option value="account">Conta</option><option value="data_backup">Backup e dados</option><option value="audit">Auditoria</option></select><button class="button button--quiet" :disabled="refreshing" @click="update">Atualizar</button></template>
    <p v-if="error" class="feedback feedback--error">{{ error }}</p>
    <div class="request-tabs">
      <button :class="{ active: requestFilter === 'all' }" @click="requestFilter = 'all'">Todas <span>{{ requests.length }}</span></button>
      <button :class="{ active: requestFilter === 'pending' }" @click="requestFilter = 'pending'">Abertas <span>{{ requests.filter(request => request.status === 'pending').length }}</span></button>
      <button :class="{ active: requestFilter === 'under_review' }" @click="requestFilter = 'under_review'">Em atendimento <span>{{ requests.filter(request => request.status === 'under_review').length }}</span></button>
      <button :class="{ active: requestFilter === 'closed' }" @click="requestFilter = 'closed'">Encerradas <span>{{ requests.filter(request => request.status === 'closed').length }}</span></button>
    </div>
    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Protocolo</th><th>Empresa</th><th>Assunto</th><th>Categoria</th><th>Solicitante</th><th>Prioridade</th><th>Status</th><th>Aberto em</th><th></th></tr></thead><tbody><tr v-for="request in filteredRequests" :key="request.id"><td><code>{{ request.id }}</code></td><td><strong>{{ tenantFor(request.tenantId)?.name || request.tenantId }}</strong></td><td>{{ request.subject || request.reason }}<small>{{ request.reason }}</small></td><td>{{ categoryLabel(request.category) }}</td><td><strong>{{ request.requesterName || 'Usuario indisponivel' }}</strong><small>{{ request.requesterRole }}</small></td><td>{{ request.priority }}</td><td><span :class="statusClass(request.status)">{{ statusLabel(request.status) }}</span></td><td>{{ formatDate(request.createdAt) }}</td><td><button class="table-action" @click="openChat(request.id)">{{ isChatOpen(request.status) ? 'Atender' : 'Visualizar' }}</button></td></tr><tr v-if="!filteredRequests.length"><td colspan="9" class="empty-state">Nenhuma solicitacao encontrada.</td></tr></tbody></table></div></section>
  </AdminShell>
</template>
