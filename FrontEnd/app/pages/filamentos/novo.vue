<script setup lang="ts">
import { computed, nextTick, reactive, ref, watchEffect } from 'vue'
import { navigateTo } from '#app'

const { filaments, createItem, updateItem } = useAppData()
const { notify } = useUi()
const route = useRoute()
const saving = ref(false)
const form = reactive({ name: '', maker: '', material: 'PLA', type: '1.75 mm', color: '', colorHex: '#111827', initial: 1000, remaining: 1000, cost: 0, supplier: '', date: '', minStock: 200, status: 'Em estoque' })
const errors = reactive<Record<string, string>>({})
const editId = computed(() => typeof route.query.id === 'string' ? route.query.id : '')
const isEditing = computed(() => Boolean(editId.value))
const hydrated = ref(false)
const pieceWeight = ref(180)
const costPerGram = computed(() => form.initial ? form.cost / form.initial : 0)
const pieceCost = computed(() => costPerGram.value * pieceWeight.value)
const touched = computed(() => Object.values(form).some(value => value !== '' && value !== 0 && !['PLA', '1.75 mm', '#111827', 'Em estoque', 1000, 200].includes(value as never)))
watchEffect(() => {
  if (!editId.value || hydrated.value) return
  const item = filaments.value.find(filament => filament.id === editId.value)
  if (!item) return
  Object.assign(form, { ...item, date: item.date || '' })
  hydrated.value = true
})
const validate = () => {
  Object.keys(errors).forEach(key => delete errors[key])
  if (!form.name.trim()) errors.name = 'Informe o nome do filamento.'
  if (!form.maker.trim()) errors.maker = 'Informe o fabricante.'
  if (!form.material) errors.material = 'Selecione o material.'
  if (!form.type) errors.type = 'Selecione o diametro.'
  if (!form.color.trim()) errors.color = 'Informe a cor.'
  if (!form.initial || form.initial <= 0) errors.initial = 'Informe o peso inicial.'
  if (!form.remaining || form.remaining < 0) errors.remaining = 'Informe o peso restante.'
  if (!form.cost || form.cost <= 0) errors.cost = 'Informe o custo do rolo.'
  const first = Object.keys(errors)[0]
  if (first) nextTick(() => document.querySelector(`[data-field="${first}"] input,[data-field="${first}"] select`)?.focus())
  return !first
}
const reset = () => { form.name = ''; form.maker = ''; form.color = ''; form.cost = 0; form.supplier = ''; form.date = ''; form.remaining = form.initial }
const save = async (again = false) => {
  if (!validate()) return
  if (saving.value) return
  saving.value = true
  try {
    const payload = { id: editId.value, name: form.name, maker: form.maker, material: form.material, type: form.type, color: form.color, colorHex: form.colorHex, initial: form.initial, remaining: form.remaining, cost: form.cost, supplier: form.supplier || 'Nao informado', date: form.date || null, status: form.status }
    if (isEditing.value) await updateItem('filaments', payload)
    else await createItem('filaments', payload)
    notify(isEditing.value ? 'Filamento atualizado com sucesso.' : 'Filamento cadastrado com sucesso.')
    if (again) return reset()
    navigateTo('/filamentos')
  } finally {
    saving.value = false
  }
}
const cancel = () => {
  if (!touched.value || window.confirm('Descartar alteracoes?\n\nAs informacoes preenchidas ainda nao foram salvas.')) navigateTo('/filamentos')
}
</script>

<template>
  <div>
    <div class="breadcrumb"><span>Filamentos</span><UiIcon name="chevron" :size="12" /><strong>{{ isEditing ? 'Editar Filamento' : 'Novo Filamento' }}</strong></div>
    <PageHeader :title="isEditing ? 'Editar Filamento' : 'Novo Filamento'" :subtitle="isEditing ? 'Atualize estoque, custo e dados do rolo.' : 'Cadastre um novo rolo de filamento e acompanhe automaticamente seu estoque e custo por grama.'" />
    <div class="split-layout" style="grid-template-columns:minmax(0,1fr) 330px">
      <form @submit.prevent="save(false)">
        <div class="form-card">
          <h2 class="form-card__title"><UiIcon name="spool" />1. Informacoes do Filamento</h2>
          <div class="form-grid">
            <div class="field col-4" data-field="name" :class="{'field--error':errors.name}"><label>Nome do Filamento *</label><input v-model="form.name" placeholder="PLA Preto"><small v-if="errors.name" class="field__error">{{errors.name}}</small></div>
            <div class="field col-4" data-field="maker" :class="{'field--error':errors.maker}"><label>Fabricante *</label><input v-model="form.maker" placeholder="eSUN"><small v-if="errors.maker" class="field__error">{{errors.maker}}</small></div>
            <div class="field col-4" data-field="material" :class="{'field--error':errors.material}"><label>Material *</label><select v-model="form.material"><option>PLA</option><option>PETG</option><option>ABS</option><option>TPU</option><option>ASA</option><option>Nylon</option><option>PLA Silk</option><option>PLA Wood</option><option>Outro</option></select><small v-if="errors.material" class="field__error">{{errors.material}}</small></div>
            <div class="field col-4" data-field="type" :class="{'field--error':errors.type}"><label>Tipo / Diametro *</label><select v-model="form.type"><option>1.75 mm</option><option>2.85 mm</option><option>Outro</option></select><small v-if="errors.type" class="field__error">{{errors.type}}</small></div>
            <div class="field col-4" data-field="color" :class="{'field--error':errors.color}"><label>Cor *</label><input v-model="form.color" placeholder="Preto"><small v-if="errors.color" class="field__error">{{errors.color}}</small></div>
            <div class="field col-4"><label>Seletor de cor</label><input v-model="form.colorHex" type="color"></div>
          </div>
        </div>
        <div class="form-card">
          <h2 class="form-card__title"><UiIcon name="calculator" />2. Informacoes do Rolo</h2>
          <div class="form-grid">
            <div class="field col-3" data-field="initial" :class="{'field--error':errors.initial}"><label>Peso inicial *</label><input v-model.number="form.initial" type="number"><small v-if="errors.initial" class="field__error">{{errors.initial}}</small></div>
            <div class="field col-3" data-field="remaining" :class="{'field--error':errors.remaining}"><label>Peso restante *</label><input v-model.number="form.remaining" type="number"><small v-if="errors.remaining" class="field__error">{{errors.remaining}}</small></div>
            <div class="field col-3" data-field="cost" :class="{'field--error':errors.cost}"><label>Custo do rolo *</label><input v-model.number="form.cost" type="number" step=".01"><small v-if="errors.cost" class="field__error">{{errors.cost}}</small></div>
            <div class="field col-3"><label>Data da compra</label><input v-model="form.date" type="date"></div>
            <div class="field col-6"><label>Fornecedor</label><input v-model="form.supplier" placeholder="3D Fila"></div>
          </div>
        </div>
        <div class="form-card">
          <h2 class="form-card__title"><UiIcon name="alert" />3. Estoque</h2>
          <div class="form-grid">
            <div class="field col-4"><label>Estoque minimo para alerta</label><input v-model.number="form.minStock" type="number"><small>O sistema avisara quando o filamento atingir esse peso.</small></div>
            <div class="field col-4"><label>Status</label><select v-model="form.status"><option>Em estoque</option><option>Atencao</option><option>Baixo estoque</option><option>Esgotado</option></select></div>
          </div>
        </div>
        <div class="form-actions"><button class="btn" type="button" @click="cancel">Cancelar</button><button v-if="!isEditing" class="btn" type="button" :disabled="saving" @click="save(true)">Salvar e adicionar outro</button><button class="btn btn--primary" type="submit" :disabled="saving">{{ saving ? 'Salvando...' : isEditing ? 'Salvar Alteracoes' : 'Salvar Filamento' }}</button></div>
      </form>
      <aside>
        <div class="detail-card">
          <div class="detail-card__head"><span class="product-thumb" style="border-radius:50%"><UiIcon name="spool" :size="45" /></span><div><h3>{{form.name || 'Novo filamento'}}</h3><p>{{form.maker || 'Fabricante'}} - {{form.material}}</p><p><span class="dot" :style="{background:form.colorHex,border:'1px solid #ccd3df'}" /> {{form.color || 'Cor'}}</p></div></div>
          <div class="detail-card__body"><div class="summary-box"><div class="detail-list__row"><span>Material</span><strong>{{form.material}}</strong></div><div class="detail-list__row"><span>Peso</span><strong>{{formatNumber(form.remaining)}} g</strong></div><div class="detail-list__row"><span>Valor</span><strong>{{formatCurrency(form.cost)}}</strong></div></div></div>
        </div>
        <PanelCard title="Custo por Grama" style="margin-top:12px">
          <div class="summary-box"><div class="detail-list__row"><span>Rolo</span><strong>{{formatCurrency(form.cost)}}</strong></div><div class="detail-list__row"><span>Peso</span><strong>{{formatNumber(form.initial)}} g</strong></div><div class="detail-list__row"><span>Resultado</span><strong class="money-positive">R$ {{costPerGram.toFixed(3).replace('.', ',')}} / g</strong></div></div>
          <div class="field" style="margin-top:12px"><label>Quanto custa uma peca?</label><input v-model.number="pieceWeight" type="number"></div>
          <div class="summary-box"><div class="detail-list__row"><span>{{formatNumber(pieceWeight)}} g</span><strong>{{formatCurrency(pieceCost)}}</strong></div></div>
        </PanelCard>
      </aside>
    </div>
  </div>
</template>
