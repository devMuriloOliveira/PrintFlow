<script setup lang="ts">
const route = useRoute()
const { tenantDetails, tenantUsers, tenantSubscriptionEvents, tenantBillingRecords, platformPlans, loadTenantDetails, loadTenantUsers, loadTenantSubscriptionEvents, loadTenantBillingRecords, loadPlatformPlans, updateTenantSubscription, createTenantBillingRecord, statusLabel, statusClass, formatDate } = usePlatformAdminWorkspace()
const loading = ref(true)
const tabLoading = ref(false)
const error = ref('')
const activeTab = ref<'overview' | 'subscription' | 'users' | 'history'>('overview')
const tenantId = computed(() => String(route.params.id || ''))
const saving = ref(false)
const form = reactive({ status: 'active', billingCycle: 'manual', planId: '', currentPeriodEnd: '', trialEndsAt: '', graceEndsAt: '', notes: '', reason: '' })
const billing = reactive({ amount: '', reference: '', dueAt: '', status: 'pending', reason: '' })
const selectedPlan = computed(() => platformPlans.value.find(plan => plan.id === (tenantDetails.value?.subscription?.planId || form.planId)))
const roleLabel = (role: string) => ({ owner: 'Proprietario', admin: 'Administrador', operator: 'Operador', financial: 'Financeiro', production: 'Producao', platform_super_admin: 'Superadmin' }[role] || role)
const userRoleSummary = computed(() => {
  const groups = new Map<string, number>()
  for (const user of tenantUsers.value) groups.set(user.role, (groups.get(user.role) || 0) + 1)
  return [...groups.entries()].map(([role, count]) => ({ role, count }))
})
const saveSubscription = async () => { saving.value = true; try { await updateTenantSubscription(tenantId.value, { ...form }); form.reason = '' } catch (cause: any) { error.value = cause?.data?.error || cause?.message || 'Nao foi possivel salvar a assinatura.' } finally { saving.value = false } }
const saveBilling = async () => { saving.value = true; try { await createTenantBillingRecord(tenantId.value, { ...billing, amount: Number(billing.amount) }); billing.amount = ''; billing.reference = ''; billing.reason = '' } catch (cause: any) { error.value = cause?.data?.error || cause?.message || 'Nao foi possivel registrar a cobranca.' } finally { saving.value = false } }
const usageRows = computed(() => {
  const usage = tenantDetails.value?.usage
  if (!usage) return []
  const limits = selectedPlan.value?.limits || {}
  return [
    { label: 'Usuarios ativos', value: usage.activeUsers, total: Number(limits.users || 0) },
    { label: 'Agents', value: usage.agents, total: Number(limits.agents || 0) },
    { label: 'Impressoras', value: usage.printers, total: Number(limits.printers || 0) },
    { label: 'Produtos', value: usage.products, total: Number(limits.products || 0) }
  ]
})
const load = async () => {
  loading.value = true; error.value = ''
  try {
    await Promise.all([loadTenantDetails(tenantId.value), loadPlatformPlans()])
    if (tenantDetails.value?.subscription) Object.assign(form, { status: tenantDetails.value.subscription.status, billingCycle: tenantDetails.value.subscription.billingCycle, planId: tenantDetails.value.subscription.planId || '', currentPeriodEnd: tenantDetails.value.subscription.currentPeriodEnd?.slice(0, 16) || '', trialEndsAt: tenantDetails.value.subscription.trialEndsAt?.slice(0, 16) || '', graceEndsAt: tenantDetails.value.subscription.graceEndsAt?.slice(0, 16) || '', notes: tenantDetails.value.subscription.notes || '' })
  } catch (cause: any) { error.value = cause?.data?.error || cause?.message || 'Nao foi possivel carregar a empresa.' }
  finally { loading.value = false }
}
const loadTabData = async (tab: string) => {
  if (loading.value || tabLoading.value) return
  const jobs: Promise<unknown>[] = []
  if (tab === 'users' && !tenantUsers.value.length) jobs.push(loadTenantUsers(tenantId.value))
  if (tab === 'history' && !tenantSubscriptionEvents.value.length) jobs.push(loadTenantSubscriptionEvents(tenantId.value))
  if (tab === 'subscription' && !tenantBillingRecords.value.length) jobs.push(loadTenantBillingRecords(tenantId.value))
  if (!jobs.length) return
  tabLoading.value = true
  try { await Promise.all(jobs) } catch (cause: any) { error.value = cause?.data?.error || cause?.message || 'Nao foi possivel carregar esta aba.' } finally { tabLoading.value = false }
}
watch(activeTab, (tab) => { void loadTabData(tab) })
onMounted(load)
</script>

<template>
  <AdminShell title="Detalhes da empresa" subtitle="Assinatura, uso, usuarios e historico administrativo">
    <template #actions><NuxtLink class="button button--quiet" to="/empresas">Voltar para empresas</NuxtLink></template>
    <p v-if="error" class="feedback feedback--error">{{ error }}</p>
    <div v-if="loading" class="empty-state">Carregando dados da empresa...</div>
    <template v-else-if="tenantDetails">
      <section class="tenant-detail-head"><div><span class="section-kicker">Empresa</span><h2>{{ tenantDetails.name }}</h2><p>{{ tenantDetails.cnpj }} · {{ tenantDetails.id }}</p></div><div class="tenant-detail-head__status"><span :class="statusClass(tenantDetails.accountStatus)">{{ statusLabel(tenantDetails.accountStatus) }}</span><span :class="statusClass(tenantDetails.subscription?.status || 'not_configured')">{{ statusLabel(tenantDetails.subscription?.status || 'not_configured') }}</span></div></section>
      <section class="detail-metrics"><article><span>Plano</span><strong>{{ tenantDetails.subscription?.planName || 'Sem plano' }}</strong><small>{{ tenantDetails.subscription?.billingCycle || 'manual' }}</small></article><article><span>Cobranca</span><strong>{{ statusLabel(tenantDetails.billingStatus) }}</strong><small>Vencimento {{ formatDate(tenantDetails.billingDueAt) }}</small></article><article><span>Periodo atual</span><strong>{{ formatDate(tenantDetails.subscription?.currentPeriodEnd) }}</strong><small>Proxima referencia</small></article><article><span>Uso total</span><strong>{{ tenantDetails.usage.orders }}</strong><small>pedidos registrados</small></article></section>
      <nav class="detail-tabs" aria-label="Detalhes da empresa"><button :class="{ active: activeTab === 'overview' }" @click="activeTab = 'overview'">Visao geral</button><button :class="{ active: activeTab === 'subscription' }" @click="activeTab = 'subscription'">Assinatura</button><button :class="{ active: activeTab === 'users' }" @click="activeTab = 'users'">Usuarios <span>{{ tenantUsers.length }}</span></button><button :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'">Historico <span>{{ tenantSubscriptionEvents.length }}</span></button></nav>
      <p v-if="tabLoading" class="feedback">Carregando dados desta aba...</p>
      <section v-if="activeTab === 'overview'" class="detail-grid"><article class="panel"><div class="panel-head"><div><h2>Uso da empresa</h2><p>Consumo comparado aos limites do plano atual.</p></div></div><div class="usage-list"><div v-for="item in usageRows" :key="item.label"><div><span>{{ item.label }}</span><strong>{{ item.value }}<small v-if="item.total"> / {{ item.total }}</small><small v-else> / sem limite</small></strong></div><div class="usage-track"><span :style="{ width: `${item.total ? Math.min(100, item.value / item.total * 100) : 0}%` }" /></div></div></div></article><article class="panel"><div class="panel-head"><div><h2>Dados principais</h2><p>Informacoes operacionais minimizadas para a administracao.</p></div></div><dl class="detail-list"><dt>Identificador</dt><dd>{{ tenantDetails.id }}</dd><dt>Plano</dt><dd>{{ tenantDetails.subscription?.planName || 'Sem plano' }}</dd><dt>Criada em</dt><dd>{{ formatDate(tenantDetails.createdAt) }}</dd><dt>Impressoras</dt><dd>{{ tenantDetails.printers }}</dd><dt>Agents online</dt><dd>{{ tenantDetails.onlineAgents }} / {{ tenantDetails.agents }}</dd></dl></article></section>
      <section v-else-if="activeTab === 'subscription'" class="detail-grid"><article class="panel"><div class="panel-head"><div><h2>Assinatura interna</h2><p>Controle administrativo sem provedor de pagamento.</p></div></div><div class="form-grid"><label>Status<select v-model="form.status"><option v-for="value in ['trial','active','past_due','grace','paused','courtesy','cancelled','ended']" :key="value" :value="value">{{ statusLabel(value) }}</option></select></label><label>Plano<select v-model="form.planId"><option value="">Sem plano</option><option v-for="plan in platformPlans" :key="plan.id" :value="plan.id">{{ plan.name }}</option></select></label><label>Ciclo<select v-model="form.billingCycle"><option value="manual">Manual</option><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></label><label>Fim do periodo<input v-model="form.currentPeriodEnd" type="datetime-local"></label><label>Fim do teste<input v-model="form.trialEndsAt" type="datetime-local"></label><label>Fim da carencia<input v-model="form.graceEndsAt" type="datetime-local"></label><label class="form-grid__wide">Observacoes<textarea v-model="form.notes" rows="2" /></label><label class="form-grid__wide">Motivo da alteracao (obrigatorio)<textarea v-model="form.reason" rows="2" minlength="8" required /></label></div><button class="button" :disabled="saving || form.reason.length < 8" @click="saveSubscription">{{ saving ? 'Salvando...' : 'Salvar assinatura' }}</button></article><article class="panel"><div class="panel-head"><div><h2>Historico de cobrancas</h2><p>Registros manuais, preparados para futura sincronizacao.</p></div></div><div v-for="record in tenantBillingRecords" :key="record.id" class="activity-row"><div><strong>{{ record.reference || record.id }}</strong><small>{{ record.currency }} {{ record.amount.toFixed(2) }} · {{ statusLabel(record.status) }}</small></div><time>{{ formatDate(record.dueAt || record.createdAt) }}</time></div><p v-if="!tenantBillingRecords.length" class="empty-state">Nenhuma cobranca registrada.</p><hr><div class="form-grid"><label>Valor<input v-model="billing.amount" type="number" min="0" step="0.01"></label><label>Referencia<input v-model="billing.reference" maxlength="120"></label><label>Vencimento<input v-model="billing.dueAt" type="datetime-local"></label><label>Status<select v-model="billing.status"><option v-for="value in ['pending','paid','overdue','void','courtesy']" :key="value" :value="value">{{ statusLabel(value) }}</option></select></label><label class="form-grid__wide">Motivo do registro (obrigatorio)<textarea v-model="billing.reason" rows="2" minlength="8" /></label></div><button class="button button--quiet" :disabled="saving || billing.reason.length < 8 || billing.amount === ''" @click="saveBilling">Registrar cobranca</button></article></section>
      <section v-else-if="activeTab === 'users'" class="panel table-panel"><div class="panel-head"><div><h2>Usuarios e perfis de acesso</h2><p>Visao administrativa minimizada; alteracoes de permissao continuam restritas ao contexto da propria empresa.</p></div></div><div class="role-summary"><span v-for="item in userRoleSummary" :key="item.role">{{ roleLabel(item.role) }} <strong>{{ item.count }}</strong></span></div><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Perfil</th><th>Status</th><th>Criado em</th></tr></thead><tbody><tr v-for="user in tenantUsers" :key="user.id"><td><strong>{{ user.name }}</strong><small>{{ user.id }}</small></td><td>{{ roleLabel(user.role) }}</td><td><span :class="statusClass(user.status)">{{ statusLabel(user.status) }}</span></td><td>{{ formatDate(user.createdAt) }}</td></tr><tr v-if="!tenantUsers.length"><td colspan="4" class="empty-state">Nenhum usuario encontrado.</td></tr></tbody></table></div></section>
      <section v-else class="panel"><div class="panel-head"><div><h2>Historico da assinatura</h2><p>Eventos internos registrados para a empresa.</p></div></div><div v-for="event in tenantSubscriptionEvents" :key="event.id" class="activity-row"><div><strong>{{ event.action }}</strong><small>{{ event.reason || 'Sem justificativa registrada' }} · {{ event.source === 'provider' ? `Sincronizado${event.provider ? ` por ${event.provider}` : ''}` : 'Alteracao manual' }}</small></div><time>{{ formatDate(event.createdAt) }}</time></div><p v-if="!tenantSubscriptionEvents.length" class="empty-state">Nenhum evento de assinatura registrado.</p></section>
    </template>
  </AdminShell>
</template>
