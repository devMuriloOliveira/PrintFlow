<script setup lang="ts">
import type { AuditRequest, PlatformAudit } from '~/types/platform-admin'

const {
  session, requests, tenants, authorizedTenantAudit, error, activeRequests, formatDate, load
} = usePlatformAdminWorkspace()
const search = ref('')
const platformAudit = ref<PlatformAudit[]>([])
const auditExportFormat = ref<'csv' | 'xlsx'>('xlsx')
const actionError = ref('')
const selectedChatRequestId = ref('')
const selectedOperationalRequestId = ref('')
const reportLoading = ref(false)
const reportDateFrom = ref('')
const reportDateTo = ref('')

const auditRequests = computed(() => requests.value.filter(request => request.category === 'audit' && request.decision === 'approved' && Boolean(request.expiresAt && new Date(request.expiresAt).getTime() > Date.now())))
const requestLabel = (request: AuditRequest) => `${request.id} - ${request.subject}`
const reportPeriod = () => new URLSearchParams({ ...(reportDateFrom.value ? { from: reportDateFrom.value } : {}), ...(reportDateTo.value ? { to: reportDateTo.value } : {}) }).toString()

const filteredPlatformAudit = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return platformAudit.value
  return platformAudit.value.filter(event => `${event.action} ${event.summary} ${event.context || ''} ${event.targetTenantId || ''} ${event.reason || ''}`.toLowerCase().includes(term))
})

const downloadAuditReport = () => {
  if (!authorizedTenantAudit.value) return
  const tenantId = encodeURIComponent(authorizedTenantAudit.value.tenant.id)
  const accessRequestId = encodeURIComponent(authorizedTenantAudit.value.accessRequestId)
  const period = reportPeriod()
  return session.download(`/api/platform-admin/tenants/${tenantId}/audit-export?accessRequestId=${accessRequestId}&format=${auditExportFormat.value}${period ? `&${period}` : ''}`, `Relatorio_Auditoria_de_Empresa.${auditExportFormat.value}`)
}

const downloadAdministrativeReport = async () => {
  reportLoading.value = true; actionError.value = ''
  try { const period = reportPeriod(); await session.download(`/api/platform-admin/audit-export${period ? `?${period}` : ''}`, 'Relatorio_Atividades_Administrativas.csv') }
  catch (cause: any) { actionError.value = cause?.message || 'Nao foi possivel gerar o relatorio administrativo.' }
  finally { reportLoading.value = false }
}

const downloadChatReport = async () => {
  if (!selectedChatRequestId.value) return
  reportLoading.value = true; actionError.value = ''
  try { const period = reportPeriod(); await session.download(`/api/platform-admin/support-requests/${encodeURIComponent(selectedChatRequestId.value)}/report${period ? `?${period}` : ''}`, `Relatorio_Conversa_${selectedChatRequestId.value}.csv`) }
  catch (cause: any) { actionError.value = cause?.message || 'Nao foi possivel gerar o relatorio da conversa.' }
  finally { reportLoading.value = false }
}

const openOperationalAudit = async () => {
  const request = auditRequests.value.find(item => item.id === selectedOperationalRequestId.value)
  const tenant = request && tenants.value.find(item => item.id === request.tenantId)
  if (!request || !tenant) return
  reportLoading.value = true; actionError.value = ''
  try {
    const period = reportPeriod()
    const events = await session.request<any[]>(`/api/platform-admin/tenants/${encodeURIComponent(tenant.id)}/audit?accessRequestId=${encodeURIComponent(request.id)}${period ? `&${period}` : ''}`)
    authorizedTenantAudit.value = { tenant, accessRequestId: request.id, events }
  } catch (cause: any) { actionError.value = cause?.data?.error || cause?.message || 'A autorizacao para este relatorio nao esta mais valida.' }
  finally { reportLoading.value = false }
}

onMounted(async () => {
  if (!await load({ requests: true, tenants: true })) return
  try {
    platformAudit.value = await session.request<PlatformAudit[]>('/api/platform-admin/audit?limit=100')
  } catch (cause: any) {
    actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel carregar a auditoria administrativa.'
  }
})
</script>

<template>
  <AdminShell v-model:search="search" title="Auditoria" subtitle="Acompanhe acessos e acoes administrativas" :request-count="activeRequests.length">
    <p v-if="error || actionError" class="feedback feedback--error">{{ actionError || error }}</p>
    <section class="panel"><div class="panel-head"><div><h2>Gerar relatorio</h2><p>Escolha uma fonte e o periodo. Cada exportacao fica registrada na auditoria.</p></div></div><div class="inline-actions" style="justify-content:flex-start;flex-wrap:wrap"><input v-model="reportDateFrom" type="date" aria-label="Data inicial"><input v-model="reportDateTo" type="date" aria-label="Data final"><button class="button button--primary" :disabled="reportLoading" @click="downloadAdministrativeReport">Atividades administrativas</button><select v-model="selectedChatRequestId" aria-label="Protocolo da conversa"><option value="">Selecione uma conversa</option><option v-for="request in requests" :key="request.id" :value="request.id">{{ requestLabel(request) }}</option></select><button class="button button--quiet" :disabled="reportLoading || !selectedChatRequestId" @click="downloadChatReport">Historico do chat</button><select v-model="selectedOperationalRequestId" aria-label="Protocolo autorizado"><option value="">Selecione uma autorizacao aprovada</option><option v-for="request in auditRequests" :key="request.id" :value="request.id">{{ requestLabel(request) }}</option></select><button class="button button--quiet" :disabled="reportLoading || !selectedOperationalRequestId" @click="openOperationalAudit">Eventos da empresa</button></div></section>
    <section v-if="authorizedTenantAudit" class="panel"><div class="panel-head"><div><h2>Eventos de {{ authorizedTenantAudit.tenant.name }}</h2><p>Acesso temporario validado</p></div><div class="inline-actions"><select v-model="auditExportFormat"><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option></select><button class="button button--primary" @click="downloadAuditReport">Exportar</button><button class="button button--quiet" @click="authorizedTenantAudit = null">Fechar</button></div></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Acao</th><th>Origem</th><th>Recurso</th></tr></thead><tbody><tr v-for="event in authorizedTenantAudit.events" :key="event.id"><td>{{ formatDate(event.createdAt) }}</td><td><strong>{{ event.summary }}</strong><small>{{ event.context }}</small><code>{{ event.action }}</code></td><td>{{ event.actorType }}</td><td>{{ event.entityType }} {{ event.entityId }}</td></tr><tr v-if="!authorizedTenantAudit.events.length"><td colspan="4" class="empty-state">Nenhum evento encontrado no escopo autorizado.</td></tr></tbody></table></div></section>
    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Data e hora</th><th>Acao</th><th>Empresa</th><th>Recurso</th><th>Motivo</th></tr></thead><tbody><tr v-for="event in filteredPlatformAudit" :key="event.id"><td>{{ formatDate(event.createdAt) }}</td><td><strong>{{ event.summary }}</strong><small>{{ event.context }}</small><code>{{ event.action }}</code></td><td>{{ event.targetTenantId || '-' }}</td><td>{{ event.targetResource }} {{ event.targetResourceId }}</td><td>{{ event.reason || '-' }}</td></tr><tr v-if="!filteredPlatformAudit.length"><td colspan="5" class="empty-state">Nenhum evento administrativo registrado.</td></tr></tbody></table></div></section>
  </AdminShell>
</template>
