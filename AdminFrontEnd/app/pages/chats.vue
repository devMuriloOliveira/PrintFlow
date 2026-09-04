<script setup lang="ts">
import type { AuditRequest, Message } from '~/types/platform-admin'

const route = useRoute()
const {
  session, requests, authorizedTenantAudit, error, activeRequests, closedRequests, tenantFor, formatDate,
  statusLabel, statusClass, isChatOpen, load, refreshRequests
} = usePlatformAdminWorkspace()
const search = ref('')
const selectedRequest = ref<AuditRequest | null>(null)
const messages = ref<Message[]>([])
const messageDraft = ref('')
const actionLoading = ref(false)
const actionError = ref('')

const filteredRequests = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return requests.value
  return requests.value.filter(request => `${request.id} ${request.subject} ${request.reason} ${request.category} ${request.requestedBy} ${tenantFor(request.tenantId)?.name || request.tenantId}`.toLowerCase().includes(term))
})

const openChat = async (request: AuditRequest) => {
  selectedRequest.value = request
  actionLoading.value = true
  actionError.value = ''
  try {
    messages.value = await session.request<Message[]>(`/api/platform-admin/support-requests/${encodeURIComponent(request.id)}/messages`)
  } catch (cause: any) {
    actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel abrir a conversa.'
  } finally {
    actionLoading.value = false
  }
}

const refreshSelected = async () => {
  await refreshRequests()
  const updated = requests.value.find(request => request.id === selectedRequest.value?.id)
  if (updated) await openChat(updated)
}

const sendMessage = async () => {
  if (!selectedRequest.value || !messageDraft.value.trim()) return
  actionLoading.value = true
  actionError.value = ''
  try {
    await session.request(`/api/platform-admin/support-requests/${encodeURIComponent(selectedRequest.value.id)}/messages`, { method: 'POST', body: { body: messageDraft.value } })
    messageDraft.value = ''
    await refreshSelected()
  } catch (cause: any) {
    actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel enviar a mensagem.'
  } finally {
    actionLoading.value = false
  }
}

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
  await refreshRequests()
  if (selectedRequest.value) await refreshSelected()
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
  const protocol = typeof route.query.protocolo === 'string' ? route.query.protocolo : ''
  const initial = requests.value.find(request => request.id === protocol) || activeRequests.value[0] || requests.value[0]
  if (initial) await openChat(initial)
})
</script>

<template>
  <AdminShell v-model:search="search" title="Chats" subtitle="Atendimento seguro entre superadmin e usuarios" :request-count="activeRequests.length">
    <template #actions><button class="button button--quiet" :disabled="actionLoading" @click="update">Atualizar</button></template>
    <p v-if="error || actionError" class="feedback feedback--error">{{ actionError || error }}</p>
    <div class="chat-layout">
      <aside class="chat-overview"><h2>Visao geral</h2><div><span>Em atendimento</span><strong>{{ requests.filter(request => request.status !== 'pending' && isChatOpen(request.status)).length }}</strong></div><div><span>Aguardando resposta</span><strong>{{ requests.filter(request => request.status === 'pending').length }}</strong></div><div><span>Encerrados</span><strong>{{ closedRequests.length }}</strong></div></aside>
      <aside class="conversation-list"><div class="conversation-title"><h2>Conversas</h2><span>Mais recentes</span></div><button v-for="request in filteredRequests" :key="request.id" :class="{ active: selectedRequest?.id === request.id }" @click="openChat(request)"><span class="company-avatar">{{ (tenantFor(request.tenantId)?.name || 'PF').slice(0, 2).toUpperCase() }}</span><div><code>{{ request.id }}</code><strong>{{ tenantFor(request.tenantId)?.name || request.tenantId }}</strong><small>{{ request.subject || request.reason }}</small><span :class="statusClass(request.status)">{{ statusLabel(request.status) }}</span></div><time>{{ formatDate(request.updatedAt || request.createdAt) }}</time></button><p v-if="!filteredRequests.length" class="empty-state">Nenhuma conversa encontrada.</p></aside>
      <section class="chat-panel"><div v-if="!selectedRequest" class="chat-empty"><span>M</span><h2>Selecione uma conversa</h2><p>Escolha um protocolo para iniciar ou revisar o atendimento.</p></div><template v-else><header class="chat-header"><span class="company-avatar">{{ (tenantFor(selectedRequest.tenantId)?.name || 'PF').slice(0, 2).toUpperCase() }}</span><div><h2>{{ tenantFor(selectedRequest.tenantId)?.name || selectedRequest.tenantId }} <span>Conversa segura</span></h2><p>Protocolo: {{ selectedRequest.id }}</p></div><div class="chat-actions"><button v-if="isChatOpen(selectedRequest.status)" class="button button--danger" :disabled="actionLoading" @click="closeChat">Encerrar conversa</button></div></header>
        <div class="chat-body"><div class="message-stream"><div class="day-marker">Atendimento auditado</div><article v-for="message in messages" :key="message.id" :class="['message', message.sender_type === 'superadmin' ? 'message--admin' : 'message--owner']"><span class="company-avatar">{{ message.sender_type === 'superadmin' ? 'SA' : 'US' }}</span><div><label>{{ message.sender_type === 'superadmin' ? 'Superadmin' : 'Solicitante' }}</label><p>{{ message.body }}</p><time>{{ formatDate(message.created_at) }}</time></div></article><p v-if="!messages.length && !actionLoading" class="empty-state">Envie a primeira mensagem para iniciar o atendimento.</p></div><aside class="request-context"><h3>{{ selectedRequest.category === 'audit' ? 'Fluxo de acesso protegido' : 'Contexto do atendimento' }}</h3><ol><li><span>1</span><div><strong>Assunto</strong><p>{{ selectedRequest.subject || selectedRequest.reason }}</p></div></li><li><span>2</span><div><strong>{{ selectedRequest.category === 'audit' ? 'Escopo restrito' : 'Descricao' }}</strong><p>{{ selectedRequest.category === 'audit' ? `${selectedRequest.scope.entityType || 'Auditoria operacional'} ${selectedRequest.scope.entityId || ''}` : selectedRequest.reason }}</p></div></li><li><span>3</span><div><strong>{{ selectedRequest.category === 'audit' ? 'Acesso temporario' : 'Atendimento' }}</strong><p>{{ selectedRequest.category === 'audit' ? (selectedRequest.expiresAt ? `Expira em ${formatDate(selectedRequest.expiresAt)}` : selectedRequest.decision === 'rejected' ? 'Acesso rejeitado' : 'Aguardando decisao') : statusLabel(selectedRequest.status) }}</p></div></li></ol><div class="request-card"><span>Dados da solicitacao</span><dl><dt>Protocolo</dt><dd>{{ selectedRequest.id }}</dd><dt>Usuario</dt><dd>{{ selectedRequest.requestedBy }}</dd><dt>Perfil</dt><dd>{{ selectedRequest.requesterRole || '-' }}</dd><dt>Prioridade</dt><dd>{{ selectedRequest.priority }}</dd><dt>Solicitado em</dt><dd>{{ formatDate(selectedRequest.createdAt) }}</dd><dt>Status</dt><dd>{{ statusLabel(selectedRequest.status) }}</dd><template v-if="selectedRequest.decision"><dt>Decisao</dt><dd>{{ statusLabel(selectedRequest.decision) }}</dd></template><template v-if="selectedRequest.reviewReason"><dt>Justificativa</dt><dd>{{ selectedRequest.reviewReason }}</dd></template></dl><div v-if="selectedRequest.category === 'audit' && ['pending', 'under_review'].includes(selectedRequest.status)" class="decision-actions"><button class="button button--approve" @click="decideRequest(true)">Aprovar</button><button class="button button--quiet" @click="decideRequest(false)">Rejeitar</button></div><button v-if="canOpenAuditReport" class="button button--primary" style="width:100%;margin-top:8px" :disabled="actionLoading" @click="openAuditReport">Abrir relatorio autorizado</button></div></aside></div>
        <form v-if="isChatOpen(selectedRequest.status)" class="message-form" @submit.prevent="sendMessage"><textarea v-model="messageDraft" maxlength="1000" placeholder="Digite uma mensagem..." required></textarea><button :disabled="actionLoading || !messageDraft.trim()">Enviar</button></form><div v-else class="chat-closed">Atendimento encerrado. O historico permanece disponivel para auditoria.</div></template></section>
    </div>
  </AdminShell>
</template>
