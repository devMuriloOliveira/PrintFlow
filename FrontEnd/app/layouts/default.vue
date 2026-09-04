<script setup lang="ts">
const sidebarOpen = useState('sidebar-open', () => false)
const { toast } = useUi()
const { settings } = useAppData()
const auth = useAuth()
const { activeRequest, refresh: refreshSupport } = useSupportRequests()
const preferences = computed(() => (settings.value?.preferences as Record<string, unknown> | undefined) || {})
const compactLayout = computed(() => Boolean(preferences.value.compactLayout))
const brandStyle = computed(() => ({
  '--blue': String(preferences.value.accentColor || '#1768f2'),
  '--blue-dark': String(preferences.value.accentColor || '#1768f2')
}))
onMounted(() => { if (auth.isAuthenticated.value) void refreshSupport().catch(() => {}) })
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--compact': compactLayout }" :style="brandStyle">
    <AppSidebar :open="sidebarOpen" @close="sidebarOpen = false" />
    <div class="app-body">
      <AppHeader @menu="sidebarOpen = true" />
      <main class="page-shell">
        <slot />
      </main>
    </div>
    <Transition name="toast">
      <div v-if="toast.visible" class="toast" :class="`toast--${toast.type}`">
        <UiIcon :name="toast.type === 'success' ? 'check' : 'info'" :size="18" />
        <span>{{ toast.message }}</span>
      </div>
    </Transition>
    <SupportRequestChat v-if="activeRequest" :request-id="activeRequest.id" :status="activeRequest.status" />
  </div>
</template>
