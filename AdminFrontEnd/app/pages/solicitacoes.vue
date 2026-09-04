<script setup lang="ts">
const {
  requests, error, activeRequests, tenantFor, formatDate, statusLabel, statusClass,
  isChatOpen, load, refreshRequests
} = usePlatformAdminWorkspace()
const search = ref('')
const requestFilter = ref('all')
const refreshing = ref(false)

const filteredRequests = computed(() => {
  const term = search.value.trim().toLowerCase()
  return requests.value.filter(request => {
    const matchesStatus = requestFilter.value === 'all' || request.status === requestFilter.value
    const content = `${request.id} ${request.reason} ${request.status} ${tenantFor(request.tenantId)?.name || request.tenantId}`.toLowerCase()
    return matchesStatus && (!term || content.includes(term))
  })
})

const update = async () => {
  refreshing.value = true
  try { await refreshRequests() } finally { refreshing.value = false }
}
const openChat = (requestId: string) => navigateTo({ path: '/chats', query: { protocolo: requestId } })
onMounted(() => void load({ tenants: true, requests: true }))
</script>

<template>
  <AdminShell v-model:search="search" title="Solicitacoes" subtitle="Gerencie solicitacoes enviadas pelos owners" :request-count="activeRequests.length">
    <template #actions><button class="button button--quiet" :disabled="refreshing" @click="update">Atualizar</button></template>
    <p v-if="error" class="feedback feedback--error">{{ error }}</p>
    <div class="request-tabs">
      <button :class="{ active: requestFilter === 'all' }" @click="requestFilter = 'all'">Todas <span>{{ requests.length }}</span></button>
      <button :class="{ active: requestFilter === 'pending' }" @click="requestFilter = 'pending'">Abertas <span>{{ requests.filter(request => request.status === 'pending').length }}</span></button>
      <button :class="{ active: requestFilter === 'under_review' }" @click="requestFilter = 'under_review'">Em atendimento <span>{{ requests.filter(request => request.status === 'under_review').length }}</span></button>
      <button :class="{ active: requestFilter === 'closed' }" @click="requestFilter = 'closed'">Encerradas <span>{{ requests.filter(request => request.status === 'closed').length }}</span></button>
    </div>
    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Protocolo</th><th>Empresa</th><th>Assunto</th><th>Escopo</th><th>Status</th><th>Aberto em</th><th></th></tr></thead><tbody><tr v-for="request in filteredRequests" :key="request.id"><td><code>{{ request.id }}</code></td><td><strong>{{ tenantFor(request.tenantId)?.name || request.tenantId }}</strong></td><td>{{ request.reason }}</td><td>{{ request.scope.entityType || 'Auditoria operacional' }}<small>{{ request.scope.entityId }}</small></td><td><span :class="statusClass(request.status)">{{ statusLabel(request.status) }}</span></td><td>{{ formatDate(request.createdAt) }}</td><td><button class="table-action" @click="openChat(request.id)">{{ isChatOpen(request.status) ? 'Atender' : 'Visualizar' }}</button></td></tr><tr v-if="!filteredRequests.length"><td colspan="7" class="empty-state">Nenhuma solicitacao encontrada.</td></tr></tbody></table></div></section>
  </AdminShell>
</template>
