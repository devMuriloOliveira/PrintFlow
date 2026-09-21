<script setup lang="ts">
definePageMeta({ layout: 'default' })

const auth = useAuth()
const route = useRoute()
const { getStripeBilling } = useAppData()
const initials = computed(() => auth.user.value?.name.split(' ').filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'PF')
const billing = ref<Awaited<ReturnType<typeof getStripeBilling>> | null>(null)
const billingLoading = ref(false)
const canManageBilling = computed(() => auth.user.value?.role === 'owner')
const subscription = computed(() => billing.value?.subscription || null)
const hasManagedSubscription = computed(() => subscription.value?.planCode !== 'free' && ['trial', 'active', 'past_due', 'grace', 'paused'].includes(subscription.value?.status || ''))
const planName = computed(() => hasManagedSubscription.value ? (subscription.value?.planName || 'PRO') : 'Grátis')
const availablePlan = computed(() => billing.value?.plans[0] || null)
const subscriptionStatus = (status = '') => ({ trial: 'Trial histórico', active: 'Assinatura ativa', past_due: 'Pagamento pendente', grace: 'Período de carência', paused: 'Pausada', cancelled: 'Encerrada', ended: 'Encerrada' }[status] || 'Plano não informado')
const periodLabel = computed(() => subscription.value?.status === 'grace' ? 'Carência termina em' : subscription.value?.status === 'trial' ? 'Período histórico termina em' : 'Próxima cobrança em')
const periodDate = computed(() => {
  const value = subscription.value?.status === 'grace' ? subscription.value?.graceEndsAt : subscription.value?.currentPeriodEnd
  return value ? new Date(value).toLocaleDateString('pt-BR') : 'Não informado'
})
const proBenefits = ['Automação com PrintFlow Agent e fila de impressão', 'Marketplaces e relatórios avançados', 'Equipe com até 8 pessoas', 'Operação sem os limites do plano FREE']
const freeBenefits = ['Clientes, produtos e pedidos manuais', '1 impressora manual e gestão de filamentos', 'Metas e operação básica dentro dos limites', 'Sem Agent, marketplaces e relatórios avançados']

const upgradeRequested = computed(() => String(route.query.upgrade || '') === '1')

onMounted(async () => {
  if (!canManageBilling.value) return
  billingLoading.value = true
  try { billing.value = await getStripeBilling() } catch { billing.value = null } finally { billingLoading.value = false }
})

const profileSections = [
  { title: 'Dados da empresa', description: 'Cadastro, contatos e preferências da empresa.', to: '/configuracoes/empresa', icon: 'building' },
  { title: 'Segurança e senha', description: 'Altere a senha, ative MFA e gerencie sessões.', to: '/configuracoes/seguranca', icon: 'shield' },
  { title: 'Privacidade e LGPD', description: 'Exporte dados e registre solicitações sobre privacidade.', to: '/configuracoes/privacidade', icon: 'shield' },
  { title: 'Ajuda e suporte', description: 'Abra e acompanhe solicitações pelo protocolo.', to: '/configuracoes/suporte', icon: 'info' },
  { title: 'Backup e exclusão', description: 'Exporte dados ou programe a exclusão da empresa.', to: '/configuracoes/backup', icon: 'download', danger: true }
]
</script>

<template>
  <div class="profile-page">
    <PageHeader title="Minha conta e assinatura" subtitle="Centralize os dados da sua conta, assinatura, segurança e solicitações." />
    <section class="profile-overview-grid">
      <div class="profile-summary"><span class="avatar profile-summary__avatar">{{ initials }}</span><div class="profile-summary__content"><h2>{{ auth.user.value?.name || 'Usuário' }}</h2><p>{{ auth.user.value?.email || 'E-mail não informado' }}</p><span class="badge">{{ auth.user.value?.role === 'owner' ? 'Owner da empresa' : 'Usuário da empresa' }}</span><button class="profile-signout" type="button" @click="auth.logout"><UiIcon name="logout" :size="15" />Sair da conta</button></div></div>
      <div class="profile-plan-highlight" :class="{ 'profile-plan-highlight--active': hasManagedSubscription }"><span class="profile-plan-highlight__icon"><UiIcon name="crown" :size="30" /></span><small>Seu plano</small><strong>{{ billingLoading ? 'Consultando...' : planName }}</strong><span :class="['badge', { 'badge--green': hasManagedSubscription }]">{{ billingLoading ? 'Aguarde' : (hasManagedSubscription ? subscriptionStatus(subscription?.status) : 'Plano gratuito') }}</span></div>
    </section>

    <section class="profile-billing-card">
      <div v-if="upgradeRequested && !hasManagedSubscription" class="profile-upgrade-banner"><UiIcon name="lock" :size="18" /><div><strong>Desbloqueie mais do PrintFlow</strong><span>Ative automação, marketplaces, relatórios avançados e equipe no PRO.</span></div></div>
      <div class="profile-billing-card__head"><span class="profile-section-card__icon"><UiIcon name="wallet" /></span><div><h2>Planos PrintFlow</h2><p>FREE para operação manual; PRO mensal para conectar e automatizar a produção.</p></div></div>
      <div v-if="canManageBilling && hasManagedSubscription" class="profile-billing-card__details"><div><small>{{ periodLabel }}</small><strong>{{ periodDate }}</strong><span>{{ subscription?.billingCycle === 'yearly' ? 'Cobrança anual recorrente' : 'Cobrança mensal' }}</span></div><div><small>Benefícios incluídos</small><strong>PRO completo</strong><ul class="profile-plan-benefits"><li v-for="benefit in proBenefits" :key="benefit">{{ benefit }}</li></ul></div></div>
      <div v-else-if="canManageBilling && !billingLoading && !availablePlan" class="info-note"><UiIcon name="info" />Não foi possível carregar os planos agora.</div>
      <template v-if="canManageBilling && !hasManagedSubscription && availablePlan">
        <div class="profile-plans">
          <article class="profile-plan-option profile-plan-option--free"><div><h3>FREE</h3><p>Organize sua operação manual dentro dos limites do plano.</p></div><strong>R$ 0</strong><ul class="profile-plan-benefits"><li v-for="benefit in freeBenefits" :key="benefit">{{ benefit }}</li></ul><button class="btn" type="button" disabled>Plano atual</button></article>
          <article class="profile-plan-option profile-plan-option--featured"><span>Preço de lançamento vigente</span><div><h3>PRO mensal</h3><p>Cobrança mensal recorrente pelo Stripe, sem fidelidade.</p></div><strong>{{ new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(availablePlan.monthly) }}<small>/mês</small></strong><ul class="profile-plan-benefits"><li v-for="benefit in proBenefits" :key="benefit">{{ benefit }}</li></ul><NuxtLink class="btn btn--primary" to="/configuracoes/assinatura">Ver assinatura e assinar PRO</NuxtLink></article>
        </div>
        <div v-if="!billing?.configured" class="info-note" style="margin-top:14px"><UiIcon name="info" />A assinatura será liberada quando a cobrança Stripe estiver configurada.</div>
      </template>
      <div v-else-if="hasManagedSubscription" class="profile-billing-card__actions"><NuxtLink class="btn btn--primary" to="/configuracoes/assinatura">Gerenciar assinatura <UiIcon name="chevron" :size="14" /></NuxtLink></div>
    </section>

    <section class="profile-section-grid" aria-label="Opções do perfil"><NuxtLink v-for="section in profileSections" :key="section.to" class="profile-section-card" :class="{ 'profile-section-card--danger': section.danger }" :to="section.to"><span class="profile-section-card__icon"><UiIcon :name="section.icon" /></span><span class="profile-section-card__content"><strong>{{ section.title }}</strong><small>{{ section.description }}</small></span><UiIcon name="chevron" :size="17" /></NuxtLink></section>
  </div>
</template>
