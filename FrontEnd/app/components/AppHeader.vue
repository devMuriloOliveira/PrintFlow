<script setup lang="ts">
import { notificationDestination } from '~/utils/notificationDestination'
import type { OperationalNotification } from '~/composables/useOperationalNotifications'

defineEmits<{ menu: [] }>()

const { settings } = useAppData()
const workspaceName = computed(() => {
  const name = settings.value?.name || ''
  return !name || /^PrintFlow(?: 3D)?$/i.test(name.trim()) ? 'Filamind' : name
})
const notificationsOpen = ref(false)
const auth = useAuth()
const { notifications, unreadCount, refreshNotifications, markNotificationRead } = useOperationalNotifications()
const { notify } = useUi()
const clearingNotifications = ref(false)
const unreadNotifications = computed(() => notifications.value.filter(notification => !notification.readAt))
const openNotification = (notification: OperationalNotification) => {
  const destination = notificationDestination(notification.type)
  void markNotificationRead(notification.id).then((marked) => {
    if (!marked) notify('Não foi possível marcar a notificação como lida.', 'info')
  })
  if (destination) {
    notificationsOpen.value = false
    void navigateTo(destination)
  }
}
const clearNotifications = async () => {
  if (clearingNotifications.value) return
  clearingNotifications.value = true
  const ids = unreadNotifications.value.map(notification => notification.id)
  let failed = 0
  try {
    for (const id of ids) if (!(await markNotificationRead(id))) failed++
    await refreshNotifications()
    if (failed) notify('Não foi possível marcar todas as notificações como lidas. Tente novamente.', 'info')
  } finally {
    clearingNotifications.value = false
  }
}
let notificationTimer: ReturnType<typeof setInterval> | undefined

const notificationDotClass = (severity: string) => ({
  success: 'dot--green', warning: 'dot--orange', error: 'dot--red', info: 'dot--blue'
}[severity] || 'dot--blue')

const notificationTime = (value: string) => {
  const date = new Date(value)
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000))
  if (minutes < 1) return 'Agora'
  if (minutes < 60) return `Ha ${minutes} min`
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

onMounted(() => {
  const load = () => {
    if (document.visibilityState === 'visible') void refreshNotifications().catch(() => {})
    notificationTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshNotifications().catch(() => {})
    }, 30_000)
  }
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(load, { timeout: 2000 })
  else window.setTimeout(load, 900)
})

onBeforeUnmount(() => {
  if (notificationTimer) clearInterval(notificationTimer)
})

const initials = computed(() =>
  auth.user.value?.name
    .split(' ')
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'FM'
)
</script>

<template>
  <header class="topbar">
    <button class="icon-btn mobile-menu" type="button" aria-label="Abrir menu" @click="$emit('menu')">
      <UiIcon name="sidebar" :size="21" />
    </button>

    <div class="workspace-context">
      <UiIcon name="building" :size="18" />
      <div><small>Área de trabalho</small><strong>{{ workspaceName }}</strong></div>
    </div>

    <div class="topbar-actions">
      <div class="notification-wrap">
        <button
          class="icon-btn notification"
          aria-label="Notificações"
          @click="notificationsOpen = !notificationsOpen"
        >
          <UiIcon name="bell" :size="21" />
          <b v-if="unreadCount">{{ unreadCount > 9 ? '9+' : unreadCount }}</b>
        </button>

        <Transition name="drop">
          <div v-if="notificationsOpen" class="dropdown-card notifications">
            <div class="dropdown-card__head">
              <strong>Notificações</strong>
              <span>{{ unreadCount ? `${unreadCount} nova${unreadCount === 1 ? '' : 's'}` : 'Nenhuma recente' }}</span>
            </div>

            <button v-for="notification in unreadNotifications" :key="notification.id" class="notification-item" type="button" :disabled="clearingNotifications" @click="openNotification(notification)">
              <i class="dot" :class="notificationDotClass(notification.severity)" />
              <div>
                <strong>{{ notification.title }}</strong>
                <small>{{ notification.message || notificationTime(notification.createdAt) }}</small>
                <small v-if="notificationDestination(notification.type)">Abrir área →</small>
              </div>
            </button>
            <div v-if="!unreadNotifications.length" class="notification-item notification-item--empty">Nenhuma notificação não lida entre as mais recentes.</div>
            <div class="notification-actions">
              <NuxtLink to="/notificacoes" @click="notificationsOpen = false">Ver histórico</NuxtLink>
              <button v-if="unreadNotifications.length || clearingNotifications" type="button" :disabled="clearingNotifications" @click="clearNotifications">{{ clearingNotifications ? 'Limpando...' : 'Limpar exibidas' }}</button>
            </div>

            <div v-if="false" class="notification-item">
              <i class="dot dot--orange" />
              <div>
                <strong>PLA Preto com estoque baixo</strong>
                <small>Restam apenas 180 g</small>
              </div>
            </div>

            <div v-if="false" class="notification-item">
              <i class="dot dot--blue" />
              <div>
                <strong>Nova meta atingida</strong>
                <small>61% da meta mensal</small>
              </div>
            </div>

            <div v-if="false" class="notification-item">
              <i class="dot dot--green" />
              <div>
                <strong>Pedido #10845 entregue</strong>
                <small>Há 12 minutos</small>
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <NuxtLink class="profile-control" to="/perfil" aria-label="Abrir meu perfil">
        <span class="avatar">{{ initials }}</span>
        <span class="profile-copy">
          <strong>{{ auth.user.value?.name || 'Usuário' }}</strong>
          <small>Meu perfil</small>
        </span>
        <UiIcon name="chevron" :size="14" />
      </NuxtLink>
    </div>
  </header>
</template>
