<script setup lang="ts">
defineProps<{ title: string; subtitle: string; requestCount?: number; searchable?: boolean }>()
const search = defineModel<string>('search', { default: '' })
const session = useAdminSession()
const { clearWorkspace, notifications, loadNotifications, markNotificationRead } = usePlatformAdminWorkspace()
const route = useRoute()
const mobileMenuOpen = ref(false)

const nav = [
  { label: 'Visão geral', items: [{ to: '/', label: 'Central', icon: 'overview' }] },
  { label: 'Operação', items: [
    { to: '/solicitacoes', label: 'Suporte', icon: 'support' },
    { to: '/empresas', label: 'Empresas', icon: 'companies' }
  ] },
  { label: 'Governança', items: [
    { to: '/auditoria?secao=eventos', label: 'Auditoria', icon: 'audit' },
    { to: '/auditoria?secao=relatorios', label: 'Relatórios', icon: 'reports' },
    { to: '/exclusoes', label: 'Exclusões', icon: 'deletions' }
  ] }
]

const isActive = (to: string) => {
  const [path, query] = to.split('?')
  if (path === '/empresas' && route.path.startsWith('/empresas/')) return true
  if (path === '/auditoria' && query === 'secao=eventos' && route.query.secao === 'empresa') return true
  return route.path === path && (!query || route.query.secao === new URLSearchParams(query).get('secao') || (query === 'secao=eventos' && !route.query.secao))
}
const unreadNotifications = computed(() => notifications.value.filter(notification => !notification.readAt))
const initials = computed(() => String(session.user.value?.name || 'Superadmin').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase())

watch(() => route.fullPath, () => { mobileMenuOpen.value = false })
onMounted(() => void loadNotifications().catch(() => {}))

const logout = async () => {
  clearWorkspace()
  try { await session.logout() }
  finally { await navigateTo('/login') }
}
</script>

<template>
  <div class="admin-app">
    <button v-if="mobileMenuOpen" class="admin-mobile-backdrop" type="button" aria-label="Fechar menu" @click="mobileMenuOpen = false"></button>
    <aside class="admin-sidebar" :class="{ 'admin-sidebar--open': mobileMenuOpen }">
      <NuxtLink class="admin-logo" to="/" aria-label="PrintFlow Administração">
        <svg viewBox="0 0 44 44" aria-hidden="true"><path d="m22 2 13 7.5v15L22 32 9 24.5v-15L22 2Z" fill="#6f4df6"/><path d="m22 17 13-7.5v15L22 32V17Z" fill="#2348d8"/><path d="M22 17 9 9.5v15L22 32V17Z" fill="#42c1f2"/><path d="m22 17 13 7.5L22 42 9 34.5l13-7.5V17Z" fill="#1768f2" opacity=".9"/><path d="m9 24.5 13 7.5v10L9 34.5v-10Z" fill="#62d2ef"/></svg>
        <span><strong>PrintFlow</strong><small>ADMINISTRAÇÃO</small></span>
      </NuxtLink>
      <div class="admin-workspace-label"><span class="security-dot"></span> Ambiente administrativo</div>
      <nav aria-label="Navegação principal">
        <div v-for="group in nav" :key="group.label" class="nav-section">
          <span class="nav-section__title">{{ group.label }}</span>
          <NuxtLink v-for="item in group.items" :key="item.to" :to="item.to" :class="{ active: isActive(item.to) }" :aria-current="isActive(item.to) ? 'page' : undefined">
            <AdminIcon :name="item.icon" :size="19" />
            <span>{{ item.label }}</span>
            <span v-if="item.to === '/solicitacoes' && requestCount" class="nav-count" title="Solicitações carregadas nesta consulta">{{ requestCount }}</span>
          </NuxtLink>
        </div>
      </nav>
      <div class="sidebar-foot"><span class="security-dot"></span><div><strong>Área protegida</strong><small>Ações administrativas auditadas</small></div></div>
    </aside>
    <div class="admin-main">
      <header class="admin-topbar">
        <div class="admin-topbar__start">
          <button class="admin-menu-toggle" type="button" :aria-expanded="mobileMenuOpen" aria-label="Abrir navegação" @click="mobileMenuOpen = !mobileMenuOpen"><AdminIcon name="menu" :size="21" /></button>
          <label v-if="searchable" class="top-search"><AdminIcon name="search" :size="18" /><input v-model="search" :aria-label="`Buscar em ${title}`" :placeholder="`Buscar em ${title.toLowerCase()}...`"></label>
          <div v-else class="admin-topbar__context"><span>ADMINISTRAÇÃO</span><strong>{{ title }}</strong></div>
        </div>
        <div class="admin-user">
          <details class="admin-notifications"><summary aria-label="Notificações de suporte"><AdminIcon name="bell" :size="19" /><span v-if="unreadNotifications.length" class="nav-count">{{ unreadNotifications.length }}</span></summary><div class="notification-popover"><div class="notification-popover__title">Notificações</div><p v-if="!notifications.length" class="empty-state">Nenhuma notificação.</p><button v-for="notification in notifications.slice(0, 8)" :key="notification.id" type="button" :class="{ unread: !notification.readAt }" @click="markNotificationRead(notification.id)"><strong>{{ notification.title }}</strong><small>{{ notification.message }}</small></button></div></details>
          <span class="avatar">{{ initials }}</span><div class="admin-user__identity"><strong>{{ session.user.value?.name || 'Superadmin' }}</strong><small>Administrador da plataforma</small></div><button class="logout" type="button" @click="logout">Sair</button>
        </div>
      </header>
      <main class="admin-content">
        <div class="page-heading"><div><span class="page-heading__eyebrow">PRINTFLOW / {{ title.toUpperCase() }}</span><h1>{{ title }}</h1><p>{{ subtitle }}</p></div><div class="page-heading__actions"><slot name="actions" /></div></div>
        <slot />
      </main>
    </div>
  </div>
</template>
