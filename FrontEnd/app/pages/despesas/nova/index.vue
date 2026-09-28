<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch, watchEffect } from 'vue'
import { navigateTo } from '#app'

const { expenses, createItem, createExpenseInstallments, updateItem } = useAppData()
const { notify } = useUi()
const route = useRoute()
const saving = ref(false)
const form = reactive({ description: '', category: 'Filamento', customCategory: '', supplier: '', value: 0, date: '', payment: 'PIX', creditInstallments: 1, recurring: false, frequency: 'Mensal', nextDue: '', notes: '', status: 'Pago' })
const errors = reactive<Record<string, string>>({})
const editId = computed(() => typeof route.query.id === 'string' ? route.query.id : '')
const duplicateId = computed(() => typeof route.query.duplicar === 'string' ? route.query.duplicar : '')
const isEditing = computed(() => Boolean(editId.value))
const isCreditPayment = computed(() => /cart[aã]o de cr[eé]dito/i.test(form.payment))
const createsInstallments = computed(() => isCreditPayment.value && form.creditInstallments > 1 && !isEditing.value)
const hydrated = ref(false)
const touched = computed(() => Object.entries(form).some(([key, value]) => value !== '' && value !== 0 && value !== false && !(key === 'creditInstallments' && value === 1) && !['Filamento', 'PIX', 'Mensal', 'Pago'].includes(String(value))))
const recurrence = computed(() => createsInstallments.value ? `${form.creditInstallments} parcelas mensais` : form.recurring ? `${form.frequency}${form.nextDue ? ` - ${form.nextDue}` : ''}` : 'Não recorrente')
const installmentAmount = computed(() => {
  const totalCents = Math.round(Number(form.value || 0) * 100)
  const count = Math.max(1, Number(form.creditInstallments) || 1)
  return (Math.floor(totalCents / count) + (totalCents - Math.floor(totalCents / count) * count)) / 100
})
watchEffect(() => {
  if ((!editId.value && !duplicateId.value) || hydrated.value) return
  const item = expenses.value.find(expense => expense.id === (editId.value || duplicateId.value))
  if (!item) return
  const isRecurring = item.recurrence && !/n[aã]o recorrente/i.test(item.recurrence)
  const [frequency, nextDue = ''] = isRecurring ? item.recurrence.split(' - ') : ['Mensal', '']
  Object.assign(form, { description: duplicateId.value ? `${item.description} (cópia)` : item.description, category: item.category, customCategory: '', supplier: item.supplier, value: item.value, date: duplicateId.value ? new Date().toISOString().slice(0, 10) : toDateInputValue(item.date), payment: item.payment, recurring: isRecurring, frequency, nextDue: toDateInputValue(item.nextDueDate || nextDue), notes: item.notes || '', status: duplicateId.value ? 'Pendente' : item.status })
  hydrated.value = true
})
const validate = () => {
  Object.keys(errors).forEach(key => delete errors[key])
  if (!form.description.trim()) errors.description = 'Informe a descrição da despesa.'
  if (!form.value || form.value <= 0) errors.value = 'Informe o valor da despesa.'
  if (!form.category || (form.category === '+ Criar nova categoria' && !form.customCategory.trim())) errors.category = 'Informe uma categoria.'
  if (!form.date.trim()) errors.date = 'Informe a data da despesa.'
  if (!form.payment) errors.payment = 'Selecione a forma de pagamento.'
  if (isCreditPayment.value && !isEditing.value && (!Number.isInteger(form.creditInstallments) || form.creditInstallments < 1 || form.creditInstallments > 48)) errors.creditInstallments = 'Escolha entre 1 e 48 parcelas.'
  if (form.recurring && !form.nextDue.trim()) errors.nextDue = 'Informe o próximo vencimento.'
  const first = Object.keys(errors)[0]
  if (first) nextTick(() => document.querySelector(`[data-field="${first}"] input,[data-field="${first}"] select`)?.focus())
  return !first
}
const reset = () => { form.description = ''; form.category = 'Filamento'; form.customCategory = ''; form.supplier = ''; form.value = 0; form.date = ''; form.notes = ''; form.recurring = false; form.nextDue = ''; form.creditInstallments = 1 }
watch(() => form.payment, (payment) => { if (!/cart[aã]o de cr[eé]dito/i.test(payment)) form.creditInstallments = 1 })
const chooseCategory = () => {
  if (form.category !== '+ Criar nova categoria') form.customCategory = ''
}
const save = async (again = false) => {
  if (!validate()) return
  if (saving.value) return
  saving.value = true
  try {
    const payload = { id: editId.value, description: form.description, category: form.category === '+ Criar nova categoria' ? form.customCategory.trim() : form.category, supplier: form.supplier || 'Não informado', value: form.value, date: form.date, payment: form.payment, recurrence: recurrence.value, nextDueDate: form.recurring ? form.nextDue : '', notes: form.notes.trim(), status: form.status }
    if (createsInstallments.value) await createExpenseInstallments(payload, form.creditInstallments)
    else await (isEditing.value ? updateItem('expenses', payload) : createItem('expenses', payload))
    notify(createsInstallments.value ? `${form.creditInstallments} parcelas cadastradas com sucesso.` : isEditing.value ? 'Despesa atualizada com sucesso.' : 'Despesa cadastrada com sucesso.')
    if (again) return reset()
    navigateTo('/despesas')
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Não foi possível salvar a despesa.')
  } finally {
    saving.value = false
  }
}
const cancel = () => {
  if (!touched.value || window.confirm('Descartar alterações?\n\nAs informações preenchidas ainda não foram salvas.')) navigateTo('/despesas')
}
</script>

<template>
  <main class="expense-create">
    <div class="breadcrumb expense-create__breadcrumb"><span>Financeiro</span><UiIcon name="chevron" :size="12" /><span>Despesas</span><UiIcon name="chevron" :size="12" /><strong>{{ isEditing ? 'Editar lançamento' : 'Novo lançamento' }}</strong></div>
    <header class="expense-hero">
      <span class="expense-hero__icon"><UiIcon name="receipt" :size="22" /></span>
      <div class="expense-hero__copy"><span class="expense-hero__eyebrow">CONTROLE FINANCEIRO</span><h1>{{ isEditing ? 'Editar despesa' : 'Nova despesa' }}</h1><p>{{ isEditing ? 'Revise os dados deste lançamento financeiro.' : 'Registre um gasto e mantenha o caixa da operação em dia.' }}</p></div>
      <span class="expense-hero__tag"><i />{{ isEditing ? 'EDIÇÃO' : 'NOVO REGISTRO' }}</span>
    </header>

    <div class="expense-editor-layout">
      <form class="expense-editor-form" @submit.prevent="save(false)">
        <section class="expense-section">
          <div class="expense-section__heading"><span class="expense-section__number">01</span><div><span class="expense-section__eyebrow">IDENTIFICAÇÃO</span><h2>O que vamos registrar?</h2><p>Descreva o gasto e classifique para seus relatórios.</p></div></div>
          <div class="form-grid expense-section__fields">
            <div class="field col-7" data-field="description" :class="{'field--error':errors.description}"><label>Descrição da despesa <b>*</b></label><input v-model="form.description" placeholder="Ex.: Filamento PLA preto"><small v-if="errors.description" class="field__error">{{errors.description}}</small></div>
            <div class="field col-5" data-field="value" :class="{'field--error':errors.value}"><label>Valor total <b>*</b></label><div class="expense-money-input"><span>R$</span><input v-model.number="form.value" type="number" min="0" step=".01" placeholder="0,00"></div><small v-if="errors.value" class="field__error">{{errors.value}}</small></div>
            <div class="field col-4" data-field="category" :class="{'field--error':errors.category}"><label>Categoria <b>*</b></label><select v-model="form.category" @change="chooseCategory"><option>Filamento</option><option>Energia</option><option>Embalagens</option><option>Equipamentos</option><option>Manutencao</option><option>Pecas</option><option>Ferramentas</option><option>Software</option><option>Marketplace</option><option>Marketing</option><option>Publicidade</option><option>Impostos</option><option>Frete</option><option>Funcionarios</option><option>Aluguel</option><option>Internet</option><option>Outros</option><option>+ Criar nova categoria</option></select><small v-if="errors.category" class="field__error">{{errors.category}}</small></div>
            <div v-if="form.category === '+ Criar nova categoria'" class="field col-4" data-field="category"><label>Nome da categoria <b>*</b></label><input v-model="form.customCategory" placeholder="Ex.: Contabilidade"></div>
            <div class="field col-4"><label>Fornecedor</label><input v-model="form.supplier" placeholder="Nome do fornecedor"></div>
            <div class="field col-4" data-field="date" :class="{'field--error':errors.date}"><label>Data da despesa <b>*</b></label><UiDateInput v-model="form.date" aria-label="Data da despesa" /><small v-if="errors.date" class="field__error">{{errors.date}}</small></div>
          </div>
        </section>

        <section class="expense-section">
          <div class="expense-section__heading"><span class="expense-section__number">02</span><div><span class="expense-section__eyebrow">PAGAMENTO</span><h2>Como essa despesa foi paga?</h2><p>Escolha o meio utilizado e o estado atual do lançamento.</p></div></div>
          <div class="form-grid expense-section__fields">
            <div class="field col-6" data-field="payment" :class="{'field--error':errors.payment}"><label>Forma de pagamento <b>*</b></label><select v-model="form.payment"><option>PIX</option><option>Cartao de credito</option><option>Cartao de debito</option><option>Boleto</option><option>Dinheiro</option><option>Transferencia</option><option>Outro</option></select><small v-if="errors.payment" class="field__error">{{errors.payment}}</small></div>
            <div class="field col-6"><label>Status financeiro</label><select v-model="form.status"><option>Pago</option><option>Pendente</option><option>Agendado</option><option>Cancelado</option></select></div>
            <div v-if="isCreditPayment && !isEditing" class="field col-6" data-field="creditInstallments" :class="{'field--error':errors.creditInstallments}"><label>Parcelamento</label><div class="expense-number-input"><input v-model.number="form.creditInstallments" type="number" min="1" max="48" step="1" :disabled="form.recurring"><span>vezes</span></div><small>De 1 a 48 parcelas mensais.</small><small v-if="errors.creditInstallments" class="field__error">{{errors.creditInstallments}}</small></div>
          </div>
          <div v-if="createsInstallments" class="expense-installment-note"><span><UiIcon name="calendar" :size="17" /></span><div><strong>{{ form.creditInstallments }} lançamentos mensais</strong><p>O valor total será dividido automaticamente. Os próximos vencimentos entram como pendentes.</p></div><b>{{ formatCurrency(installmentAmount) }}<small>/ parcela</small></b></div>
        </section>

        <section class="expense-section expense-section--schedule">
          <div class="expense-section__heading"><span class="expense-section__number">03</span><div><span class="expense-section__eyebrow">PLANEJAMENTO</span><h2>Recorrência e vencimentos</h2><p>Configure uma repetição contínua ou um parcelamento fechado.</p></div></div>
          <div class="expense-recurring-control"><span class="expense-recurring-control__icon"><UiIcon name="calendar" :size="18" /></span><div class="expense-recurring-control__copy"><strong>Repetir esta despesa</strong><small>Use para contas que voltam sem uma última parcela definida.</small></div><span class="expense-recurring-control__state">{{form.recurring ? 'Ativa' : 'Desativada'}}</span><button type="button" class="switch" :aria-pressed="form.recurring" :class="{active:form.recurring}" :disabled="createsInstallments" @click="form.recurring=!form.recurring" /></div>
          <div v-if="createsInstallments" class="expense-schedule-hint">O parcelamento já define uma quantidade fechada; recorrência contínua fica desativada.</div>
          <div v-if="form.recurring" class="form-grid expense-section__fields expense-recurring-fields">
            <div class="field col-6"><label>Frequência</label><select v-model="form.frequency"><option>Mensal</option><option>Semanal</option><option>Quinzenal</option><option>Trimestral</option><option>Semestral</option><option>Anual</option></select></div>
            <div class="field col-6" data-field="nextDue" :class="{'field--error':errors.nextDue}"><label>Próximo vencimento</label><UiDateInput v-model="form.nextDue" aria-label="Próximo vencimento" /><small v-if="errors.nextDue" class="field__error">{{errors.nextDue}}</small></div>
          </div>
        </section>

        <section class="expense-section expense-section--notes">
          <div class="expense-section__heading"><span class="expense-section__number">04</span><div><span class="expense-section__eyebrow">CONTEXTO</span><h2>Observações</h2><p>Inclua uma referência útil para consultas futuras.</p></div></div>
          <div class="field"><textarea v-model="form.notes" placeholder="Número da nota, centro de custo ou detalhe interno"></textarea></div>
        </section>

        <div class="expense-form-actions"><button class="btn" type="button" @click="cancel">Cancelar</button><button v-if="!isEditing" class="btn" type="button" :disabled="saving" @click="save(true)">Salvar e adicionar outra</button><button class="btn btn--primary" type="submit" :disabled="saving"><UiIcon name="check" :size="16" />{{ saving ? 'Salvando...' : isEditing ? 'Salvar alterações' : 'Salvar despesa' }}</button></div>
      </form>

      <aside class="expense-summary">
        <div class="expense-summary__card">
          <div class="expense-summary__top"><div><span class="expense-summary__eyebrow">PRÉVIA DO LANÇAMENTO</span><h2>Resumo financeiro</h2></div><span class="expense-summary__icon"><UiIcon name="receipt" :size="19" /></span></div>
          <div class="expense-summary__amount"><span>{{ createsInstallments ? 'Valor por parcela' : 'Valor da despesa' }}</span><strong>{{ formatCurrency(createsInstallments ? installmentAmount : form.value) }}</strong><small v-if="createsInstallments">de {{ formatCurrency(form.value) }} no total</small><small v-else>O valor será considerado no fluxo de caixa.</small></div>
          <div v-if="createsInstallments" class="expense-installment-track" aria-hidden="true"><i v-for="part in Math.min(Number(form.creditInstallments) || 1, 12)" :key="part" /><span v-if="form.creditInstallments > 12">+{{ form.creditInstallments - 12 }}</span></div>
          <div class="expense-summary__rows">
            <div><span>Categoria</span><strong>{{ form.category === '+ Criar nova categoria' ? (form.customCategory || 'Nova categoria') : form.category }}</strong></div>
            <div><span>Pagamento</span><strong>{{ form.payment }}{{ createsInstallments ? ` · ${form.creditInstallments}x` : '' }}</strong></div>
            <div><span>Status inicial</span><strong class="expense-status" :class="`expense-status--${form.status.toLowerCase()}`"><i />{{ form.status }}</strong></div>
            <div><span>Data</span><strong>{{ form.date || 'A definir' }}</strong></div>
            <div><span>Planejamento</span><strong>{{ recurrence }}</strong></div>
          </div>
          <div class="expense-summary__footer"><UiIcon name="info" :size="15" /><span>Os dados desta prévia só entram nos relatórios após salvar.</span></div>
        </div>
        <div class="expense-summary__tip"><span><UiIcon name="shield" :size="17" /></span><p><strong>Registro organizado</strong>Classifique corretamente para facilitar a leitura de custos e pagamentos.</p></div>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.expense-create { --expense-accent: #1768f2; --expense-ink: #14213d; --expense-muted: #748198; max-width: 1420px; margin: 0 auto; padding-bottom: 24px; }
.expense-create__breadcrumb { margin: 0 0 14px; }
.expense-hero { display: flex; align-items: center; gap: 16px; margin-bottom: 22px; padding: 20px 22px; border: 1px solid #dfe8f5; border-radius: 16px; background: radial-gradient(ellipse at 100% 0%,rgba(23,104,242,.09),transparent 38%),linear-gradient(115deg,#fff 0%,#f8fbff 100%); box-shadow: 0 8px 24px rgba(21,48,91,.045); }
.expense-hero__icon { display: grid; width: 52px; height: 52px; flex: 0 0 auto; place-items: center; border: 1px solid #d7e6ff; border-radius: 15px; color: var(--expense-accent); background: #edf4ff; }
.expense-hero__copy { min-width: 0; }
.expense-hero__eyebrow,.expense-section__eyebrow,.expense-summary__eyebrow { color: #71809a; font-size: 9px; font-weight: 800; letter-spacing: .12em; }
.expense-hero h1 { margin: 4px 0 3px; color: var(--expense-ink); font-size: clamp(23px,2vw,29px); font-weight: 720; letter-spacing: -.04em; line-height: 1.15; }
.expense-hero p { margin: 0; color: var(--expense-muted); font-size: 12px; line-height: 1.5; }
.expense-hero__tag { display: inline-flex; align-items: center; gap: 7px; margin-left: auto; padding: 8px 11px; border: 1px solid #dce8f8; border-radius: 999px; color: #4b5c78; background: rgba(255,255,255,.85); font-size: 9px; font-weight: 800; letter-spacing: .04em; white-space: nowrap; }
.expense-hero__tag i,.expense-status i { width: 7px; height: 7px; border-radius: 50%; background: #1768f2; }
.expense-editor-layout { display: grid; grid-template-columns: minmax(0,1fr) 340px; align-items: start; gap: 18px; }
.expense-editor-form { display: grid; min-width: 0; gap: 13px; }
.expense-section,.expense-summary__card { border: 1px solid #e0e6ef; border-radius: 14px; background: #fff; box-shadow: 0 5px 18px rgba(19,37,70,.035); }
.expense-section { padding: 20px 21px 21px; transition: border-color .18s ease,box-shadow .18s ease; }
.expense-section:focus-within { border-color: #c5d9fb; box-shadow: 0 8px 25px rgba(23,104,242,.055); }
.expense-section__heading { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 19px; }
.expense-section__number { display: grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; border: 1px solid #dbe8fb; border-radius: 10px; color: #1768f2; background: #f0f6ff; font-size: 10px; font-weight: 850; }
.expense-section__heading > div { min-width: 0; }
.expense-section__eyebrow { display: block; margin: 1px 0 4px; color: #8390a4; }
.expense-section__heading h2 { margin: 0; color: var(--expense-ink); font-size: 16px; font-weight: 720; letter-spacing: -.02em; }
.expense-section__heading p { margin: 4px 0 0; color: var(--expense-muted); font-size: 11px; line-height: 1.45; }
.expense-section__fields { gap: 15px 14px; }
.expense-section :deep(.field) { gap: 7px; }
.expense-section :deep(.field label) { color: #35425c; font-size: 11px; font-weight: 700; }
.expense-section :deep(.field label b) { color: #e05261; font-weight: 700; }
.expense-section :deep(.field input),.expense-section :deep(.field select),.expense-section :deep(.field textarea) { min-height: 43px; border-color: #d9e1eb; border-radius: 8px; color: #1b2944; background-color: #fff; font-size: 12px; }
.expense-section :deep(.field input:hover),.expense-section :deep(.field select:hover),.expense-section :deep(.field textarea:hover) { border-color: #b9c9df; }
.expense-section :deep(.field input:disabled) { color: #8490a2; background: #f5f7fa; }
.expense-section :deep(.field small:not(.field__error)) { color: #8793a6; font-size: 10px; }
.expense-money-input,.expense-number-input { display: flex; min-height: 43px; align-items: center; overflow: hidden; border: 1px solid #d9e1eb; border-radius: 8px; background: white; transition: border-color .16s ease,box-shadow .16s ease; }
.expense-money-input:focus-within,.expense-number-input:focus-within { border-color: #1768f2; box-shadow: 0 0 0 3px rgba(23,104,242,.09); }
.expense-money-input > span { padding-left: 12px; color: #75839a; font-size: 11px; font-weight: 750; }
.expense-section :deep(.expense-money-input input) { min-width: 0; border: 0; box-shadow: none; font-size: 16px; font-weight: 750; }
.expense-section :deep(.expense-money-input input:focus) { box-shadow: none; }
.expense-number-input input { width: 100%; min-width: 0; height: 41px; border: 0; outline: 0; padding: 0 11px; color: #1b2944; font: inherit; font-size: 13px; font-weight: 700; }
.expense-number-input > span { padding: 0 12px; color: #71809a; font-size: 11px; font-weight: 650; white-space: nowrap; }
.expense-installment-note { display: grid; grid-template-columns: 34px minmax(0,1fr) auto; align-items: center; gap: 11px; margin-top: 17px; padding: 13px 14px; border: 1px solid #d9e8ff; border-radius: 11px; background: linear-gradient(100deg,#f3f8ff,#fbfdff); }
.expense-installment-note > span { display: grid; width: 33px; height: 33px; place-items: center; border-radius: 9px; color: #1768f2; background: #e5efff; }
.expense-installment-note strong { display: block; color: #22324f; font-size: 11px; }
.expense-installment-note p { margin: 3px 0 0; color: #748198; font-size: 10px; line-height: 1.45; }
.expense-installment-note > b { color: #1768f2; font-size: 14px; text-align: right; white-space: nowrap; }
.expense-installment-note > b small { display: block; margin-top: 2px; color: #8793a6; font-size: 9px; font-weight: 600; }
.expense-recurring-control { display: flex; min-height: 62px; align-items: center; gap: 11px; padding: 12px 13px; border: 1px solid #e3e9f1; border-radius: 11px; background: #fafbfd; }
.expense-recurring-control__icon { display: grid; width: 35px; height: 35px; flex: 0 0 auto; place-items: center; border-radius: 10px; color: #647795; background: #eef2f7; }
.expense-recurring-control__copy { min-width: 0; }
.expense-recurring-control__copy strong { display: block; color: #26334d; font-size: 11px; }
.expense-recurring-control__copy small { display: block; margin-top: 3px; color: #7b8799; font-size: 9px; line-height: 1.4; }
.expense-recurring-control__state { margin-left: auto; color: #77849a; font-size: 10px; font-weight: 700; white-space: nowrap; }
.expense-recurring-control .switch { transform: scale(.9); }
.expense-recurring-control .switch:disabled { cursor: not-allowed; opacity: .55; }
.expense-schedule-hint { margin-top: 8px; color: #72819b; font-size: 10px; }
.expense-recurring-fields { margin-top: 15px; padding-top: 15px; border-top: 1px solid #edf0f5; }
.expense-section--notes :deep(textarea) { min-height: 78px; }
.expense-form-actions { position: sticky; bottom: 12px; z-index: 3; display: flex; justify-content: flex-end; gap: 9px; margin-top: 2px; padding: 12px; border: 1px solid #dfe6ef; border-radius: 13px; background: rgba(255,255,255,.94); box-shadow: 0 12px 30px rgba(18,38,74,.11); backdrop-filter: blur(12px); }
.expense-form-actions :deep(.btn) { min-height: 39px; }
.expense-summary { position: sticky; top: 20px; display: grid; gap: 12px; }
.expense-summary__card { overflow: hidden; }
.expense-summary__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 18px 18px 14px; }
.expense-summary__eyebrow { color: #1768f2; }
.expense-summary__top h2 { margin: 5px 0 0; color: #1a2945; font-size: 15px; font-weight: 750; }
.expense-summary__icon { display: grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; border-radius: 11px; color: #1768f2; background: #edf4ff; }
.expense-summary__amount { padding: 15px 18px 17px; border-top: 1px solid #edf1f6; border-bottom: 1px solid #edf1f6; background: linear-gradient(135deg,#fbfdff,#f4f8ff); }
.expense-summary__amount span,.expense-summary__amount small { display: block; color: #75839a; font-size: 10px; }
.expense-summary__amount strong { display: block; margin: 5px 0 3px; color: #14213d; font-size: clamp(25px,2.4vw,31px); font-weight: 780; letter-spacing: -.045em; line-height: 1.1; overflow-wrap: anywhere; }
.expense-summary__amount small { font-size: 9px; }
.expense-installment-track { display: flex; align-items: center; gap: 4px; padding: 12px 18px 0; }
.expense-installment-track i { height: 5px; flex: 1; border-radius: 99px; background: linear-gradient(90deg,#1768f2,#73a6ff); }
.expense-installment-track span { color: #75839a; font-size: 9px; font-weight: 700; }
.expense-summary__rows { display: grid; gap: 0; padding: 7px 18px 5px; }
.expense-summary__rows > div { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f0f2f6; }
.expense-summary__rows > div:last-child { border: 0; }
.expense-summary__rows span { color: #76839a; font-size: 10px; }
.expense-summary__rows strong { max-width: 64%; color: #293752; font-size: 10px; font-weight: 700; text-align: right; overflow-wrap: anywhere; }
.expense-status { display: inline-flex; align-items: center; gap: 6px; }
.expense-status i { background: #d58a23; }
.expense-status--pago i { background: #19a56f; }
.expense-status--cancelado i { background: #dc5662; }
.expense-summary__footer { display: flex; align-items: flex-start; gap: 8px; margin: 0 12px 12px; padding: 10px; border-radius: 8px; color: #75839a; background: #f7f9fc; font-size: 9px; line-height: 1.45; }
.expense-summary__footer :deep(.ui-icon) { flex: 0 0 auto; color: #6683ad; }
.expense-summary__tip { display: flex; align-items: flex-start; gap: 10px; padding: 13px 14px; border: 1px solid #e4eaf2; border-radius: 12px; color: #728098; background: #fff; box-shadow: 0 4px 15px rgba(19,37,70,.025); }
.expense-summary__tip > span { display: grid; width: 29px; height: 29px; flex: 0 0 auto; place-items: center; border-radius: 8px; color: #6382ae; background: #edf3fb; }
.expense-summary__tip p { margin: 0; font-size: 9px; line-height: 1.55; }
.expense-summary__tip strong { display: block; margin-bottom: 2px; color: #34435f; font-size: 10px; }
@media (max-width: 1050px) { .expense-editor-layout { grid-template-columns: minmax(0,1fr) 300px; gap: 13px; } .expense-section { padding: 17px; } }
@media (max-width: 900px) { .expense-editor-layout { grid-template-columns: 1fr; } .expense-summary { position: static; grid-row: 1; } .expense-summary__rows { grid-template-columns: 1fr 1fr; column-gap: 18px; } .expense-summary__rows > div:nth-last-child(2) { border-bottom: 0; } }
@media (max-width: 600px) { .expense-hero { align-items: flex-start; gap: 12px; margin-bottom: 14px; padding: 15px; } .expense-hero__icon { width: 43px; height: 43px; border-radius: 12px; } .expense-hero__tag { display: none; } .expense-hero p { font-size: 11px; } .expense-editor-form { gap: 10px; } .expense-section { padding: 15px; border-radius: 12px; } .expense-section__heading { gap: 9px; margin-bottom: 15px; } .expense-section__number { width: 30px; height: 30px; } .expense-section__heading h2 { font-size: 14px; } .expense-section__heading p { font-size: 10px; } .expense-section__fields { gap: 12px; } .expense-section__fields > .col-4,.expense-section__fields > .col-5,.expense-section__fields > .col-6,.expense-section__fields > .col-7 { grid-column: span 12; } .expense-recurring-control { flex-wrap: wrap; } .expense-recurring-control__copy { flex: 1; } .expense-recurring-control__state { margin-left: 46px; } .expense-installment-note { grid-template-columns: 32px minmax(0,1fr); } .expense-installment-note > b { grid-column: 2; text-align: left; } .expense-summary__rows { grid-template-columns: 1fr; } .expense-summary__rows > div:nth-last-child(2) { border-bottom: 1px solid #f0f2f6; } .expense-form-actions { position: static; flex-direction: column-reverse; } .expense-form-actions :deep(.btn) { width: 100%; justify-content: center; } }
</style>
