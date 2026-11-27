<script setup lang="ts">
defineProps<{ open: boolean }>()
defineEmits<{ toggle: []; navigate: [] }>()
const route = useRouter().currentRoute
const items = [
  { label: 'Início', to: '/', icon: 'home' },
  { label: 'Vendas', to: '/vendas', icon: 'cart' },
  { label: 'Produtos', to: '/produtos', icon: 'box' }
]
const isActive = (path: string) => path === '/' ? route.value.path === '/' : route.value.path === path || route.value.path.startsWith(`${path}/`)
</script>

<template>
  <nav class="mobile-nav" aria-label="Navegação rápida">
    <NuxtLink v-for="item in items" :key="item.to" :to="item.to" class="mobile-nav__item"
      :class="{ 'mobile-nav__item--active': isActive(item.to) }" :aria-label="item.label"
      :aria-current="isActive(item.to) ? 'page' : undefined" @click="$emit('navigate')">
      <UiIcon :name="item.icon" :size="23" />
    </NuxtLink>
    <button class="mobile-nav__item" :class="{ 'mobile-nav__item--active': open || !items.some(item => isActive(item.to)) }"
      type="button" aria-label="Mais áreas" aria-controls="main-sidebar" :aria-expanded="open" @click="$emit('toggle')">
      <UiIcon name="more" :size="23" />
    </button>
  </nav>
</template>
