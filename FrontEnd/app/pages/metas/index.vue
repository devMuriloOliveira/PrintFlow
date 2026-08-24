<script setup lang="ts">
const { goals, deleteItem } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()
const router = useRouter()
const editGoal = (goal: any) => {
  if (!goal.id) return
  router.push(`/metas/nova?id=${goal.id}`)
}
const removeGoal = async (goal: any) => {
  if (!goal.id || !window.confirm(`Excluir meta?\n\n${goal.name}\n\nEsta ação não poderá ser desfeita.`)) return
  await deleteItem('goals', goal.id)
  notify('Meta excluída com sucesso.')
}
</script>

<template>
  <div>
    <PageHeader title="Metas" subtitle="Defina objetivos e acompanhe a evolução do seu negócio."><NuxtLink class="btn btn--primary" to="/metas/nova"><UiIcon name="plus" />Nova Meta</NuxtLink></PageHeader>
    <div class="metrics-grid metrics-grid--4"><MetricCard label="Metas Ativas" :value="formatNumber(metrics.activeGoals.value)" icon="target" note="Dados do banco" /><MetricCard label="Progresso Médio" :value="metrics.percent(metrics.goalsProgress.value)" icon="chart" note="Dados do banco" color="green" /><MetricCard label="Metas Concluídas" :value="formatNumber(metrics.completedGoals.value)" icon="check" note="Dados do banco" color="purple" /><MetricCard label="Próxima Conclusão" :value="metrics.nextGoal.value?.name || '-'" icon="trend" :change="metrics.nextGoal.value ? `Faltam ${formatCurrency(metrics.nextGoal.value.target - metrics.nextGoal.value.current)}` : ''" color="orange" /></div>
    <div class="dashboard-grid" style="grid-template-columns:repeat(2,1fr)">
      <PanelCard v-for="g in goals" :key="g.id || g.name">
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:20px">
          <span class="metric-card__icon" :style="{color:g.color}"><UiIcon :name="g.icon" /></span>
          <div class="table-product table-product--editable" style="min-width:0"><div><h3 style="margin:0 0 4px">{{g.name}}</h3><small style="color:var(--muted)">Período atual</small></div><button class="row-action row-action--edit" title="Editar meta" @click.stop="editGoal(g)"><UiIcon name="edit" :size="15" /></button></div>
          <span class="badge badge--green" style="margin-left:auto">{{g.status || 'Ativa'}}</span>
          <button class="row-action" title="Excluir meta" @click.stop="removeGoal(g)"><UiIcon name="close" :size="16" /></button>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:9px"><strong>{{g.name.includes('pedidos')?formatNumber(g.current):g.name.includes('Reducao')?`${g.current}%`:formatCurrency(g.current)}}</strong><span style="color:var(--muted)">de {{g.name.includes('pedidos')?formatNumber(g.target):g.name.includes('Reducao')?`${g.target}%`:formatCurrency(g.target)}}</span></div>
        <div class="progress"><span :style="{width:`${Math.min(g.current/g.target*100,100)}%`,background:g.color}" /></div>
        <small style="display:block;color:var(--muted);margin-top:8px">{{(g.current/g.target*100).toFixed(0)}}% concluído</small>
      </PanelCard>
    </div>
  </div>
</template>
