<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <NuxtLayout>
    <NuxtPage :key="route.fullPath" :page-key="route.fullPath" :transition="{ name: 'page', mode: 'out-in' }" />
  </NuxtLayout>
</template>
