<script setup lang="ts">
const sidebarOpen = useState('sidebar-open', () => false)
const { toast } = useUi()
</script>

<template>
  <div class="app-shell">
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
  </div>
</template>
