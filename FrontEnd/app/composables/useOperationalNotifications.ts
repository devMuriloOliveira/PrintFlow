export type OperationalNotification = {
  id: string
  type: string
  severity: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  entityType?: string
  entityId?: string
  readAt?: string | null
  createdAt: string
}

export const useOperationalNotifications = () => {
  const config = useRuntimeConfig()
  const auth = useAuth()
  const apiBase = String(config.public.apiBase || '').replace(/\/$/, '')
  const notifications = useState<OperationalNotification[]>('operational-notifications', () => [])
  const loading = useState('operational-notifications-loading', () => false)
  const { settings } = useAppData()
  const visibleNotifications = computed(() => {
    const preferences = (settings.value?.preferences || {}) as Record<string, unknown>
    return notifications.value.filter((notification) => {
      if (notification.type.startsWith('print.') || notification.type.startsWith('agent.')) return preferences.productionAlerts !== false
      if (notification.type.startsWith('marketplace.')) return preferences.marketplaceAlerts !== false
      return true
    })
  })

  const refreshNotifications = async () => {
    if (!process.client || !auth.ready.value || loading.value || !auth.authHeaders.value.Authorization) return notifications.value
    loading.value = true
    try {
      notifications.value = await $fetch<OperationalNotification[]>(`${apiBase}/api/operational-notifications?limit=25`, {
        headers: auth.authHeaders.value
      })
    } catch (error: any) {
      if (error?.status === 401 || error?.status === 403) notifications.value = []
    } finally {
      loading.value = false
    }
    return notifications.value
  }

  const markNotificationRead = async (id: string) => {
    const item = notifications.value.find((notification) => notification.id === id)
    if (!item || item.readAt) return
    const readAt = new Date().toISOString()
    item.readAt = readAt
    try {
      await $fetch(`${apiBase}/api/operational-notifications/${encodeURIComponent(id)}/read`, {
        method: 'POST', headers: auth.authHeaders.value, body: {}
      })
    } catch {
      item.readAt = null
    }
  }

  return {
    notifications: visibleNotifications,
    loading,
    unreadCount: computed(() => visibleNotifications.value.filter((item) => !item.readAt).length),
    refreshNotifications,
    markNotificationRead
  }
}
