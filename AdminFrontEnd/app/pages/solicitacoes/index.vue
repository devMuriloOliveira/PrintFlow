<script setup lang="ts">
const {
  session, requests, messagesByRequest, error, activeRequests, tenantFor, formatDate, statusLabel, statusClass,
  load, refreshRequests, updatePrivacyRequest, exportPrivacyPortability, exportSupportRequestsReport,
  claimChat, loadMessages, loadSupportContact, updateSupportMetadata, addSupportNote
} = usePlatformAdminWorkspace()
const route = useRoute()
const search = ref('')
const requestFilter = ref<'all' | 'open' | 'progress' | 'closed'>('all')
const categoryFilter = ref('all')
const refreshing = ref(false)
const privacyTriage = ref<{ id: string; status: string; dueAt: string; reason: string } | null>(null)
const triageLoading = ref(false)
const reportLoading = ref(false)
const requestPage = ref(0)
const requestPageSize = 50
const requestPageLoading = ref(false)
const selectedRequestId = ref('')
const detailLoading = ref(false)
const detailSaving = ref(false)
const detailFeedback = ref('')
const selectedContact = ref<{ requesterName: string; requesterEmail: string } | null>(null)
const supportEditor = reactive({ status: 'in_progress', tags: '', note: '' })

const selectedRequest = computed(() => requests.value.find(request => request.id === selectedRequestId.value) || null)
const selectedMessages = computed(() => selectedRequestId.value ? messagesByRequest.value[selectedRequestId.value] || [] : [])
const selectedIsSupport = computed(() => selectedRequest.value?.requestKind !== 'privacy' && selectedRequest.value?.category !== 'audit')
const currentAdminId = computed(() => String(session.user.value?.id || ''))
const canManageSelected = computed(() => {
  const request = selectedRequest.value
  if (!request) return false
  return String(request.chatAssigneeId || '') === currentAdminId.value || Boolean(request.chatCollaborators?.some(collaborator => String(collaborator.id) === currentAdminId.value))
})
const requestStatus = (request: any) => request.requestKind === 'support' ? (request.supportStatus || request.status) : request.status
const isClosed = (request: any) => ['closed', 'cancelled', 'expired', 'rejected', 'resolved'].includes(requestStatus(request))
const isProgress = (request: any) => ['under_review', 'in_progress', 'waiting_customer', 'waiting_internal', 'reopened', 'approved'].includes(requestStatus(request))
const matchesGroup = (request: any) => requestFilter.value === 'all' || (requestFilter.value === 'closed' ? isClosed(request) : requestFilter.value === 'progress' ? isProgress(request) : !isClosed(request) && !isProgress(request))
const requestCounts = computed(() => ({
  open: requests.value.filter(request => !isClosed(request) && !isProgress(request)).length,
  progress: requests.value.filter(isProgress).length,
  closed: requests.value.filter(isClosed).length
}))
const hasNextRequestPage = computed(() => requests.value.length === requestPageSize)

const filteredRequests = computed(() => {
  const term = search.value.trim().toLowerCase()
  const protocolTerm = term.replace(/\D/g, '')
  return requests.value.filter(request => {
    const matchesCategory = categoryFilter.value === 'all' || request.category === categoryFilter.value
    const content = `${request.id} ${request.protocolNumber} ${request.subject} ${request.reason} ${request.category} ${request.requesterName} ${request.status} ${tenantFor(request.tenantId)?.name || request.tenantId}`.toLowerCase()
    const matchesSearch = !term || content.includes(term) || (protocolTerm.length >= 12 && request.protocolNumber === protocolTerm)
    return matchesGroup(request) && matchesCategory && matchesSearch
  })
})

const loadRequestsPage = async () => {
  requestPageLoading.value = true
  try {
    await refreshRequests({ search: search.value.trim(), category: categoryFilter.value === 'all' ? '' : categoryFilter.value, limit: String(requestPageSize), offset: String(requestPage.value * requestPageSize) })
  } catch (cause: any) {
    error.value = cause?.data?.error || cause?.message || 'Nao foi possivel carregar as solicitacoes.'
  } finally { requestPageLoading.value = false }
}
const update = async () => {
  refreshing.value = true
  try { requestPage.value = 0; await loadRequestsPage() } finally { refreshing.value = false }
}
const changeRequestPage = (delta: number) => {
  const next = requestPage.value + delta
  if (next < 0 || (delta > 0 && !hasNextRequestPage.value)) return
  requestPage.value = next
  void loadRequestsPage()
}
let requestFilterTimer: ReturnType<typeof setTimeout> | undefined
watch([search, categoryFilter], () => {
  if (requestFilterTimer) clearTimeout(requestFilterTimer)
  requestFilterTimer = setTimeout(() => { requestPage.value = 0; void loadRequestsPage() }, 250)
})

const categoryLabel = (category: string) => ({ technical: 'Suporte', financial: 'Financeiro', integration: 'Integração', account: 'Conta', data_backup: 'Backup e dados', privacy: 'LGPD', audit: 'Auditoria' }[category] || category)
const protocolLabel = (request: any) => String(request?.protocolNumber || request?.id || '').replace(/(\d{4})(?=\d)/g, '$1 ')
const emailSubject = computed(() => selectedRequest.value ? `[PrintFlow #${selectedRequest.value.protocolNumber || selectedRequest.value.id}] ${selectedRequest.value.subject}` : '')
const loadSelectedContact = async () => {
  if (!selectedRequest.value || !selectedIsSupport.value || !canManageSelected.value) return
  selectedContact.value = await loadSupportContact(selectedRequest.value.id)
}
const openRequest = async (request: any) => {
  selectedRequestId.value = request.id
  detailFeedback.value = ''
  selectedContact.value = null
  supportEditor.status = request.supportStatus || 'in_progress'
  supportEditor.tags = (request.supportTags || []).join(', ')
  supportEditor.note = ''
  if (!request.chatAssigneeId && !request.chatCollaborators?.length) return
  detailLoading.value = true
  try { await Promise.all([loadMessages(request.id, true), loadSelectedContact()]) }
  catch (cause: any) { detailFeedback.value = cause?.data?.error || cause?.message || 'Nao foi possivel carregar as observacoes.' }
  finally { detailLoading.value = false }
}
const closeDetail = () => { selectedRequestId.value = ''; selectedContact.value = null; detailFeedback.value = '' }
const copyText = async (value: string, label: string) => {
  if (!value) return
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value)
    else {
      const input = document.createElement('textarea')
      input.value = value; input.style.position = 'fixed'; input.style.opacity = '0'
      document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove()
    }
    detailFeedback.value = `${label} copiado.`
  } catch { detailFeedback.value = `Nao foi possivel copiar ${label.toLowerCase()}.` }
}
const claimSelected = async () => {
  if (!selectedRequest.value) return
  detailLoading.value = true; detailFeedback.value = ''
  try {
    await claimChat(selectedRequest.value.id)
    await loadRequestsPage()
    supportEditor.status = 'in_progress'
    await Promise.all([loadMessages(selectedRequestId.value, true), loadSelectedContact()])
    detailFeedback.value = 'Atendimento atribuído a você.'
  } catch (cause: any) { detailFeedback.value = cause?.data?.error || cause?.message || 'Nao foi possivel assumir o atendimento.' }
  finally { detailLoading.value = false }
}
const saveSupport = async () => {
  if (!selectedRequest.value || !canManageSelected.value) return
  detailSaving.value = true; detailFeedback.value = ''
  try {
    await updateSupportMetadata(selectedRequest.value.id, { supportStatus: supportEditor.status, tags: supportEditor.tags })
    if (supportEditor.note.trim()) {
      await addSupportNote(selectedRequest.value.id, supportEditor.note.trim())
      supportEditor.note = ''
    }
    await loadRequestsPage()
    detailFeedback.value = supportEditor.status === 'resolved' ? 'Atendimento encerrado e registrado.' : 'Atendimento atualizado.'
  } catch (cause: any) { detailFeedback.value = cause?.data?.error || cause?.message || 'Nao foi possivel atualizar o atendimento.' }
  finally { detailSaving.value = false }
}
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
onMounted(async () => {
  await load({ tenants: true })
  await loadRequestsPage()
  const protocol = String(route.query.protocolo || '')
  const normalized = protocol.replace(/\D/g, '')
  const requested = requests.value.find(request => request.id === protocol || request.protocolNumber === normalized)
  if (requested) await openRequest(requested)
})
</script>

<template>
  <AdminShell v-model:search="search" title="Suporte e solicitações" subtitle="Receba, organize e conclua os contatos enviados pelo PrintFlow" :request-count="activeRequests.length">
    <template #actions><select v-model="categoryFilter" aria-label="Filtrar categoria"><option value="all">Todas as categorias</option><option value="technical">Suporte</option><option value="financial">Financeiro</option><option value="integration">Integrações</option><option value="account">Conta</option><option value="data_backup">Backup e dados</option><option value="privacy">LGPD</option><option value="audit">Auditoria</option></select><button class="button button--quiet" :disabled="reportLoading" @click="exportRequestsReport">Exportar CSV</button><button class="button button--quiet" :disabled="refreshing" @click="update">{{ refreshing ? 'Atualizando...' : 'Atualizar' }}</button></template>
    <p v-if="error" class="feedback feedback--error">{{ error }}</p>

    <section class="support-admin-summary" aria-label="Resumo da fila">
      <article><span class="support-admin-summary__mark support-admin-summary__mark--new">N</span><div><small>Novas</small><strong>{{ requestCounts.open }}</strong><p>Aguardando responsável</p></div></article>
      <article><span class="support-admin-summary__mark support-admin-summary__mark--progress">A</span><div><small>Em atendimento</small><strong>{{ requestCounts.progress }}</strong><p>Em análise pela equipe</p></div></article>
      <article><span class="support-admin-summary__mark support-admin-summary__mark--done">C</span><div><small>Concluídas</small><strong>{{ requestCounts.closed }}</strong><p>Resolvidas ou encerradas</p></div></article>
    </section>

    <div class="support-admin-toolbar">
      <div class="request-tabs">
        <button :class="{ active: requestFilter === 'all' }" @click="requestFilter = 'all'">Todas <span>{{ requests.length }}</span></button>
        <button :class="{ active: requestFilter === 'open' }" @click="requestFilter = 'open'">Novas <span>{{ requestCounts.open }}</span></button>
        <button :class="{ active: requestFilter === 'progress' }" @click="requestFilter = 'progress'">Em atendimento <span>{{ requestCounts.progress }}</span></button>
        <button :class="{ active: requestFilter === 'closed' }" @click="requestFilter = 'closed'">Concluídas <span>{{ requestCounts.closed }}</span></button>
      </div>
      <p><span></span>Os contatos são internos. Nenhuma resposta por e-mail é enviada nesta etapa.</p>
    </div>

    <section class="panel table-panel support-admin-table"><div class="table-wrap"><table><thead><tr><th>Solicitante</th><th>Empresa e protocolo</th><th>Assunto</th><th>Tipo</th><th>Responsável</th><th>Status</th><th>Recebido em</th><th></th></tr></thead><tbody><tr v-for="request in filteredRequests" :key="request.id"><td><strong>{{ request.requesterName || 'Usuário indisponível' }}</strong><small>{{ request.chatAssigneeId ? 'Contato disponível ao responsável' : 'E-mail protegido até a atribuição' }}</small></td><td><strong>{{ tenantFor(request.tenantId)?.name || request.tenantId }}</strong><small><code>{{ protocolLabel(request) }}</code></small></td><td class="support-admin-table__subject"><strong>{{ request.subject || 'Sem assunto' }}</strong><small>{{ request.reason }}</small></td><td>{{ request.requestKind === 'privacy' ? 'LGPD' : categoryLabel(request.category) }}</td><td>{{ request.chatAssigneeName || request.responsibleName || 'Não atribuído' }}</td><td><span :class="statusClass(requestStatus(request))">{{ statusLabel(requestStatus(request)) }}</span></td><td>{{ formatDate(request.createdAt) }}</td><td><button class="button button--quiet" @click="openRequest(request)">Abrir</button></td></tr><tr v-if="!filteredRequests.length"><td colspan="8" class="empty-state">Nenhuma solicitação encontrada com estes filtros.</td></tr></tbody></table></div><div class="table-footer"><span>{{ requestPageLoading ? 'Carregando solicitações...' : `Página ${requestPage + 1} · ${filteredRequests.length} registros` }}</span><div class="pagination"><button class="button button--quiet" :disabled="requestPageLoading || requestPage === 0" @click="changeRequestPage(-1)">Anterior</button><button class="button button--quiet" :disabled="requestPageLoading || !hasNextRequestPage" @click="changeRequestPage(1)">Próxima</button></div></div></section>

    <section v-if="selectedRequest" class="support-detail-backdrop" @click.self="closeDetail">
      <article class="support-detail" role="dialog" aria-modal="true" aria-labelledby="support-detail-title">
        <header class="support-detail__header"><div><span>{{ selectedRequest.requestKind === 'privacy' ? 'Solicitação LGPD' : 'Contato de suporte' }}</span><h2 id="support-detail-title">{{ selectedRequest.subject }}</h2><p><code>{{ protocolLabel(selectedRequest) }}</code> · {{ formatDate(selectedRequest.createdAt) }}</p></div><button class="support-detail__close" aria-label="Fechar detalhes" @click="closeDetail">×</button></header>
        <div class="support-detail__body">
          <main>
            <section class="support-detail__message"><span>Mensagem recebida</span><p>{{ selectedRequest.reason }}</p></section>
            <section class="support-detail__contact"><div><small>Nome</small><strong>{{ selectedContact?.requesterName || selectedRequest.requesterName || 'Não informado' }}</strong></div><div v-if="selectedContact"><small>E-mail liberado para o responsável</small><strong>{{ selectedContact.requesterEmail }}</strong><span class="support-detail__contact-actions"><button type="button" class="button button--quiet" @click="copyText(selectedContact.requesterEmail, 'E-mail')">Copiar e-mail</button><button type="button" class="button button--quiet" @click="copyText(emailSubject, 'Assunto')">Copiar assunto</button></span></div><div v-else><small>E-mail protegido</small><strong>{{ selectedIsSupport ? 'Assuma o atendimento para visualizar' : 'Disponível somente no fluxo autorizado' }}</strong></div><div><small>Empresa</small><strong>{{ tenantFor(selectedRequest.tenantId)?.name || selectedRequest.tenantId }}</strong></div></section>
            <section v-if="selectedMessages.length" class="support-detail__notes"><h3>Histórico interno</h3><article v-for="message in selectedMessages" :key="message.id"><div><strong>{{ message.sender_type === 'superadmin' ? 'Equipe PrintFlow' : selectedRequest.requesterName }}</strong><time>{{ formatDate(message.created_at) }}</time></div><p>{{ message.body }}</p></article></section>
            <p v-else-if="detailLoading" class="support-detail__empty">Carregando histórico...</p>
            <p v-else class="support-detail__empty">Nenhuma observação interna registrada.</p>
          </main>
          <aside>
            <div class="support-detail__state"><small>Status atual</small><span :class="statusClass(requestStatus(selectedRequest))">{{ statusLabel(requestStatus(selectedRequest)) }}</span><p>Responsável: <strong>{{ selectedRequest.chatAssigneeName || 'Não atribuído' }}</strong></p></div>
            <button v-if="selectedIsSupport && !selectedRequest.chatAssigneeId" class="button button--primary support-detail__claim" :disabled="detailLoading" @click="claimSelected">{{ detailLoading ? 'Assumindo...' : 'Assumir atendimento' }}</button>
            <form v-else-if="selectedIsSupport && canManageSelected" class="support-detail__form" @submit.prevent="saveSupport">
              <label>Status<select v-model="supportEditor.status"><option value="in_progress">Em atendimento</option><option value="waiting_internal">Aguardando equipe</option><option value="resolved">Resolvido</option></select></label>
              <label>Marcadores<input v-model="supportEditor.tags" maxlength="200" placeholder="Ex.: acesso, impressora"></label>
              <label>Observação interna<textarea v-model="supportEditor.note" maxlength="1000" placeholder="Registre o que foi analisado ou realizado"></textarea></label>
              <p>Esta observação fica somente no AdminFrontEnd e não dispara e-mail.</p>
              <button class="button button--primary" :disabled="detailSaving">{{ detailSaving ? 'Salvando...' : supportEditor.status === 'resolved' ? 'Concluir atendimento' : 'Salvar atendimento' }}</button>
            </form>
            <div v-else-if="selectedRequest.requestKind === 'privacy'" class="support-detail__special"><strong>Fluxo de LGPD</strong><p>Use a triagem própria para definir prazo, decisão e justificativa auditável.</p><button v-if="!isClosed(selectedRequest)" class="button button--primary" @click="openPrivacyTriage(selectedRequest); closeDetail()">Abrir triagem</button><button v-if="selectedRequest.privacyRight === 'portability' && selectedRequest.status === 'closed'" class="button button--quiet" @click="exportPortability(selectedRequest)">Baixar portabilidade CSV</button><span v-if="isClosed(selectedRequest) && selectedRequest.privacyRight !== 'portability'" class="status-pill status-pill--closed">Solicitação concluída</span></div>
            <div v-else class="support-detail__special"><strong>Solicitação controlada</strong><p>Este protocolo segue o fluxo específico de auditoria da plataforma.</p></div>
            <p v-if="detailFeedback" class="support-detail__feedback">{{ detailFeedback }}</p>
          </aside>
        </div>
      </article>
    </section>

    <section v-if="privacyTriage" class="access-modal"><div class="modal-card"><button class="modal-close" @click="privacyTriage = null">Cancelar</button><h2>Triar solicitação LGPD</h2><p>Protocolo <code>{{ privacyTriage.id }}</code>. A alteração será registrada na auditoria da plataforma.</p><form @submit.prevent="savePrivacyTriage"><label>Status<select v-model="privacyTriage.status"><option value="under_review">Em atendimento</option><option value="rejected">Rejeitada</option><option value="closed">Encerrada</option></select></label><label>Prazo de resposta<input v-model="privacyTriage.dueAt" type="date"></label><label>Motivo/registro<textarea v-model="privacyTriage.reason" minlength="8" maxlength="500" required></textarea></label><button class="button button--primary" :disabled="triageLoading">{{ triageLoading ? 'Salvando...' : 'Salvar triagem' }}</button></form></div></section>
  </AdminShell>
</template>
