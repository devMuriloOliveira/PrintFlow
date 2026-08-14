<script setup lang="ts">
import { computed, nextTick, reactive, ref, watchEffect } from 'vue'
import { navigateTo } from '#app'

const { expenses, createItem, updateItem } = useAppData()
const { notify } = useUi()
const route = useRoute()
const saving = ref(false)
const form = reactive({ description: '', category: 'Filamento', supplier: '', value: 0, date: '', payment: 'PIX', recurring: false, frequency: 'Mensal', nextDue: '', receipt: '', notes: '', status: 'Pago' })
const errors = reactive<Record<string, string>>({})
const editId = computed(() => typeof route.query.id === 'string' ? route.query.id : '')
const isEditing = computed(() => Boolean(editId.value))
const hydrated = ref(false)
const touched = computed(() => Object.values(form).some(value => value !== '' && value !== 0 && value !== false && !['Filamento', 'PIX', 'Mensal', 'Pago'].includes(String(value))))
const recurrence = computed(() => form.recurring ? `${form.frequency}${form.nextDue ? ` - ${form.nextDue}` : ''}` : 'Nao recorrente')
watchEffect(() => {
  if (!editId.value || hydrated.value) return
  const item = expenses.value.find(expense => expense.id === editId.value)
  if (!item) return
  const [frequency, nextDue = ''] = item.recurrence && item.recurrence !== 'Nao recorrente' ? item.recurrence.split(' - ') : ['Mensal', '']
  Object.assign(form, { description: item.description, category: item.category, supplier: item.supplier, value: item.value, date: item.date || '', payment: item.payment, recurring: item.recurrence !== 'Nao recorrente', frequency, nextDue, status: item.status })
  hydrated.value = true
})
const validate = () => {
  Object.keys(errors).forEach(key => delete errors[key])
  if (!form.description.trim()) errors.description = 'Informe a descricao da despesa.'
  if (!form.value || form.value <= 0) errors.value = 'Informe o valor da despesa.'
  if (!form.category) errors.category = 'Selecione uma categoria.'
  if (!form.date.trim()) errors.date = 'Informe a data da despesa.'
  if (!form.payment) errors.payment = 'Selecione a forma de pagamento.'
  if (form.recurring && !form.nextDue.trim()) errors.nextDue = 'Informe o proximo vencimento.'
  const first = Object.keys(errors)[0]
  if (first) nextTick(() => document.querySelector(`[data-field="${first}"] input,[data-field="${first}"] select`)?.focus())
  return !first
}
const reset = () => { form.description = ''; form.supplier = ''; form.value = 0; form.date = ''; form.receipt = ''; form.notes = ''; form.recurring = false; form.nextDue = '' }
const handleReceiptUpload = (event: Event) => {
  form.receipt = (event.target as HTMLInputElement).files?.[0]?.name || ''
}
const save = async (again = false) => {
  if (!validate()) return
  if (saving.value) return
  saving.value = true
  try {
    const payload = { id: editId.value, description: form.description, category: form.category, supplier: form.supplier || 'Nao informado', value: form.value, date: form.date, payment: form.payment, recurrence: recurrence.value, status: form.status }
    if (isEditing.value) await updateItem('expenses', payload)
    else await createItem('expenses', payload)
    notify(isEditing.value ? 'Despesa atualizada com sucesso.' : 'Despesa cadastrada com sucesso.')
    if (again) return reset()
    navigateTo('/despesas')
  } finally {
    saving.value = false
  }
}
const cancel = () => {
  if (!touched.value || window.confirm('Descartar alteracoes?\n\nAs informacoes preenchidas ainda nao foram salvas.')) navigateTo('/despesas')
}
</script>

<template>
  <div>
    <div class="breadcrumb"><span>Despesas</span><UiIcon name="chevron" :size="12" /><strong>{{ isEditing ? 'Editar Despesa' : 'Nova Despesa' }}</strong></div>
    <PageHeader :title="isEditing ? 'Editar Despesa' : 'Nova Despesa'" :subtitle="isEditing ? 'Atualize valor, categoria e recorrencia da despesa.' : 'Registre uma nova despesa da empresa e mantenha seu financeiro atualizado.'" />
    <div class="split-layout" style="grid-template-columns:minmax(0,1fr) 330px">
      <form @submit.prevent="save(false)">
        <div class="form-card">
          <h2 class="form-card__title"><UiIcon name="receipt" />1. Informacoes da Despesa</h2>
          <div class="form-grid">
            <div class="field col-6" data-field="description" :class="{'field--error':errors.description}"><label>Descricao da despesa *</label><input v-model="form.description" placeholder="Compra de Filamento PLA Preto"><small v-if="errors.description" class="field__error">{{errors.description}}</small></div>
            <div class="field col-3" data-field="value" :class="{'field--error':errors.value}"><label>Valor *</label><input v-model.number="form.value" type="number" min="0" step=".01" placeholder="R$ 480,00"><small v-if="errors.value" class="field__error">{{errors.value}}</small></div>
            <div class="field col-3" data-field="date" :class="{'field--error':errors.date}"><label>Data da despesa *</label><input v-model="form.date" type="date"><small v-if="errors.date" class="field__error">{{errors.date}}</small></div>
            <div class="field col-4" data-field="category" :class="{'field--error':errors.category}"><label>Categoria *</label><select v-model="form.category"><option>Filamento</option><option>Energia</option><option>Embalagens</option><option>Equipamentos</option><option>Manutencao</option><option>Pecas</option><option>Ferramentas</option><option>Software</option><option>Marketplace</option><option>Marketing</option><option>Publicidade</option><option>Impostos</option><option>Frete</option><option>Funcionarios</option><option>Aluguel</option><option>Internet</option><option>Outros</option><option>+ Criar nova categoria</option></select><small v-if="errors.category" class="field__error">{{errors.category}}</small></div>
            <div class="field col-4"><label>Fornecedor</label><input v-model="form.supplier" placeholder="3D Fila"></div>
            <div class="field col-4" data-field="payment" :class="{'field--error':errors.payment}"><label>Forma de pagamento *</label><select v-model="form.payment"><option>PIX</option><option>Cartao de credito</option><option>Cartao de debito</option><option>Boleto</option><option>Dinheiro</option><option>Transferencia</option><option>Outro</option></select><small v-if="errors.payment" class="field__error">{{errors.payment}}</small></div>
          </div>
        </div>
        <div class="form-card">
          <h2 class="form-card__title"><UiIcon name="calendar" />2. Recorrencia</h2>
          <div class="form-grid">
            <div class="field col-4"><label>Essa despesa e recorrente?</label><div class="switch-row"><span>{{form.recurring ? 'Sim' : 'Nao'}}</span><button type="button" class="switch" :class="{active:form.recurring}" @click="form.recurring=!form.recurring" /></div></div>
            <template v-if="form.recurring">
              <div class="field col-4"><label>Frequencia</label><select v-model="form.frequency"><option>Mensal</option><option>Semanal</option><option>Quinzenal</option><option>Trimestral</option><option>Semestral</option><option>Anual</option></select></div>
              <div class="field col-4" data-field="nextDue" :class="{'field--error':errors.nextDue}"><label>Proximo vencimento</label><input v-model="form.nextDue" type="date"><small v-if="errors.nextDue" class="field__error">{{errors.nextDue}}</small></div>
            </template>
          </div>
        </div>
        <div class="form-card">
          <h2 class="form-card__title"><UiIcon name="upload" />3. Comprovante</h2>
          <label class="upload-zone"><input type="file" accept=".pdf,.jpg,.jpeg,.png" hidden @change="handleReceiptUpload"><span><UiIcon name="upload" :size="28" /><strong>{{form.receipt || 'Adicionar comprovante'}}</strong><small>PDF, JPG ou PNG</small></span></label>
        </div>
        <div class="form-card">
          <h2 class="form-card__title"><UiIcon name="edit" />4. Observacoes</h2>
          <div class="field"><label>Observacoes</label><textarea v-model="form.notes" placeholder="Detalhes internos sobre essa despesa" /></div>
        </div>
        <div class="form-actions"><button class="btn" type="button" @click="cancel">Cancelar</button><button v-if="!isEditing" class="btn" type="button" :disabled="saving" @click="save(true)">Salvar e adicionar outra</button><button class="btn btn--primary" type="submit" :disabled="saving">{{ saving ? 'Salvando...' : isEditing ? 'Salvar Alteracoes' : 'Salvar Despesa' }}</button></div>
      </form>
      <aside class="detail-card">
        <div class="detail-card__head"><span class="metric-card__icon"><UiIcon name="receipt" /></span><div><h3>Resumo da Despesa</h3><p>{{form.category}}</p><p>{{recurrence}}</p></div></div>
        <div class="detail-card__body">
          <div class="detail-list"><div class="detail-list__row"><span>Categoria</span><strong>{{form.category}}</strong></div><div class="detail-list__row"><span>Fornecedor</span><strong>{{form.supplier || 'Nao informado'}}</strong></div><div class="detail-list__row"><span>Pagamento</span><strong>{{form.payment}}</strong></div><div class="detail-list__row"><span>Data</span><strong>{{form.date || '-'}}</strong></div><div class="detail-list__row"><span>Recorrencia</span><strong>{{recurrence}}</strong></div></div>
          <div class="summary-box"><div class="detail-list__row"><span>Valor Total</span><strong class="money-negative">{{formatCurrency(form.value)}}</strong></div></div>
        </div>
      </aside>
    </div>
  </div>
</template>
