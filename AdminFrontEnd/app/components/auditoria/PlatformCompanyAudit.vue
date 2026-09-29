<script setup lang="ts">
import type { AuditRequest, TenantAudit, TenantDetails } from '~/types/platform-admin'

const { session, authorizedTenantAudit, formatDate, load } = usePlatformAdminWorkspace()
const selected = ref('')
const loading = ref(false)
const error = ref('')
const format = ref<'csv' | 'xlsx'>('xlsx')
const auditRequests = ref<AuditRequest[]>([])
const availableApprovals = computed(() => auditRequests.value.filter(request => request.decision === 'approved' && Boolean(request.expiresAt && new Date(request.expiresAt).getTime() > Date.now())))
const label = (request: AuditRequest) => `${request.protocolNumber || request.id} · ${request.subject}`

const open = async () => {
  const request = availableApprovals.value.find(item => item.id === selected.value)
  if (!request) return
  loading.value = true; error.value = ''
  try {
    const tenant = await session.request<TenantDetails>(`/api/platform-admin/tenants/${encodeURIComponent(request.tenantId)}/details`)
    const events = await session.request<TenantAudit[]>(`/api/platform-admin/tenants/${encodeURIComponent(tenant.id)}/audit?accessRequestId=${encodeURIComponent(request.id)}`)
    authorizedTenantAudit.value = { tenant, accessRequestId: request.id, events }
  } catch (cause: any) { error.value = cause?.data?.error || cause?.message || 'Não foi possível carregar os eventos autorizados.' }
  finally { loading.value = false }
}
const exportAudit = async () => {
  if (!authorizedTenantAudit.value) return
  loading.value = true; error.value = ''
  try {
    await session.download(`/api/platform-admin/tenants/${encodeURIComponent(authorizedTenantAudit.value.tenant.id)}/audit-export?accessRequestId=${encodeURIComponent(authorizedTenantAudit.value.accessRequestId)}&format=${format.value}`, `Relatorio_Auditoria_de_Empresa.${format.value}`)
  } catch (cause: any) { error.value = cause?.data?.error || cause?.message || 'Não foi possível exportar os eventos.' }
  finally { loading.value = false }
}
onMounted(async () => {
  try { if (await load({})) auditRequests.value = await session.request<AuditRequest[]>('/api/platform-admin/support-requests?category=audit&limit=200') }
  catch (cause: any) { error.value = cause?.data?.error || cause?.message || 'Não foi possível carregar as autorizações.' }
})
</script>

<template>
  <div class="company-audit">
    <p v-if="error" class="feedback feedback--error" role="alert">{{ error }}</p>
    <section v-if="authorizedTenantAudit" class="panel table-panel">
      <div class="company-audit__heading"><div><span class="section-kicker">ACESSO TEMPORÁRIO VALIDADO</span><h2>Eventos de {{ authorizedTenantAudit.tenant.name }}</h2><p>Somente eventos liberados pelo protocolo {{ authorizedTenantAudit.accessRequestId }}.</p></div><div class="inline-actions"><select v-model="format" aria-label="Formato de exportação"><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option></select><button class="button button--primary" type="button" :disabled="loading" @click="exportAudit">{{ loading ? 'Exportando...' : 'Exportar' }}</button><button class="button button--quiet" type="button" @click="authorizedTenantAudit = null">Fechar</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Data</th><th>Ação</th><th>Origem</th><th>Recurso</th></tr></thead><tbody><tr v-for="event in authorizedTenantAudit.events" :key="event.id"><td>{{ formatDate(event.createdAt) }}</td><td><strong>{{ event.summary }}</strong><small>{{ event.context }}</small><code>{{ event.action }}</code></td><td>{{ event.actorType }}</td><td>{{ event.entityType }} {{ event.entityId }}</td></tr><tr v-if="!authorizedTenantAudit.events.length"><td colspan="4" class="empty-state">Nenhum evento encontrado no escopo autorizado.</td></tr></tbody></table></div>
    </section>
    <section v-else class="panel company-audit__empty"><span class="section-kicker">ACESSO PROTEGIDO</span><h2>Consultar eventos de uma empresa</h2><p>Selecione um protocolo aprovado e válido. A consulta é auditada e respeita o período de autorização.</p><div class="inline-actions"><select v-model="selected" aria-label="Protocolo autorizado"><option value="">Selecione uma autorização aprovada</option><option v-for="request in availableApprovals" :key="request.id" :value="request.id">{{ label(request) }}</option></select><button class="button button--primary" type="button" :disabled="loading || !selected" @click="open">{{ loading ? 'Carregando...' : 'Carregar eventos' }}</button></div><p v-if="!availableApprovals.length" class="company-audit__note">Nenhuma autorização válida disponível nesta consulta.</p></section>
  </div>
</template>
