<script setup lang="ts">
const route = useRoute()
const auth = useAuth()
const pageKey = computed(() => route.path === '/relatorios' ? route.path : route.fullPath)
</script>

<template>
  <div v-if="!auth.ready" class="app-bootstrap" role="status" aria-live="polite">
    <div class="app-bootstrap__card">
      <AppLogo />
      <span class="app-bootstrap__spinner" aria-hidden="true" />
      <strong>Preparando o Filamind</strong>
      <small>Verificando sua sessão com segurança...</small>
    </div>
  </div>
  <NuxtLayout v-else>
    <NuxtPage :page-key="pageKey" :transition="{ name: 'page', mode: 'out-in' }" />
  </NuxtLayout>
</template>
