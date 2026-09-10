<script setup lang="ts">
const { products, orders, expenses, expenseSegments, filaments, goals, printers, printJobs, pending } = useAppData()
const metrics = useBusinessMetrics()

const revenueLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const monthlyRevenue = computed(() => {
  const values = Array.from({ length: 12 }, () => 0)
  for (const order of orders.value) {
    const parts = String(order.date).split('/').map(Number)
    const month = parts.length >= 2 ? parts[1] : Number(String(order.date).slice(5, 7))
    if (month >= 1 && month <= 12) values[month - 1] += order.gross / 1000
  }
  return values
})
const monthlyExpenses = computed(() => {
  const values = Array.from({ length: 12 }, () => 0)
  for (const expense of expenses.value) {
    const parts = String(expense.date).split('/').map(Number)
    const month = parts.length >= 2 ? parts[1] : Number(String(expense.date).slice(5, 7))
    if (month >= 1 && month <= 12) values[month - 1] += expense.value / 1000
  }
  return values
})
const monthlyOrders = computed(() => {
  const values = Array.from({ length: 12 }, () => 0)
  for (const order of orders.value) {
    const parts = String(order.date).split('/').map(Number)
    const month = parts.length >= 2 ? parts[1] : Number(String(order.date).slice(5, 7))
    if (month >= 1 && month <= 12) values[month - 1] += Number(order.qty || 1)
  }
  return values
})
const monthlyFees = computed(() => {
  const values = Array.from({ length: 12 }, () => 0)
  for (const order of orders.value) {
    const parts = String(order.date).split('/').map(Number)
    const month = parts.length >= 2 ? parts[1] : Number(String(order.date).slice(5, 7))
    if (month >= 1 && month <= 12) values[month - 1] += Number(order.fee || 0)
  }
  return values
})
const marketplaceBars = computed(() => {
  const colors = ['#1768f2', '#0da566', '#f59e0b', '#c83bb7', '#29b6c8', '#7d8799']
  const totals = new Map<string, number>()
  for (const order of orders.value) totals.set(order.marketplace || 'Sem marketplace', (totals.get(order.marketplace || 'Sem marketplace') || 0) + order.gross)
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const max = rows[0]?.[1] || 0
  return rows.map(([label, value], index) => ({ label, value, percent: max ? value / max * 100 : 0, color: colors[index % colors.length] }))
})
const productPerformance = computed(() => {
  const totals = new Map<string, { sales: number, profit: number }>()
  for (const order of orders.value) {
    const current = totals.get(order.product) || { sales: 0, profit: 0 }
    current.sales += order.qty
    current.profit += order.profit
    totals.set(order.product, current)
  }
  return products.value.map((product) => {
    const item = totals.get(product.name) || { sales: 0, profit: 0 }
    return { ...product, sales: item.sales, orderProfit: item.profit }
  }).sort((a, b) => b.orderProfit - a.orderProfit)
})
const alerts = computed(() => [
  ...filaments.value.filter(f => f.remaining < 300).map(f => ({ icon: 'box', title: `${f.name} próximo do fim`, text: `Restam ${formatNumber(f.remaining)} g em estoque`, badge: 'Estoque baixo', cls: 'badge--orange' })),
  ...goals.value.filter(g => g.target > 0).map(g => ({ icon: 'target', title: g.title, text: `${metrics.percent(Math.min(g.current / g.target * 100, 100))} da meta`, badge: g.status, cls: 'badge--green' }))
])
const activePrintJobs = computed(() => printJobs.value.filter(job => ['starting', 'printing', 'paused'].includes(String(job.status || ''))))
const queuedPrintJobs = computed(() => printJobs.value.filter(job => ['queued', 'awaiting_confirmation'].includes(String(job.status || ''))))
const activePrinterIds = computed(() => new Set(activePrintJobs.value.map(job => String(job.printerId || '')).filter(Boolean)))
const operationalPrinters = computed(() => printers.value.map(printer => {
  const activeJob = activePrintJobs.value.find(job => String(job.printerId || '') === String(printer.id || ''))
  const queued = printJobs.value.filter(job => String(job.printerId || '') === String(printer.id || '') && ['queued', 'awaiting_confirmation'].includes(String(job.status || ''))).length
  const progress = Number((activeJob?.agentLastStatus as any)?.progress || 0)
  return { ...printer, activeJob, queued, progress: Number.isFinite(progress) ? progress : 0 }
}).sort((a, b) => Number(Boolean(b.activeJob)) - Number(Boolean(a.activeJob)) || b.queued - a.queued))
const orderStageSummary = computed(() => {
  const stages = [
    { label: 'Aguardando', statuses: ['Pendente', 'Aguardando confirmação'], color: '#f59e0b' },
    { label: 'Produção', statuses: ['Produção', 'Impresso', 'Embalando'], color: '#1768f2' },
    { label: 'Envio', statuses: ['Enviado'], color: '#0da566' },
    { label: 'Concluídos', statuses: ['Entregue'], color: '#7c3aed' }
  ]
  return stages.map(stage => ({ ...stage, count: orders.value.filter(order => stage.statuses.includes(String(order.status || ''))).length }))
})
const lowStockItems = computed(() => [...filaments.value].filter(filament => Number(filament.remaining || 0) < 300).sort((a, b) => Number(a.remaining || 0) - Number(b.remaining || 0)).slice(0, 5))
const operationalAlerts = computed(() => [
  ...printers.value.filter(printer => /manutenc/i.test(String(printer.status || ''))).map(printer => ({ icon: 'wrench', title: `${printer.name} em manutenção`, text: 'Verifique a disponibilidade antes de iniciar a fila.', badge: 'Atenção', cls: 'badge--orange' })),
  ...orders.value.filter(order => ['Produção', 'Impresso', 'Embalando'].includes(String(order.status || '')) && !printJobs.value.some(job => String(job.orderId || '') === String(order.dbId || order.id || ''))).slice(0, 3).map(order => ({ icon: 'bag', title: `Pedido ${order.id} sem fila`, text: 'Vincule uma impressora para iniciar a produção.', badge: 'Ação', cls: 'badge--orange' }))
])
</script>

<template>
  <div>
    <PageHeader title="Dashboard" subtitle="Resumo geral do seu negócio de impressão 3D" />
    <div v-if="pending" class="page-loading-hint" role="status">Carregando seus dados...</div>

    <div class="metrics-grid">
      <MetricCard label="Faturamento Total" :value="formatCurrency(metrics.revenue.value)" icon="trend" note="Dados do banco" color="blue" :points="monthlyRevenue" />
      <MetricCard label="Despesas Totais" :value="formatCurrency(metrics.expenseTotal.value)" icon="receipt" note="Dados do banco" color="red" negative :points="monthlyExpenses" />
      <MetricCard label="Lucro Líquido" :value="formatCurrency(metrics.profit.value)" icon="money" :change="`Margem ${metrics.percent(metrics.margin.value)}`" color="green" selected :points="monthlyRevenue.map((x, i) => x - monthlyExpenses[i])" />
      <MetricCard label="Pedidos" :value="formatNumber(metrics.orderCount.value)" icon="bag" note="Quantidade vendida por mês" color="purple" :points="monthlyOrders" />
      <MetricCard label="Ticket Médio" :value="formatCurrency(metrics.ticket.value)" icon="tag" note="Faturamento / Pedidos" color="orange" :points="monthlyRevenue.map((value, index) => monthlyOrders[index] ? value / monthlyOrders[index] : 0)" />
      <MetricCard label="Taxas de Marketplaces" :value="formatCurrency(metrics.fees.value)" icon="percent" note="Taxas registradas por mês" color="cyan" :points="monthlyFees" />
    </div>

    <div class="operational-board">
      <PanelCard title="Operação agora" subtitle="Acompanhe o que precisa de ação neste momento.">
        <div class="operational-summary">
          <NuxtLink class="operational-summary__item" to="/vendas?status=Acompanhar%20pedido"><span class="operational-summary__icon operational-summary__icon--blue"><UiIcon name="bag" :size="18" /></span><div><strong>{{ activePrintJobs.length + queuedPrintJobs.length }}</strong><small>Itens na produção</small></div></NuxtLink>
          <NuxtLink class="operational-summary__item" to="/impressoras"><span class="operational-summary__icon operational-summary__icon--green"><UiIcon name="printer" :size="18" /></span><div><strong>{{ activePrinterIds.size }}/{{ printers.length }}</strong><small>Impressoras ocupadas</small></div></NuxtLink>
          <NuxtLink class="operational-summary__item" to="/filamentos"><span class="operational-summary__icon operational-summary__icon--orange"><UiIcon name="spool" :size="18" /></span><div><strong>{{ lowStockItems.length }}</strong><small>Alertas de estoque</small></div></NuxtLink>
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
          <NuxtLink v-for="alert in operationalAlerts" :key="alert.title" class="alert-row" to="/vendas"><span class="alert-row__icon"><UiIcon :name="alert.icon" :size="17" /></span><div><strong>{{ alert.title }}</strong><small>{{ alert.text }}</small></div><span class="badge" :class="alert.cls">{{ alert.badge }}</span></NuxtLink>
          <NuxtLink v-for="filament in lowStockItems" :key="filament.id || filament.name" class="alert-row" to="/filamentos"><span class="alert-row__icon"><UiIcon name="spool" :size="17" /></span><div><strong>{{ filament.name }} próximo do fim</strong><small>Restam {{ formatNumber(filament.remaining) }} g em estoque</small></div><span class="badge badge--orange">Repor</span></NuxtLink>
        </div>
      </PanelCard>
    </div>

    <div class="dashboard-grid">
      <PanelCard title="Faturamento Mensal"><LineChart :values="monthlyRevenue" :labels="revenueLabels" /></PanelCard>
      <PanelCard title="Receita x Despesas"><LineChart :values="monthlyRevenue" :second="monthlyExpenses" :labels="revenueLabels" /></PanelCard>
      <PanelCard title="Despesas por Categoria"><DonutChart :segments="expenseSegments" :total="formatCurrency(metrics.expenseTotal.value)" /></PanelCard>
    </div>

    <div class="dashboard-grid dashboard-grid--bottom">
      <PanelCard title="Faturamento por Marketplace">
        <div class="bar-list" style="padding-top:12px">
          <div v-if="!marketplaceBars.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="store"/></div><h3>Nenhuma venda por marketplace</h3><p>Cadastre vendas para preencher este gráfico.</p></div></div>
          <div v-for="bar in marketplaceBars" :key="bar.label" class="bar-row"><span>{{ bar.label }}</span><div class="bar-row__track"><div class="bar-row__fill" :style="{ width: `${bar.percent}%`, background: bar.color }"/></div><strong>{{ formatCurrency(bar.value) }}</strong></div>
        </div>
      </PanelCard>
      <PanelCard title="Produtos mais Lucrativos">
        <div class="table-scroll"><table class="data-table"><thead><tr><th>Produto</th><th>Vendas</th><th>Lucro</th><th>Margem</th></tr></thead><tbody><tr v-if="!productPerformance.length"><td colspan="4"><div class="empty-state"><div><div class="empty-state__icon"><UiIcon name="box"/></div><h3>Nenhum produto cadastrado</h3><p>Cadastre produtos e vendas para ver o desempenho.</p></div></div></td></tr><tr v-for="p in productPerformance" :key="p.sku"><td><div class="table-product"><ProductThumb :type="p.thumb" :size="28"/><strong>{{ p.name }}</strong></div></td><td>{{ p.sales }}</td><td class="money-positive">{{ formatCurrency(p.orderProfit) }}</td><td><span class="badge badge--green">{{ metrics.percent(p.margin || 0) }}</span></td></tr></tbody></table></div>
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
.operational-board { display: grid; grid-template-columns: 1fr 1.1fr 1fr; gap: 12px; margin-bottom: 12px; }
.operational-board > :deep(.panel) { min-height: 254px; }
.operational-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.operational-summary__item { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 9px; border: 1px solid #e8edf4; border-radius: 9px; color: inherit; text-decoration: none; }
.operational-summary__item strong { display: block; font-size: 15px; }
.operational-summary__item small { display: block; color: var(--muted); font-size: 8px; white-space: nowrap; }
.operational-summary__icon, .printer-queue-row__icon { display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 auto; border-radius: 8px; }
.operational-summary__icon--blue { color: var(--blue); background: var(--blue-soft); }.operational-summary__icon--green { color: var(--green); background: #e6f8ef; }.operational-summary__icon--orange { color: var(--orange); background: #fff2e5; }
.stage-list { display: grid; gap: 2px; margin-top: 14px; }.stage-row { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #edf1f6; font-size: 10px; }.stage-row__dot { width: 7px; height: 7px; border-radius: 50%; }.stage-row strong { font-size: 11px; }
.printer-queue-list { display: grid; gap: 5px; }.printer-queue-row { display: flex; gap: 8px; padding: 7px 0; border-bottom: 1px solid #edf1f6; color: inherit; text-decoration: none; }.printer-queue-row__icon { color: var(--blue); background: var(--blue-soft); }.printer-queue-row__body { flex: 1; min-width: 0; }.printer-queue-row__body > div:first-child { display: flex; justify-content: space-between; gap: 8px; }.printer-queue-row strong, .printer-queue-row small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.printer-queue-row small { margin-top: 2px; color: var(--muted); font-size: 8px; }.printer-queue-row .progress { margin-top: 6px; height: 5px; }.empty-state--compact { min-height: 185px; }.alert-row { color: inherit; text-decoration: none; }
@media (max-width: 1150px) { .operational-board { grid-template-columns: 1fr 1fr; }.operational-board > :last-child { grid-column: span 2; } }
@media (max-width: 700px) { .operational-board { grid-template-columns: 1fr; }.operational-board > :last-child { grid-column: auto; }.operational-summary { grid-template-columns: 1fr; } }
</style>
