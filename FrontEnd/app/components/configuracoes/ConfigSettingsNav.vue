<script setup lang="ts">
type Tab = [string, string, string]
defineProps<{ tabs: Tab[]; active: string }>()
const emit = defineEmits<{ select: [value: string] }>()
</script>

<template>
  <nav class="settings-nav" aria-label="Seções de configurações">
    <button v-for="tab in tabs" :key="tab[0]" :class="{ active: active === tab[0] }" type="button" @click="emit('select', tab[0])">
      <span class="settings-nav__icon"><UiIcon :name="tab[1]" /></span>
      <span><strong>{{ tab[0] }}</strong><small>{{ tab[2] }}</small></span>
    </button>
  </nav>
</template>
