<script setup lang="ts">
const route=useRoute();const {activeRequests}=usePlatformAdminWorkspace();const auditSection=computed(()=>{const section=String(route.query.secao||'eventos');return['eventos','empresa','relatorios'].includes(section)?section:'eventos'})
</script>
<template><AdminShell title="Auditoria" subtitle="Acompanhe acessos e acoes administrativas" :request-count="activeRequests.length"><LazyAuditoriaPlatformAuditEvents v-if="auditSection==='eventos'"/><LazyAuditoriaPlatformCompanyAudit v-else-if="auditSection==='empresa'"/><LazyAuditoriaPlatformAuditReports v-else/></AdminShell></template>
