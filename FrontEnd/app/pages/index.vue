<script setup lang="ts">
const { loadDashboardSummary, setOnboardingPrinterMode } = useAppData()
const { unreadCount } = useOperationalNotifications()
const { notify } = useUi()
const summary = ref<DashboardSummary>(emptyDashboardSummary())
const pending = ref(true)
const savingOnboardingMode = ref(false)

const revenueLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const totals = computed(() => summary.value.totals)
const monthlyRevenue = computed(() => summary.value.monthlyRevenue.map(value => value / 1000))
const monthlyExpenses = computed(() => summary.value.monthlyExpenses.map(value => value / 1000))
const monthlyOrders = computed(() => summary.value.monthlyOrders)
const productPerformance = computed(() => summary.value.productPerformance)
const expenseSegments = computed(() => summary.value.expenseSegments)
const alerts = computed(() => [
  ...summary.value.lowStockItems.map(f => ({ icon: 'box', title: `${f.name} próximo do fim`, text: `Restam ${formatNumber(f.remaining)} g em estoque`, badge: 'Estoque baixo', cls: 'badge--orange' })),
  ...summary.value.goals.filter(g => g.target > 0).map(g => ({ icon: 'target', title: g.name, text: `${percent(Math.min(g.current / g.target * 100, 100))} da meta`, badge: g.status, cls: 'badge--green' }))
])
const operationalPrinters = computed(() => summary.value.queuePrinters)
const orderStageSummary = computed(() => {
  const counts = summary.value.orderStages
  return [
    { label: 'Aguardando', count: counts.awaiting, color: '#f59e0b' },
    { label: 'Produção', count: counts.production, color: '#1768f2' },
    { label: 'Envio', count: counts.shipping, color: '#0da566' },
    { label: 'Concluídos', count: counts.completed, color: '#7c3aed' }
  ]
})
const lowStockItems = computed(() => [...summary.value.lowStockItems].sort((a, b) => a.remaining - b.remaining).slice(0, 5))
const operationalAlerts = computed(() => [
  ...summary.value.offlinePrinters.map(printer => ({ icon: 'printer', title: `${printer.name} offline`, text: 'Confira a conexão antes de iniciar a produção.', badge: 'Offline', cls: 'badge--red', to: '/impressoras' })),
  ...summary.value.maintenancePrinters.map(printer => ({ icon: 'wrench', title: `${printer.name} em manutenção`, text: 'Verifique a disponibilidade antes de iniciar a fila.', badge: 'Atenção', cls: 'badge--orange', to: '/impressoras' })),
  ...summary.value.overdueOrders.map(order => ({ icon: 'clock', title: `Pedido ${order.id} precisa de atenção`, text: 'Pedido aberto há mais de 7 dias.', badge: 'Atrasado', cls: 'badge--red', to: '/vendas?status=Acompanhar%20pedido' })),
  ...summary.value.pendingOrders.map(order => ({ icon: 'bag', title: `Pedido ${order.id} sem fila`, text: 'Vincule uma impressora para iniciar a produção.', badge: 'Ação', cls: 'badge--orange', to: '/vendas?status=Acompanhar%20pedido' })),
  ...summary.value.integrationErrors.map(integration => ({ icon: 'alert', title: `${integration.name} com falha`, text: 'Revise a conexão e tente sincronizar novamente.', badge: 'Integração', cls: 'badge--red', to: '/marketplaces' }))
])
const onboardingSteps = computed(() => [
  { key: 'company', title: 'Configure sua empresa', text: 'Revise os dados usados nos cálculos e documentos.', done: summary.value.onboarding.companyConfigured, to: '/configuracoes/empresa', action: 'Configurar empresa', icon: 'building' },
  { key: 'product', title: 'Cadastre seu primeiro produto', text: 'Defina custo, margem e dados de impressão.', done: summary.value.onboarding.productCount > 0, to: '/produtos/novo', action: 'Cadastrar produto', icon: 'box' },
  { key: 'printer', title: 'Defina como vai produzir', text: summary.value.onboarding.printerMode === 'manual' ? 'Operação manual selecionada.' : 'Cadastre uma impressora ou continue com operação manual.', done: summary.value.printerCount > 0 || summary.value.onboarding.printerMode === 'manual', to: '/impressoras/nova', action: 'Cadastrar impressora', icon: 'printer' }
])
const onboardingCompleted = computed(() => onboardingSteps.value.filter(step => step.done).length)
const onboardingDone = computed(() => onboardingCompleted.value === onboardingSteps.value.length)
const chooseManualOperation = async () => {
  if (savingOnboardingMode.value) return
  savingOnboardingMode.value = true
  try {
    await setOnboardingPrinterMode('manual')
    summary.value.onboarding.printerMode = 'manual'
    notify('Operação manual selecionada. Você pode cadastrar uma impressora quando quiser.')
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Não foi possível salvar sua escolha.')
  } finally { savingOnboardingMode.value = false }
}
const percent = (value: number) => `${value.toFixed(1).replace('.', ',')}%`

onMounted(async () => {
  try { summary.value = await loadDashboardSummary() }
  catch { summary.value = emptyDashboardSummary() }
  finally { pending.value = false }
})
</script>

<template>
  <div class="dashboard-page">
    <PageHeader title="Dashboard" subtitle="Vendas, custos e produção da sua empresa." />
    <div v-if="pending" class="page-loading-hint" role="status">Carregando seus dados...</div>

    <section v-if="!pending && !onboardingDone" class="onboarding" aria-labelledby="onboarding-title">
      <div class="onboarding__head"><div><span class="onboarding__eyebrow">PRIMEIROS PASSOS</span><h2 id="onboarding-title">Prepare seu espaço de trabalho</h2><p>Conclua estas etapas para começar com dados e produção organizados.</p></div><strong>{{ onboardingCompleted }}/{{ onboardingSteps.length }}</strong></div>
      <div class="onboarding__progress" role="progressbar" :aria-valuenow="onboardingCompleted" :aria-valuemax="onboardingSteps.length"><span :style="{ width: `${onboardingCompleted / onboardingSteps.length * 100}%` }" /></div>
      <div class="onboarding__steps">
        <article v-for="step in onboardingSteps" :key="step.key" class="onboarding-step" :class="{ 'onboarding-step--done': step.done }">
          <span class="onboarding-step__icon"><UiIcon :name="step.done ? 'check' : step.icon" :size="18" /></span>
          <div><strong>{{ step.title }}</strong><small>{{ step.text }}</small></div>
          <span v-if="step.done" class="badge badge--green">Concluído</span>
          <div v-else class="onboarding-step__actions"><NuxtLink class="btn" :to="step.to">{{ step.action }}</NuxtLink><button v-if="step.key === 'printer'" class="btn btn--ghost" type="button" :disabled="savingOnboardingMode" @click="chooseManualOperation">{{ savingOnboardingMode ? 'Salvando...' : 'Usar modo manual' }}</button></div>
        </article>
      </div>
    </section>

    <div class="metrics-grid metrics-grid--5">
      <MetricCard label="Faturamento total" :value="formatCurrency(totals.revenue)" icon="trend" note="Vendas registradas" color="blue" :points="monthlyRevenue" />
      <MetricCard label="Despesas totais" :value="formatCurrency(totals.expenseTotal)" icon="receipt" note="Despesas registradas" color="red" negative :points="monthlyExpenses" />
      <MetricCard label="Lucro Líquido" :value="formatCurrency(totals.profit)" icon="money" :change="`Margem ${percent(totals.margin)}`" color="green" :points="monthlyRevenue.map((x, i) => x - monthlyExpenses[i])" />
      <MetricCard label="Pedidos" :value="formatNumber(totals.orderCount)" icon="bag" note="Quantidade vendida por mês" color="purple" :points="monthlyOrders" />
      <MetricCard label="Ticket Médio" :value="formatCurrency(totals.ticket)" icon="tag" note="Faturamento / Pedidos" color="orange" :points="monthlyRevenue.map((value, index) => monthlyOrders[index] ? value / monthlyOrders[index] : 0)" />
    </div>

    <div class="operational-board">
      <PanelCard title="Operação agora" subtitle="Acompanhe o que precisa de ação neste momento.">
        <div class="operational-summary">
          <NuxtLink class="operational-summary__item" to="/vendas?status=Acompanhar%20pedido"><span class="operational-summary__icon operational-summary__icon--blue"><UiIcon name="bag" :size="18" /></span><div><strong>{{ summary.jobCounts.active + summary.jobCounts.queued }}</strong><small>Itens na produção</small></div></NuxtLink>
          <NuxtLink class="operational-summary__item" to="/impressoras"><span class="operational-summary__icon operational-summary__icon--green"><UiIcon name="printer" :size="18" /></span><div><strong>{{ summary.jobCounts.occupiedPrinters }}/{{ summary.printerCount }}</strong><small>Impressoras ocupadas</small></div></NuxtLink>
          <NuxtLink class="operational-summary__item" to="/estoque?secao=filamentos"><span class="operational-summary__icon operational-summary__icon--orange"><UiIcon name="spool" :size="18" /></span><div><strong>{{ lowStockItems.length }}</strong><small>Alertas de estoque</small></div></NuxtLink>
          <NuxtLink class="operational-summary__item" to="/notificacoes"><span class="operational-summary__icon operational-summary__icon--red"><UiIcon name="bell" :size="18" /></span><div><strong>{{ unreadCount }}</strong><small>Alertas operacionais</small></div></NuxtLink>
        </div>
        <div class="stage-list">
          <div v-for="stage in orderStageSummary" :key="stage.label" class="stage-row"><span class="stage-row__dot" :style="{ background: stage.color }"/><span>{{ stage.label }}</span><strong>{{ stage.count }}</strong></div>
        </div>
      </PanelCard>
      <PanelCard title="Fila por impressora" subtitle="Itens ativos e aguardando em cada equipamento.">
        <div v-if="!operationalPrinters.length" class="empty-state empty-state--compact"><div><div class="empty-state__icon"><UiIcon name="printer" /></div><h3>Nenhuma impressora cadastrada</h3><NuxtLink class="btn btn--primary" to="/impressoras/nova">Cadastrar impressora</NuxtLink></div></div>
        <div v-else class="printer-queue-list">
          <NuxtLink v-for="printer in operationalPrinters.slice(0, 5)" :key="printer.id || printer.code" class="printer-queue-row" to="/impressoras">
            <span class="printer-queue-row__icon"><UiIcon name="printer" :size="17" /></span><div class="printer-queue-row__body"><div><strong>{{ printer.name }}</strong><small>{{ printer.activeJob?.title || printer.activeJob?.productName || 'Livre' }}</small></div><span class="badge" :class="printer.activeJob ? 'badge--orange' : 'badge--green'">{{ printer.activeJob ? `${printer.progress}%` : `${printer.queued} na fila` }}</span><div v-if="printer.activeJob" class="progress"><span :style="{ width: `${Math.min(100, Math.max(0, printer.progress))}%` }"/></div></div>
          </NuxtLink>
        </div>
      </PanelCard>
      <PanelCard title="Ações pendentes" subtitle="Alertas operacionais que podem bloquear a produção.">
        <div v-if="!operationalAlerts.length && !lowStockItems.length" class="empty-state empty-state--compact"><div><div class="empty-state__icon"><UiIcon name="check" /></div><h3>Operação em dia</h3><p>Nenhuma ação crítica identificada.</p></div></div>
        <div v-else class="alerts-list">
          <NuxtLink v-for="alert in operationalAlerts" :key="alert.title" class="alert-row" :to="alert.to"><span class="alert-row__icon"><UiIcon :name="alert.icon" :size="17" /></span><div><strong>{{ alert.title }}</strong><small>{{ alert.text }}</small></div><span class="badge" :class="alert.cls">{{ alert.badge }}</span></NuxtLink>
          <NuxtLink v-for="filament in lowStockItems" :key="filament.id || filament.name" class="alert-row" to="/estoque?secao=filamentos"><span class="alert-row__icon"><UiIcon name="spool" :size="17" /></span><div><strong>{{ filament.name }} próximo do fim</strong><small>Restam {{ formatNumber(filament.remaining) }} g · mínimo {{ formatNumber(filament.minStock) }} g</small></div><span class="badge badge--orange">Repor</span></NuxtLink>
        </div>
      </PanelCard>
    </div>

    <div class="dashboard-grid">
      <PanelCard title="Faturamento Mensal"><LineChart :values="monthlyRevenue" :labels="revenueLabels" /></PanelCard>
      <PanelCard title="Receita x Despesas"><LineChart :values="monthlyRevenue" :second="monthlyExpenses" :labels="revenueLabels" /></PanelCard>
      <PanelCard title="Despesas por Categoria"><DonutChart :segments="expenseSegments" :total="formatCurrency(totals.expenseTotal)" /></PanelCard>
    </div>

    <div class="dashboard-grid dashboard-grid--bottom">
      <PanelCard title="Produtos mais Lucrativos">
        <div class="table-scroll"><table class="data-table"><thead><tr><th>Produto</th><th>Vendas</th><th>Lucro</th><th>Margem</th></tr></thead><tbody><tr v-if="!productPerformance.length"><td colspan="4"><div class="empty-state"><div><div class="empty-state__icon"><UiIcon name="box"/></div><h3>Nenhum produto cadastrado</h3><p>Cadastre produtos e vendas para ver o desempenho.</p></div></div></td></tr><tr v-for="p in productPerformance" :key="p.sku"><td><div class="table-product"><ProductThumb :type="p.thumb" :size="28"/><strong>{{ p.name }}</strong></div></td><td>{{ p.sales }}</td><td class="money-positive">{{ formatCurrency(p.orderProfit) }}</td><td><span class="badge badge--green">{{ percent(p.margin || 0) }}</span></td></tr></tbody></table></div>
      </PanelCard>
      <PanelCard title="Alertas e Recomendações">
        <template #actions><NuxtLink class="btn btn--ghost" to="/notificacoes">Ver todos</NuxtLink></template>
        <div class="alerts-list">
          <div v-if="!alerts.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="bell"/></div><h3>Nenhum alerta no momento</h3><p>Os alertas aparecem conforme seus dados forem cadastrados.</p></div></div>
          <div v-for="alert in alerts" :key="alert.title" class="alert-row"><span class="alert-row__icon"><UiIcon :name="alert.icon" :size="17"/></span><div><strong>{{ alert.title }}</strong><small>{{ alert.text }}</small></div><span class="badge" :class="alert.cls">{{ alert.badge }}</span><UiIcon name="chevron" :size="15"/></div>
        </div>
      </PanelCard>
    </div>
  </div>
</template>

<style scoped>
.onboarding { margin-bottom: 20px; border: 1px solid #cfe0ff; border-radius: 14px; background: linear-gradient(135deg,#f8fbff,#fff); padding: 20px; box-shadow: 0 8px 26px rgba(23,104,242,.06); }
.onboarding__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }.onboarding__head h2 { margin: 4px 0; font-size: 20px; }.onboarding__head p { margin: 0; color: var(--muted); font-size: 12px; }.onboarding__head > strong { color: var(--blue); font-size: 18px; }.onboarding__eyebrow { color: var(--blue); font-size: 10px; font-weight: 800; letter-spacing: .1em; }
.onboarding__progress { overflow: hidden; height: 6px; margin: 16px 0; border-radius: 999px; background: #e8eef8; }.onboarding__progress span { display: block; height: 100%; border-radius: inherit; background: var(--blue); transition: width .25s ease; }
.onboarding__steps { display: grid; gap: 8px; }.onboarding-step { display: grid; grid-template-columns: 36px minmax(0,1fr) auto; align-items: center; gap: 12px; padding: 11px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }.onboarding-step__icon { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 9px; color: var(--blue); background: var(--blue-soft); }.onboarding-step--done .onboarding-step__icon { color: var(--green); background: #e6f8ef; }.onboarding-step strong,.onboarding-step small { display: block; }.onboarding-step strong { font-size: 12px; }.onboarding-step small { margin-top: 3px; color: var(--muted); font-size: 11px; }.onboarding-step__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.operational-board { display: grid; grid-template-columns: 1.1fr 1fr 1fr; gap: 16px; margin-bottom: 20px; }
.operational-board > :deep(.panel) { min-height: 254px; }
.operational-summary { display: grid; grid-template-columns: 1fr; gap: 0; }
.operational-summary__item { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 9px 0; border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
.operational-summary__item > div { display: flex; flex: 1; flex-direction: row-reverse; justify-content: space-between; align-items: center; gap: 12px; }
.operational-summary__item:hover { color: var(--blue); }
.operational-summary__item strong { display: block; font-size: 15px; }
.operational-summary__item small { display: block; color: var(--muted); font-size: 12px; }
.operational-summary__icon, .printer-queue-row__icon { display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 auto; border-radius: 8px; }
.operational-summary__icon--blue { color: var(--blue); background: var(--blue-soft); }.operational-summary__icon--green { color: var(--green); background: #e6f8ef; }.operational-summary__icon--orange { color: var(--orange); background: #fff2e5; }
.operational-summary__icon--red { color: var(--red); background: #fff0f0; }
.stage-list { display: grid; gap: 2px; margin-top: 14px; }.stage-row { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #edf1f6; font-size: 10px; }.stage-row__dot { width: 7px; height: 7px; border-radius: 50%; }.stage-row strong { font-size: 11px; }
.printer-queue-list { display: grid; gap: 5px; }.printer-queue-row { display: flex; gap: 8px; padding: 7px 0; border-bottom: 1px solid #edf1f6; color: inherit; text-decoration: none; }.printer-queue-row__icon { color: var(--blue); background: var(--blue-soft); }.printer-queue-row__body { flex: 1; min-width: 0; }.printer-queue-row__body > div:first-child { display: flex; justify-content: space-between; gap: 8px; }.printer-queue-row strong, .printer-queue-row small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.printer-queue-row small { margin-top: 2px; color: var(--muted); font-size: 8px; }.printer-queue-row .progress { margin-top: 6px; height: 5px; }.empty-state--compact { min-height: 185px; }.alert-row { color: inherit; text-decoration: none; }
@media (max-width: 1150px) { .operational-board { grid-template-columns: 1fr 1fr; }.operational-board > :last-child { grid-column: span 2; } }
.stage-row { font-size: 12px; }
.stage-row strong { font-size: 12px; font-variant-numeric: tabular-nums; }
.printer-queue-row strong { font-size: 12px; }
.printer-queue-row small { font-size: 11px; }
.alert-row strong { font-size: 12px; }
.alert-row small { font-size: 11px; line-height: 1.5; }
@media (max-width: 700px) { .operational-board { grid-template-columns: 1fr; }.operational-board > :last-child { grid-column: auto; }.operational-summary { grid-template-columns: 1fr; } }
@media (max-width: 700px) { .onboarding { padding: 16px; }.onboarding-step { grid-template-columns: 36px minmax(0,1fr); }.onboarding-step > .badge,.onboarding-step__actions { grid-column: 2; justify-self: start; }.onboarding-step__actions { justify-content: flex-start; }.onboarding-step__actions .btn { min-height: 38px; } }
</style>
