<script setup lang="ts">
const { notifications, unreadCount, loading, refreshNotifications, markNotificationRead } = useOperationalNotifications()

const severityClass = (severity: string) => ({
  success: 'badge--green', warning: 'badge--orange', error: 'badge--red', info: 'badge--blue'
}[severity] || 'badge--blue')

const severityLabel = (severity: string) => ({
  success: 'Concluído', warning: 'Atenção', error: 'Erro', info: 'Informação'
}[severity] || 'Informação')

const notificationTime = (value: string) => new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short'
}).format(new Date(value))

onMounted(() => { void refreshNotifications() })
</script>

<template>
  <div>
    <PageHeader title="Notificações" subtitle="Acompanhe eventos de produção, marketplaces e operação.">
      <template #actions><button class="btn" :disabled="loading" @click="refreshNotifications">{{ loading ? 'Atualizando...' : 'Atualizar' }}</button></template>
    </PageHeader>

    <PanelCard title="Central de notificações" :subtitle="unreadCount ? `${unreadCount} não lida${unreadCount === 1 ? '' : 's'}` : 'Tudo em dia'">
      <div v-if="loading && !notifications.length" class="empty-state"><div><h3>Consultando notificações</h3></div></div>
      <div v-else-if="!notifications.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="bell" /></div><h3>Nenhuma notificação operacional</h3><p>Os avisos relevantes aparecerão aqui.</p></div></div>
      <div v-else class="notification-list">
        <button v-for="notification in notifications" :key="notification.id" class="notification-row" :class="{ 'notification-row--read': notification.readAt }" @click="markNotificationRead(notification.id)">
          <span class="notification-row__icon"><UiIcon name="bell" :size="18" /></span>
          <span class="notification-row__content"><strong>{{ notification.title }}</strong><small>{{ notification.message || 'Sem detalhes adicionais.' }}</small></span>
          <span class="notification-row__meta"><span class="badge" :class="severityClass(notification.severity)">{{ severityLabel(notification.severity) }}</span><small>{{ notificationTime(notification.createdAt) }}</small></span>
        </button>
      </div>
    </PanelCard>
  </div>
</template>

<style scoped>
.notification-list { display: grid; gap: 8px; }
.notification-row { width: 100%; display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 13px; border: 1px solid #e5eaf2; border-radius: 10px; background: #fff; text-align: left; cursor: pointer; }
.notification-row:not(.notification-row--read) { border-left: 3px solid var(--blue); }.notification-row--read { opacity: .68; }
.notification-row__icon { display: grid; place-items: center; width: 38px; height: 38px; color: var(--blue); background: var(--blue-soft); border-radius: 9px; }.notification-row__content { min-width: 0; display: grid; gap: 3px; }.notification-row__content small, .notification-row__meta small { color: var(--muted); }.notification-row__meta { display: grid; justify-items: end; gap: 5px; font-size: 11px; }
@media (max-width: 640px) { .notification-row { grid-template-columns: 34px minmax(0, 1fr); }.notification-row__meta { grid-column: 2; justify-items: start; grid-auto-flow: column; justify-content: start; }.notification-row__icon { width: 34px; height: 34px; } }
</style>
