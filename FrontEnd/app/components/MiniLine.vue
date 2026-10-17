<script setup lang="ts">
const props = withDefaults(defineProps<{ points: number[]; color?: string }>(), { color: 'currentColor' })
const polyline = computed(() => {
  const points = props.points.map(Number).filter(Number.isFinite)
  if (!points.length) return ''
  const max = Math.max(...points)
  const min = Math.min(...points)
  const range = max - min || 1
  if (points.length === 1) return `2,28 80,28`
  const denominator = Math.max(points.length - 1, 1)
  return points.map((p, i) => `${(i / denominator) * 78 + 2},${28 - ((p - min) / range) * 22}`).join(' ')
})
</script>
<template>
  <svg class="mini-line" viewBox="0 0 82 32" role="img" aria-label="Tendencia">
    <polyline :points="polyline" fill="none" :stroke="color" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
