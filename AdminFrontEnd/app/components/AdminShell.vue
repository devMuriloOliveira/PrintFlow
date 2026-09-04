<script setup lang="ts">
defineProps<{ title: string; subtitle: string; requestCount?: number }>()
const search = defineModel<string>('search', { default: '' })
const session = useAdminSession()
const { clearWorkspace } = usePlatformAdminWorkspace()
const route = useRoute()

const nav = [
  { to: '/', label: 'Central', mark: 'C' },
  { to: '/solicitacoes', label: 'Solicitacoes', mark: 'S' },
  { to: '/chats', label: 'Chats', mark: 'M' },
  { to: '/empresas', label: 'Empresas', mark: 'E' },
  { to: '/auditoria', label: 'Auditoria', mark: 'A' },
  { to: '/exclusoes', label: 'Exclusoes', mark: 'X' }
]

const isActive = (path: string) => route.path === path
const logout = async () => {
  clearWorkspace()
  session.clear()
  await navigateTo('/login')
}
</script>

<template>
  <div class="admin-app">
    <aside class="admin-sidebar">
      <NuxtLink class="admin-logo" to="/" aria-label="PrintFlow Superadmin">
        <svg viewBox="0 0 44 44" aria-hidden="true"><path d="m22 2 13 7.5v15L22 32 9 24.5v-15L22 2Z" fill="#6f4df6"/><path d="m22 17 13-7.5v15L22 32V17Z" fill="#2348d8"/><path d="M22 17 9 9.5v15L22 32V17Z" fill="#42c1f2"/><path d="m22 17 13 7.5L22 42 9 34.5l13-7.5V17Z" fill="#1768f2" opacity=".9"/><path d="m9 24.5 13 7.5v10L9 34.5v-10Z" fill="#62d2ef"/></svg>
        <span><strong>PrintFlow</strong><small>Superadmin</small></span>
      </NuxtLink>
      <nav>
        <NuxtLink v-for="item in nav" :key="item.to" :to="item.to" :class="{ active: isActive(item.to) }">
          <span class="nav-mark">{{ item.mark }}</span>{{ item.label }}
          <span v-if="item.to === '/solicitacoes' && requestCount" class="nav-count">{{ requestCount }}</span>
        </NuxtLink>
      </nav>
      <div class="sidebar-foot"><span class="security-dot"></span><div><strong>Ambiente auditado</strong><small>Acoes monitoradas</small></div></div>
    </aside>
    <div class="admin-main">
      <header class="admin-topbar">
        <div class="top-search"><span></span><input v-model="search" placeholder="Buscar nesta pagina..."></div>
        <div class="admin-user"><span class="avatar">SA</span><div><strong>{{ session.user.value?.name || 'Superadmin' }}</strong><small>Administrador da plataforma</small></div><button class="logout" @click="logout">Sair</button></div>
      </header>
      <main class="admin-content">
        <div class="page-heading"><div><h1>{{ title }}</h1><p>{{ subtitle }}</p></div><slot name="actions" /></div>
        <slot />
      </main>
    </div>
  </div>
</template>
