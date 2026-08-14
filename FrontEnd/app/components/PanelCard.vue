<script setup lang="ts">
withDefaults(defineProps<{ title?: string; subtitle?: string; flat?: boolean }>(), { title: '', subtitle: '', flat: false })
</script>
<template>
  <section class="panel" :class="{ 'panel--flat': flat }">
    <div v-if="title || $slots.actions" class="panel__head">
      <div><h2 v-if="title">{{ title }}</h2><p v-if="subtitle">{{ subtitle }}</p></div>
      <div class="panel__actions"><slot name="actions" /></div>
    </div>
    <div class="panel__body"><slot /></div>
  </section>
</template>
