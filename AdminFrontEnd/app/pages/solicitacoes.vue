<script setup lang="ts">
const {
  requests, error, activeRequests, tenantFor, formatDate, statusLabel, statusClass,
  isChatOpen, load, refreshRequests, updatePrivacyRequest, exportPrivacyPortability, exportSupportRequestsReport
} = usePlatformAdminWorkspace()
const search = ref('')
const requestFilter = ref('all')
const categoryFilter = ref('all')
const refreshing = ref(false)
const privacyTriage = ref<{ id: string; status: string; dueAt: string; reason: string } | null>(null)
const triageLoading = ref(false)
const reportLoading = ref(false)

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
const categoryLabel = (category: string) => ({ technical: 'Tecnico', financial: 'Financeiro', integration: 'Integracao', account: 'Conta', data_backup: 'Backup e dados', privacy: 'LGPD', audit: 'Auditoria' }[category] || category)
const openPrivacyTriage = (request: any) => { privacyTriage.value = { id: request.id, status: request.status === 'pending' ? 'under_review' : request.status, dueAt: request.dueAt ? String(request.dueAt).slice(0, 10) : '', reason: '' } }
const savePrivacyTriage = async () => {
  if (!privacyTriage.value || privacyTriage.value.reason.trim().length < 8) return
  triageLoading.value = true
  try { await updatePrivacyRequest(privacyTriage.value.id, { status: privacyTriage.value.status, dueAt: privacyTriage.value.dueAt, reason: privacyTriage.value.reason }); privacyTriage.value = null }
  catch (cause: any) { error.value = cause?.data?.error || cause?.message || 'Nao foi possivel salvar a triagem.' }
  finally { triageLoading.value = false }
}
const exportRequestsReport = async () => {
  reportLoading.value = true
  try { await exportSupportRequestsReport() }
  catch (cause: any) { error.value = cause?.data?.error || cause?.message || 'Nao foi possivel gerar o relatorio.' }
  finally { reportLoading.value = false }
}
const exportPortability = async (request: any) => {
  try { await exportPrivacyPortability(request.id) } catch (cause: any) { error.value = cause?.message || 'Nao foi possivel gerar a portabilidade.' }
}
onMounted(() => void load({ tenants: true, requests: true }))
</script>

<template>
  <AdminShell v-model:search="search" title="Solicitacoes" subtitle="Gerencie suporte, LGPD e auditorias em um unico fluxo" :request-count="activeRequests.length">
    <template #actions><select v-model="categoryFilter" aria-label="Filtrar categoria"><option value="all">Todas as categorias</option><option value="technical">Tecnico</option><option value="financial">Financeiro</option><option value="integration">Integracoes</option><option value="account">Conta</option><option value="data_backup">Backup e dados</option><option value="privacy">LGPD</option><option value="audit">Auditoria</option></select><button class="button button--quiet" :disabled="reportLoading" @click="exportRequestsReport">Exportar CSV</button><button class="button button--quiet" :disabled="refreshing" @click="update">Atualizar</button></template>
    <p v-if="error" class="feedback feedback--error">{{ error }}</p>
    <div class="lgpd-scope-note"><strong>Leitura rapida</strong><span>Use a coluna Tipo para distinguir suporte, LGPD e auditoria. Para conversar em tempo real, abra o protocolo em Atendimentos.</span></div>
    <div class="request-tabs">
      <button :class="{ active: requestFilter === 'all' }" @click="requestFilter = 'all'">Todas <span>{{ requests.length }}</span></button>
      <button :class="{ active: requestFilter === 'pending' }" @click="requestFilter = 'pending'">Abertas <span>{{ requests.filter(request => request.status === 'pending').length }}</span></button>
      <button :class="{ active: requestFilter === 'under_review' }" @click="requestFilter = 'under_review'">Em atendimento <span>{{ requests.filter(request => request.status === 'under_review').length }}</span></button>
      <button :class="{ active: requestFilter === 'closed' }" @click="requestFilter = 'closed'">Encerradas <span>{{ requests.filter(request => ['closed', 'rejected', 'cancelled', 'expired'].includes(request.status)).length }}</span></button>
    </div>
    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Protocolo</th><th>Empresa</th><th>Assunto</th><th>Tipo</th><th>Solicitante</th><th>Prazo</th><th>Responsavel</th><th>Status</th><th>Aberto em</th><th></th></tr></thead><tbody><tr v-for="request in filteredRequests" :key="request.id"><td><code>{{ request.id }}</code></td><td><strong>{{ tenantFor(request.tenantId)?.name || request.tenantId }}</strong></td><td>{{ request.subject || request.reason }}<small>{{ request.reason }}</small></td><td>{{ request.requestKind === 'privacy' ? 'LGPD' : categoryLabel(request.category) }}<small v-if="request.privacyRight">{{ request.privacyRight }}</small></td><td><strong>{{ request.requesterName || 'Usuario indisponivel' }}</strong><small>{{ request.requesterRole }}</small></td><td>{{ formatDate(request.dueAt) }}</td><td>{{ request.responsibleName || 'Nao atribuido' }}</td><td><span :class="statusClass(request.status)">{{ statusLabel(request.status) }}</span></td><td>{{ formatDate(request.createdAt) }}</td><td><button class="table-action" @click="openChat(request.id)">{{ isChatOpen(request.status) ? 'Atender' : 'Visualizar' }}</button><button v-if="request.requestKind === 'privacy' && !['closed', 'rejected', 'cancelled', 'expired'].includes(request.status)" class="table-action" @click="openPrivacyTriage(request)">Triar</button><button v-if="request.requestKind === 'privacy' && request.privacyRight === 'portability' && request.status === 'closed'" class="table-action" @click="exportPortability(request)">CSV</button></td></tr><tr v-if="!filteredRequests.length"><td colspan="10" class="empty-state">Nenhuma solicitacao encontrada.</td></tr></tbody></table></div></section>
    <section v-if="privacyTriage" class="access-modal"><div class="modal-card"><button class="modal-close" @click="privacyTriage = null">Cancelar</button><h2>Triar solicitacao LGPD</h2><p>Protocolo <code>{{ privacyTriage.id }}</code>. A alteracao sera registrada na auditoria da plataforma.</p><form @submit.prevent="savePrivacyTriage"><label>Status<select v-model="privacyTriage.status"><option value="under_review">Em atendimento</option><option value="rejected">Rejeitada</option><option value="closed">Encerrada</option></select></label><label>Prazo de resposta<input v-model="privacyTriage.dueAt" type="date"></label><label>Motivo/registro<textarea v-model="privacyTriage.reason" minlength="8" maxlength="500" required></textarea></label><button class="button button--primary" :disabled="triageLoading">{{ triageLoading ? 'Salvando...' : 'Salvar triagem' }}</button></form></div></section>
  </AdminShell>
</template>
