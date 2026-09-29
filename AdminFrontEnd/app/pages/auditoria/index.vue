<script setup lang="ts">
const route = useRoute()
const { activeRequests } = usePlatformAdminWorkspace()
const auditSection = computed(() => {
  const section = String(route.query.secao || 'eventos')
  return ['eventos', 'empresa', 'relatorios'].includes(section) ? section : 'eventos'
})
const sections = [
  { key: 'eventos', label: 'Eventos administrativos', to: '/auditoria?secao=eventos' },
  { key: 'empresa', label: 'Acessos por empresa', to: '/auditoria?secao=empresa' },
  { key: 'relatorios', label: 'Relatórios e exportações', to: '/auditoria?secao=relatorios' }
]
</script>

<template>
  <AdminShell :title="auditSection === 'relatorios' ? 'Relatórios' : 'Auditoria'" subtitle="Consulte eventos, acessos autorizados e exportações administrativas." :request-count="activeRequests.length">
    <nav class="audit-section-nav" aria-label="Seções de auditoria">
      <NuxtLink v-for="section in sections" :key="section.key" :to="section.to" :class="{ active: auditSection === section.key }" :aria-current="auditSection === section.key ? 'page' : undefined">{{ section.label }}</NuxtLink>
    </nav>
    <LazyAuditoriaPlatformAuditEvents v-if="auditSection === 'eventos'" />
    <LazyAuditoriaPlatformCompanyAudit v-else-if="auditSection === 'empresa'" />
    <LazyAuditoriaPlatformAuditReports v-else />
  </AdminShell>
</template>
