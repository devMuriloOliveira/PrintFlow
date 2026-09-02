<script setup lang="ts">
defineEmits<{ menu: [] }>()

const searchOpen = ref(false)
const notificationsOpen = ref(false)
const auth = useAuth()
const { notifications, unreadCount, refreshNotifications, markNotificationRead } = useOperationalNotifications()
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
  void refreshNotifications().catch(() => {})
  notificationTimer = setInterval(() => void refreshNotifications().catch(() => {}), 30_000)
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
    .toUpperCase() || 'PF'
)
</script>

<template>
  <header class="topbar">
    <button class="icon-btn mobile-menu" aria-label="Abrir menu" @click="$emit('menu')">
      <UiIcon name="menu" />
    </button>

    <div class="topbar-search" :class="{ 'topbar-search--open': searchOpen }">
      <UiIcon name="search" :size="18" />
      <input
        aria-label="Busca global"
        placeholder="Buscar pedidos, clientes, produtos..."
        @focus="searchOpen = true"
        @blur="searchOpen = false"
      >
      <kbd>Ctrl K</kbd>
    </div>

    <div class="topbar-actions">
      <button class="top-control top-control--date">
        <UiIcon name="calendar" :size="18" />
        <span>01/05/2024 - 31/05/2024</span>
        <UiIcon name="down" :size="15" />
      </button>

      <button class="top-control top-control--company">
        <UiIcon name="building" :size="18" />
        <span>PrintFlow 3D LTDA</span>
        <UiIcon name="down" :size="15" />
      </button>

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
              <span>{{ unreadCount ? `${unreadCount} nova${unreadCount === 1 ? '' : 's'}` : 'Em dia' }}</span>
            </div>

            <button v-for="notification in notifications" :key="notification.id" class="notification-item" type="button" @click="markNotificationRead(notification.id)">
              <i class="dot" :class="notificationDotClass(notification.severity)" />
              <div>
                <strong>{{ notification.title }}</strong>
                <small>{{ notification.message || notificationTime(notification.createdAt) }}</small>
              </div>
            </button>
            <div v-if="!notifications.length" class="notification-item notification-item--empty">Nenhuma notificacao operacional.</div>

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

      <button class="profile-control" @click="auth.logout">
        <span class="avatar">{{ initials }}</span>
        <span class="profile-copy">
          <strong>{{ auth.user.value?.name || 'Usuário' }}</strong>
          <small>Sair da conta</small>
        </span>
        <UiIcon name="logout" :size="14" />
      </button>
    </div>
  </header>
</template>
