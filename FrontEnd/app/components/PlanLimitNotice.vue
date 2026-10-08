<script setup lang="ts">
const props = defineProps<{
  resource: string
  label: string
  remainingText: string
}>()

const subscription = useSubscriptionAccess()
const usage = computed(() => subscription.access.value?.usage?.[props.resource] || null)
const percentUsed = computed(() => usage.value?.limit ? Math.min(100, Math.round(usage.value.used / usage.value.limit * 100)) : 0)
const reached = computed(() => Boolean(usage.value && usage.value.used >= usage.value.limit))
const visible = computed(() => subscription.isFree.value && percentUsed.value >= 80)

onMounted(() => { void subscription.load() })
</script>

<template>
  <section v-if="visible" class="plan-limit" :class="{ 'plan-limit--reached': reached }" :aria-label="`Uso do plano FREE para ${label}`">
    <span class="plan-limit__icon"><UiIcon :name="reached ? 'lock' : 'alert'" :size="18" /></span>
    <div class="plan-limit__copy">
      <strong>{{ reached ? `Limite de ${label} atingido` : `Você está perto do limite de ${label}` }}</strong>
      <p><b>{{ usage?.used }} de {{ usage?.limit }}</b> usados no plano FREE. {{ reached ? 'Novos cadastros estão bloqueados até liberar espaço ou mudar de plano.' : 'Você receberá um bloqueio ao atingir o limite.' }}</p>
      <small>{{ remainingText }}</small>
    </div>
    <NuxtLink class="btn btn--primary" :to="subscription.upgradePath">Conhecer o PRO</NuxtLink>
  </section>
</template>

<style scoped>
.plan-limit{display:grid;grid-template-columns:38px minmax(0,1fr) auto;align-items:center;gap:13px;margin:0 0 14px;border:1px solid #f5d58b;border-radius:11px;background:#fffaf0;padding:13px 14px}.plan-limit--reached{border-color:#f1b7b7;background:#fff7f7}.plan-limit__icon{display:grid;width:38px;height:38px;place-items:center;border-radius:10px;color:#9a6400;background:#fff0c9}.plan-limit--reached .plan-limit__icon{color:#b42318;background:#ffe5e5}.plan-limit__copy{min-width:0}.plan-limit__copy strong,.plan-limit__copy small{display:block}.plan-limit__copy strong{color:#273449;font-size:12px}.plan-limit__copy p{margin:4px 0;color:#59677d;font-size:11px;line-height:1.45}.plan-limit__copy small{color:#6d788a;font-size:10px}.plan-limit__copy b{color:inherit}.plan-limit .btn{white-space:nowrap}@media(max-width:680px){.plan-limit{grid-template-columns:38px minmax(0,1fr)}.plan-limit>.btn{grid-column:2;justify-self:start}}
</style>
