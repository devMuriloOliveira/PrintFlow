<script setup lang="ts">
defineEmits<{ menu: [] }>()
const searchOpen = ref(false)
const notificationsOpen = ref(false)
</script>

<template>
  <header class="topbar">
    <button class="icon-btn mobile-menu" aria-label="Abrir menu" @click="$emit('menu')"><UiIcon name="menu" /></button>
    <div class="topbar-search" :class="{ 'topbar-search--open': searchOpen }">
      <UiIcon name="search" :size="18" />
      <input aria-label="Busca global" placeholder="Buscar pedidos, clientes, produtos..." @focus="searchOpen = true" @blur="searchOpen = false">
      <kbd>⌘ K</kbd>
    </div>
    <div class="topbar-actions">
      <button class="top-control top-control--date"><UiIcon name="calendar" :size="18" /><span>01/05/2024 - 31/05/2024</span><UiIcon name="down" :size="15" /></button>
      <button class="top-control top-control--company"><UiIcon name="building" :size="18" /><span>PrintFlow 3D LTDA</span><UiIcon name="down" :size="15" /></button>
      <div class="notification-wrap">
        <button class="icon-btn notification" aria-label="Notificacoes" @click="notificationsOpen = !notificationsOpen">
          <UiIcon name="bell" :size="21" /><b>3</b>
        </button>
        <Transition name="drop">
          <div v-if="notificationsOpen" class="dropdown-card notifications">
            <div class="dropdown-card__head"><strong>Notificacoes</strong><span>3 novas</span></div>
            <div class="notification-item"><i class="dot dot--orange"/><div><strong>PLA Preto com estoque baixo</strong><small>Restam apenas 180 g</small></div></div>
            <div class="notification-item"><i class="dot dot--blue"/><div><strong>Nova meta atingida</strong><small>61% da meta mensal</small></div></div>
            <div class="notification-item"><i class="dot dot--green"/><div><strong>Pedido #10845 entregue</strong><small>Ha 12 minutos</small></div></div>
          </div>
        </Transition>
      </div>
      <button class="profile-control">
        <span class="avatar">LG</span>
        <span class="profile-copy"><strong>Lucas Godoi</strong><small>Administrador</small></span>
        <UiIcon name="down" :size="14" />
      </button>
    </div>
  </header>
</template>
