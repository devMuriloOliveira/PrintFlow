<script setup lang="ts">
definePageMeta({ layout: 'default' })

const auth = useAuth()
const route = useRoute()
const { getMercadoPagoBilling } = useAppData()
const subscriptionAccess = useSubscriptionAccess()
const subscriptionLoading = computed(() => subscriptionAccess.loading.value)
const subscriptionError = computed(() => subscriptionAccess.error.value)
const initials = computed(() => auth.user.value?.name.split(' ').filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'PF')
const billing = ref<Awaited<ReturnType<typeof getMercadoPagoBilling>> | null>(null)
const billingLoading = ref(false)
const canManageBilling = computed(() => auth.user.value?.role === 'owner')
const subscription = computed(() => billing.value?.subscription || null)
const hasManagedSubscription = computed(() => subscription.value?.planCode !== 'free' && ['trial', 'active', 'past_due', 'grace', 'paused'].includes(subscription.value?.status || ''))
const planName = computed(() => hasManagedSubscription.value ? (subscription.value?.planName || 'PRO') : 'Grátis')
const availablePlan = computed(() => billing.value?.plans[0] || null)
const isFree = computed(() => subscriptionAccess.isFree.value)
const planNameFromAccess = computed(() => isFree.value ? 'FREE' : (subscriptionAccess.access.value?.planCode ? 'PRO' : planName.value))
const usageLabels: Record<string, string> = { clients: 'Clientes', products: 'Produtos', ordersMonthly: 'Pedidos no mês', printers: 'Impressoras manuais', filaments: 'Filamentos', goals: 'Metas' }
const planUsage = computed(() => Object.entries(subscriptionAccess.access.value?.usage || {}).map(([resource, value]) => ({ resource, label: usageLabels[resource] || resource, ...value, percent: Math.min(100, Math.round(value.used / value.limit * 100)) })))
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
  void subscriptionAccess.load()
  if (!canManageBilling.value) return
  billingLoading.value = true
  try { billing.value = await getMercadoPagoBilling() } catch { billing.value = null } finally { billingLoading.value = false }
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
      <div class="profile-plan-highlight" :class="{ 'profile-plan-highlight--active': hasManagedSubscription }"><span class="profile-plan-highlight__icon"><UiIcon name="crown" :size="30" /></span><small>Seu plano</small><strong>{{ subscriptionLoading ? 'Consultando...' : subscriptionError ? 'Indisponível' : planNameFromAccess }}</strong><span :class="['badge', { 'badge--green': hasManagedSubscription, 'badge--red': subscriptionError }]">{{ subscriptionLoading ? 'Aguarde' : subscriptionError ? 'Falha ao consultar' : (isFree ? 'Plano gratuito' : (hasManagedSubscription ? subscriptionStatus(subscription?.status) : 'Plano contratado')) }}</span><button v-if="subscriptionError && !subscriptionLoading" class="profile-plan-retry" type="button" @click="subscriptionAccess.load(true)">Tentar novamente</button></div>
    </section>

    <section class="profile-billing-card">
      <div v-if="upgradeRequested && !hasManagedSubscription" class="profile-upgrade-banner"><UiIcon name="lock" :size="18" /><div><strong>Desbloqueie mais do Filamind</strong><span>Ative automação, marketplaces, relatórios avançados e equipe no PRO.</span></div></div>
      <div class="profile-billing-card__head"><span class="profile-section-card__icon"><UiIcon name="wallet" /></span><div><h2>Planos Filamind</h2><p>FREE para operação manual; PRO mensal para conectar e automatizar a produção.</p></div></div>
      <section v-if="isFree && planUsage.length" class="plan-usage" aria-label="Uso dos limites do plano FREE">
        <div class="plan-usage__head"><div><strong>Uso do plano FREE</strong><small>Acompanhe os limites antes de cadastrar. Ao atingi-los, o cadastro correspondente é bloqueado com uma mensagem explicativa.</small></div><NuxtLink v-if="canManageBilling" class="btn" to="/perfil?upgrade=1">Conhecer PRO</NuxtLink></div>
        <div class="plan-usage__grid"><article v-for="item in planUsage" :key="item.resource" :class="{ 'plan-usage__item--warning': item.percent >= 80, 'plan-usage__item--limit': item.used >= item.limit }"><div><strong>{{ item.label }}</strong><span>{{ item.used }} de {{ item.limit }}</span></div><i><b :style="{ width: `${item.percent}%` }" /></i><small v-if="item.used >= item.limit">Limite atingido — faça upgrade para continuar.</small><small v-else-if="item.percent >= 80">Você está próximo do limite.</small></article></div>
      </section>
      <div v-if="canManageBilling && hasManagedSubscription" class="profile-billing-card__details"><div><small>{{ periodLabel }}</small><strong>{{ periodDate }}</strong><span>{{ subscription?.billingCycle === 'yearly' ? 'Cobrança anual recorrente' : 'Cobrança mensal' }}</span></div><div><small>Benefícios incluídos</small><strong>PRO completo</strong><ul class="profile-plan-benefits"><li v-for="benefit in proBenefits" :key="benefit">{{ benefit }}</li></ul></div></div>
      <div v-else-if="canManageBilling && !billingLoading && !availablePlan" class="info-note"><UiIcon name="info" />Não foi possível carregar os planos agora.</div>
      <template v-if="canManageBilling && !hasManagedSubscription && availablePlan">
        <div class="profile-plans">
          <article class="profile-plan-option profile-plan-option--free"><div><h3>FREE</h3><p>Organize sua operação manual dentro dos limites do plano.</p></div><strong>R$ 0</strong><ul class="profile-plan-benefits"><li v-for="benefit in freeBenefits" :key="benefit">{{ benefit }}</li></ul><button class="btn" type="button" disabled>Plano atual</button></article>
          <article class="profile-plan-option profile-plan-option--featured"><span>Preço de lançamento vigente</span><div><h3>PRO mensal</h3><p>Cobrança mensal recorrente pelo Mercado Pago.</p></div><strong>{{ new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(availablePlan.monthly) }}<small>/mês</small></strong><ul class="profile-plan-benefits"><li v-for="benefit in proBenefits" :key="benefit">{{ benefit }}</li></ul><NuxtLink class="btn btn--primary" to="/configuracoes/assinatura">Ver assinatura e assinar PRO</NuxtLink></article>
        </div>
        <div v-if="!billing?.configured" class="info-note" style="margin-top:14px"><UiIcon name="info" />A assinatura será liberada quando a cobrança Mercado Pago estiver configurada.</div>
      </template>
      <div v-else-if="hasManagedSubscription" class="profile-billing-card__actions"><NuxtLink class="btn btn--primary" to="/configuracoes/assinatura">Gerenciar assinatura <UiIcon name="chevron" :size="14" /></NuxtLink></div>
    </section>

    <section class="profile-section-grid" aria-label="Opções do perfil"><NuxtLink v-for="section in profileSections" :key="section.to" class="profile-section-card" :class="{ 'profile-section-card--danger': section.danger }" :to="section.to"><span class="profile-section-card__icon"><UiIcon :name="section.icon" /></span><span class="profile-section-card__content"><strong>{{ section.title }}</strong><small>{{ section.description }}</small></span><UiIcon name="chevron" :size="17" /></NuxtLink></section>
  </div>
</template>

<style scoped>
.profile-plan-retry{border:0;border-radius:5px;background:transparent;color:var(--blue);padding:3px 6px;font:inherit;font-size:10px;font-weight:700;text-decoration:underline;cursor:pointer}
.profile-plan-retry:focus-visible{outline:3px solid rgba(23,104,242,.25);outline-offset:2px}
</style>
