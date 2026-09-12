<script setup lang="ts">
import type { AuditRequest, Message } from '~/types/platform-admin'

const route = useRoute()
const {
  session, requests, tenants, messagesByRequest, supportHistory, supportAttachments, authorizedTenantAudit, error, activeRequests, closedRequests, supportMacros, tenantFor, formatDate,
  statusLabel, statusClass, isChatOpen, load, loadMessages, loadSupportHistory, loadSupportAttachments, uploadSupportAttachment, downloadSupportAttachment, refreshRequests, loadChatAssignees, loadSupportMacros, claimChat, transferChat, addChatCollaborator, updateSupportMetadata, reopenSupportChat, snoozeSupport, bulkUpdateSupport, autoAssignSupport
} = usePlatformAdminWorkspace()
const search = ref('')
const queueFilter = ref<'open' | 'all' | 'unassigned' | 'mine' | 'collaborating' | 'waiting_customer' | 'waiting_internal' | 'overdue' | 'closed'>('open')
const selectedRequest = ref<AuditRequest | null>(null)
const messages = computed<Message[]>(() => selectedRequest.value ? messagesByRequest.value[selectedRequest.value.id] || [] : [])
const canParticipate = computed(() => {
  const request = selectedRequest.value
  const currentId = session.user.value?.id || ''
  return Boolean(request && (request.chatAssigneeId === currentId || request.chatCollaborators?.some(item => item.id === currentId)))
})
const messageDraft = ref('')
const messageMode = ref<'public' | 'internal'>('public')
const actionLoading = ref(false)
const conversationLoading = ref(false)
const actionError = ref('')
const chatAssignees = ref<Array<{ id: string; name: string }>>([])
const assignmentTarget = ref('')
const supportStatusDraft = ref('in_progress')
const supportTagsDraft = ref('')
const firstResponseDueDraft = ref('')
const resolutionDueDraft = ref('')
const snoozeUntilDraft = ref('')
const selectedBatchIds = ref<string[]>([])
const bulkOperation = ref<'claim' | 'status'>('claim')
const bulkStatus = ref('waiting_customer')
const categoryFilter = ref('')
const assigneeFilter = ref('')
const tenantFilter = ref('')
const fromFilter = ref('')
const toFilter = ref('')
const requestPage = ref(0)
const requestPageSize = 50
const hasNextRequestPage = computed(() => requests.value.length === requestPageSize)
let refreshTimer: ReturnType<typeof setInterval> | undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined

const requesterName = (request: AuditRequest) => request.requesterName || 'Usuario indisponivel'
const requesterInitials = (request: AuditRequest) => requesterName(request).split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()
const requesterIdentity = (request: AuditRequest) => `${requesterName(request)} · ${tenantFor(request.tenantId)?.name || 'Empresa indisponivel'}`

const isOverdue = (request: AuditRequest) => {
  const due = request.supportResolutionDueAt || request.supportFirstResponseDueAt
  return request.requestKind === 'support' && request.supportStatus !== 'resolved' && Boolean(due && new Date(due).getTime() < Date.now())
}
const isClosedRequest = (request: AuditRequest) => ['closed', 'cancelled', 'expired'].includes(request.status) || request.supportStatus === 'resolved'

const filteredRequests = computed(() => {
  const term = search.value.trim().toLowerCase()
  const currentId = session.user.value?.id || ''
  return requests.value.filter(request => {
    const collaborator = request.chatCollaborators?.some(item => item.id === currentId)
    const supportStatus = request.supportStatus || request.status
    const matchesQueue = queueFilter.value === 'closed'
      ? isClosedRequest(request)
      : !isClosedRequest(request) && (queueFilter.value === 'open' || queueFilter.value === 'all'
        || (queueFilter.value === 'unassigned' && !request.chatAssigneeId)
        || (queueFilter.value === 'mine' && request.chatAssigneeId === currentId)
        || (queueFilter.value === 'collaborating' && collaborator)
        || (queueFilter.value === 'waiting_customer' && supportStatus === 'waiting_customer')
        || (queueFilter.value === 'waiting_internal' && supportStatus === 'waiting_internal')
        || (queueFilter.value === 'overdue' && isOverdue(request)))
    const content = `${request.id} ${request.subject} ${request.reason} ${request.category} ${request.requesterName} ${supportStatus} ${tenantFor(request.tenantId)?.name || request.tenantId}`.toLowerCase()
    return matchesQueue && (!term || content.includes(term))
  })
})

const openChat = async (request: AuditRequest) => {
  selectedRequest.value = request
  supportStatusDraft.value = request.supportStatus || 'in_progress'
  supportTagsDraft.value = (request.supportTags || []).join(', ')
  firstResponseDueDraft.value = request.supportFirstResponseDueAt ? String(request.supportFirstResponseDueAt).slice(0, 16) : ''
  resolutionDueDraft.value = request.supportResolutionDueAt ? String(request.supportResolutionDueAt).slice(0, 16) : ''
  conversationLoading.value = true
  actionError.value = ''
  try {
    const currentId = session.user.value?.id || ''
    const collaborator = request.chatCollaborators?.some(item => item.id === currentId)
    if (request.chatAssigneeId && request.chatAssigneeId !== currentId && !collaborator) {
      actionError.value = 'Esta conversa esta atribuida a outro superadmin.'
      return
    }
    if (!request.chatAssigneeId && !collaborator) return
    await loadMessages(request.id)
    // Mensagens são o conteúdo crítico para abrir a conversa. Histórico e anexos
    // chegam em segundo plano para não bloquear a primeira renderização.
    void Promise.all([
      loadSupportHistory(request.id),
      request.requestKind === 'support' ? loadSupportAttachments(request.id) : Promise.resolve([])
    ]).catch((cause: any) => {
      actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel carregar todo o contexto da conversa.'
    })
  } catch (cause: any) {
    actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel abrir a conversa.'
  } finally {
    conversationLoading.value = false
  }
}

const claimSelectedChat = async () => {
  if (!selectedRequest.value) return
  actionLoading.value = true; actionError.value = ''
  try { selectedRequest.value = await claimChat(selectedRequest.value.id); await loadMessages(selectedRequest.value.id, true) } catch (cause: any) { actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel assumir a conversa.' } finally { actionLoading.value = false }
}
const transferSelectedChat = async () => {
  if (!selectedRequest.value || !assignmentTarget.value) return
  const reason = window.prompt('Informe o motivo da transferencia.') || ''
  if (reason.trim().length < 8) return
  actionLoading.value = true; actionError.value = ''
  try { await transferChat(selectedRequest.value.id, assignmentTarget.value, reason.trim()); selectedRequest.value = null } catch (cause: any) { actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel transferir a conversa.' } finally { actionLoading.value = false }
}
const addSelectedCollaborator = async () => {
  if (!selectedRequest.value || !assignmentTarget.value) return
  actionLoading.value = true; actionError.value = ''
  try { await addChatCollaborator(selectedRequest.value.id, assignmentTarget.value); await refreshSelected() } catch (cause: any) { actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel incluir o colaborador.' } finally { actionLoading.value = false }
}

const refreshSelected = async () => {
  const requestId = selectedRequest.value?.id
  if (!requestId) return
  await Promise.all([refreshRequests(), loadMessages(requestId, true)])
  selectedRequest.value = requests.value.find(request => request.id === requestId) || null
}

const sendMessage = async () => {
  if (!selectedRequest.value || !messageDraft.value.trim()) return
  actionLoading.value = true
  actionError.value = ''
  try {
    await session.request(`/api/platform-admin/support-requests/${encodeURIComponent(selectedRequest.value.id)}/messages`, { method: 'POST', body: { body: messageDraft.value, visibility: messageMode.value } })
    messageDraft.value = ''
    await refreshSelected()
  } catch (cause: any) {
    actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel enviar a mensagem.'
  } finally {
    actionLoading.value = false
  }
}

const applyMacro = (macroId: string) => {
  const macro = supportMacros.value.find(item => item.id === macroId)
  if (macro) messageDraft.value = macro.body
}
const selectMacro = (event: Event) => applyMacro((event.target as HTMLSelectElement).value)
const uploadAttachment = async (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !selectedRequest.value) return
  actionLoading.value = true; actionError.value = ''
  try { await uploadSupportAttachment(selectedRequest.value.id, file); await loadSupportAttachments(selectedRequest.value.id) }
  catch (cause: any) { actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel enviar o anexo.' }
  finally { actionLoading.value = false; (event.target as HTMLInputElement).value = '' }
}

const snoozeSelectedSupport = async () => {
  if (!selectedRequest.value || !snoozeUntilDraft.value || selectedRequest.value.requestKind !== 'support') return
  actionLoading.value = true; actionError.value = ''
  try { selectedRequest.value = await snoozeSupport(selectedRequest.value.id, snoozeUntilDraft.value); snoozeUntilDraft.value = '' }
  catch (cause: any) { actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel adiar o suporte.' }
  finally { actionLoading.value = false }
}

const saveSupportMetadata = async () => {
  if (!selectedRequest.value || selectedRequest.value.requestKind === 'privacy' || !canParticipate.value) return
  actionLoading.value = true; actionError.value = ''
  try {
    selectedRequest.value = await updateSupportMetadata(selectedRequest.value.id, { supportStatus: supportStatusDraft.value, tags: supportTagsDraft.value, firstResponseDueAt: firstResponseDueDraft.value, resolutionDueAt: resolutionDueDraft.value })
  } catch (cause: any) { actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel atualizar o suporte.' }
  finally { actionLoading.value = false }
}

const applyBulkOperation = async () => {
  if (!selectedBatchIds.value.length) return
  actionLoading.value = true; actionError.value = ''
  try {
    await bulkUpdateSupport(selectedBatchIds.value, bulkOperation.value, bulkOperation.value === 'status' ? bulkStatus.value : undefined)
    selectedBatchIds.value = []
  } catch (cause: any) { actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel aplicar a acao em lote.' }
  finally { actionLoading.value = false }
}

const autoAssignSelected = async () => {
  if (!selectedBatchIds.value.length) return
  const reason = window.prompt('Informe o motivo para distribuir os atendimentos selecionados.') || ''
  if (reason.trim().length < 8) return
  actionLoading.value = true; actionError.value = ''
  try {
    await autoAssignSupport(selectedBatchIds.value, reason.trim())
    selectedBatchIds.value = []
  } catch (cause: any) { actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel distribuir a fila.' }
  finally { actionLoading.value = false }
}

const applyServerFilters = async () => {
  actionLoading.value = true; actionError.value = ''
  try {
    await refreshRequests({ search: search.value.trim(), category: categoryFilter.value, assigneeId: assigneeFilter.value, tenantId: tenantFilter.value, from: fromFilter.value, to: toFilter.value, limit: String(requestPageSize), offset: String(requestPage.value * requestPageSize) })
  } catch (cause: any) { actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel aplicar os filtros.' }
  finally { actionLoading.value = false }
}
const changeRequestPage = async (delta: number) => {
  const nextPage = requestPage.value + delta
  if (nextPage < 0 || (delta > 0 && !hasNextRequestPage.value)) return
  requestPage.value = nextPage
  await applyServerFilters()
}
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { requestPage.value = 0; void applyServerFilters() }, 350)
})

const closeChat = async () => {
  if (!selectedRequest.value || !confirm(`Encerrar definitivamente o atendimento ${selectedRequest.value.id}?`)) return
  actionLoading.value = true
  actionError.value = ''
  try {
    await session.request(`/api/platform-admin/support-requests/${encodeURIComponent(selectedRequest.value.id)}/close-chat`, { method: 'POST' })
    await refreshRequests()
    await navigateTo('/solicitacoes')
  } catch (cause: any) {
    actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel encerrar o atendimento.'
  } finally {
    actionLoading.value = false
  }
}

const reopenChat = async () => {
  if (!selectedRequest.value) return
  const reason = window.prompt('Informe o motivo da reabertura do atendimento.') || ''
  if (reason.trim().length < 8) return
  actionLoading.value = true; actionError.value = ''
  try { selectedRequest.value = await reopenSupportChat(selectedRequest.value.id, reason); supportStatusDraft.value = 'reopened'; await loadMessages(selectedRequest.value.id, true) }
  catch (cause: any) { actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel reabrir o atendimento.' }
  finally { actionLoading.value = false }
}

const decideRequest = async (approved: boolean) => {
  if (!selectedRequest.value) return
  const reason = window.prompt(approved ? 'Justifique a aprovacao do acesso.' : 'Justifique a rejeicao da solicitacao.') || ''
  if (reason.trim().length < 12) return
  actionLoading.value = true
  actionError.value = ''
  try {
    await session.request(`/api/platform-admin/support-requests/${encodeURIComponent(selectedRequest.value.id)}/decision`, { method: 'POST', body: { approved, reason } })
    await refreshSelected()
  } catch (cause: any) {
    actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel registrar a decisao.'
  } finally {
    actionLoading.value = false
  }
}

const update = async () => {
  if (selectedRequest.value) return refreshSelected()
  await refreshRequests()
}

const canOpenAuditReport = computed(() => selectedRequest.value?.category === 'audit' && selectedRequest.value?.decision === 'approved' && Boolean(selectedRequest.value?.expiresAt && new Date(selectedRequest.value.expiresAt).getTime() > Date.now()))
const openAuditReport = async () => {
  const request = selectedRequest.value
  const tenant = request ? tenantFor(request.tenantId) : undefined
  if (!request || !tenant || !canOpenAuditReport.value) return
  actionLoading.value = true
  actionError.value = ''
  try {
    const events = await session.request<any[]>(`/api/platform-admin/tenants/${encodeURIComponent(tenant.id)}/audit?accessRequestId=${encodeURIComponent(request.id)}`)
    authorizedTenantAudit.value = { tenant, accessRequestId: request.id, events }
    await navigateTo('/auditoria')
  } catch (cause: any) {
    actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel abrir o relatorio autorizado.'
  } finally { actionLoading.value = false }
}

onMounted(async () => {
  if (!await load({ tenants: true, requests: true })) return
  const [assigneesResult, macrosResult] = await Promise.allSettled([loadChatAssignees(), loadSupportMacros()])
  if (assigneesResult.status === 'rejected') actionError.value = 'Nao foi possivel carregar os responsaveis do atendimento.'
  if (macrosResult.status === 'rejected') actionError.value = 'Nao foi possivel carregar as respostas prontas.'
  const protocol = typeof route.query.protocolo === 'string' ? route.query.protocolo : ''
  const initial = requests.value.find(request => request.id === protocol) || activeRequests.value[0] || requests.value[0]
  if (initial) await openChat(initial)
  refreshTimer = setInterval(() => {
    if (!actionLoading.value && selectedRequest.value && document.visibilityState === 'visible') void refreshSelected().catch((cause: any) => {
      actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel atualizar a conversa.'
    })
  }, 10000)
})
onBeforeUnmount(() => { if (refreshTimer) clearInterval(refreshTimer); if (searchTimer) clearTimeout(searchTimer) })
</script>

<template>
  <AdminShell v-model:search="search" title="Atendimentos" subtitle="Fila segura de suporte e protocolos LGPD" :request-count="activeRequests.length">
    <template #actions><button class="button button--quiet" :disabled="actionLoading" @click="update">Atualizar</button></template>
    <p v-if="error || actionError" class="feedback feedback--error">{{ actionError || error }}</p>
    <div class="request-card" style="margin:10px 0;display:flex;gap:8px;align-items:end;flex-wrap:wrap"><label>Fila<select v-model="queueFilter"><option value="open">Em aberto</option><option value="all">Todas em aberto</option><option value="unassigned">Nao atribuidas</option><option value="mine">Minhas</option><option value="collaborating">Colaborador</option><option value="waiting_customer">Aguardando cliente</option><option value="waiting_internal">Aguardando equipe</option><option value="overdue">Em atraso</option><option value="closed">Encerradas</option></select></label><label>Categoria<select v-model="categoryFilter"><option value="">Todas</option><option value="technical">Tecnico</option><option value="financial">Financeiro</option><option value="integration">Integracao</option><option value="account">Conta</option><option value="data_backup">Backup</option><option value="privacy">Privacidade</option></select></label><label>Responsavel<select v-model="assigneeFilter"><option value="">Todos</option><option value="unassigned">Nao atribuidas</option><option v-for="admin in chatAssignees" :key="admin.id" :value="admin.id">{{ admin.name }}</option></select></label><label>Empresa<select v-model="tenantFilter"><option value="">Todas</option><option v-for="tenant in tenants" :key="tenant.id" :value="tenant.id">{{ tenant.name }}</option></select></label><label>De<input v-model="fromFilter" type="date"></label><label>Ate<input v-model="toFilter" type="date"></label><button class="button button--quiet" :disabled="actionLoading" @click="requestPage = 0; applyServerFilters()">Filtrar servidor</button><button class="button button--quiet" :disabled="actionLoading || requestPage === 0" @click="changeRequestPage(-1)">Anterior</button><span style="font-size:11px;color:var(--muted)">Pagina {{ requestPage + 1 }}</span><button class="button button--quiet" :disabled="actionLoading || !hasNextRequestPage" @click="changeRequestPage(1)">Proxima</button></div>
    <div class="request-card" style="margin:10px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label>Atendimentos em lote<select v-model="selectedBatchIds" multiple size="3" aria-label="Selecionar atendimentos"><option v-for="request in filteredRequests" :key="request.id" :value="request.id">{{ request.id }} · {{ requesterName(request) }}</option></select></label><select v-model="bulkOperation" aria-label="Acao em lote"><option value="claim">Assumir selecionados</option><option value="status">Alterar status</option></select><select v-if="bulkOperation === 'status'" v-model="bulkStatus" aria-label="Status em lote"><option value="in_progress">Em atendimento</option><option value="waiting_customer">Aguardando cliente</option><option value="waiting_internal">Aguardando equipe</option><option value="resolved">Resolvido</option><option value="reopened">Reaberto</option></select><button class="button button--quiet" :disabled="actionLoading || !selectedBatchIds.length" @click="applyBulkOperation">Aplicar</button><button class="button button--quiet" :disabled="actionLoading || !selectedBatchIds.length" @click="autoAssignSelected">Distribuir fila</button></div>
    <div class="chat-layout">
      <aside class="chat-overview"><h2>Visao geral</h2><div><span>Em atendimento</span><strong>{{ requests.filter(request => request.status !== 'pending' && isChatOpen(request.status)).length }}</strong></div><div><span>Aguardando resposta</span><strong>{{ requests.filter(request => request.status === 'pending').length }}</strong></div><div><span>Encerrados</span><strong>{{ closedRequests.length }}</strong></div></aside>
      <aside class="conversation-list"><div class="conversation-title"><h2>Conversas</h2><span>Disponiveis e minhas</span></div><button v-for="request in filteredRequests" :key="request.id" :class="{ active: selectedRequest?.id === request.id }" @click="openChat(request)"><span class="company-avatar">{{ requesterInitials(request) }}</span><div><code>{{ request.id }}</code><strong>{{ requesterName(request) }}</strong><small>{{ request.subject || request.reason }}</small><span :class="statusClass(request.requestKind === 'support' ? (request.supportStatus || request.status) : request.status)">{{ request.chatAssigneeId ? `Atribuida a ${request.chatAssigneeName || 'superadmin'}` : 'Aguardando atribuicao' }}</span></div><time>{{ formatDate(request.updatedAt || request.createdAt) }}</time></button><p v-if="!filteredRequests.length" class="empty-state">Nenhuma conversa encontrada.</p></aside>
      <section class="chat-panel"><div v-if="!selectedRequest" class="chat-empty"><span>M</span><h2>Selecione uma conversa</h2><p>Escolha um protocolo para iniciar ou revisar o atendimento.</p></div><template v-else><header class="chat-header"><span class="company-avatar">{{ requesterInitials(selectedRequest) }}</span><div><h2>{{ tenantFor(selectedRequest.tenantId)?.name || selectedRequest.tenantId }} <span>Conversa segura</span></h2><p>Solicitante: {{ requesterName(selectedRequest) }} · Protocolo: {{ selectedRequest.id }}</p></div><div class="chat-actions"><button v-if="!selectedRequest.chatAssigneeId && isChatOpen(selectedRequest.status)" class="button button--primary" :disabled="actionLoading" @click="claimSelectedChat">Assumir conversa</button><button v-if="isChatOpen(selectedRequest.status) && selectedRequest.chatAssigneeId === session.user?.id" class="button button--danger" :disabled="actionLoading" @click="closeChat">Encerrar conversa</button></div></header>
        <div class="chat-body"><div class="message-stream"><div class="day-marker">Atendimento auditado</div><article v-for="message in messages" :key="message.id" :class="['message', message.sender_type === 'superadmin' ? 'message--admin' : 'message--owner', message.visibility === 'internal' ? 'message--internal' : '']"><span class="company-avatar">{{ message.sender_type === 'superadmin' ? 'SA' : requesterInitials(selectedRequest) }}</span><div><label>{{ message.visibility === 'internal' ? 'Nota interna' : message.sender_type === 'superadmin' ? 'Superadmin' : requesterIdentity(selectedRequest) }}</label><p>{{ message.body }}</p><time>{{ formatDate(message.created_at) }}</time></div></article><p v-if="!messages.length && !conversationLoading" class="empty-state">Envie a primeira mensagem para iniciar o atendimento.</p></div><aside class="request-context"><h3>{{ selectedRequest.category === 'audit' ? 'Fluxo de acesso protegido' : 'Contexto do atendimento' }}</h3><ol><li><span>1</span><div><strong>Assunto</strong><p>{{ selectedRequest.subject || selectedRequest.reason }}</p></div></li><li><span>2</span><div><strong>{{ selectedRequest.category === 'audit' ? 'Escopo restrito' : 'Descricao' }}</strong><p>{{ selectedRequest.category === 'audit' ? `${selectedRequest.scope.entityType || 'Auditoria operacional'} ${selectedRequest.scope.entityId || ''}` : selectedRequest.reason }}</p></div></li><li><span>3</span><div><strong>{{ selectedRequest.category === 'audit' ? 'Acesso temporario' : 'Atendimento' }}</strong><p>{{ selectedRequest.category === 'audit' ? (selectedRequest.expiresAt ? `Expira em ${formatDate(selectedRequest.expiresAt)}` : selectedRequest.decision === 'rejected' ? 'Acesso rejeitado' : 'Aguardando decisao') : statusLabel(selectedRequest.supportStatus || selectedRequest.status) }}</p></div></li></ol><div class="request-card"><span>Dados da solicitacao</span><dl><dt>Protocolo</dt><dd>{{ selectedRequest.id }}</dd><dt>Usuario</dt><dd>{{ requesterName(selectedRequest) }}</dd><dt>Perfil</dt><dd>{{ selectedRequest.requesterRole || '-' }}</dd><dt>Prioridade</dt><dd>{{ selectedRequest.priority }}</dd><dt>Solicitado em</dt><dd>{{ formatDate(selectedRequest.createdAt) }}</dd><dt>Status</dt><dd>{{ statusLabel(selectedRequest.requestKind === 'support' ? (selectedRequest.supportStatus || selectedRequest.status) : selectedRequest.status) }}</dd><template v-if="selectedRequest.supportParentRequestId"><dt>Protocolo anterior</dt><dd>{{ selectedRequest.supportParentRequestId }}</dd></template><template v-if="selectedRequest.supportReopenUntil && selectedRequest.supportStatus === 'resolved'"><dt>Reabertura ate</dt><dd>{{ formatDate(selectedRequest.supportReopenUntil) }}</dd></template><template v-if="selectedRequest.decision"><dt>Decisao</dt><dd>{{ statusLabel(selectedRequest.decision) }}</dd></template><template v-if="selectedRequest.reviewReason"><dt>Justificativa</dt><dd>{{ selectedRequest.reviewReason }}</dd></template></dl><div v-if="selectedRequest.requestKind === 'support' && canParticipate" class="request-card"><span>Operacao do suporte</span><label>Status<select v-model="supportStatusDraft"><option value="new">Novo</option><option value="in_progress">Em atendimento</option><option value="waiting_customer">Aguardando cliente</option><option value="waiting_internal">Aguardando equipe</option><option value="resolved">Resolvido</option><option value="reopened">Reaberto</option></select></label><label>Tags<input v-model="supportTagsDraft" placeholder="login, integracao, urgente"></label><label>Primeira resposta<input v-model="firstResponseDueDraft" type="datetime-local"></label><label>Resolucao<input v-model="resolutionDueDraft" type="datetime-local"></label><button class="button button--quiet" style="width:100%;margin-top:8px" :disabled="actionLoading" @click="saveSupportMetadata">Salvar operacao</button></div><div v-if="selectedRequest.category === 'audit' && ['pending', 'under_review'].includes(selectedRequest.status)" class="decision-actions"><button class="button button--approve" @click="decideRequest(true)">Aprovar</button><button class="button button--quiet" @click="decideRequest(false)">Rejeitar</button></div><button v-if="canOpenAuditReport" class="button button--primary" style="width:100%;margin-top:8px" :disabled="actionLoading" @click="openAuditReport">Abrir relatorio autorizado</button></div></aside></div>
        <div v-if="selectedRequest.chatAssigneeId === session.user?.id" class="request-card" style="margin:0 14px 10px"><span>Controle de acesso</span><p style="font-size:9px;color:var(--muted)">Responsavel: {{ selectedRequest.chatAssigneeName || 'Voce' }}. Inclusoes e transferencias ficam registradas.</p><select v-model="assignmentTarget" aria-label="Superadmin destinatario"><option value="">Selecionar outro superadmin</option><option v-for="admin in chatAssignees.filter(admin => admin.id !== session.user?.id)" :key="admin.id" :value="admin.id">{{ admin.name }}</option></select><div class="decision-actions" style="margin-top:6px"><button class="button button--quiet" :disabled="actionLoading || !assignmentTarget" @click="addSelectedCollaborator">Incluir colaborador</button><button class="button button--primary" :disabled="actionLoading || !assignmentTarget" @click="transferSelectedChat">Transferir</button></div></div><form v-if="isChatOpen(selectedRequest.status) && selectedRequest.supportStatus !== 'resolved' && canParticipate" class="message-form" @submit.prevent="sendMessage"><div class="message-mode"><button type="button" :class="{ active: messageMode === 'public' }" @click="messageMode = 'public'">Resposta pública</button><button type="button" :class="{ active: messageMode === 'internal' }" @click="messageMode = 'internal'">Nota interna</button></div><textarea v-model="messageDraft" maxlength="1000" :placeholder="messageMode === 'internal' ? 'Registre uma nota para a equipe...' : 'Digite uma mensagem... '" required></textarea><button :disabled="actionLoading || !messageDraft.trim()">{{ messageMode === 'internal' ? 'Registrar nota' : 'Enviar' }}</button></form><div v-else-if="isChatOpen(selectedRequest.status)" class="chat-closed">Assuma esta conversa para responder. O historico permanece disponivel somente aos participantes autorizados.</div><div v-else class="chat-closed">Atendimento encerrado. O historico permanece disponivel para auditoria.</div></template></section>
    </div>
  </AdminShell>
<div v-if="selectedRequest?.requestKind === 'support' && selectedRequest.chatAssigneeId === session.user?.id" class="request-card" style="margin:10px 14px"><label>Resposta pronta<select @change="selectMacro"><option value="">Escolher macro...</option><option v-for="macro in supportMacros" :key="macro.id" :value="macro.id">{{ macro.name }}</option></select></label><label>Soneca ate<input v-model="snoozeUntilDraft" type="datetime-local"></label><button class="button button--quiet" :disabled="actionLoading || !snoozeUntilDraft" @click="snoozeSelectedSupport">Adiar alertas</button><button v-if="selectedRequest.status === 'closed'" class="button button--quiet" :disabled="actionLoading" @click="reopenChat">Reabrir atendimento</button></div>
<details v-if="selectedRequest" class="request-card" style="margin:10px 14px"><summary>Histórico de alterações ({{ supportHistory[selectedRequest.id]?.length || 0 }})</summary><div v-for="event in supportHistory[selectedRequest.id] || []" :key="event.id" class="activity-row"><div><strong>{{ event.summary }}</strong><small>{{ event.reason || event.context }}</small></div><time>{{ formatDate(event.createdAt) }}</time></div><p v-if="!supportHistory[selectedRequest.id]?.length" class="empty-state">Nenhuma alteração registrada.</p></details>
<details v-if="selectedRequest?.requestKind === 'support'" class="request-card" style="margin:10px 14px"><summary>Anexos ({{ supportAttachments[selectedRequest.id]?.length || 0 }})</summary><input type="file" accept="application/pdf,text/plain,text/csv,image/png,image/jpeg" @change="uploadAttachment"><button v-for="attachment in supportAttachments[selectedRequest.id] || []" :key="attachment.id" class="activity-row" type="button" @click="downloadSupportAttachment(selectedRequest.id, attachment)"><div><strong>{{ attachment.originalName }}</strong><small>{{ Math.ceil(attachment.sizeBytes / 1024) }} KB · expira {{ formatDate(attachment.expiresAt) }}</small></div></button></details>
</template>
