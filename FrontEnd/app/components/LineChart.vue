<script setup lang="ts">
const props = withDefaults(defineProps<{ values: number[]; labels?: string[]; color?: string; second?: number[]; secondColor?: string }>(), { color: '#1768f2', secondColor: '#ef4444', labels: () => [] })
const makePoints = (values: number[]) => {
  const max = Math.max(...values) * 1.1
  const min = Math.min(...values) * .85
  const range = max - min || 1
  const steps = Math.max(values.length - 1, 1)
  return values.map((p, i) => `${40 + (i / steps) * 660},${190 - ((p - min) / range) * 145}`).join(' ')
}
const points = computed(() => makePoints(props.values))
const points2 = computed(() => props.second ? makePoints(props.second) : '')
const pointX = (index: number) => 40 + (index / Math.max(props.values.length - 1, 1)) * 660
</script>
<template>
  <div class="line-chart">
    <svg viewBox="0 0 740 230" preserveAspectRatio="none" role="img" aria-label="Grafico de linhas">
      <g class="chart-grid"><line v-for="y in [45,80,115,150,185]" :key="y" x1="40" :y1="y" x2="700" :y2="y" /></g>
      <polyline v-if="second" :points="points2" fill="none" :stroke="secondColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      <polyline :points="points" fill="none" :stroke="color" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      <g v-for="(p, i) in values" :key="i">
        <circle :cx="pointX(i)" :cy="Number(points.split(' ')[i].split(',')[1])" r="4" :fill="color" />
      </g>
      <g class="chart-labels">
        <text v-for="(label, i) in labels" :key="label" :x="40 + (i / Math.max(labels.length - 1, 1)) * 660" y="218" text-anchor="middle">{{ label }}</text>
      </g>
    </svg>
  </div>
</template>
