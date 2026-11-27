<script setup lang="ts">
import MobileNav from '../components/MobileNav.vue'

const sidebarOpen = useState('sidebar-open', () => false)
const route = useRoute()
watch(() => route.fullPath, () => { sidebarOpen.value = false })
const closeMenuOnEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') sidebarOpen.value = false
}
onMounted(() => window.addEventListener('keydown', closeMenuOnEscape))
onBeforeUnmount(() => window.removeEventListener('keydown', closeMenuOnEscape))
const { toast } = useUi()
const { settings } = useAppData()
const preferences = computed(() => (settings.value?.preferences as Record<string, unknown> | undefined) || {})
const compactLayout = computed(() => Boolean(preferences.value.compactLayout))
const brandStyle = computed(() => ({
  '--blue': String(preferences.value.accentColor || '#1768f2'),
  '--blue-dark': String(preferences.value.accentColor || '#1768f2')
}))
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
    <MobileNav :open="sidebarOpen" @toggle="sidebarOpen = !sidebarOpen" @navigate="sidebarOpen = false" />
    <Transition name="toast">
      <div v-if="toast.visible" class="toast" :class="`toast--${toast.type}`">
        <UiIcon :name="toast.type === 'success' ? 'check' : 'info'" :size="18" />
        <span>{{ toast.message }}</span>
      </div>
    </Transition>
  </div>
</template>
