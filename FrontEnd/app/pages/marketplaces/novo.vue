<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { navigateTo } from '#app'

const { marketplaces } = useAppData()
const { notify } = useUi()
const form = reactive({ name: '', short: '', logo: '', color: '#1768f2', active: true, commission: 14, fixed: 4, financial: 4.49, ads: 3, others: 1, startDate: '', gross: 0, net: 0, orders: 0 })
const errors = reactive<Record<string, string>>({})
const saleValue = ref(100)
const fees = computed(() => ({ commission: saleValue.value * form.commission / 100, fixed: form.fixed, financial: saleValue.value * form.financial / 100, ads: saleValue.value * form.ads / 100, others: saleValue.value * form.others / 100 }))
const netPreview = computed(() => saleValue.value - Object.values(fees.value).reduce((a, b) => a + b, 0))
const handleLogoUpload = (event: Event) => {
  form.logo = (event.target as HTMLInputElement).files?.[0]?.name || ''
}
const validate = () => {
  Object.keys(errors).forEach(key => delete errors[key])
  if (!form.name.trim()) errors.name = 'Informe o nome do marketplace.'
  if (form.commission < 0) errors.commission = 'Informe uma comissao valida.'
  if (!form.startDate.trim()) errors.startDate = 'Informe a data de inicio das taxas.'
  const first = Object.keys(errors)[0]
  if (first) nextTick(() => document.querySelector(`[data-field="${first}"] input,[data-field="${first}"] select`)?.focus())
  return !first
}
const save = () => {
  if (!validate()) return
  marketplaces.value.unshift({ name: form.name, short: (form.short || form.name[0]).slice(0, 2), color: form.color, commission: form.commission, fixed: form.fixed, financial: form.financial, ads: form.ads, others: form.others, gross: form.gross, net: form.net, orders: form.orders, active: form.active })
  notify('Marketplace cadastrado com sucesso.')
  navigateTo('/marketplaces')
}
const cancel = () => {
  if ((!form.name && !form.startDate) || window.confirm('Descartar alteracoes?\n\nAs informacoes preenchidas ainda nao foram salvas.')) navigateTo('/marketplaces')
}
</script>

<template>
  <div>
    <div class="breadcrumb"><span>Marketplaces</span><UiIcon name="chevron" :size="12" /><strong>Novo Marketplace</strong></div>
    <PageHeader title="Novo Marketplace" subtitle="Cadastre um novo canal de vendas e configure suas taxas." />
    <div class="split-layout" style="grid-template-columns:minmax(0,1fr) 330px">
      <form @submit.prevent="save">
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="store" />1. Marketplace</h2><div class="form-grid">
          <div class="field col-5" data-field="name" :class="{'field--error':errors.name}"><label>Nome do marketplace *</label><select v-model="form.name"><option value="">Selecione</option><option>Shopee</option><option>Mercado Livre</option><option>Amazon</option><option>Etsy</option><option>TikTok Shop</option><option>Elo7</option><option>Site proprio</option><option>Instagram</option><option>Outro</option></select><small v-if="errors.name" class="field__error">{{errors.name}}</small></div>
          <div class="field col-2"><label>Sigla</label><input v-model="form.short" maxlength="2"></div><div class="field col-2"><label>Cor</label><input v-model="form.color" type="color"></div><div class="field col-3"><label>Status</label><select v-model="form.active"><option :value="true">Ativo</option><option :value="false">Inativo</option></select></div>
          <div class="field col-12"><label>Logo</label><label class="upload-zone"><input type="file" accept=".jpg,.jpeg,.png,.svg" hidden @change="handleLogoUpload"><span><UiIcon name="upload" :size="24" /><strong>{{form.logo || 'Enviar logo opcional'}}</strong><small>PNG, JPG ou SVG</small></span></label></div>
        </div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="percent" />2. Taxas</h2><div class="form-grid"><div class="field col-3" data-field="commission" :class="{'field--error':errors.commission}"><label>Comissao percentual *</label><input v-model.number="form.commission" type="number" step=".01"><small v-if="errors.commission" class="field__error">{{errors.commission}}</small></div><div class="field col-3"><label>Tarifa fixa</label><input v-model.number="form.fixed" type="number" step=".01"></div><div class="field col-3"><label>Taxa financeira</label><input v-model.number="form.financial" type="number" step=".01"></div><div class="field col-3"><label>Custo de anuncio</label><input v-model.number="form.ads" type="number" step=".01"></div><div class="field col-3"><label>Outras tarifas</label><input v-model.number="form.others" type="number" step=".01"></div></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="calendar" />3. Vigencia das Taxas</h2><div class="form-grid"><div class="field col-4" data-field="startDate" :class="{'field--error':errors.startDate}"><label>Data de inicio *</label><input v-model="form.startDate" type="date"><small v-if="errors.startDate" class="field__error">{{errors.startDate}}</small></div><div class="col-8 info-note"><UiIcon name="info" :size="18" />As taxas serao aplicadas somente as vendas realizadas a partir desta data.</div></div></div>
        <div class="form-actions"><button class="btn" type="button" @click="cancel">Cancelar</button><button class="btn btn--primary" type="submit">Salvar Marketplace</button></div>
      </form>
      <aside><PanelCard title="Simulacao de Taxas"><div class="field"><label>Valor da venda</label><input v-model.number="saleValue" type="number"></div><div class="detail-list" style="margin-top:10px"><div class="detail-list__row"><span>Venda bruta</span><strong>{{formatCurrency(saleValue)}}</strong></div><div class="detail-list__row"><span>Comissao</span><strong>- {{formatCurrency(fees.commission)}}</strong></div><div class="detail-list__row"><span>Tarifa fixa</span><strong>- {{formatCurrency(fees.fixed)}}</strong></div><div class="detail-list__row"><span>Taxa financeira</span><strong>- {{formatCurrency(fees.financial)}}</strong></div><div class="detail-list__row"><span>Publicidade</span><strong>- {{formatCurrency(fees.ads)}}</strong></div><div class="detail-list__row"><span>Outras taxas</span><strong>- {{formatCurrency(fees.others)}}</strong></div></div><div class="summary-box"><small>Receita Liquida</small><strong class="money-positive" style="display:block;font-size:23px;margin-top:6px">{{formatCurrency(netPreview)}}</strong><span class="badge badge--green" style="margin-top:7px">{{(netPreview/saleValue*100).toFixed(1)}}% do valor bruto</span></div></PanelCard></aside>
    </div>
  </div>
</template>
