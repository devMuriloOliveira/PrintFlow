<script setup lang="ts">
const { goals, deleteItem } = useAppData()
const { notify } = useUi()
const router = useRouter()
const filter = ref<'all' | 'active' | 'attention' | 'completed'>('all')
const sort = ref<'priority' | 'deadline' | 'progress' | 'name'>('priority')
const search = ref('')
const deletingId = ref('')
const today = new Date()
today.setHours(0, 0, 0, 0)

const goalTypes: Record<string, { label: string; unit: 'currency' | 'number' | 'percent'; icon: string; color: string }> = {
  revenue: { label: 'Faturamento', unit: 'currency', icon: 'trend', color: '#1768f2' },
  profit: { label: 'Lucro', unit: 'currency', icon: 'money', color: '#0da566' },
  orders: { label: 'Pedidos', unit: 'number', icon: 'bag', color: '#7c3aed' },
  average_ticket: { label: 'Ticket médio', unit: 'currency', icon: 'tag', color: '#f57c1f' },
  expense_reduction: { label: 'Redução de despesas', unit: 'percent', icon: 'receipt', color: '#ef4444' }
}
const metaFor = (goal: any) => goalTypes[goal.goalType] || { label: 'Meta personalizada', unit: 'currency', icon: goal.icon || 'target', color: goal.color || '#1768f2' }
const goalProgress = (goal: any) => Number(goal.target || 0) > 0 ? Math.min(100, Math.max(0, Number(goal.current || 0) / Number(goal.target) * 100)) : 0
const parseDate = (value: string) => value ? new Date(`${value}T00:00:00`) : null
const dateLabel = (value: string) => value ? new Intl.DateTimeFormat('pt-BR').format(parseDate(value) as Date) : 'Sem data'
const daysUntil = (value: string) => {
  const date = parseDate(value)
  return date ? Math.ceil((date.getTime() - today.getTime()) / 86400000) : null
}
const expectedProgress = (goal: any) => {
  const start = parseDate(goal.periodStart)
  const end = parseDate(goal.periodEnd)
  if (!start || !end || end <= start) return 0
  if (today <= start) return 0
  if (today >= end) return 100
  return Math.min(100, Math.max(0, (today.getTime() - start.getTime()) / (end.getTime() - start.getTime()) * 100))
}
const stateFor = (goal: any) => {
  const progress = goalProgress(goal)
  const days = daysUntil(goal.periodEnd)
  if (progress >= 100 || String(goal.status || '').toLowerCase().includes('conclu')) return { key: 'completed', label: 'Concluída', badge: 'badge--green' }
  if (days !== null && days < 0) return { key: 'attention', label: 'Prazo encerrado', badge: 'badge--red' }
  if (progress + 10 < expectedProgress(goal)) return { key: 'attention', label: 'Requer atenção', badge: 'badge--orange' }
  return { key: 'active', label: 'No ritmo', badge: '' }
}
const formatGoalValue = (goal: any, value: number) => {
  const unit = metaFor(goal).unit
  if (unit === 'number') return formatNumber(Number(value || 0))
  if (unit === 'percent') return `${Number(value || 0).toFixed(1)}%`
  return formatCurrency(Number(value || 0))
}
const remaining = (goal: any) => Math.max(0, Number(goal.target || 0) - Number(goal.current || 0))
const periodText = (goal: any) => `${dateLabel(goal.periodStart)} até ${dateLabel(goal.periodEnd)}`
const deadlineText = (goal: any) => {
  const days = daysUntil(goal.periodEnd)
  if (days === null) return 'Prazo não informado'
  if (days < 0) return `Encerrada há ${Math.abs(days)} dia(s)`
  if (days === 0) return 'Encerra hoje'
  return `${days} dia(s) restantes`
}
const pacePerDay = (goal: any) => {
  const start = parseDate(goal.periodStart)
  const end = parseDate(goal.periodEnd)
  const anchor = start && start > today ? start : today
  if (goalProgress(goal) >= 100 || !end || end < anchor) return 0
  const availableDays = Math.floor((end.getTime() - anchor.getTime()) / 86400000) + 1
  return remaining(goal) / Math.max(availableDays, 1)
}
const paceText = (goal: any) => {
  if (goalProgress(goal) >= 100) return 'Objetivo alcançado'
  if (goal.goalType === 'average_ticket') return `elevar o ticket em ${formatGoalValue(goal, remaining(goal))}`
  const days = daysUntil(goal.periodEnd)
  if (days === null) return 'Defina um prazo'
  if (days < 0) return 'Prazo encerrado'
  return `${formatGoalValue(goal, pacePerDay(goal))} por dia`
}
const progressGap = (goal: any) => goalProgress(goal) - expectedProgress(goal)
const completedGoals = computed(() => goals.value.filter(goal => stateFor(goal).key === 'completed'))
const attentionGoals = computed(() => goals.value.filter(goal => stateFor(goal).key === 'attention'))
const activeGoals = computed(() => goals.value.filter(goal => stateFor(goal).key === 'active'))
const averageProgress = computed(() => goals.value.length ? goals.value.reduce((sum, goal) => sum + goalProgress(goal), 0) / goals.value.length : 0)
const closestGoal = computed(() => activeGoals.value.slice().sort((a, b) => remaining(a) / Math.max(Number(a.target || 0), 1) - remaining(b) / Math.max(Number(b.target || 0), 1))[0])
const focusGoal = computed(() => attentionGoals.value.slice().sort((a, b) => progressGap(a) - progressGap(b))[0] || closestGoal.value || completedGoals.value[0])
const focusHeading = computed(() => {
  if (!focusGoal.value) return ''
  if (stateFor(focusGoal.value).key === 'attention') return 'Esta meta pede uma decisão agora'
  if (stateFor(focusGoal.value).key === 'completed') return 'Objetivo alcançado no período'
  return 'Próxima meta para acompanhar'
})
const focusDescription = computed(() => {
  const goal = focusGoal.value
  if (!goal) return ''
  if (stateFor(goal).key === 'completed') return `${goal.name} chegou a ${formatGoalValue(goal, goal.current)} de resultado.`
  return `${goal.name} · ${paceText(goal)} para chegar a ${formatGoalValue(goal, goal.target)}.`
})
const visibleGoals = computed(() => {
  const term = search.value.trim().toLocaleLowerCase('pt-BR')
  const list = goals.value.filter(goal => (filter.value === 'all' || stateFor(goal).key === filter.value) && (!term || `${goal.name} ${metaFor(goal).label}`.toLocaleLowerCase('pt-BR').includes(term)))
  return list.slice().sort((a, b) => {
    if (sort.value === 'deadline') return (parseDate(a.periodEnd)?.getTime() || Infinity) - (parseDate(b.periodEnd)?.getTime() || Infinity)
    if (sort.value === 'progress') return goalProgress(b) - goalProgress(a)
    if (sort.value === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')
    const weight = { attention: 0, active: 1, completed: 2 }
    return weight[stateFor(a).key as keyof typeof weight] - weight[stateFor(b).key as keyof typeof weight]
      || (parseDate(a.periodEnd)?.getTime() || Infinity) - (parseDate(b.periodEnd)?.getTime() || Infinity)
  })
})
const filterOptions = computed(() => [
  { key: 'all' as const, label: 'Todas', count: goals.value.length },
  { key: 'active' as const, label: 'No ritmo', count: activeGoals.value.length },
  { key: 'attention' as const, label: 'Atenção', count: attentionGoals.value.length },
  { key: 'completed' as const, label: 'Concluídas', count: completedGoals.value.length }
])
const editGoal = (goal: any) => goal.id && router.push(`/metas/nova?id=${goal.id}`)
const duplicateGoal = (goal: any) => goal.id && router.push(`/metas/nova?duplicar=${goal.id}`)
const removeGoal = async (goal: any) => {
  if (!goal.id || deletingId.value || !window.confirm(`Excluir meta?\n\n${goal.name}\n\nEsta ação não poderá ser desfeita.`)) return
  deletingId.value = String(goal.id)
  try {
    await deleteItem('goals', goal.id)
    notify('Meta excluída com sucesso.')
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Não foi possível excluir a meta.', 'info')
  } finally {
    deletingId.value = ''
  }
}
</script>

<template>
  <div class="goals-page">
    <PageHeader title="Metas" subtitle="Transforme resultados de vendas em objetivos com prazo e acompanhamento automático.">
      <NuxtLink class="btn btn--primary" to="/metas/nova"><UiIcon name="plus" />Nova meta</NuxtLink>
    </PageHeader>

    <section v-if="focusGoal" class="goals-focus" :class="{ 'goals-focus--attention': stateFor(focusGoal).key === 'attention' }" :style="{ '--focus-color': metaFor(focusGoal).color }">
      <div class="goals-focus__icon"><UiIcon :name="stateFor(focusGoal).key === 'attention' ? 'info' : metaFor(focusGoal).icon" :size="22" /></div>
      <div class="goals-focus__copy"><span>FOCO OPERACIONAL</span><h2>{{ focusHeading }}</h2><p>{{ focusDescription }}</p></div>
      <div class="goals-focus__progress"><span>Progresso atual</span><strong>{{ goalProgress(focusGoal).toFixed(0) }}%</strong><small :class="{ 'money-negative': progressGap(focusGoal) < -10 }">{{ Math.abs(progressGap(focusGoal)).toFixed(0) }} p.p. {{ progressGap(focusGoal) >= 0 ? 'acima' : 'abaixo' }} do ritmo</small></div>
      <button class="btn" type="button" @click="editGoal(focusGoal)"><UiIcon name="edit" :size="15" />Revisar meta</button>
    </section>

    <div class="metrics-grid metrics-grid--4 goals-metrics">
      <MetricCard label="Metas no ritmo" :value="formatNumber(activeGoals.length)" icon="target" note="Progresso compatível com o prazo" :points="goals.map(goal => goalProgress(goal))" />
      <MetricCard label="Progresso médio" :value="`${averageProgress.toFixed(1)}%`" icon="chart" note="Considerando todas as metas" color="green" :points="goals.map(goal => goalProgress(goal))" />
      <MetricCard label="Precisam de atenção" :value="formatNumber(attentionGoals.length)" icon="info" note="Atrasadas ou fora do ritmo" :color="attentionGoals.length ? 'orange' : 'cyan'" :points="goals.map(goal => stateFor(goal).key === 'attention' ? 1 : 0)" />
      <MetricCard label="Mais próxima" :value="closestGoal?.name || 'Nenhuma'" icon="trend" :note="closestGoal ? `${goalProgress(closestGoal).toFixed(0)}% concluído` : 'Crie uma meta para acompanhar'" color="purple" :points="goals.map(goal => goalProgress(goal))" />
    </div>

    <section class="goals-toolbar" aria-label="Filtros das metas">
      <div class="goals-tabs">
        <button v-for="option in filterOptions" :key="option.key" type="button" :class="{ active: filter === option.key }" @click="filter = option.key"><span>{{ option.label }}</span><strong>{{ option.count }}</strong></button>
      </div>
      <div class="goals-toolbar__right"><label class="goals-search"><UiIcon name="search" :size="16" /><input v-model="search" aria-label="Buscar meta" placeholder="Buscar por nome ou tipo"></label><label class="goals-sort"><span>Ordenar</span><select v-model="sort" aria-label="Ordenar metas"><option value="priority">Prioridade</option><option value="deadline">Prazo</option><option value="progress">Progresso</option><option value="name">Nome</option></select></label></div>
    </section>

    <div v-if="!goals.length" class="goals-empty">
      <span><UiIcon name="target" :size="28" /></span>
      <h2>Defina o próximo resultado da empresa</h2>
      <p>Metas de faturamento, lucro, pedidos e ticket médio são atualizadas automaticamente pelas vendas do período.</p>
      <NuxtLink class="btn btn--primary" to="/metas/nova"><UiIcon name="plus" />Criar primeira meta</NuxtLink>
    </div>
    <div v-else-if="!visibleGoals.length" class="goals-empty goals-empty--compact">
      <span><UiIcon name="search" :size="24" /></span><h2>Nenhuma meta encontrada</h2><p>Altere a busca ou selecione outro estado.</p>
    </div>

    <section v-else class="goals-grid" aria-label="Metas cadastradas">
      <article v-for="goal in visibleGoals" :key="goal.id || goal.name" class="goal-card" :style="{ '--goal-color': metaFor(goal).color }">
        <header class="goal-card__head">
          <span class="goal-card__icon"><UiIcon :name="metaFor(goal).icon" :size="20" /></span>
          <div class="goal-card__title"><span>{{ metaFor(goal).label }}</span><h2>{{ goal.name }}</h2><small><UiIcon name="calendar" :size="13" />{{ periodText(goal) }}</small></div>
          <span class="badge" :class="stateFor(goal).badge">{{ stateFor(goal).label }}</span>
          <div class="goal-card__actions"><button class="row-action" type="button" title="Editar meta" @click="editGoal(goal)"><UiIcon name="edit" :size="15" /></button><button class="row-action" type="button" title="Duplicar meta" @click="duplicateGoal(goal)"><UiIcon name="plus" :size="15" /></button><button class="row-action" type="button" title="Excluir meta" :disabled="deletingId === String(goal.id)" @click="removeGoal(goal)"><UiIcon name="close" :size="16" /></button></div>
        </header>

        <div class="goal-card__result">
          <div><small>Resultado atual</small><strong>{{ formatGoalValue(goal, goal.current) }}</strong></div>
          <div><small>Objetivo</small><strong>{{ formatGoalValue(goal, goal.target) }}</strong></div>
          <b>{{ goalProgress(goal).toFixed(0) }}%</b>
        </div>
        <div class="goal-progress" role="progressbar" :aria-label="`Progresso da meta ${goal.name}`" :aria-valuenow="goalProgress(goal)" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${goalProgress(goal)}%` }" /></div>

        <footer class="goal-card__footer">
          <div><span>Falta alcançar</span><strong>{{ formatGoalValue(goal, remaining(goal)) }}</strong></div>
          <div><span>Ritmo necessário</span><strong>{{ paceText(goal) }}</strong></div>
          <div><span>Prazo</span><strong :class="{ 'money-negative': (daysUntil(goal.periodEnd) ?? 0) < 0 && goalProgress(goal) < 100 }">{{ deadlineText(goal) }}</strong></div>
          <div><span>Ritmo esperado</span><strong>{{ expectedProgress(goal).toFixed(0) }}% até hoje</strong></div>
        </footer>
      </article>
    </section>
  </div>
</template>

<style scoped>
.goals-page{display:grid;gap:18px;max-width:1440px;margin:0 auto;padding-bottom:24px}.goals-metrics{margin-bottom:0}.goals-focus{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:15px;min-height:96px;padding:17px 18px;border:1px solid #dce7f7;border-left:4px solid var(--focus-color);border-radius:14px;background:radial-gradient(circle at 92% 0%,color-mix(in srgb,var(--focus-color) 9%,transparent),transparent 32%),linear-gradient(110deg,#fff,#f8fbff);box-shadow:0 7px 22px rgba(29,53,91,.045)}.goals-focus--attention{border-color:#f1d9c3;border-left-color:#e88932;background:linear-gradient(110deg,#fff,#fffaf5)}.goals-focus__icon{display:grid;width:43px;height:43px;place-items:center;border-radius:12px;color:var(--focus-color);background:color-mix(in srgb,var(--focus-color) 10%,white)}.goals-focus--attention .goals-focus__icon{color:#db7217;background:#fff0e1}.goals-focus__copy>span{color:#738198;font-size:9px;font-weight:800;letter-spacing:.12em}.goals-focus__copy h2{margin:4px 0 3px;color:#16223b;font-size:15px}.goals-focus__copy p{margin:0;color:#68758b;font-size:11px;line-height:1.5}.goals-focus__copy p strong{color:#34425d}.goals-focus__progress{display:grid;min-width:130px;gap:2px;border-left:1px solid #e4eaf2;padding-left:17px}.goals-focus__progress span,.goals-focus__progress small{color:#7a879a;font-size:9px}.goals-focus__progress strong{color:#17233c;font-size:23px;line-height:1}.goals-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px;border:1px solid #dce4f0;border-radius:13px;background:#fff;box-shadow:0 4px 14px rgba(26,43,68,.025)}.goals-tabs{display:flex;align-items:center;gap:5px;overflow:auto}.goals-tabs button{display:flex;align-items:center;gap:7px;min-height:36px;border:0;border-radius:8px;padding:0 11px;background:transparent;color:#5d687a;cursor:pointer}.goals-tabs button:hover{background:#f4f7fb}.goals-tabs button.active{background:#edf3ff;color:#1768f2;font-weight:700}.goals-tabs strong{display:grid;min-width:20px;height:20px;place-items:center;border-radius:10px;background:#e7ebf2;font-size:10px}.goals-tabs button.active strong{background:#1768f2;color:#fff}.goals-toolbar__right{display:flex;align-items:center;gap:8px}.goals-search{display:flex;align-items:center;gap:8px;min-width:230px;border:1px solid #d8deea;border-radius:8px;padding:0 10px;color:#7a8596}.goals-search:focus-within{border-color:#1768f2;box-shadow:0 0 0 3px rgba(23,104,242,.1)}.goals-search input{width:100%;min-height:36px;border:0;outline:0;background:transparent}.goals-sort{display:flex;align-items:center;gap:7px;min-height:38px;border:1px solid #d8deea;border-radius:8px;padding:0 8px 0 10px;color:#7a8596;font-size:9px}.goals-sort select{border:0;outline:0;background:transparent;color:#34425c;font-size:10px;font-weight:700}.goals-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.goal-card{overflow:hidden;border:1px solid #dce4f0;border-top:3px solid var(--goal-color);border-radius:14px;background:#fff;box-shadow:0 4px 14px rgba(26,43,68,.04);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}.goal-card:hover{transform:translateY(-1px);box-shadow:0 10px 25px rgba(26,43,68,.07)}.goal-card__head{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:start;gap:11px;padding:17px 18px 13px}.goal-card__icon{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:color-mix(in srgb,var(--goal-color) 10%,white);color:var(--goal-color)}.goal-card__title{min-width:0}.goal-card__title>span{color:var(--goal-color);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em}.goal-card__title h2{overflow:hidden;margin:3px 0 5px;color:#172033;font-size:16px;text-overflow:ellipsis;white-space:nowrap}.goal-card__title small{display:flex;align-items:center;gap:5px;color:#687386}.goal-card__actions{display:flex;gap:3px}.goal-card__result{display:grid;grid-template-columns:1fr 1fr auto;align-items:end;gap:16px;padding:12px 18px}.goal-card__result>div{display:grid;gap:3px}.goal-card__result small,.goal-card__footer span{color:#687386;font-size:10px}.goal-card__result strong{color:#172033;font-size:19px}.goal-card__result b{color:var(--goal-color);font-size:25px}.goal-progress{overflow:hidden;height:8px;margin:0 18px;border-radius:5px;background:#edf0f5}.goal-progress span{display:block;height:100%;border-radius:inherit;background:var(--goal-color);transition:width .25s ease}.goal-card__footer{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin-top:16px;border-top:1px solid #edf0f5;background:#edf0f5}.goal-card__footer div{display:grid;gap:3px;padding:12px 14px;background:#fafbfd}.goal-card__footer strong{color:#38445a;font-size:11px}.goals-empty{display:grid;min-height:310px;place-items:center;align-content:center;gap:8px;border:1px dashed #ccd6e5;border-radius:14px;background:#fafbfd;text-align:center}.goals-empty>span{display:grid;width:54px;height:54px;place-items:center;border-radius:14px;background:#edf3ff;color:#1768f2}.goals-empty h2{margin:4px 0 0;color:#172033;font-size:19px}.goals-empty p{max-width:500px;margin:0 0 8px;color:#687386;font-size:12px;line-height:1.5}.goals-empty--compact{min-height:220px}
@media(max-width:1180px){.goals-focus{grid-template-columns:auto minmax(0,1fr) auto}.goals-focus>.btn{grid-column:2/4;justify-self:end}.goals-toolbar{align-items:stretch;flex-direction:column}.goals-toolbar__right{justify-content:flex-end}}
@media(max-width:1050px){.goals-grid{grid-template-columns:1fr}.goal-card__footer strong{font-size:12px}}
@media(max-width:720px){.goals-focus{grid-template-columns:auto minmax(0,1fr);padding:15px}.goals-focus__progress{grid-column:2;border-left:0;padding-left:0}.goals-focus>.btn{grid-column:1/-1;width:100%;justify-content:center}.goals-toolbar__right{align-items:stretch;flex-direction:column}.goals-search{min-width:0}.goals-sort{justify-content:space-between}.goal-card__head{grid-template-columns:auto minmax(0,1fr) auto}.goal-card__head>.badge{grid-column:2}.goal-card__actions{grid-column:3;grid-row:1}.goal-card__footer{grid-template-columns:1fr 1fr}.goal-card__result{grid-template-columns:1fr 1fr}.goal-card__result b{grid-column:1/-1}.goals-tabs button{white-space:nowrap}}
@media(max-width:480px){.goal-card__footer{grid-template-columns:1fr}.goals-focus__copy p{font-size:10px}}
</style>
