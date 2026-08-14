<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { navigateTo } from '#app'

const { createItem } = useAppData()
const { notify } = useUi()
const saving = ref(false)
const goalTypes = [{ name: 'Faturamento', icon: 'trend', color: '#1768f2', format: 'currency' }, { name: 'Lucro', icon: 'money', color: '#0da566', format: 'currency' }, { name: 'Pedidos', icon: 'bag', color: '#7c3aed', format: 'number' }, { name: 'Ticket Medio', icon: 'tag', color: '#f57c1f', format: 'currency' }, { name: 'Reducao de Despesas', icon: 'receipt', color: '#ef4444', format: 'percent' }]
const form = reactive({ type: 'Faturamento', name: '', target: 20000, start: '', end: '', shortcut: 'Este mes', compare: false, previous: 0 })
const errors = reactive<Record<string, string>>({})
const selected = computed(() => goalTypes.find(x => x.name === form.type) || goalTypes[0])
const progress = computed(() => 0)
const formatted = (value: number) => selected.value.format === 'currency' ? formatCurrency(value) : selected.value.format === 'percent' ? `${value}%` : formatNumber(value)
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
    await createItem('goals', { name: form.name, current: 0, target: form.target, color: selected.value.color, icon: selected.value.icon, periodStart: form.start, periodEnd: form.end, status: 'Ativa' })
    notify('Meta cadastrada com sucesso.')
    navigateTo('/metas')
  } finally {
    saving.value = false
  }
}
const cancel = () => {
  if ((!form.name && !form.start && !form.end) || window.confirm('Descartar alteracoes?\n\nAs informacoes preenchidas ainda nao foram salvas.')) navigateTo('/metas')
}
</script>

<template>
  <div>
    <div class="breadcrumb"><span>Metas</span><UiIcon name="chevron" :size="12" /><strong>Nova Meta</strong></div>
    <PageHeader title="Nova Meta" subtitle="Crie uma nova meta e acompanhe a evolucao do seu negocio." />
    <div class="split-layout" style="grid-template-columns:minmax(0,1fr) 330px">
      <form @submit.prevent="save">
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="target" />1. Tipo da Meta</h2><div class="choice-grid"><button v-for="type in goalTypes" :key="type.name" class="choice-card" :class="{active:form.type===type.name}" type="button" @click="form.type=type.name"><UiIcon :name="type.icon" :style="{color:type.color}" /><strong>{{type.name}}</strong><small>{{type.format === 'currency' ? 'Valor financeiro' : type.format === 'percent' ? 'Percentual' : 'Quantidade'}}</small></button></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="edit" />2. Definicao da Meta</h2><div class="form-grid"><div class="field col-7" data-field="name" :class="{'field--error':errors.name}"><label>Nome da meta *</label><input v-model="form.name" placeholder="Faturamento de Agosto"><small v-if="errors.name" class="field__error">{{errors.name}}</small></div><div class="field col-5" data-field="target" :class="{'field--error':errors.target}"><label>Valor desejado *</label><input v-model.number="form.target" type="number" step=".01"><small v-if="errors.target" class="field__error">{{errors.target}}</small></div></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="calendar" />3. Periodo</h2><div class="form-grid"><div class="field col-4" data-field="start" :class="{'field--error':errors.start}"><label>Data inicial *</label><input v-model="form.start" type="date"><small v-if="errors.start" class="field__error">{{errors.start}}</small></div><div class="field col-4" data-field="end" :class="{'field--error':errors.end}"><label>Data final *</label><input v-model="form.end" type="date"><small v-if="errors.end" class="field__error">{{errors.end}}</small></div><div class="field col-4"><label>Atalho</label><select v-model="form.shortcut"><option>Este mes</option><option>Proximo mes</option><option>Este trimestre</option><option>Este ano</option><option>Personalizado</option></select></div></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="chart" />4. Comparacao</h2><div class="form-grid"><div class="field col-5"><label>Comparar com periodo anterior</label><div class="switch-row"><span>{{form.compare ? 'Ativado' : 'Desativado'}}</span><button type="button" class="switch" :class="{active:form.compare}" @click="form.compare=!form.compare" /></div></div><div v-if="form.compare" class="field col-4"><label>Valor periodo anterior</label><input v-model.number="form.previous" type="number" step=".01"></div></div></div>
        <div class="form-actions"><button class="btn" type="button" @click="cancel">Cancelar</button><button class="btn btn--primary" type="submit" :disabled="saving">{{ saving ? 'Salvando...' : 'Criar Meta' }}</button></div>
      </form>
      <aside class="detail-card"><div class="detail-card__head"><span class="metric-card__icon" :style="{color:selected.color}"><UiIcon :name="selected.icon" /></span><div><h3>Meta de {{form.type}}</h3><p>{{form.name || 'Nome da meta'}}</p></div></div><div class="detail-card__body"><div style="display:flex;justify-content:space-between;margin-bottom:9px"><strong>{{formatted(0)}}</strong><span style="color:var(--muted)">de {{formatted(form.target)}}</span></div><div class="progress"><span :style="{width:`${progress}%`,background:selected.color}" /></div><small style="display:block;color:var(--muted);margin-top:8px">{{progress}}% concluido</small><div class="summary-box"><div class="detail-list__row"><span>Periodo</span><strong>{{form.start || '-'}} - {{form.end || '-'}}</strong></div><div class="detail-list__row"><span>Dias restantes</span><strong>31 dias</strong></div></div><div class="info-note" style="margin-top:12px"><UiIcon name="info" :size="18" />O progresso sera atualizado automaticamente conforme novas vendas forem registradas.</div></div></aside>
    </div>
  </div>
</template>
