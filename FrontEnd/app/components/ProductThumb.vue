<script setup lang="ts">
withDefaults(defineProps<{ type?: string; size?: number }>(), { type: 'vase', size: 44 })
</script>
<template>
  <div class="product-thumb" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg v-if="type === 'vase'" viewBox="0 0 48 48"><path d="M17 7h14l-2 7c6 5 10 13 9 21-1 7-7 10-14 10S11 42 10 35c-1-8 3-16 9-21l-2-7Z" fill="#283038"/><path d="m19 14 6 29 6-29M12 29l12 14 12-14M15 20l9 23 9-23" fill="none" stroke="#65717b" stroke-width="1.5"/></svg>
    <svg v-else-if="type === 'headphones'" viewBox="0 0 48 48"><path d="M10 28v-6a14 14 0 0 1 28 0v6" fill="none" stroke="#1f2937" stroke-width="5"/><rect x="7" y="25" width="9" height="15" rx="4" fill="#111827"/><rect x="32" y="25" width="9" height="15" rx="4" fill="#111827"/></svg>
    <svg v-else-if="type === 'dino'" viewBox="0 0 48 48"><path d="M8 34c6-3 7-9 10-18 3-7 9-8 14-5-5 3-5 6-2 8 6 4 9 5 10 12-6-3-8-2-10 3l-2 7h-5l1-7c-5 3-8 4-12 3l-2 4H5l3-7Z" fill="#22c55e"/><circle cx="29" cy="14" r="1.5" fill="#052e16"/></svg>
    <svg v-else-if="type === 'organizer'" viewBox="0 0 48 48"><path d="M9 17h30l-2 25H11L9 17Z" fill="#d97706"/><path d="M14 17V8h5v9m5 0V5h5v12m4 0V10h5v7" stroke="#374151" stroke-width="3"/><path d="M17 23v13m7-13v13m7-13v13" stroke="#fed7aa" stroke-width="2"/></svg>
    <svg v-else viewBox="0 0 48 48"><circle cx="19" cy="27" r="10" fill="none" stroke="#8b5e3c" stroke-width="5"/><path d="m26 20 12-12 3 3-4 4 3 3-4 4-3-3" fill="none" stroke="#8b5e3c" stroke-width="5" stroke-linejoin="round"/></svg>
  </div>
</template>
