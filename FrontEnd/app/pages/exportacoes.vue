<script setup lang="ts">
const goToReports = () => navigateTo('/relatorios')
</script>
<template>
  <div>
    <PageHeader title="Exportações" subtitle="As exportações agora ficam centralizadas nos Relatórios." />
    <PanelCard title="Exportação centralizada" subtitle="Use os filtros da tela de Relatórios para gerar CSV ou XLSX com os dados filtrados.">
      <div class="summary-box">
        <strong>Evite relatórios duplicados e mantenha período, tipo e histórico no mesmo lugar.</strong>
        <button class="btn btn--primary" type="button" style="margin-top:12px" @click="goToReports">Abrir Relatórios</button>
      </div>
    </PanelCard>
  </div>
</template>
