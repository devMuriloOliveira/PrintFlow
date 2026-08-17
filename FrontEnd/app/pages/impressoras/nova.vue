<script setup lang="ts">
import { computed, nextTick, reactive, ref, watchEffect } from 'vue'
import { navigateTo } from '#app'

const { printers, filaments, createItem, updateItem } = useAppData()
const { notify } = useUi()
const route = useRoute()
const saving = ref(false)
const nextCode = computed(() => `PRT-${String(printers.value.length + 1).padStart(3, '0')}`)
const form = reactive({ name: '', maker: '', model: '', serial: '', code: '', acquired: '', purchase: 0, power: 350, consumption: .35, x: 220, y: 220, z: 250, nozzle: .4, firmware: 'Marlin 2.1', hours: 0, status: 'Disponível', location: '', filament: 'PLA Preto', maintenance: '', nextMaintenance: '', interval: 250 })
const errors = reactive<Record<string, string>>({})
const editId = computed(() => typeof route.query.id === 'string' ? route.query.id : '')
const isEditing = computed(() => Boolean(editId.value))
const hydrated = ref(false)
const testHours = ref(10)
const energyCost = computed(() => form.power / 1000 * testHours.value * .68)
const touched = computed(() => Object.values(form).some(value => value !== '' && value !== 0 && !['Disponível', 'PLA Preto', 'Marlin 2.1', 350, .35, 220, 250, .4].includes(value as never)))
watchEffect(() => {
  if (!editId.value || hydrated.value) return
  const item = printers.value.find(printer => printer.id === editId.value)
  if (!item) return
  Object.assign(form, { name: item.name, maker: item.maker, model: item.model, serial: item.serial, code: item.code, acquired: toDateInputValue(item.acquired), power: item.power, hours: item.hours, status: /Em Impressao|Em Impressão/.test(item.status) ? 'Imprimindo' : /Em Manutencao|Em Manutenção/.test(item.status) ? 'Manutenção' : item.status === 'Disponivel' ? 'Disponível' : item.status, maintenance: toDateInputValue(item.maintenance) })
  hydrated.value = true
})
const validate = () => {
  Object.keys(errors).forEach(key => delete errors[key])
  if (!form.name.trim()) errors.name = 'Informe o nome da impressora.'
  if (!form.maker.trim()) errors.maker = 'Informe o fabricante.'
  if (!form.model.trim()) errors.model = 'Informe o modelo.'
  if (!form.power || form.power <= 0) errors.power = 'Informe a potência média.'
  if (!form.status) errors.status = 'Selecione o status.'
  const first = Object.keys(errors)[0]
  if (first) nextTick(() => document.querySelector(`[data-field="${first}"] input,[data-field="${first}"] select`)?.focus())
  return !first
}
const save = async (again = false) => {
  if (!validate()) return
  if (saving.value) return
  saving.value = true
  try {
    const payload = { id: editId.value, name: form.name, code: form.code || nextCode.value, maker: form.maker, model: form.model, acquired: form.acquired || null, power: form.power, hours: form.hours, status: form.status === 'Imprimindo' ? 'Em Impressão' : form.status === 'Manutenção' ? 'Em Manutenção' : form.status, maintenance: form.maintenance || null, serial: form.serial || '-', location: form.location, volume: `${form.x} x ${form.y} x ${form.z} mm`, defaultFilament: form.filament }
    if (isEditing.value) await updateItem('printers', payload)
    else await createItem('printers', payload)
    notify(isEditing.value ? 'Impressora atualizada com sucesso.' : 'Impressora cadastrada com sucesso.')
    if (again) { form.name = ''; form.model = ''; form.serial = ''; form.code = ''; return }
    navigateTo('/impressoras')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Não foi possível salvar a impressora.', 'info')
  } finally {
    saving.value = false
  }
}
const cancel = () => {
  if (!touched.value || window.confirm('Descartar alterações?\n\nAs informações preenchidas ainda não foram salvas.')) navigateTo('/impressoras')
}
</script>

<template>
  <div>
    <div class="breadcrumb"><span>Impressoras</span><UiIcon name="chevron" :size="12" /><strong>{{ isEditing ? 'Editar Impressora' : 'Nova Impressora' }}</strong></div>
    <PageHeader :title="isEditing ? 'Editar Impressora' : 'Nova Impressora'" :subtitle="isEditing ? 'Atualize operação, potência e manutenção da impressora.' : 'Cadastre uma nova impressora 3D e acompanhe sua operação, consumo e manutenção.'" />
    <div class="split-layout" style="grid-template-columns:minmax(0,1fr) 340px">
      <form @submit.prevent="save(false)">
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="printer" />1. Identificação</h2><div class="form-grid">
          <div class="field col-5" data-field="name" :class="{'field--error':errors.name}"><label>Nome da Impressora *</label><input v-model="form.name" placeholder="Ender 3 V2 - Produção 01"><small v-if="errors.name" class="field__error">{{errors.name}}</small></div>
          <div class="field col-4" data-field="maker" :class="{'field--error':errors.maker}"><label>Fabricante *</label><input v-model="form.maker" placeholder="Creality"><small v-if="errors.maker" class="field__error">{{errors.maker}}</small></div>
          <div class="field col-3" data-field="model" :class="{'field--error':errors.model}"><label>Modelo *</label><input v-model="form.model" placeholder="Ender 3 V2"><small v-if="errors.model" class="field__error">{{errors.model}}</small></div>
          <div class="field col-4"><label>Número de série</label><input v-model="form.serial"></div><div class="field col-4"><label>Código interno</label><input v-model="form.code" :placeholder="nextCode"></div>
        </div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="money" />2. Aquisição</h2><div class="form-grid"><div class="field col-4"><label>Data de aquisição</label><input v-model="form.acquired" type="date"></div><div class="field col-4"><label>Preço de compra</label><input v-model.number="form.purchase" type="number" step=".01"></div></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="settings" />3. Especificações</h2><div class="form-grid">
          <div class="field col-3" data-field="power" :class="{'field--error':errors.power}"><label>Potência média *</label><input v-model.number="form.power" type="number"><small v-if="errors.power" class="field__error">{{errors.power}}</small></div>
          <div class="field col-3"><label>Consumo médio</label><input v-model.number="form.consumption" type="number" step=".01"></div><div class="field col-2"><label>X</label><input v-model.number="form.x" type="number"></div><div class="field col-2"><label>Y</label><input v-model.number="form.y" type="number"></div><div class="field col-2"><label>Z</label><input v-model.number="form.z" type="number"></div>
          <div class="field col-3"><label>Diâmetro do bico</label><input v-model.number="form.nozzle" type="number" step=".1"></div><div class="field col-4"><label>Firmware</label><input v-model="form.firmware"></div>
        </div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="play" />4. Operação</h2><div class="form-grid"><div class="field col-3"><label>Horas acumuladas</label><input v-model.number="form.hours" type="number"></div><div class="field col-3" data-field="status" :class="{'field--error':errors.status}"><label>Status *</label><select v-model="form.status"><option>Disponível</option><option>Imprimindo</option><option>Manutenção</option><option>Inativa</option></select><small v-if="errors.status" class="field__error">{{errors.status}}</small></div><div class="field col-3"><label>Localização</label><input v-model="form.location" placeholder="Sala de Produção"></div><div class="field col-3"><label>Filamento padrão</label><select v-model="form.filament"><option v-for="f in filaments" :key="f.name">{{f.name}}</option></select></div></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="wrench" />5. Manutenção</h2><div class="form-grid"><div class="field col-4"><label>Última manutenção</label><input v-model="form.maintenance" type="date"></div><div class="field col-4"><label>Próxima manutenção</label><input v-model="form.nextMaintenance" type="date"></div><div class="field col-4"><label>Intervalo recomendado</label><input v-model.number="form.interval" type="number"></div></div></div>
        <div class="form-actions"><button class="btn" type="button" @click="cancel">Cancelar</button><button v-if="!isEditing" class="btn" type="button" :disabled="saving" @click="save(true)">Salvar e adicionar outra</button><button class="btn btn--primary" type="submit" :disabled="saving">{{ saving ? 'Salvando...' : isEditing ? 'Salvar Alterações' : 'Salvar Impressora' }}</button></div>
      </form>
      <aside><div class="detail-card"><div class="detail-card__head"><span class="product-thumb" style="width:95px;height:95px"><UiIcon name="printer" :size="58" /></span><div><h3>{{form.name || 'Nova impressora'}}</h3><p>{{form.maker || 'Fabricante'}} {{form.model}}</p><p><span class="badge badge--green">{{form.status}}</span></p></div></div></div>
        <PanelCard title="Estimativa de Energia" style="margin-top:12px"><div class="field"><label>Horas de impressão</label><input v-model.number="testHours" type="number"></div><div class="summary-box"><div class="detail-list__row"><span>Potência</span><strong>{{form.power}} W</strong></div><div class="detail-list__row"><span>Custo estimado</span><strong class="money-positive">{{formatCurrency(energyCost)}}</strong></div></div></PanelCard></aside>
    </div>
  </div>
</template>
