<script setup lang="ts">
import type { AuditRequest, TenantAudit, TenantDetails } from '~/types/platform-admin'

const { session, requests, authorizedTenantAudit, load } = usePlatformAdminWorkspace()
const reportDateFrom = ref('')
const reportDateTo = ref('')
const selectedChatRequestId = ref('')
const selectedOperationalRequestId = ref('')
const approvedAuditRequests = ref<AuditRequest[]>([])
const reportLoading = ref('')
const loadingRequests = ref(true)
const error = ref('')

const invalidPeriod = computed(() => Boolean(reportDateFrom.value && reportDateTo.value && reportDateFrom.value > reportDateTo.value))
const availableApprovals = computed(() => approvedAuditRequests.value.filter(request => request.decision === 'approved' && Boolean(request.expiresAt && new Date(request.expiresAt).getTime() > Date.now())))
const label = (request: AuditRequest) => `${request.protocolNumber || request.id} · ${request.subject}`
const period = () => new URLSearchParams({
  ...(reportDateFrom.value ? { from: reportDateFrom.value } : {}),
  ...(reportDateTo.value ? { to: reportDateTo.value } : {})
}).toString()
const reportPath = (path: string) => `${path}${period() ? `?${period()}` : ''}`

const downloadAdministrativeReport = async () => {
  reportLoading.value = 'administrative'; error.value = ''
  try { await session.download(reportPath('/api/platform-admin/audit-export'), 'Relatorio_Atividades_Administrativas.csv') }
  catch (cause: any) { error.value = cause?.message || 'Não foi possível gerar o relatório administrativo.' }
  finally { reportLoading.value = '' }
}
const downloadChatReport = async () => {
  if (!selectedChatRequestId.value) return
  reportLoading.value = 'chat'; error.value = ''
  try { await session.download(reportPath(`/api/platform-admin/support-requests/${encodeURIComponent(selectedChatRequestId.value)}/report`), `Relatorio_Conversa_${selectedChatRequestId.value}.csv`) }
  catch (cause: any) { error.value = cause?.message || 'Não foi possível gerar o relatório da conversa.' }
  finally { reportLoading.value = '' }
}
const openCompanyEvents = async () => {
  const request = availableApprovals.value.find(item => item.id === selectedOperationalRequestId.value)
  if (!request) return
  reportLoading.value = 'company'; error.value = ''
  try {
    const tenant = await session.request<TenantDetails>(`/api/platform-admin/tenants/${encodeURIComponent(request.tenantId)}/details`)
    const query = period()
    const events = await session.request<TenantAudit[]>(`/api/platform-admin/tenants/${encodeURIComponent(tenant.id)}/audit?accessRequestId=${encodeURIComponent(request.id)}${query ? `&${query}` : ''}`)
    authorizedTenantAudit.value = { tenant, accessRequestId: request.id, events }
    await navigateTo('/auditoria?secao=empresa')
  } catch (cause: any) { error.value = cause?.data?.error || cause?.message || 'A autorização para este relatório não está mais válida.' }
  finally { reportLoading.value = '' }
}
onMounted(async () => {
  try {
    if (!await load({ requests: true })) return
    approvedAuditRequests.value = await session.request<AuditRequest[]>('/api/platform-admin/support-requests?category=audit&limit=200')
  } catch { error.value = 'Não foi possível carregar as autorizações de auditoria.' }
  finally { loadingRequests.value = false }
})
</script>

<template>
  <div class="audit-reports">
    <p v-if="error" class="feedback feedback--error" role="alert">{{ error }}</p>
    <section class="panel report-period">
      <div class="panel-head"><div><span class="section-kicker">FILTRO COMPARTILHADO</span><h2>Período do relatório</h2><p>Opcional. O intervalo selecionado vale para as três consultas abaixo.</p></div></div>
      <div class="report-period__inputs"><label>Data inicial<input v-model="reportDateFrom" type="date" :max="reportDateTo || undefined"></label><label>Data final<input v-model="reportDateTo" type="date" :min="reportDateFrom || undefined"></label><button class="button button--quiet" type="button" :disabled="!reportDateFrom && !reportDateTo" @click="reportDateFrom = ''; reportDateTo = ''">Limpar período</button></div>
      <p v-if="invalidPeriod" class="feedback feedback--error" role="alert">A data inicial precisa ser anterior à data final.</p>
    </section>
    <section class="report-options" aria-label="Tipos de relatório">
      <article class="panel report-option"><span class="section-kicker">PLATAFORMA</span><h2>Atividades administrativas</h2><p>Eventos realizados pelos administradores da plataforma. A exportação é registrada na auditoria.</p><div class="report-option__footer"><span>Arquivo CSV</span><button class="button button--primary" type="button" :disabled="Boolean(reportLoading) || invalidPeriod" @click="downloadAdministrativeReport">{{ reportLoading === 'administrative' ? 'Gerando...' : 'Exportar atividades' }}</button></div></article>
      <article class="panel report-option"><span class="section-kicker">SUPORTE</span><h2>Histórico de atendimento</h2><p>Mensagens e registro de um protocolo específico da fila carregada.</p><label>Protocolo<select v-model="selectedChatRequestId"><option value="">Selecione uma conversa</option><option v-for="request in requests" :key="request.id" :value="request.id">{{ label(request) }}</option></select></label><div class="report-option__footer"><span>Arquivo CSV</span><button class="button button--primary" type="button" :disabled="Boolean(reportLoading) || invalidPeriod || !selectedChatRequestId" @click="downloadChatReport">{{ reportLoading === 'chat' ? 'Gerando...' : 'Exportar conversa' }}</button></div></article>
      <article class="panel report-option"><span class="section-kicker">ACESSO PROTEGIDO</span><h2>Eventos da empresa</h2><p>Consulta disponível apenas para autorizações aprovadas e ainda válidas.</p><label>Autorização<select v-model="selectedOperationalRequestId" :disabled="loadingRequests"><option value="">{{ loadingRequests ? 'Carregando autorizações...' : 'Selecione uma autorização' }}</option><option v-for="request in availableApprovals" :key="request.id" :value="request.id">{{ label(request) }}</option></select></label><div class="report-option__footer"><span>Acesso temporário</span><button class="button button--primary" type="button" :disabled="Boolean(reportLoading) || invalidPeriod || !selectedOperationalRequestId" @click="openCompanyEvents">{{ reportLoading === 'company' ? 'Carregando...' : 'Consultar eventos' }}</button></div></article>
    </section>
  </div>
</template>
