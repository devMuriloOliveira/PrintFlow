<script setup lang="ts">
defineProps<{ title: string; subtitle: string; icon?: string }>()
</script>
<template>
  <div class="page-heading">
    <div v-if="icon" class="page-heading__icon"><UiIcon :name="icon" :size="25" /></div>
    <div>
      <h1>{{ title }}</h1>
      <p>{{ subtitle }}</p>
    </div>
    <div class="page-heading__actions"><slot /></div>
  </div>
</template>
