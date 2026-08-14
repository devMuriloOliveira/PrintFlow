<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { navigateTo } from '#app'

const { apiBase, createItem, createMarketplaceIntegration } = useAppData()
const { notify } = useUi()
const saving = ref(false)
const errors = reactive<Record<string, string>>({})
const saleValue = ref(100)

const platforms = [
  { id: 'mercado_livre', name: 'Mercado Livre', short: 'ML', color: '#ffe600', webhook: '/webhooks/mercadolivre', commission: 16, fixed: 5, financial: 0, ads: 3 },
  { id: 'shopee', name: 'Shopee', short: 'SP', color: '#ee4d2d', webhook: '/webhooks/shopee', commission: 14, fixed: 4, financial: 0, ads: 3 },
  { id: 'amazon', name: 'Amazon', short: 'AM', color: '#232f3e', webhook: '/webhooks/amazon', commission: 15, fixed: 0, financial: 0, ads: 2 },
  { id: 'custom', name: 'Outro canal', short: 'OT', color: '#1768f2', webhook: '', commission: 0, fixed: 0, financial: 0, ads: 0 }
]

const form = reactive({
  platform: 'mercado_livre',
  name: 'Mercado Livre',
  short: 'ML',
  color: '#ffe600',
  active: true,
  accountExternalId: '',
  connectionName: '',
  accessToken: '',
  refreshToken: '',
  tokenExpiresAt: '',
  scopes: '',
  commission: 16,
  fixed: 5,
  financial: 0,
  ads: 3,
  others: 0,
  startDate: ''
})

const selectedPlatform = computed(() => platforms.find((item) => item.id === form.platform) || platforms[0])
const requiresToken = computed(() => form.platform !== 'custom')
const webhookUrl = computed(() => selectedPlatform.value.webhook ? `${apiBase}${selectedPlatform.value.webhook}` : '')
const connectionStatus = computed(() => form.platform === 'custom' ? 'manual' : 'connected')
const fees = computed(() => ({
  commission: saleValue.value * form.commission / 100,
  fixed: form.fixed,
  financial: saleValue.value * form.financial / 100,
  ads: saleValue.value * form.ads / 100,
  others: saleValue.value * form.others / 100
}))
const totalFees = computed(() => Object.values(fees.value).reduce((a, b) => a + b, 0))
const netPreview = computed(() => saleValue.value - totalFees.value)

watch(() => form.platform, (platformId) => {
  const platform = platforms.find((item) => item.id === platformId) || platforms[0]
  form.name = platform.name
  form.short = platform.short
  form.color = platform.color
  form.commission = platform.commission
  form.fixed = platform.fixed
  form.financial = platform.financial
  form.ads = platform.ads
})

const validate = () => {
  Object.keys(errors).forEach(key => delete errors[key])
  if (!form.name.trim()) errors.name = 'Informe o nome do canal.'
  if (requiresToken.value && !form.accountExternalId.trim()) errors.accountExternalId = 'Informe o ID da conta externa.'
  if (requiresToken.value && !form.accessToken.trim()) errors.accessToken = 'Informe o access token da integracao.'
  if (form.commission < 0) errors.commission = 'Informe uma comissao valida.'
  if (!form.startDate.trim()) errors.startDate = 'Informe a data de inicio.'
  const first = Object.keys(errors)[0]
  if (first) nextTick(() => document.querySelector(`[data-field="${first}"] input,[data-field="${first}"] select`)?.focus())
  return !first
}

const copyWebhook = () => {
  navigator.clipboard?.writeText(webhookUrl.value)
  notify('URL copiada.')
}

const save = async () => {
  if (!validate() || saving.value) return
  saving.value = true
  try {
    await createItem('marketplaces', {
      name: form.name,
      short: (form.short || form.name[0]).slice(0, 2).toUpperCase(),
      color: form.color,
      platform: form.platform,
      connectionStatus: connectionStatus.value,
      commission: form.commission,
      fixed: form.fixed,
      financial: form.financial,
      ads: form.ads,
      others: form.others,
      active: form.active
    })

    if (requiresToken.value) {
      await createMarketplaceIntegration({
        platform: form.platform,
        marketplaceName: form.name,
        connectionName: form.connectionName || form.name,
        accountExternalId: form.accountExternalId,
        accessToken: form.accessToken,
        refreshToken: form.refreshToken,
        tokenExpiresAt: form.tokenExpiresAt,
        scopes: form.scopes
      })
    }

    notify(requiresToken.value ? 'Marketplace conectado com sucesso.' : 'Marketplace cadastrado com sucesso.')
    navigateTo('/marketplaces')
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Nao foi possivel salvar o marketplace.', 'info')
  } finally {
    saving.value = false
  }
}

const cancel = () => {
  if ((!form.accountExternalId && !form.startDate) || window.confirm('Descartar alteracoes?\n\nAs informacoes preenchidas ainda nao foram salvas.')) navigateTo('/marketplaces')
}
</script>

<template>
  <div>
    <div class="breadcrumb"><span>Marketplaces</span><UiIcon name="chevron" :size="12" /><strong>Novo Marketplace</strong></div>
    <PageHeader title="Novo Marketplace" subtitle="Conecte canais de venda e acompanhe receita, taxas e lucro automaticamente." />
    <div class="split-layout" style="grid-template-columns:minmax(0,1fr) 330px">
      <form @submit.prevent="save">
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="store" />1. Servico de venda</h2><div class="integration-grid">
          <button v-for="platform in platforms" :key="platform.id" class="integration-card" :class="{active:form.platform===platform.id}" type="button" @click="form.platform=platform.id">
            <span class="market-logo" :style="{background:platform.color,color:platform.id==='mercado_livre'?'#17233c':'#fff'}">{{platform.short}}</span>
            <strong>{{platform.name}}</strong>
            <small>{{platform.id==='custom' ? 'Controle manual de taxas' : 'Webhook e token obrigatorio'}}</small>
          </button>
        </div><div class="form-grid" style="margin-top:14px">
          <div class="field col-5" data-field="name" :class="{'field--error':errors.name}"><label>Nome no PrintFlow *</label><input v-model="form.name"><small v-if="errors.name" class="field__error">{{errors.name}}</small></div>
          <div class="field col-2"><label>Sigla</label><input v-model="form.short" maxlength="2"></div>
          <div class="field col-2"><label>Cor</label><input v-model="form.color" type="color"></div>
          <div class="field col-3"><label>Status</label><select v-model="form.active"><option :value="true">Ativo</option><option :value="false">Inativo</option></select></div>
        </div></div>

        <div class="form-card"><h2 class="form-card__title"><UiIcon name="shield" />2. Credenciais e webhook</h2><div class="form-grid">
          <div v-if="requiresToken" class="field col-4" data-field="accountExternalId" :class="{'field--error':errors.accountExternalId}"><label>ID da conta externa *</label><input v-model="form.accountExternalId" :placeholder="form.platform==='shopee'?'Shop ID':'Seller/User ID'"><small v-if="errors.accountExternalId" class="field__error">{{errors.accountExternalId}}</small></div>
          <div class="field col-4"><label>Nome da conexao</label><input v-model="form.connectionName" placeholder="Loja principal"></div>
          <div v-if="requiresToken" class="field col-4"><label>Expira em</label><input v-model="form.tokenExpiresAt" type="datetime-local"></div>
          <div v-if="requiresToken" class="field col-6" data-field="accessToken" :class="{'field--error':errors.accessToken}"><label>Access token *</label><input v-model="form.accessToken" type="password" autocomplete="off" placeholder="Obrigatorio e criptografado"><small v-if="errors.accessToken" class="field__error">{{errors.accessToken}}</small></div>
          <div v-if="requiresToken" class="field col-6"><label>Refresh token</label><input v-model="form.refreshToken" type="password" autocomplete="off" placeholder="Opcional e criptografado"></div>
          <div v-if="requiresToken" class="field col-12"><label>Escopos/permissoes</label><input v-model="form.scopes" placeholder="orders.read, finances.read"></div>
          <div v-if="webhookUrl" class="field col-12"><label>URL do webhook para configurar no servico</label><div class="copy-field"><input :value="webhookUrl" readonly><button class="btn" type="button" @click="copyWebhook"><UiIcon name="download" :size="15"/>Copiar</button></div></div>
        </div></div>

        <div class="form-card"><h2 class="form-card__title"><UiIcon name="percent" />3. Taxas e vigencia</h2><div class="form-grid">
          <div class="field col-3" data-field="commission" :class="{'field--error':errors.commission}"><label>Comissao (%) *</label><input v-model.number="form.commission" type="number" step=".01"><small v-if="errors.commission" class="field__error">{{errors.commission}}</small></div>
          <div class="field col-3"><label>Tarifa fixa</label><input v-model.number="form.fixed" type="number" step=".01"></div>
          <div class="field col-3"><label>Taxa financeira (%)</label><input v-model.number="form.financial" type="number" step=".01"></div>
          <div class="field col-3"><label>Anuncios (%)</label><input v-model.number="form.ads" type="number" step=".01"></div>
          <div class="field col-3"><label>Outras taxas (%)</label><input v-model.number="form.others" type="number" step=".01"></div>
          <div class="field col-4" data-field="startDate" :class="{'field--error':errors.startDate}"><label>Inicio das taxas *</label><input v-model="form.startDate" type="date"><small v-if="errors.startDate" class="field__error">{{errors.startDate}}</small></div>
          <div class="col-5 info-note"><UiIcon name="info" :size="18" />Essas regras entram quando a plataforma nao enviar o detalhamento completo das taxas.</div>
        </div></div>

        <div class="form-actions"><button class="btn" type="button" @click="cancel">Cancelar</button><button class="btn btn--primary" type="submit" :disabled="saving">{{ saving ? 'Salvando...' : 'Salvar e conectar' }}</button></div>
      </form>
      <aside><PanelCard title="Previa de resultado"><div class="field"><label>Valor da venda</label><input v-model.number="saleValue" type="number"></div><div class="detail-list" style="margin-top:10px"><div class="detail-list__row"><span>Venda bruta</span><strong>{{formatCurrency(saleValue)}}</strong></div><div class="detail-list__row"><span>Total de taxas</span><strong>- {{formatCurrency(totalFees)}}</strong></div><div class="detail-list__row"><span>Receita liquida</span><strong class="money-positive">{{formatCurrency(netPreview)}}</strong></div></div><div class="summary-box"><small>Status da conexao</small><strong style="display:block;font-size:18px;margin-top:6px">{{connectionStatus === 'connected' ? 'Conectado' : 'Manual'}}</strong><span class="badge badge--green" style="margin-top:7px">{{netPreview && saleValue ? (netPreview/saleValue*100).toFixed(1) : '0.0'}}% do bruto</span></div></PanelCard></aside>
    </div>
  </div>
</template>

<style scoped>
.integration-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.integration-card{display:flex;min-height:92px;flex-direction:column;align-items:flex-start;justify-content:center;gap:6px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:10px;text-align:left;cursor:pointer}
.integration-card.active{border-color:var(--blue);box-shadow:0 0 0 2px #e4f0ff;background:#fbfdff}
.integration-card small{color:var(--muted);font-size:8px}
.market-logo{display:grid;width:30px;height:30px;place-items:center;border-radius:7px;font-weight:800;font-size:12px}
.copy-field{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}
@media (max-width:900px){.integration-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
