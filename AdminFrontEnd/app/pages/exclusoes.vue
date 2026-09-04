<script setup lang="ts">
import type { DeletionAudit } from '~/types/platform-admin'

const {
  session, requests, error, activeRequests, formatDate, load
} = usePlatformAdminWorkspace()
const search = ref('')
const deletionAudit = ref<DeletionAudit[]>([])
const actionError = ref('')

const filteredDeletionAudit = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return deletionAudit.value
  return deletionAudit.value.filter(event => `${event.requestId} ${event.eventType} ${event.summary} ${event.context || ''}`.toLowerCase().includes(term))
})

const evidenceLabel = (event: DeletionAudit) => {
  const evidence = event.evidence || {}
  if (evidence.tenantFingerprint || evidence.cnpjFingerprint || evidence.requesterFingerprint) return 'Impressoes criptograficas registradas'
  if (Object.keys(evidence).length) return 'Evidencia operacional registrada'
  return 'Sem evidencia adicional'
}

onMounted(async () => {
  if (!await load({ requests: true })) return
  try {
    deletionAudit.value = await session.request<DeletionAudit[]>('/api/platform-admin/tenant-deletions?limit=100')
  } catch (cause: any) {
    actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel carregar as exclusoes auditadas.'
  }
})
</script>

<template>
  <AdminShell v-model:search="search" title="Exclusoes auditadas" subtitle="Consulte evidencias preservadas de exclusao" :request-count="activeRequests.length">
    <p v-if="error || actionError" class="feedback feedback--error">{{ actionError || error }}</p>
    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Data</th><th>Etapa</th><th>Protocolo</th><th>Evidencia preservada</th></tr></thead><tbody><tr v-for="event in filteredDeletionAudit" :key="event.id"><td>{{ formatDate(event.createdAt) }}</td><td><strong>{{ event.summary }}</strong><small>{{ event.context }}</small></td><td><code>{{ event.requestId }}</code></td><td>{{ evidenceLabel(event) }}</td></tr><tr v-if="!filteredDeletionAudit.length"><td colspan="4" class="empty-state">Nenhuma exclusao registrada.</td></tr></tbody></table></div></section>
  </AdminShell>
</template>
