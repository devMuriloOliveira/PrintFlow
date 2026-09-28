<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watchEffect } from 'vue'
import { navigateTo } from '#app'

const { goals, createItem, updateItem } = useAppData()
const { notify } = useUi()
const route = useRoute()
const saving = ref(false)
const goalTypes = [
  { key: 'revenue', name: 'Faturamento', icon: 'trend', color: '#1768f2', format: 'currency', description: 'Receita bruta das vendas', source: 'Soma o valor bruto das vendas não canceladas no período.' },
  { key: 'profit', name: 'Lucro', icon: 'money', color: '#0da566', format: 'currency', description: 'Resultado após custos', source: 'Soma o lucro calculado das vendas não canceladas no período.' },
  { key: 'orders', name: 'Pedidos', icon: 'bag', color: '#7c3aed', format: 'number', description: 'Volume de vendas', source: 'Conta os pedidos e vendas acompanhadas no período.' },
  { key: 'average_ticket', name: 'Ticket Médio', icon: 'tag', color: '#f57c1f', format: 'currency', description: 'Valor médio por pedido', source: 'Divide o faturamento pela quantidade de vendas do período.' }
]
const form = reactive({ type: 'Faturamento', name: '', target: 20000, start: '', end: '', shortcut: 'Este mês' })
const errors = reactive<Record<string, string>>({})
const editId = computed(() => typeof route.query.id === 'string' ? route.query.id : '')
const duplicateId = computed(() => typeof route.query.duplicar === 'string' ? route.query.duplicar : '')
const isEditing = computed(() => Boolean(editId.value))
const sourceGoal = computed(() => goals.value.find(item => item.id === (editId.value || duplicateId.value)))
const hydrated = ref(false)
const selected = computed(() => goalTypes.find(x => x.name === form.type) || goalTypes[0])
const goalTypeKey = computed(() => selected.value.key)
const progress = computed(() => {
  const current = isEditing.value ? sourceGoal.value?.current || 0 : 0
  return form.target > 0 ? Math.min(100, Math.max(0, Number((current / form.target * 100).toFixed(1)))) : 0
})
const remainingDays = computed(() => form.end ? Math.max(0, Math.ceil((new Date(`${form.end}T23:59:59`).getTime() - Date.now()) / 86400000)) : 0)
const remainingValue = computed(() => Math.max(0, Number(form.target || 0) - Number(isEditing.value ? sourceGoal.value?.current || 0 : 0)))
const paceDays = computed(() => {
  if (!form.end) return 0
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const start = form.start ? new Date(`${form.start}T00:00:00`) : today
  const end = new Date(`${form.end}T00:00:00`)
  const anchor = start > today ? start : today
  return end >= anchor ? Math.floor((end.getTime() - anchor.getTime()) / 86400000) + 1 : 0
})
const dailyPace = computed(() => paceDays.value ? remainingValue.value / paceDays.value : 0)
const pacePreview = computed(() => {
  if (selected.value.key === 'average_ticket') return {
    title: 'REFERÊNCIA POR PEDIDO', value: `${formatted(form.target)} de ticket alvo`, detail: isEditing.value ? `diferença atual de ${formatted(remainingValue.value)}` : 'o progresso usa a média real das vendas'
  }
  if (!paceDays.value) return { title: 'RITMO NECESSÁRIO', value: 'Prazo encerrado', detail: 'revise o período para retomar o acompanhamento' }
  return { title: 'RITMO NECESSÁRIO', value: `${formatted(dailyPace.value)} por dia`, detail: `para cobrir o restante em ${paceDays.value} dia(s) disponíveis` }
})
const formatted = (value: number) => selected.value.format === 'currency' ? formatCurrency(value) : formatNumber(value)
const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const applyShortcut = () => {
  if (form.shortcut === 'Personalizado') return
  const now = new Date()
  let start = new Date(now.getFullYear(), now.getMonth(), 1)
  let end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  if (form.shortcut === 'Próximo mês') {
    start = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    end = new Date(now.getFullYear(), now.getMonth() + 2, 0)
  } else if (form.shortcut === 'Este trimestre') {
    const quarterStart = Math.floor(now.getMonth() / 3) * 3
    start = new Date(now.getFullYear(), quarterStart, 1)
    end = new Date(now.getFullYear(), quarterStart + 3, 0)
  } else if (form.shortcut === 'Este ano') {
    start = new Date(now.getFullYear(), 0, 1)
    end = new Date(now.getFullYear(), 11, 31)
  }
  form.start = isoDate(start)
  form.end = isoDate(end)
}
const useCustomPeriod = () => { form.shortcut = 'Personalizado' }
watchEffect(() => {
  if ((!editId.value && !duplicateId.value) || hydrated.value) return
  const goal = sourceGoal.value
  if (!goal) return
  const type = goalTypes.find(item => item.key === goal.goalType)?.name || goalTypes.find(item => item.icon === goal.icon)?.name || 'Faturamento'
  Object.assign(form, { type, name: duplicateId.value ? `${goal.name} (cópia)` : goal.name, target: goal.target, start: goal.periodStart || '', end: goal.periodEnd || '', shortcut: 'Personalizado' })
  hydrated.value = true
})
const validate = () => {
  Object.keys(errors).forEach(key => delete errors[key])
  if (!form.name.trim()) errors.name = 'Informe o nome da meta.'
  if (!form.target || form.target <= 0) errors.target = 'Informe o valor desejado.'
  if (!form.start) errors.start = 'Informe a data inicial.'
  if (!form.end) errors.end = 'Informe a data final.'
  if (form.start && form.end && form.end < form.start) errors.end = 'A data final deve ser posterior à inicial.'
  const first = Object.keys(errors)[0]
  if (first) nextTick(() => document.querySelector(`[data-field="${first}"] input`)?.focus())
  return !first
}
const save = async () => {
  if (!validate()) return
  if (saving.value) return
  saving.value = true
  try {
    const payload = { id: editId.value, name: form.name.trim(), goalType: goalTypeKey.value, current: isEditing.value ? sourceGoal.value?.current || 0 : 0, target: form.target, color: selected.value.color, icon: selected.value.icon, periodStart: form.start, periodEnd: form.end, status: isEditing.value ? sourceGoal.value?.status || 'Ativa' : 'Ativa' }
    if (isEditing.value) await updateItem('goals', payload)
    else await createItem('goals', payload)
    notify(isEditing.value ? 'Meta atualizada com sucesso.' : 'Meta cadastrada com sucesso.')
    navigateTo('/metas')
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Não foi possível salvar a meta.', 'info')
  } finally {
    saving.value = false
  }
}
onMounted(() => { if (!isEditing.value && !duplicateId.value) applyShortcut() })
const cancel = () => {
  if ((!form.name && !form.start && !form.end) || window.confirm('Descartar alterações?\n\nAs informações preenchidas ainda não foram salvas.')) navigateTo('/metas')
}
</script>

<template>
  <main class="goal-editor">
    <div class="breadcrumb"><span>Planejamento</span><UiIcon name="chevron" :size="12" /><span>Metas</span><UiIcon name="chevron" :size="12" /><strong>{{ isEditing ? 'Editar meta' : duplicateId ? 'Duplicar meta' : 'Nova meta' }}</strong></div>
    <header class="goal-editor__hero">
      <span><UiIcon name="target" :size="22" /></span><div><small>PLANEJAMENTO DE RESULTADOS</small><h1>{{ isEditing ? 'Revisar objetivo' : duplicateId ? 'Replicar uma meta' : 'Definir nova meta' }}</h1><p>Escolha um indicador, um resultado desejado e o prazo para alcançá-lo.</p></div>
    </header>

    <div class="goal-editor__layout">
      <form class="goal-editor__form" @submit.prevent="save">
        <section class="goal-section">
          <div class="goal-section__heading"><span>01</span><div><small>INDICADOR</small><h2>O que você quer melhorar?</h2><p>O resultado será atualizado automaticamente a partir das vendas.</p></div></div>
          <div class="goal-type-grid">
            <button v-for="type in goalTypes" :key="type.key" class="goal-type" :class="{ 'goal-type--active': form.type === type.name }" :style="{ '--type-color': type.color }" type="button" @click="form.type=type.name">
              <span class="goal-type__icon"><UiIcon :name="type.icon" :size="19" /></span><span><strong>{{type.name}}</strong><small>{{type.description}}</small></span><i><UiIcon name="check" :size="12" /></i>
            </button>
          </div>
          <div class="goal-data-source"><UiIcon name="info" :size="16" /><span><strong>Como é calculada:</strong> {{ selected.source }}</span></div>
        </section>

        <section class="goal-section">
          <div class="goal-section__heading"><span>02</span><div><small>OBJETIVO</small><h2>Qual resultado precisa ser alcançado?</h2><p>Use um nome curto e um alvo que seja fácil de reconhecer.</p></div></div>
          <div class="form-grid goal-section__fields">
            <div class="field col-7" data-field="name" :class="{'field--error':errors.name}"><label>Nome da meta <b>*</b></label><input v-model="form.name" :placeholder="`${form.type} do período`"><small v-if="errors.name" class="field__error">{{errors.name}}</small></div>
            <div class="field col-5" data-field="target" :class="{'field--error':errors.target}"><label>{{ selected.format === 'number' ? 'Quantidade desejada' : 'Valor desejado' }} <b>*</b></label><div class="goal-target-input"><span v-if="selected.format === 'currency'">R$</span><input v-model.number="form.target" type="number" min="0.01" :step="selected.format === 'number' ? 1 : .01"></div><small v-if="errors.target" class="field__error">{{errors.target}}</small></div>
          </div>
        </section>

        <section class="goal-section">
          <div class="goal-section__heading"><span>03</span><div><small>PRAZO</small><h2>Quando essa meta deve acontecer?</h2><p>O sistema compara o progresso real com o tempo já consumido.</p></div></div>
          <div class="goal-shortcuts" aria-label="Atalhos de período"><button v-for="shortcut in ['Este mês','Próximo mês','Este trimestre','Este ano']" :key="shortcut" type="button" :class="{ active: form.shortcut === shortcut }" @click="form.shortcut=shortcut;applyShortcut()">{{shortcut}}</button><button type="button" :class="{ active: form.shortcut === 'Personalizado' }" @click="useCustomPeriod">Personalizado</button></div>
          <div class="form-grid goal-section__fields goal-period-fields">
            <div class="field col-6" data-field="start" :class="{'field--error':errors.start}"><label>Data inicial <b>*</b></label><UiDateInput v-model="form.start" aria-label="Data inicial" @change="useCustomPeriod" /><small v-if="errors.start" class="field__error">{{errors.start}}</small></div>
            <div class="field col-6" data-field="end" :class="{'field--error':errors.end}"><label>Data final <b>*</b></label><UiDateInput v-model="form.end" aria-label="Data final" @change="useCustomPeriod" /><small v-if="errors.end" class="field__error">{{errors.end}}</small></div>
          </div>
        </section>

        <div class="goal-editor__actions"><button class="btn" type="button" @click="cancel">Cancelar</button><button class="btn btn--primary" type="submit" :disabled="saving"><UiIcon name="check" :size="16" />{{ saving ? 'Salvando...' : isEditing ? 'Salvar alterações' : duplicateId ? 'Criar cópia' : 'Criar meta' }}</button></div>
      </form>

      <aside class="goal-preview" :style="{ '--goal-color': selected.color }">
        <div class="goal-preview__card">
          <div class="goal-preview__header"><span><UiIcon :name="selected.icon" :size="20" /></span><div><small>PRÉVIA DA META</small><h2>{{form.name || `${form.type} do período`}}</h2><p>{{form.type}}</p></div></div>
          <div class="goal-preview__numbers"><div><span>Resultado atual</span><strong>{{formatted(isEditing ? sourceGoal?.current || 0 : 0)}}</strong></div><div><span>Objetivo</span><strong>{{formatted(form.target)}}</strong></div></div>
          <div class="goal-preview__progress"><div><span>Progresso</span><strong>{{progress}}%</strong></div><div class="goal-preview__track"><i :style="{width:`${progress}%`}" /></div></div>
          <div class="goal-preview__pace"><span><UiIcon name="trend" :size="17" /></span><div><small>{{pacePreview.title}}</small><strong>{{pacePreview.value}}</strong><p>{{pacePreview.detail}}</p></div></div>
          <div class="goal-preview__details"><div><span>Início</span><strong>{{form.start || 'A definir'}}</strong></div><div><span>Encerramento</span><strong>{{form.end || 'A definir'}}</strong></div><div><span>Falta alcançar</span><strong>{{formatted(remainingValue)}}</strong></div></div>
          <div class="goal-preview__note"><UiIcon name="info" :size="15" /><span>Vendas canceladas não entram no progresso desta meta.</span></div>
        </div>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.goal-editor{--goal-ink:#16223b;--goal-muted:#748198;max-width:1420px;margin:0 auto;padding-bottom:24px}.goal-editor__hero{display:flex;align-items:center;gap:14px;margin:4px 0 20px;padding:19px 21px;border:1px solid #dfe8f5;border-radius:16px;background:radial-gradient(circle at 95% 0%,rgba(23,104,242,.09),transparent 34%),linear-gradient(115deg,#fff,#f8fbff);box-shadow:0 8px 24px rgba(21,48,91,.04)}.goal-editor__hero>span{display:grid;width:49px;height:49px;flex:0 0 auto;place-items:center;border:1px solid #d8e6fb;border-radius:14px;color:#1768f2;background:#edf4ff}.goal-editor__hero small,.goal-section__heading small,.goal-preview small{color:#76849a;font-size:9px;font-weight:800;letter-spacing:.11em}.goal-editor__hero h1{margin:4px 0 3px;color:var(--goal-ink);font-size:25px;letter-spacing:-.04em}.goal-editor__hero p{margin:0;color:var(--goal-muted);font-size:11px}.goal-editor__layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;align-items:start;gap:18px}.goal-editor__form{display:grid;min-width:0;gap:13px}.goal-section,.goal-preview__card{border:1px solid #e0e6ef;border-radius:14px;background:#fff;box-shadow:0 5px 18px rgba(19,37,70,.035)}.goal-section{padding:20px 21px}.goal-section:focus-within{border-color:#c5d9fb;box-shadow:0 8px 25px rgba(23,104,242,.055)}.goal-section__heading{display:flex;gap:12px;margin-bottom:18px}.goal-section__heading>span{display:grid;width:34px;height:34px;flex:0 0 auto;place-items:center;border:1px solid #dbe8fb;border-radius:10px;color:#1768f2;background:#f0f6ff;font-size:10px;font-weight:850}.goal-section__heading h2{margin:3px 0 4px;color:var(--goal-ink);font-size:16px}.goal-section__heading p{margin:0;color:var(--goal-muted);font-size:10px;line-height:1.45}.goal-type-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.goal-type{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:11px;min-height:74px;border:1px solid #dfe5ee;border-radius:11px;padding:12px;color:#26344f;background:#fff;text-align:left;cursor:pointer;transition:.18s ease}.goal-type:hover{border-color:color-mix(in srgb,var(--type-color) 42%,#dfe5ee);transform:translateY(-1px);box-shadow:0 7px 17px rgba(25,45,78,.05)}.goal-type--active{border-color:var(--type-color);background:color-mix(in srgb,var(--type-color) 4%,white);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--type-color) 18%,transparent)}.goal-type__icon{display:grid;width:37px;height:37px;place-items:center;border-radius:10px;color:var(--type-color);background:color-mix(in srgb,var(--type-color) 10%,white)}.goal-type strong{display:block;font-size:11px}.goal-type small{display:block;margin-top:3px;color:#79869a;font-size:9px;line-height:1.35}.goal-type>i{display:grid;width:19px;height:19px;place-items:center;border:1px solid #d8e0eb;border-radius:50%;color:transparent}.goal-type--active>i{border-color:var(--type-color);color:#fff;background:var(--type-color)}.goal-data-source{display:flex;align-items:flex-start;gap:8px;margin-top:12px;padding:10px 11px;border-radius:9px;color:#6f7d93;background:#f6f8fb;font-size:9px;line-height:1.5}.goal-data-source :deep(.ui-icon){flex:0 0 auto;color:#6381ab}.goal-data-source strong{color:#40506b}.goal-section__fields{gap:14px}.goal-section :deep(.field){gap:7px}.goal-section :deep(.field label){color:#35425c;font-size:11px;font-weight:700}.goal-section :deep(.field label b){color:#e05261}.goal-section :deep(.field input){min-height:43px;border-color:#d9e1eb;border-radius:8px;color:#1b2944;font-size:12px}.goal-target-input{display:flex;align-items:center;overflow:hidden;border:1px solid #d9e1eb;border-radius:8px}.goal-target-input:focus-within{border-color:#1768f2;box-shadow:0 0 0 3px rgba(23,104,242,.09)}.goal-target-input>span{padding-left:12px;color:#748198;font-size:11px;font-weight:700}.goal-section :deep(.goal-target-input input){min-width:0;border:0;box-shadow:none;font-size:15px;font-weight:750}.goal-section :deep(.goal-target-input input:focus){box-shadow:none}.goal-shortcuts{display:flex;gap:6px;margin-bottom:15px;overflow:auto}.goal-shortcuts button{min-height:33px;border:1px solid #dce3ed;border-radius:8px;padding:0 11px;color:#5f6c82;background:#fff;font-size:10px;font-weight:650;white-space:nowrap;cursor:pointer}.goal-shortcuts button:hover{border-color:#acc6ef;color:#1768f2}.goal-shortcuts button.active{border-color:#1768f2;color:#1768f2;background:#edf4ff}.goal-period-fields{padding-top:1px}.goal-editor__actions{position:sticky;bottom:12px;z-index:3;display:flex;justify-content:flex-end;gap:9px;padding:12px;border:1px solid #dfe6ef;border-radius:13px;background:rgba(255,255,255,.94);box-shadow:0 12px 30px rgba(18,38,74,.11);backdrop-filter:blur(12px)}.goal-preview{position:sticky;top:20px}.goal-preview__card{overflow:hidden;border-top:3px solid var(--goal-color)}.goal-preview__header{display:flex;align-items:center;gap:11px;padding:17px 18px}.goal-preview__header>span{display:grid;width:39px;height:39px;flex:0 0 auto;place-items:center;border-radius:11px;color:var(--goal-color);background:color-mix(in srgb,var(--goal-color) 10%,white)}.goal-preview__header h2{overflow:hidden;margin:3px 0;color:#17243e;font-size:14px;text-overflow:ellipsis;white-space:nowrap}.goal-preview__header p{margin:0;color:var(--goal-color);font-size:9px;font-weight:700}.goal-preview__numbers{display:grid;grid-template-columns:1fr 1fr;gap:1px;border-top:1px solid #edf1f5;border-bottom:1px solid #edf1f5;background:#edf1f5}.goal-preview__numbers>div{display:grid;gap:4px;padding:14px 17px;background:#fafbfd}.goal-preview__numbers span,.goal-preview__progress span,.goal-preview__details span{color:#78859a;font-size:9px}.goal-preview__numbers strong{color:#1b2843;font-size:15px;overflow-wrap:anywhere}.goal-preview__progress{padding:15px 18px}.goal-preview__progress>div:first-child{display:flex;justify-content:space-between;margin-bottom:8px}.goal-preview__progress strong{color:var(--goal-color);font-size:12px}.goal-preview__track{overflow:hidden;height:8px;border-radius:99px;background:#e9edf3}.goal-preview__track i{display:block;height:100%;border-radius:inherit;background:var(--goal-color)}.goal-preview__pace{display:flex;gap:10px;margin:0 13px;padding:12px;border:1px solid color-mix(in srgb,var(--goal-color) 17%,#e4e9f0);border-radius:10px;background:color-mix(in srgb,var(--goal-color) 4%,white)}.goal-preview__pace>span{display:grid;width:33px;height:33px;flex:0 0 auto;place-items:center;border-radius:9px;color:var(--goal-color);background:color-mix(in srgb,var(--goal-color) 10%,white)}.goal-preview__pace strong{display:block;margin:3px 0 2px;color:#24324e;font-size:12px}.goal-preview__pace p{margin:0;color:#78859a;font-size:9px}.goal-preview__details{display:grid;padding:9px 18px}.goal-preview__details>div{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #f0f2f6}.goal-preview__details>div:last-child{border:0}.goal-preview__details strong{max-width:62%;color:#33415b;font-size:10px;text-align:right;overflow-wrap:anywhere}.goal-preview__note{display:flex;align-items:flex-start;gap:7px;margin:0 12px 12px;padding:9px;border-radius:8px;color:#75839a;background:#f6f8fb;font-size:9px;line-height:1.45}.goal-preview__note :deep(.ui-icon){flex:0 0 auto;color:#6683ad}
@media(max-width:980px){.goal-editor__layout{grid-template-columns:1fr}.goal-preview{position:static;grid-row:1}.goal-preview__details{grid-template-columns:repeat(3,1fr);gap:15px}.goal-preview__details>div{display:grid}.goal-preview__details strong{max-width:none;text-align:left}}
@media(max-width:620px){.goal-editor__hero{padding:15px}.goal-editor__hero>span{width:42px;height:42px}.goal-editor__hero h1{font-size:21px}.goal-section{padding:15px}.goal-type-grid{grid-template-columns:1fr}.goal-section__fields>.col-5,.goal-section__fields>.col-6,.goal-section__fields>.col-7{grid-column:span 12}.goal-preview__details{grid-template-columns:1fr;gap:0}.goal-preview__details>div{display:flex}.goal-preview__details strong{text-align:right}.goal-editor__actions{position:static;flex-direction:column-reverse}.goal-editor__actions :deep(.btn){width:100%;justify-content:center}}
</style>
