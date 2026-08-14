<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  value: string
  icon: string
  color?: string
  change?: string
  note?: string
  negative?: boolean
  selected?: boolean
  points?: number[]
}>(), { color: 'blue', change: '', note: '', negative: false, selected: false, points: () => [5, 10, 8, 15, 12, 18, 15, 20] })
</script>

<template>
  <article class="metric-card" :class="[`metric-card--${color}`, { 'metric-card--selected': selected }]">
    <div class="metric-card__top">
      <span class="metric-card__icon"><UiIcon :name="icon" :size="21" /></span>
      <span class="metric-card__label">{{ label }} <UiIcon name="info" :size="13" /></span>
    </div>
    <strong class="metric-card__value">{{ value }}</strong>
    <div class="metric-card__bottom">
      <div><b v-if="change" :class="{ negative }">{{ negative ? '↓' : '↑' }} {{ change }}</b><small>{{ note }}</small></div>
      <MiniLine :points="points" />
    </div>
  </article>
</template>
