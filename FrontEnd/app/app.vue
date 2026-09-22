<script setup lang="ts">
const route = useRoute()
const auth = useAuth()
</script>

<template>
  <div v-if="!auth.ready" class="app-bootstrap" role="status" aria-live="polite">
    <div class="app-bootstrap__card">
      <AppLogo />
      <span class="app-bootstrap__spinner" aria-hidden="true" />
      <strong>Preparando o PrintFlow</strong>
      <small>Verificando sua sessão com segurança...</small>
    </div>
  </div>
  <NuxtLayout v-else>
    <NuxtPage :key="route.fullPath" :page-key="route.fullPath" :transition="{ name: 'page', mode: 'out-in' }" />
  </NuxtLayout>
</template>
