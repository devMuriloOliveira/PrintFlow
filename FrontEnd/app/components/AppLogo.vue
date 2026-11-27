<script setup lang="ts">
defineProps<{ logoUrl?: string; brandName?: string }>()
</script>

<template>
  <div class="brand">
    <img v-if="logoUrl" class="brand__mark brand__mark--image" :src="logoUrl" alt="Logotipo da empresa" decoding="async">
    <img v-else class="brand__mark brand__mark--image" src="/filamind-logo.png" alt="Logotipo Filamind" decoding="async">
    <span class="brand__name">{{ brandName || 'Filamind' }}</span>
  </div>
</template>
