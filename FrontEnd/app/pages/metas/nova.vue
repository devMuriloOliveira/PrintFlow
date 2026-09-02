<script setup lang="ts">
import { computed, nextTick, reactive, ref, watchEffect } from 'vue'
import { navigateTo } from '#app'

const { goals, createItem, updateItem } = useAppData()
const { notify } = useUi()
const route = useRoute()
const saving = ref(false)
const goalTypes = [{ name: 'Faturamento', icon: 'trend', color: '#1768f2', format: 'currency' }, { name: 'Lucro', icon: 'money', color: '#0da566', format: 'currency' }, { name: 'Pedidos', icon: 'bag', color: '#7c3aed', format: 'number' }, { name: 'Ticket Médio', icon: 'tag', color: '#f57c1f', format: 'currency' }, { name: 'Redução de Despesas', icon: 'receipt', color: '#ef4444', format: 'percent' }]
const form = reactive({ type: 'Faturamento', name: '', target: 20000, start: '', end: '', shortcut: 'Este mês', compare: false, previous: 0 })
const errors = reactive<Record<string, string>>({})
const editId = computed(() => typeof route.query.id === 'string' ? route.query.id : '')
const isEditing = computed(() => Boolean(editId.value))
const hydrated = ref(false)
const selected = computed(() => goalTypes.find(x => x.name === form.type) || goalTypes[0])
const progress = computed(() => 0)
const formatted = (value: number) => selected.value.format === 'currency' ? formatCurrency(value) : selected.value.format === 'percent' ? `${value}%` : formatNumber(value)
watchEffect(() => {
  if (!editId.value || hydrated.value) return
  const goal = goals.value.find(item => item.id === editId.value)
  if (!goal) return
  const type = goalTypes.find(item => item.icon === goal.icon)?.name || 'Faturamento'
  Object.assign(form, { type, name: goal.name, target: goal.target, start: goal.periodStart || '', end: goal.periodEnd || '' })
  hydrated.value = true
})
const validate = () => {
  Object.keys(errors).forEach(key => delete errors[key])
  if (!form.name.trim()) errors.name = 'Informe o nome da meta.'
  if (!form.target || form.target <= 0) errors.target = 'Informe o valor desejado.'
  if (!form.start) errors.start = 'Informe a data inicial.'
  if (!form.end) errors.end = 'Informe a data final.'
  const first = Object.keys(errors)[0]
  if (first) nextTick(() => document.querySelector(`[data-field="${first}"] input`)?.focus())
  return !first
}
const save = async () => {
  if (!validate()) return
  if (saving.value) return
  saving.value = true
  try {
    const payload = { id: editId.value, name: form.name, current: goals.value.find(item => item.id === editId.value)?.current || 0, target: form.target, color: selected.value.color, icon: selected.value.icon, periodStart: form.start, periodEnd: form.end, status: 'Ativa' }
    if (isEditing.value) await updateItem('goals', payload)
    else await createItem('goals', payload)
    notify(isEditing.value ? 'Meta atualizada com sucesso.' : 'Meta cadastrada com sucesso.')
    navigateTo('/metas')
  } finally {
    saving.value = false
  }
}
const cancel = () => {
  if ((!form.name && !form.start && !form.end) || window.confirm('Descartar alterações?\n\nAs informações preenchidas ainda não foram salvas.')) navigateTo('/metas')
}
</script>

<template>
  <div>
    <div class="breadcrumb"><span>Metas</span><UiIcon name="chevron" :size="12" /><strong>{{ isEditing ? 'Editar Meta' : 'Nova Meta' }}</strong></div>
    <PageHeader :title="isEditing ? 'Editar Meta' : 'Nova Meta'" :subtitle="isEditing ? 'Atualize objetivo, período e valor esperado.' : 'Crie uma nova meta e acompanhe a evolução do seu negócio.'" />
    <div class="split-layout" style="grid-template-columns:minmax(0,1fr) 330px">
      <form @submit.prevent="save">
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="target" />1. Tipo da Meta</h2><div class="choice-grid"><button v-for="type in goalTypes" :key="type.name" class="choice-card" :class="{active:form.type===type.name}" type="button" @click="form.type=type.name"><UiIcon :name="type.icon" :style="{color:type.color}" /><strong>{{type.name}}</strong><small>{{type.format === 'currency' ? 'Valor financeiro' : type.format === 'percent' ? 'Percentual' : 'Quantidade'}}</small></button></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="edit" />2. Definição da Meta</h2><div class="form-grid"><div class="field col-7" data-field="name" :class="{'field--error':errors.name}"><label>Nome da meta *</label><input v-model="form.name" placeholder="Faturamento de Agosto"><small v-if="errors.name" class="field__error">{{errors.name}}</small></div><div class="field col-5" data-field="target" :class="{'field--error':errors.target}"><label>Valor desejado *</label><input v-model.number="form.target" type="number" step=".01"><small v-if="errors.target" class="field__error">{{errors.target}}</small></div></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="calendar" />3. Período</h2><div class="form-grid"><div class="field col-4" data-field="start" :class="{'field--error':errors.start}"><label>Data inicial *</label><input v-model="form.start" type="date"><small v-if="errors.start" class="field__error">{{errors.start}}</small></div><div class="field col-4" data-field="end" :class="{'field--error':errors.end}"><label>Data final *</label><input v-model="form.end" type="date"><small v-if="errors.end" class="field__error">{{errors.end}}</small></div><div class="field col-4"><label>Atalho</label><select v-model="form.shortcut"><option>Este mês</option><option>Próximo mês</option><option>Este trimestre</option><option>Este ano</option><option>Personalizado</option></select></div></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="chart" />4. Comparação</h2><div class="form-grid"><div class="field col-5"><label>Comparar com período anterior</label><div class="switch-row"><span>{{form.compare ? 'Ativado' : 'Desativado'}}</span><button type="button" class="switch" :class="{active:form.compare}" @click="form.compare=!form.compare" /></div></div><div v-if="form.compare" class="field col-4"><label>Valor período anterior</label><input v-model.number="form.previous" type="number" step=".01"></div></div></div>
        <div class="form-actions"><button class="btn" type="button" @click="cancel">Cancelar</button><button class="btn btn--primary" type="submit" :disabled="saving">{{ saving ? 'Salvando...' : isEditing ? 'Salvar Alterações' : 'Criar Meta' }}</button></div>
      </form>
      <aside class="detail-card"><div class="detail-card__head"><span class="metric-card__icon" :style="{color:selected.color}"><UiIcon :name="selected.icon" /></span><div><h3>Meta de {{form.type}}</h3><p>{{form.name || 'Nome da meta'}}</p></div></div><div class="detail-card__body"><div style="display:flex;justify-content:space-between;margin-bottom:9px"><strong>{{formatted(0)}}</strong><span style="color:var(--muted)">de {{formatted(form.target)}}</span></div><div class="progress"><span :style="{width:`${progress}%`,background:selected.color}" /></div><small style="display:block;color:var(--muted);margin-top:8px">{{progress}}% concluído</small><div class="summary-box"><div class="detail-list__row"><span>Período</span><strong>{{form.start || '-'}} - {{form.end || '-'}}</strong></div><div class="detail-list__row"><span>Dias restantes</span><strong>31 dias</strong></div></div><div class="info-note" style="margin-top:12px"><UiIcon name="info" :size="18" />O progresso será atualizado automaticamente conforme novas vendas forem registradas.</div></div></aside>
    </div>
  </div>
</template>
