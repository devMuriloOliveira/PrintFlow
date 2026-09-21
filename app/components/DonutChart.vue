<script setup lang="ts">
const props = withDefaults(defineProps<{ segments: { label: string; value: number; color: string }[]; total: string; caption?: string }>(), { caption: 'Total' })
const background = computed(() => {
  const sum = props.segments.reduce((acc, item) => acc + item.value, 0)
  let current = 0
  const stops = props.segments.map(item => {
    const from = current
    current += item.value / sum * 100
    return `${item.color} ${from}% ${current}%`
  })
  return `conic-gradient(${stops.join(',')})`
})
</script>
<template>
  <div class="donut-wrap">
    <div class="donut" :style="{ background }"><div class="donut__hole"><small>{{ caption }}</small><strong>{{ total }}</strong></div></div>
    <div class="donut-legend">
      <div v-for="item in segments" :key="item.label" class="legend-row"><i :style="{ background: item.color }"/><span>{{ item.label }}</span><strong>{{ item.value.toLocaleString('pt-BR') }}%</strong></div>
    </div>
  </div>
</template>
