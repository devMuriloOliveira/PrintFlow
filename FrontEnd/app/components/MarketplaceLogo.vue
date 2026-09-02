<script setup lang="ts">
const props = withDefaults(defineProps<{
  platform?: string
  name?: string
  short?: string
  size?: number
}>(), {
  platform: '',
  name: '',
  short: '',
  size: 30
})

const normalized = computed(() => {
  const value = `${props.platform} ${props.name}`.toLowerCase()
  if (value.includes('mercado') || value.includes('livre')) return 'mercado_livre'
  if (value.includes('shopee')) return 'shopee'
  if (value.includes('amazon')) return 'amazon'
  return 'custom'
})

const fallback = computed(() => (props.short || props.name || 'OT').slice(0, 2).toUpperCase())
const imageSrc = computed(() => {
  if (normalized.value === 'mercado_livre') return '/marketplaces/mercado-libre.svg'
  if (normalized.value === 'shopee') return '/marketplaces/shopee.svg'
  if (normalized.value === 'amazon') return '/marketplaces/amazon.png'
  return ''
})
const iconStyle = computed(() => ({
  width: normalized.value === 'amazon' ? `${Math.round(props.size * 1.85)}px` : `${props.size}px`,
  height: `${props.size}px`
}))
</script>

<template>
  <span class="marketplace-logo" :class="`marketplace-logo--${normalized}`" :style="iconStyle" :title="name || fallback">
    <img v-if="imageSrc" :src="imageSrc" :alt="name || fallback" loading="lazy">
    <span v-else>{{ fallback }}</span>
  </span>
</template>

<style scoped>
.marketplace-logo{display:inline-grid;place-items:center;flex:0 0 auto;border:1px solid var(--line);border-radius:8px;overflow:hidden;font-weight:800;font-size:12px;line-height:1;color:#fff;background:#fff}
.marketplace-logo img{display:block;width:100%;height:100%;object-fit:contain;padding:3px}
.marketplace-logo--amazon img{padding:5px}
.marketplace-logo--custom{border-color:#1768f2;background:#1768f2}
</style>
