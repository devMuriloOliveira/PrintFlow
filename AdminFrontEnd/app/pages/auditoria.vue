<script setup lang="ts">
import type { PlatformAudit } from '~/types/platform-admin'

const {
  session, requests, authorizedTenantAudit, error, activeRequests, formatDate, load
} = usePlatformAdminWorkspace()
const search = ref('')
const platformAudit = ref<PlatformAudit[]>([])
const auditExportFormat = ref<'csv' | 'xlsx'>('xlsx')
const actionError = ref('')

const filteredPlatformAudit = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return platformAudit.value
  return platformAudit.value.filter(event => `${event.action} ${event.summary} ${event.context || ''} ${event.targetTenantId || ''} ${event.reason || ''}`.toLowerCase().includes(term))
})

const downloadAuditReport = () => {
  if (!authorizedTenantAudit.value) return
  const tenantId = encodeURIComponent(authorizedTenantAudit.value.tenant.id)
  const accessRequestId = encodeURIComponent(authorizedTenantAudit.value.accessRequestId)
  return session.download(`/api/platform-admin/tenants/${tenantId}/audit-export?accessRequestId=${accessRequestId}&format=${auditExportFormat.value}`, `Relatorio_Auditoria_de_Empresa.${auditExportFormat.value}`)
}

onMounted(async () => {
  if (!await load({ requests: true })) return
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
    <section v-if="authorizedTenantAudit" class="panel"><div class="panel-head"><div><h2>Eventos de {{ authorizedTenantAudit.tenant.name }}</h2><p>Acesso temporario validado</p></div><div class="inline-actions"><select v-model="auditExportFormat"><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option></select><button class="button button--primary" @click="downloadAuditReport">Exportar</button><button class="button button--quiet" @click="authorizedTenantAudit = null">Fechar</button></div></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Acao</th><th>Origem</th><th>Recurso</th></tr></thead><tbody><tr v-for="event in authorizedTenantAudit.events" :key="event.id"><td>{{ formatDate(event.createdAt) }}</td><td><strong>{{ event.summary }}</strong><small>{{ event.context }}</small><code>{{ event.action }}</code></td><td>{{ event.actorType }}</td><td>{{ event.entityType }} {{ event.entityId }}</td></tr><tr v-if="!authorizedTenantAudit.events.length"><td colspan="4" class="empty-state">Nenhum evento encontrado no escopo autorizado.</td></tr></tbody></table></div></section>
    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Data e hora</th><th>Acao</th><th>Empresa</th><th>Recurso</th><th>Motivo</th></tr></thead><tbody><tr v-for="event in filteredPlatformAudit" :key="event.id"><td>{{ formatDate(event.createdAt) }}</td><td><strong>{{ event.summary }}</strong><small>{{ event.context }}</small><code>{{ event.action }}</code></td><td>{{ event.targetTenantId || '-' }}</td><td>{{ event.targetResource }} {{ event.targetResourceId }}</td><td>{{ event.reason || '-' }}</td></tr><tr v-if="!filteredPlatformAudit.length"><td colspan="5" class="empty-state">Nenhum evento administrativo registrado.</td></tr></tbody></table></div></section>
  </AdminShell>
</template>
