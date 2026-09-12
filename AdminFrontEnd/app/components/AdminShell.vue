<script setup lang="ts">
defineProps<{ title: string; subtitle: string; requestCount?: number }>()
const search = defineModel<string>('search', { default: '' })
const session = useAdminSession()
const { clearWorkspace, notifications, loadNotifications, markNotificationRead } = usePlatformAdminWorkspace()
const route = useRoute()

const nav = [
  { to: '/', label: 'Central', mark: 'C' },
  { to: '/chats', label: 'Atendimentos', mark: 'A' },
  { to: '/solicitacoes', label: 'Solicitacoes LGPD', mark: 'L' },
  { to: '/empresas', label: 'Empresas', mark: 'E' },
  { to: '/auditoria', label: 'Auditoria', mark: 'G', children: [{ to: '/auditoria?secao=eventos', label: 'Eventos administrativos' }, { to: '/auditoria?secao=empresa', label: 'Acessos por empresa' }] },
  { to: '/auditoria?secao=relatorios', label: 'Relatorios', mark: 'R', children: [{ to: '/auditoria?secao=relatorios', label: 'Exportacoes' }] },
  { to: '/exclusoes', label: 'Exclusoes', mark: 'X' }
]

const isActive = (path: string) => route.path === path.split('?')[0] && (!path.includes('?') || route.fullPath === path)
const logout = async () => {
  clearWorkspace()
  await session.logout()
  await navigateTo('/login')
}
const unreadNotifications = computed(() => notifications.value.filter(notification => !notification.readAt))
onMounted(() => void loadNotifications().catch(() => {}))
</script>

<template>
  <div class="admin-app">
    <aside class="admin-sidebar">
      <NuxtLink class="admin-logo" to="/" aria-label="PrintFlow Superadmin">
        <svg viewBox="0 0 44 44" aria-hidden="true"><path d="m22 2 13 7.5v15L22 32 9 24.5v-15L22 2Z" fill="#6f4df6"/><path d="m22 17 13-7.5v15L22 32V17Z" fill="#2348d8"/><path d="M22 17 9 9.5v15L22 32V17Z" fill="#42c1f2"/><path d="m22 17 13 7.5L22 42 9 34.5l13-7.5V17Z" fill="#1768f2" opacity=".9"/><path d="m9 24.5 13 7.5v10L9 34.5v-10Z" fill="#62d2ef"/></svg>
        <span><strong>PrintFlow</strong><small>Superadmin</small></span>
      </NuxtLink>
      <nav aria-label="Navegacao principal">
        <div v-for="item in nav" :key="item.to" class="nav-group">
          <NuxtLink :to="item.to" :class="{ active: isActive(item.to) && !item.children }">
            <span class="nav-mark">{{ item.mark }}</span>{{ item.label }}
            <span v-if="item.to === '/solicitacoes' && requestCount" class="nav-count">{{ requestCount }}</span>
          </NuxtLink>
          <div v-if="item.children && (isActive(item.to) || item.children.some(child => isActive(child.to)))" class="nav-submenu">
            <NuxtLink v-for="child in item.children" :key="child.to" :to="child.to" :class="{ active: isActive(child.to) }">{{ child.label }}</NuxtLink>
          </div>
        </div>
      </nav>
      <div class="sidebar-foot"><span class="security-dot"></span><div><strong>Ambiente auditado</strong><small>Acoes monitoradas</small></div></div>
    </aside>
    <div class="admin-main">
      <header class="admin-topbar">
        <div class="top-search"><span></span><input v-model="search" placeholder="Buscar nesta pagina..."></div>
        <div class="admin-user"><details class="admin-notifications"><summary aria-label="Notificacoes de suporte">N<span v-if="unreadNotifications.length" class="nav-count">{{ unreadNotifications.length }}</span></summary><div class="notification-popover"><p v-if="!notifications.length" class="empty-state">Nenhuma notificacao.</p><button v-for="notification in notifications.slice(0, 8)" :key="notification.id" :class="{ unread: !notification.readAt }" @click="markNotificationRead(notification.id)"><strong>{{ notification.title }}</strong><small>{{ notification.message }}</small></button></div></details><span class="avatar">SA</span><div><strong>{{ session.user.value?.name || 'Superadmin' }}</strong><small>Administrador da plataforma</small></div><button class="logout" @click="logout">Sair</button></div>
      </header>
      <main class="admin-content">
        <div class="page-heading"><div><h1>{{ title }}</h1><p>{{ subtitle }}</p></div><slot name="actions" /></div>
        <slot />
      </main>
    </div>
  </div>
</template>
