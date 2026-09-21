<script setup lang="ts">
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const route = useRoute()

const items = [
  { label: 'Dashboard', to: '/', icon: 'home' },
  { label: 'Vendas', to: '/vendas', icon: 'cart' },
  { label: 'Produtos', to: '/produtos', icon: 'box' },
  { label: 'Despesas', to: '/despesas', icon: 'receipt' },
  { label: 'Filamentos', to: '/filamentos', icon: 'spool' },
  { label: 'Impressoras', to: '/impressoras', icon: 'printer' },
  { label: 'Marketplaces', to: '/marketplaces', icon: 'store' },
  { label: 'Clientes', to: '/clientes', icon: 'users' },
  { label: 'Relatorios', to: '/relatorios', icon: 'chart' },
  { label: 'Metas', to: '/metas', icon: 'target' },
  { label: 'Exportacoes', to: '/exportacoes', icon: 'download' },
  { label: 'Calculadora 3D', to: '/calculadora-3d', icon: 'calculator' },
  { label: 'Configuracoes', to: '/configuracoes', icon: 'settings' }
]

const active = (to: string) => to === '/' ? route.path === '/' : route.path.startsWith(to)
</script>

<template>
  <div v-if="open" class="sidebar-backdrop" @click="emit('close')" />
  <aside class="sidebar" :class="{ 'sidebar--open': open }">
    <div class="sidebar__top">
      <AppLogo />
      <button class="icon-btn sidebar__close" aria-label="Fechar menu" @click="emit('close')"><UiIcon name="close" /></button>
    </div>
    <nav class="sidebar__nav">
      <NuxtLink v-for="item in items" :key="item.to" :to="item.to" class="nav-item" :class="{ 'nav-item--active': active(item.to) }" @click="emit('close')">
        <UiIcon :name="item.icon" :size="20" />
        <span>{{ item.label }}</span>
      </NuxtLink>
    </nav>
    <div class="tip-card">
      <div class="tip-card__icon"><UiIcon name="box" :size="21" /></div>
      <div>
        <strong>Dica PrintFlow</strong>
        <p>Transforme seus numeros em decisoes mais seguras.</p>
        <NuxtLink to="/calculadora-3d">Saiba mais <span>→</span></NuxtLink>
      </div>
    </div>
  </aside>
</template>
