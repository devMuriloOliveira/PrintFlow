<script setup lang="ts">
const props = withDefaults(defineProps<{ points: number[]; color?: string }>(), { color: 'currentColor' })
const polyline = computed(() => {
  const max = Math.max(...props.points)
  const min = Math.min(...props.points)
  const range = max - min || 1
  return props.points.map((p, i) => `${(i / (props.points.length - 1)) * 78 + 2},${28 - ((p - min) / range) * 22}`).join(' ')
})
</script>
<template>
  <svg class="mini-line" viewBox="0 0 82 32" role="img" aria-label="Tendencia">
    <polyline :points="polyline" fill="none" :stroke="color" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
