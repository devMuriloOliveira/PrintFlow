<script setup lang="ts">
const props = withDefaults(defineProps<{ values: number[]; labels?: string[]; color?: string; second?: number[]; secondColor?: string }>(), { color: '#1768f2', secondColor: '#ef4444', labels: () => [] })
const container = ref<HTMLElement | null>(null)
const width = ref(600)
const plotWidth = computed(() => Math.max(1, width.value - 64))
const labelStep = computed(() => Math.max(1, Math.ceil(props.labels.length / Math.max(2, Math.floor(plotWidth.value / 58)))))
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([entry]) => { if (entry && entry.contentRect.width > 0) width.value = entry.contentRect.width })
  if (container.value) observer.observe(container.value)
})
onBeforeUnmount(() => observer?.disconnect())
const makePoints = (values: number[]) => {
  const max = Math.max(...values) * 1.1
  const min = Math.min(...values) * .85
  const range = max - min || 1
  const steps = Math.max(values.length - 1, 1)
  return values.map((p, i) => `${32 + (i / steps) * plotWidth.value},${190 - ((p - min) / range) * 145}`).join(' ')
}
const points = computed(() => makePoints(props.values))
const points2 = computed(() => props.second ? makePoints(props.second) : '')
const pointX = (index: number) => 32 + (index / Math.max(props.values.length - 1, 1)) * plotWidth.value
</script>
<template>
  <div ref="container" class="line-chart">
    <svg :viewBox="`0 0 ${width} 230`" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Gráfico de linhas">
      <g class="chart-grid"><line v-for="y in [45,80,115,150,185]" :key="y" x1="32" :y1="y" :x2="width - 32" :y2="y" /></g>
      <polyline v-if="second" :points="points2" fill="none" :stroke="secondColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      <polyline :points="points" fill="none" :stroke="color" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      <g v-for="(p, i) in values" :key="i">
        <circle :cx="pointX(i)" :cy="Number(points.split(' ')[i].split(',')[1])" r="4" :fill="color" />
      </g>
      <g class="chart-labels">
        <template v-for="(label, i) in labels" :key="`${label}-${i}`"><text v-if="i % labelStep === 0" :x="32 + (i / Math.max(labels.length - 1, 1)) * plotWidth" y="218" text-anchor="middle">{{ label }}</text></template>
      </g>
    </svg>
  </div>
</template>
