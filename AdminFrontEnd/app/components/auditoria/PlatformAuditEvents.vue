<script setup lang="ts">
const { loadPlatformAudit, platformAuditEvents, formatDate } = usePlatformAdminWorkspace()
const search = ref('')
const events = platformAuditEvents
const error = ref('')
const loading = ref(false)
const filtered = computed(() => events.value)
let searchTimer: ReturnType<typeof setTimeout> | undefined

const loadEvents = async () => {
  loading.value = true
  try {
    events.value = await loadPlatformAudit(search.value)
    error.value = ''
  } catch (cause: any) {
    error.value = cause?.data?.error || cause?.message || 'Nao foi possivel carregar a auditoria administrativa.'
  } finally { loading.value = false }
}

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void loadEvents(), 250)
})
onMounted(() => void loadEvents())
onBeforeUnmount(() => { if (searchTimer) clearTimeout(searchTimer) })
</script>
<template><div><p v-if="error" class="feedback feedback--error">{{error}}</p><section class="audit-guide" aria-label="Tipos de auditoria"><article><strong>Eventos da plataforma</strong><span>Atividade administrativa dos superadmins.</span></article><article><strong>Escopo protegido</strong><span>Dados de empresas só aparecem com autorização aprovada.</span></article></section><section class="panel"><label class="audit-search">Filtrar eventos<input v-model="search" placeholder="Ação, recurso ou empresa"></label></section><section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Data e hora</th><th>Acao</th><th>Empresa</th><th>Recurso</th><th>Motivo</th></tr></thead><tbody><tr v-for="event in filtered" :key="event.id"><td>{{formatDate(event.createdAt)}}</td><td><strong>{{event.summary}}</strong><small>{{event.context}}</small><code>{{event.action}}</code></td><td>{{event.targetTenantId||'-'}}</td><td>{{event.targetResource}} {{event.targetResourceId}}</td><td>{{event.reason||'-'}}</td></tr><tr v-if="!filtered.length"><td colspan="5" class="empty-state">Nenhum evento administrativo registrado.</td></tr></tbody></table></div></section></div></template>
