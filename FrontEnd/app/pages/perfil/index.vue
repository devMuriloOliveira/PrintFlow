<script setup lang="ts">
definePageMeta({ layout: 'default' })

const auth = useAuth()
const { getStripeBilling, createStripeCheckout } = useAppData()
const { notify } = useUi()
const initials = computed(() => auth.user.value?.name.split(' ').filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'PF')
const billing = ref<Awaited<ReturnType<typeof getStripeBilling>> | null>(null)
const billingLoading = ref(false)
const checkoutLoading = ref<'monthly' | 'yearly' | ''>('')
const canManageBilling = computed(() => auth.user.value?.role === 'owner')
const subscription = computed(() => billing.value?.subscription || null)
const hasManagedSubscription = computed(() => subscription.value?.planCode !== 'free' && ['trial', 'active', 'past_due', 'grace', 'paused'].includes(subscription.value?.status || ''))
const planName = computed(() => hasManagedSubscription.value ? (subscription.value?.planName || 'PRO') : 'Grátis')
const availablePlan = computed(() => billing.value?.plans[0] || null)
const subscriptionStatus = (status = '') => ({ trial: 'Teste ativo', active: 'Assinatura ativa', past_due: 'Pagamento pendente', grace: 'Período de carência', paused: 'Pausada', cancelled: 'Encerrada', ended: 'Encerrada' }[status] || 'Plano não informado')
const periodLabel = computed(() => subscription.value?.status === 'trial' ? 'Teste termina em' : 'Próxima cobrança em')
const periodDate = computed(() => subscription.value?.currentPeriodEnd ? new Date(subscription.value.currentPeriodEnd).toLocaleDateString('pt-BR') : 'Não informado')
const currency = (value: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const annualMonthlyEquivalent = computed(() => availablePlan.value ? currency(availablePlan.value.yearly / 12) : '')
const proBenefits = ['Vendas, clientes, produtos e filamentos', 'Impressoras, Agent e fila de impressão', 'Marketplaces e relatórios avançados', 'Equipe com até 8 pessoas']
const freeBenefits = ['Dashboard em modo de consulta', 'Calculadora 3D com 1 simulação salva', 'Impressoras e Agent', 'Vendas, produtos e Marketplaces']

const startCheckout = async (billingCycle: 'monthly' | 'yearly') => {
  if (!availablePlan.value || checkoutLoading.value) return
  checkoutLoading.value = billingCycle
  try {
    const result = await createStripeCheckout({ planCode: availablePlan.value.code, billingCycle })
    window.location.assign(result.url)
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Não foi possível abrir o checkout.')
  } finally {
    checkoutLoading.value = ''
  }
}

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
      <div class="profile-billing-card__head"><span class="profile-section-card__icon"><UiIcon name="wallet" /></span><div><h2>Planos PrintFlow</h2><p>Escolha o nível ideal para a sua operação.</p></div></div>
      <div v-if="canManageBilling && hasManagedSubscription" class="profile-billing-card__details"><div><small>{{ periodLabel }}</small><strong>{{ periodDate }}</strong><span>{{ subscription?.billingCycle === 'yearly' ? 'Cobrança anual recorrente' : 'Cobrança mensal' }}</span></div><div><small>Benefícios incluídos</small><strong>PRO completo</strong><ul class="profile-plan-benefits"><li v-for="benefit in proBenefits" :key="benefit">{{ benefit }}</li></ul></div></div>
      <div v-else-if="canManageBilling && !billingLoading && !availablePlan" class="info-note"><UiIcon name="info" />Não foi possível carregar os planos agora.</div>
      <template v-if="canManageBilling && !hasManagedSubscription && availablePlan">
        <div class="profile-plans profile-plans--three">
          <article class="profile-plan-option profile-plan-option--free"><div><h3>Grátis</h3><p>Para testar a calculadora e o fluxo básico.</p></div><strong>R$ 0</strong><ul class="profile-plan-benefits"><li v-for="(benefit, index) in freeBenefits" :key="benefit" :class="{ 'profile-plan-benefits__locked': index > 1 }">{{ benefit }}</li></ul><button class="btn" type="button" disabled>Plano atual</button></article>
          <article class="profile-plan-option profile-plan-option--featured"><span>7 dias grátis</span><div><h3>PRO Mensal</h3><p>7 dias grátis com cartão. Cancele quando quiser.</p></div><strong>R$ 0 <small>nos 7 dias</small></strong><small class="profile-plan-option__charge">Depois {{ currency(availablePlan.monthly) }}/mês</small><ul class="profile-plan-benefits"><li v-for="benefit in proBenefits" :key="`monthly-${benefit}`">{{ benefit }}</li></ul><button class="btn btn--primary" type="button" :disabled="!billing?.configured || !availablePlan.monthlyEnabled || !!checkoutLoading" @click="startCheckout('monthly')">{{ checkoutLoading === 'monthly' ? 'Abrindo...' : 'Começar 7 dias grátis' }}</button></article>
          <article class="profile-plan-option"><span class="profile-plan-option__saving">Economize R$ 38,90</span><div><h3>PRO Anual</h3><p>7 dias grátis e melhor valor para quem usa todo dia.</p></div><strong>{{ currency(availablePlan.yearly) }}<small>/ano</small></strong><small class="profile-plan-option__charge">Equivale a {{ annualMonthlyEquivalent }}/mês após o período grátis.</small><ul class="profile-plan-benefits"><li v-for="benefit in proBenefits" :key="`yearly-${benefit}`">{{ benefit }}</li></ul><button class="btn" type="button" :disabled="!billing?.configured || !availablePlan.yearlyEnabled || !!checkoutLoading" @click="startCheckout('yearly')">{{ checkoutLoading === 'yearly' ? 'Abrindo...' : 'Começar 7 dias grátis' }}</button></article>
        </div>
        <div v-if="!billing?.configured" class="info-note" style="margin-top:14px"><UiIcon name="info" />Os planos estão sendo preparados. O checkout será liberado quando a cobrança estiver configurada.</div>
      </template>
      <div v-else-if="hasManagedSubscription" class="profile-billing-card__actions"><NuxtLink class="btn btn--primary" to="/configuracoes/assinatura">Gerenciar assinatura <UiIcon name="chevron" :size="14" /></NuxtLink></div>
    </section>

    <section class="profile-section-grid" aria-label="Opções do perfil"><NuxtLink v-for="section in profileSections" :key="section.to" class="profile-section-card" :class="{ 'profile-section-card--danger': section.danger }" :to="section.to"><span class="profile-section-card__icon"><UiIcon :name="section.icon" /></span><span class="profile-section-card__content"><strong>{{ section.title }}</strong><small>{{ section.description }}</small></span><UiIcon name="chevron" :size="17" /></NuxtLink></section>
  </div>
</template>
