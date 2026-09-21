<script setup lang="ts">
import NovaImpressoraPage from '~/components/impressoras/NovaImpressoraPage.vue'

definePageMeta({ layout: 'default' })
const subscriptionAccess = useSubscriptionAccess()
onMounted(() => { void subscriptionAccess.load() })
</script>

<template>
  <section v-if="subscriptionAccess.isLocked('/impressoras/nova')" class="feature-lock-screen">
    <div class="feature-lock-screen__icon"><UiIcon name="lock" :size="28" /></div>
    <h1>Impressoras são um recurso PRO</h1>
    <p>Escolha um plano para cadastrar impressoras, conectar o Agent e liberar sua fila de produção.</p>
    <NuxtLink class="btn btn--primary" :to="subscriptionAccess.upgradePath">Ver planos e desbloquear</NuxtLink>
  </section>
  <NovaImpressoraPage v-else />
</template>
