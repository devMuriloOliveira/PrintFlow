<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch, watchEffect } from 'vue'
import { navigateTo } from '#app'

const { marketplaces, createItem, updateItem, createMarketplaceIntegration, startMarketplaceOAuth } = useAppData()
const { notify } = useUi()
const route = useRoute()
const saving = ref(false)
const oauthLoading = ref(false)
const errors = reactive<Record<string, string>>({})
const saleValue = ref(100)
const editId = computed(() => typeof route.query.id === 'string' ? route.query.id : '')
const isEditing = computed(() => Boolean(editId.value))
const hydrated = ref(false)
const connectionMode = ref<'oauth' | 'manual'>('oauth')
const persistedConnectionStatus = ref('manual')

const platforms = [
  { id: 'mercado_livre', name: 'Mercado Livre', short: 'ML', color: '#ffe600', commission: 16, fixed: 5, financial: 0, ads: 3, integration: 'available', description: 'OAuth oficial e pedidos automáticos' },
  { id: 'shopee', name: 'Shopee', short: 'SP', color: '#ee4d2d', commission: 14, fixed: 4, financial: 0, ads: 3, integration: 'pending', description: 'Canal manual; integração em desenvolvimento' },
  { id: 'amazon', name: 'Amazon', short: 'AM', color: '#232f3e', commission: 15, fixed: 0, financial: 0, ads: 2, integration: 'pending', description: 'Canal manual; integração ainda não disponível' },
  { id: 'custom', name: 'Outro canal', short: 'OT', color: '#1768f2', commission: 0, fixed: 0, financial: 0, ads: 0, integration: 'manual', description: 'Controle manual de taxas e resultados' }
]

const form = reactive({
  platform: 'mercado_livre', name: 'Mercado Livre', short: 'ML', color: '#ffe600', active: true,
  accountExternalId: '', connectionName: '', accessToken: '', refreshToken: '', tokenExpiresAt: '', scopes: '',
  commission: 16, fixed: 5, financial: 0, ads: 3, others: 0, startDate: ''
})

const selectedPlatform = computed(() => platforms.find(platform => platform.id === form.platform) || platforms[0])
const supportsOfficialIntegration = computed(() => selectedPlatform.value.integration === 'available')
const pendingOfficialIntegration = computed(() => selectedPlatform.value.integration === 'pending')
const requiresManualCredentials = computed(() => supportsOfficialIntegration.value && connectionMode.value === 'manual' && !isEditing.value)
const connectionStatus = computed(() => supportsOfficialIntegration.value ? persistedConnectionStatus.value : 'manual')
const integrationStatusLabel = computed(() => pendingOfficialIntegration.value
  ? 'Integração em breve'
  : supportsOfficialIntegration.value ? 'Integração disponível' : 'Canal manual')
const fees = computed(() => ({
  commission: saleValue.value * form.commission / 100,
  fixed: form.fixed,
  financial: saleValue.value * form.financial / 100,
  ads: saleValue.value * form.ads / 100,
  others: saleValue.value * form.others / 100
}))
const totalFees = computed(() => Object.values(fees.value).reduce((total, value) => total + Number(value || 0), 0))
const netPreview = computed(() => saleValue.value - totalFees.value)
const netPercent = computed(() => saleValue.value > 0 ? netPreview.value / saleValue.value * 100 : 0)

watch(() => form.platform, (platformId) => {
  if (isEditing.value && hydrated.value) return
  const platform = platforms.find(item => item.id === platformId) || platforms[0]
  form.name = platform.name
  form.short = platform.short
  form.color = platform.color
  form.commission = platform.commission
  form.fixed = platform.fixed
  form.financial = platform.financial
  form.ads = platform.ads
  connectionMode.value = platformId === 'mercado_livre' ? 'oauth' : 'manual'
})

watchEffect(() => {
  if (!editId.value || hydrated.value) return
  const item = marketplaces.value.find(marketplace => marketplace.id === editId.value)
  if (!item) return
  Object.assign(form, {
    platform: item.platform || 'custom', name: item.name, short: item.short, color: item.color, active: item.active,
    commission: item.commission, fixed: item.fixed, financial: item.financial, ads: item.ads, others: item.others
  })
  persistedConnectionStatus.value = item.connectionStatus || 'manual'
  connectionMode.value = item.platform === 'mercado_livre' ? 'oauth' : 'manual'
  hydrated.value = true
})

const validate = () => {
  Object.keys(errors).forEach(key => delete errors[key])
  if (!form.name.trim()) errors.name = 'Informe o nome do canal.'
  if (requiresManualCredentials.value && !form.accountExternalId.trim()) errors.accountExternalId = 'Informe o ID da conta externa.'
  if (requiresManualCredentials.value && !form.accessToken.trim()) errors.accessToken = 'Informe o access token da integração.'
  for (const field of ['commission', 'fixed', 'financial', 'ads', 'others'] as const) {
    if (!Number.isFinite(Number(form[field])) || Number(form[field]) < 0) errors[field] = 'Use um valor igual ou maior que zero.'
  }
  if (!form.startDate.trim()) errors.startDate = 'Informe a data de início.'
  const first = Object.keys(errors)[0]
  if (first) nextTick(() => document.querySelector(`[data-field="${first}"] input,[data-field="${first}"] select`)?.focus())
  return !first
}

const connectOfficialOAuth = async () => {
  if (!supportsOfficialIntegration.value || oauthLoading.value) return
  if (!window.confirm('O Mercado Livre vai autorizar a conta que estiver aberta no navegador. Para adicionar outra conta, entre nela ou troque de usuário no Mercado Livre antes de continuar.')) return
  oauthLoading.value = true
  try {
    window.location.href = await startMarketplaceOAuth(form.platform)
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Não foi possível iniciar a autorização oficial.', 'info')
  } finally {
    oauthLoading.value = false
  }
}

const save = async () => {
  if (!validate() || saving.value) return
  saving.value = true
  try {
    const payload = {
      id: editId.value, name: form.name.trim(), short: (form.short || form.name[0]).slice(0, 2).toUpperCase(),
      color: form.color, platform: form.platform, connectionStatus: connectionStatus.value,
      commission: form.commission, fixed: form.fixed, financial: form.financial, ads: form.ads, others: form.others, active: form.active
    }
    if (isEditing.value) await updateItem('marketplaces', payload)
    else await createItem('marketplaces', payload)

    if (!isEditing.value && requiresManualCredentials.value) {
      await createMarketplaceIntegration({
        platform: form.platform, marketplaceName: form.name, connectionName: form.connectionName || form.name,
        accountExternalId: form.accountExternalId, accessToken: form.accessToken, refreshToken: form.refreshToken,
        tokenExpiresAt: form.tokenExpiresAt, scopes: form.scopes
      })
    }

    const message = isEditing.value
      ? 'Canal atualizado com sucesso.'
      : pendingOfficialIntegration.value
        ? `${form.name} cadastrado como canal manual. A integração automática ainda não está disponível.`
        : requiresManualCredentials.value ? 'Marketplace conectado com sucesso.' : 'Canal cadastrado com sucesso.'
    notify(message)
    await navigateTo('/marketplaces')
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Não foi possível salvar o canal.', 'info')
  } finally {
    saving.value = false
  }
}

const cancel = () => {
  if ((!form.accountExternalId && !form.startDate) || window.confirm('Descartar alterações?\n\nAs informações preenchidas ainda não foram salvas.')) navigateTo('/marketplaces')
}
</script>

<template>
  <main class="marketplace-editor">
    <div class="breadcrumb"><span>Marketplaces</span><UiIcon name="chevron" :size="12" /><strong>{{ isEditing ? 'Editar canal' : 'Adicionar canal' }}</strong></div>

    <header class="marketplace-hero">
      <span class="marketplace-hero__icon"><UiIcon name="store" :size="22" /></span>
      <div><span>CANAIS DE VENDA</span><h1>{{ isEditing ? 'Editar canal' : 'Adicionar canal' }}</h1><p>{{ isEditing ? 'Atualize taxas e regras sem alterar o histórico de vendas.' : 'Configure o canal e veja com clareza o que será automático ou manual.' }}</p></div>
      <span class="marketplace-hero__status" :class="{ pending: pendingOfficialIntegration }"><i />{{ integrationStatusLabel }}</span>
    </header>

    <div class="marketplace-editor__layout">
      <form class="marketplace-editor__form" @submit.prevent="save">
        <section class="marketplace-section">
          <div class="marketplace-section__heading"><span>01</span><div><small>CANAL</small><h2>Onde a venda acontece?</h2><p>Escolha a plataforma. Canais pendentes funcionam apenas com controle manual.</p></div></div>
          <div class="integration-grid">
            <button v-for="platform in platforms" :key="platform.id" class="integration-card" :class="{ active: form.platform === platform.id, pending: platform.integration === 'pending' }" type="button" :disabled="isEditing" @click="form.platform = platform.id">
              <div class="integration-card__top"><MarketplaceLogo :platform="platform.id" :name="platform.name" :short="platform.short" :size="34" /><span class="badge" :class="platform.integration === 'available' ? 'badge--green' : platform.integration === 'pending' ? 'badge--orange' : 'badge--gray'">{{ platform.integration === 'available' ? 'Disponível' : platform.integration === 'pending' ? 'Em breve' : 'Manual' }}</span></div>
              <strong>{{ platform.name }}</strong><small>{{ platform.description }}</small><i />
            </button>
          </div>
          <div class="form-grid marketplace-section__fields">
            <div class="field col-5" data-field="name" :class="{'field--error':errors.name}"><label>Nome no PrintFlow <b>*</b></label><input v-model="form.name"><small v-if="errors.name" class="field__error">{{ errors.name }}</small></div>
            <div class="field col-2"><label>Sigla</label><input v-model="form.short" maxlength="2"></div>
            <div class="field col-2"><label>Cor</label><input v-model="form.color" type="color"></div>
            <div class="field col-3"><label>Status do canal</label><select v-model="form.active"><option :value="true">Ativo</option><option :value="false">Inativo</option></select></div>
          </div>
        </section>

        <section class="marketplace-section">
          <div class="marketplace-section__heading"><span>02</span><div><small>INTEGRAÇÃO</small><h2>Como os pedidos entram?</h2><p>A disponibilidade abaixo se refere à importação automática, não ao cadastro manual do canal.</p></div></div>

          <template v-if="supportsOfficialIntegration">
            <div class="integration-message integration-message--available"><span><UiIcon name="check" :size="17" /></span><div><strong>Integração oficial disponível</strong><p>O Mercado Livre pode enviar pedidos automaticamente após a autorização OAuth.</p></div></div>
            <div class="oauth-guidance"><UiIcon name="info" :size="18" /><span><strong>Vai adicionar outra conta?</strong> Entre nessa conta ou troque de usuário no Mercado Livre antes de continuar. O OAuth autoriza a conta aberta no navegador.</span></div>
            <div class="integration-actions"><button type="button" class="btn btn--primary" :disabled="oauthLoading" @click="connectOfficialOAuth"><UiIcon name="bolt" :size="16" />{{ oauthLoading ? 'Abrindo Mercado Livre...' : 'Conectar com OAuth oficial' }}</button><button type="button" class="btn" :class="{ 'btn--primary': connectionMode === 'manual' }" @click="connectionMode = connectionMode === 'manual' ? 'oauth' : 'manual'">{{ connectionMode === 'manual' ? 'Voltar para OAuth' : 'Tenho credenciais manuais' }}</button></div>
            <div v-if="requiresManualCredentials" class="manual-credentials">
              <div class="info-note"><UiIcon name="shield" :size="17" />Use esta opção somente se você recebeu credenciais válidas do serviço.</div>
              <div class="form-grid">
                <div class="field col-4" data-field="accountExternalId" :class="{'field--error':errors.accountExternalId}"><label>Seller/User ID <b>*</b></label><input v-model="form.accountExternalId"><small v-if="errors.accountExternalId" class="field__error">{{ errors.accountExternalId }}</small></div>
                <div class="field col-4"><label>Nome da conexão</label><input v-model="form.connectionName" placeholder="Loja principal"></div>
                <div class="field col-4"><label>Expira em</label><input v-model="form.tokenExpiresAt" type="datetime-local"></div>
                <div class="field col-6" data-field="accessToken" :class="{'field--error':errors.accessToken}"><label>Access token <b>*</b></label><input v-model="form.accessToken" type="password" autocomplete="off" placeholder="Armazenado de forma criptografada"><small v-if="errors.accessToken" class="field__error">{{ errors.accessToken }}</small></div>
                <div class="field col-6"><label>Refresh token</label><input v-model="form.refreshToken" type="password" autocomplete="off" placeholder="Opcional e criptografado"></div>
                <div class="field col-12"><label>Escopos/permissões</label><input v-model="form.scopes" placeholder="orders.read, finances.read"></div>
              </div>
            </div>
          </template>

          <div v-else-if="pendingOfficialIntegration" class="integration-message integration-message--pending">
            <span><UiIcon name="clock" :size="18" /></span><div><strong>Integração com {{ selectedPlatform.name }} ainda não disponível</strong><p>Você pode salvar o canal e configurar suas taxas agora, mas os pedidos não serão importados automaticamente. Não é necessário informar token ou credenciais.</p><small>Quando a integração oficial for liberada, a conexão aparecerá na área de Contas conectadas.</small></div>
          </div>

          <div v-else class="integration-message integration-message--manual">
            <span><UiIcon name="settings" :size="18" /></span><div><strong>Controle totalmente manual</strong><p>Use para vendas de balcão, redes sociais ou qualquer canal sem integração. Os pedidos são registrados pela tela de Nova venda.</p></div>
          </div>
        </section>

        <section class="marketplace-section">
          <div class="marketplace-section__heading"><span>03</span><div><small>REGRAS FINANCEIRAS</small><h2>Taxas e vigência</h2><p>Esses valores entram nas simulações e servem como referência quando o canal não detalhar as tarifas.</p></div></div>
          <div class="form-grid marketplace-section__fields">
            <div class="field col-3" data-field="commission" :class="{'field--error':errors.commission}"><label>Comissão (%) <b>*</b></label><input v-model.number="form.commission" type="number" min="0" step=".01"><small v-if="errors.commission" class="field__error">{{ errors.commission }}</small></div>
            <div class="field col-3" data-field="fixed" :class="{'field--error':errors.fixed}"><label>Tarifa fixa</label><input v-model.number="form.fixed" type="number" min="0" step=".01"><small v-if="errors.fixed" class="field__error">{{ errors.fixed }}</small></div>
            <div class="field col-3" data-field="financial" :class="{'field--error':errors.financial}"><label>Taxa financeira (%)</label><input v-model.number="form.financial" type="number" min="0" step=".01"><small v-if="errors.financial" class="field__error">{{ errors.financial }}</small></div>
            <div class="field col-3" data-field="ads" :class="{'field--error':errors.ads}"><label>Anúncios (%)</label><input v-model.number="form.ads" type="number" min="0" step=".01"><small v-if="errors.ads" class="field__error">{{ errors.ads }}</small></div>
            <div class="field col-3" data-field="others" :class="{'field--error':errors.others}"><label>Outras taxas (%)</label><input v-model.number="form.others" type="number" min="0" step=".01"><small v-if="errors.others" class="field__error">{{ errors.others }}</small></div>
            <div class="field col-4" data-field="startDate" :class="{'field--error':errors.startDate}"><label>Início das taxas <b>*</b></label><UiDateInput v-model="form.startDate" aria-label="Início das taxas" /><small v-if="errors.startDate" class="field__error">{{ errors.startDate }}</small></div>
            <div class="col-5 info-note"><UiIcon name="info" :size="18" />Revise as taxas com frequência; cada plataforma pode alterá-las conforme categoria ou anúncio.</div>
          </div>
        </section>

        <div class="form-actions marketplace-editor__actions"><button class="btn" type="button" @click="cancel">Cancelar</button><button class="btn btn--primary" type="submit" :disabled="saving"><UiIcon name="check" :size="16" />{{ saving ? 'Salvando...' : isEditing ? 'Salvar alterações' : pendingOfficialIntegration ? 'Salvar canal manual' : 'Salvar canal' }}</button></div>
      </form>

      <aside class="marketplace-preview">
        <section class="marketplace-preview__card">
          <header><MarketplaceLogo :platform="form.platform" :name="form.name" :short="form.short" :size="44" /><div><small>PRÉVIA DO CANAL</small><h3>{{ form.name || 'Novo canal' }}</h3><span class="badge" :class="supportsOfficialIntegration ? 'badge--green' : pendingOfficialIntegration ? 'badge--orange' : 'badge--gray'">{{ integrationStatusLabel }}</span></div></header>
          <div class="field marketplace-preview__sale"><label>Simular venda de</label><div class="marketplace-money"><span>R$</span><input v-model.number="saleValue" type="number" min="0" step=".01"></div></div>
          <div class="marketplace-preview__breakdown"><div><span>Venda bruta</span><strong>{{ formatCurrency(saleValue) }}</strong></div><div><span>Total de taxas</span><strong class="money-negative">- {{ formatCurrency(totalFees) }}</strong></div><div class="total"><span>Receita líquida</span><strong :class="netPreview >= 0 ? 'money-positive' : 'money-negative'">{{ formatCurrency(netPreview) }}</strong></div></div>
          <div class="marketplace-preview__percent"><div><span>Percentual líquido</span><strong>{{ netPercent.toFixed(1).replace('.', ',') }}%</strong></div><i><span :style="{ width: `${Math.max(0, Math.min(100, netPercent))}%` }" /></i></div>
        </section>

        <section class="marketplace-behavior">
          <h3><UiIcon name="bolt" :size="17" />Como funcionará</h3>
          <div><span class="active"><UiIcon name="check" :size="12" /></span><p><strong>Taxas e simulações</strong><small>Disponíveis assim que o canal for salvo.</small></p></div>
          <div><span :class="{ active: supportsOfficialIntegration }"><UiIcon :name="supportsOfficialIntegration ? 'check' : 'clock'" :size="12" /></span><p><strong>Importação de pedidos</strong><small>{{ supportsOfficialIntegration ? 'Disponível após conectar uma conta.' : pendingOfficialIntegration ? 'Ainda não disponível para este canal.' : 'Registro manual pela tela de vendas.' }}</small></p></div>
          <div><span :class="{ active: supportsOfficialIntegration }"><UiIcon :name="supportsOfficialIntegration ? 'check' : 'info'" :size="12" /></span><p><strong>Sincronização automática</strong><small>{{ supportsOfficialIntegration ? 'OAuth oficial do Mercado Livre.' : 'Nenhuma credencial será solicitada.' }}</small></p></div>
        </section>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.marketplace-editor{width:min(100%,1280px);margin:0 auto}.marketplace-hero{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:14px;overflow:hidden;margin-bottom:16px;border:1px solid #d8e4f5;border-radius:14px;background:linear-gradient(135deg,#fbfdff,#eef5ff);padding:18px 20px}.marketplace-hero:after{position:absolute;right:-35px;top:-75px;width:160px;height:160px;border-radius:50%;background:rgba(23,104,242,.06);content:''}.marketplace-hero__icon{display:grid;width:46px;height:46px;place-items:center;border-radius:13px;color:#fff;background:linear-gradient(145deg,#1768f2,#0c50bd);box-shadow:0 8px 20px rgba(23,104,242,.2)}.marketplace-hero>div>span,.marketplace-preview__card header small{display:block;color:var(--blue);font-size:8px;font-weight:800;letter-spacing:.09em}.marketplace-hero h1{margin:3px 0;color:#172238;font-size:21px}.marketplace-hero p{margin:0;color:var(--muted);font-size:10px}.marketplace-hero__status{position:relative;z-index:1;display:flex;align-items:center;gap:6px;border:1px solid #d5e6de;border-radius:999px;color:#267453;background:#f5fcf8;padding:6px 10px;font-size:8px;font-weight:800}.marketplace-hero__status i{width:7px;height:7px;border-radius:50%;background:#16a36a;box-shadow:0 0 0 3px rgba(22,163,106,.12)}.marketplace-hero__status.pending{border-color:#f0dfbc;color:#8a5b08;background:#fffaf0}.marketplace-hero__status.pending i{background:#e59a16;box-shadow:0 0 0 3px rgba(229,154,22,.13)}.marketplace-editor__layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;align-items:start;gap:16px}.marketplace-editor__form{display:grid;gap:12px}.marketplace-section{border:1px solid var(--line);border-radius:12px;background:#fff;padding:20px}.marketplace-section__heading{display:flex;align-items:flex-start;gap:12px;padding-bottom:15px;border-bottom:1px solid #edf1f6}.marketplace-section__heading>span{display:grid;width:34px;height:34px;flex:0 0 auto;place-items:center;border-radius:9px;color:var(--blue);background:var(--blue-soft);font-size:10px;font-weight:800}.marketplace-section__heading small{display:block;color:var(--blue);font-size:8px;font-weight:800;letter-spacing:.08em}.marketplace-section__heading h2{margin:3px 0;color:#192338;font-size:14px}.marketplace-section__heading p{margin:0;color:var(--muted);font-size:9px}.marketplace-section__fields{margin-top:16px}.integration-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:16px}.integration-card{position:relative;display:flex;min-height:132px;flex-direction:column;align-items:flex-start;gap:6px;border:1px solid var(--line);border-radius:10px;color:#263349;background:#fff;padding:11px;text-align:left;cursor:pointer;transition:border-color .16s,box-shadow .16s,transform .16s}.integration-card:hover{border-color:#b9cdeb;transform:translateY(-1px)}.integration-card:disabled{color:#263349;cursor:default;opacity:.78}.integration-card:disabled:hover{border-color:var(--line);transform:none}.integration-card:disabled.active:hover{border-color:var(--blue)}.integration-card.active{border-color:var(--blue);background:#f7faff;box-shadow:inset 0 0 0 1px rgba(23,104,242,.1)}.integration-card.pending:not(.active){background:#fffdf9}.integration-card__top{display:flex;width:100%;align-items:center;justify-content:space-between;gap:6px}.integration-card>strong{margin-top:2px;font-size:10px}.integration-card>small{color:var(--muted);font-size:8px;line-height:1.4}.integration-card>i{position:absolute;right:10px;bottom:10px;width:13px;height:13px;border:1px solid #bdc8d7;border-radius:50%}.integration-card.active>i{border:4px solid var(--blue)}.field label b{color:var(--red)}.integration-message{display:grid;grid-template-columns:38px 1fr;gap:11px;margin-top:16px;border:1px solid #d8e5f4;border-radius:10px;background:#f8fbff;padding:13px}.integration-message>span{display:grid;width:36px;height:36px;place-items:center;border-radius:9px;color:var(--blue);background:#e6f0ff}.integration-message strong,.integration-message p,.integration-message small{display:block}.integration-message strong{color:#26344a;font-size:10px}.integration-message p{margin:4px 0 0;color:#5e6d81;font-size:9px;line-height:1.5}.integration-message small{margin-top:6px;color:#8a641b;font-size:8px}.integration-message--available{border-color:#cfe8dc;background:#f5fcf8}.integration-message--available>span{color:#087b54;background:#e2f6ec}.integration-message--pending{border-color:#f0dfbd;background:#fffbf2}.integration-message--pending>span{color:#9a6507;background:#fff0cf}.integration-message--manual>span{color:#64748b;background:#edf1f6}.oauth-guidance{display:flex;gap:8px;margin-top:10px;border-left:3px solid var(--blue);border-radius:0 8px 8px 0;color:#536379;background:#f7faff;padding:10px 12px;font-size:8.5px;line-height:1.5}.oauth-guidance svg{flex:0 0 auto;color:var(--blue)}.integration-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.manual-credentials{display:grid;gap:12px;margin-top:14px;border-top:1px solid var(--line);padding-top:14px}.field__hint{color:var(--muted);font-size:8px}.marketplace-editor__actions{position:sticky;bottom:12px;z-index:4;margin-top:0;box-shadow:0 10px 30px rgba(28,47,80,.1)}.marketplace-preview{position:sticky;top:84px;display:grid;gap:12px}.marketplace-preview__card,.marketplace-behavior{overflow:hidden;border:1px solid var(--line);border-radius:12px;background:#fff}.marketplace-preview__card header{display:flex;align-items:center;gap:11px;border-bottom:1px solid var(--line);background:linear-gradient(145deg,#fff,#f5f9ff);padding:16px}.marketplace-preview__card h3{margin:3px 0 5px;color:#192338;font-size:14px}.marketplace-preview__sale{padding:14px 16px}.marketplace-money{display:flex;align-items:center;overflow:hidden;border:1px solid var(--line);border-radius:7px}.marketplace-money:focus-within{border-color:var(--blue);box-shadow:0 0 0 3px rgba(23,104,242,.08)}.marketplace-money span{color:#6a778a;padding-left:10px;font-size:9px;font-weight:750}.marketplace-money input{border:0!important;box-shadow:none!important;padding-left:6px}.marketplace-preview__breakdown{padding:0 16px 10px}.marketplace-preview__breakdown>div{display:flex;justify-content:space-between;gap:10px;padding:8px 0;color:var(--muted);font-size:9px}.marketplace-preview__breakdown strong{color:#2d3b50}.marketplace-preview__breakdown .total{margin-top:3px;border-top:1px solid var(--line);color:#26344a;font-weight:750}.marketplace-preview__percent{border-top:1px solid var(--line);background:#fafcff;padding:12px 16px}.marketplace-preview__percent>div{display:flex;justify-content:space-between;color:var(--muted);font-size:8px}.marketplace-preview__percent>div strong{color:#2d3b50}.marketplace-preview__percent>i{display:block;height:5px;margin-top:8px;border-radius:99px;background:#e7edf5}.marketplace-preview__percent>i span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#1768f2,#20a06a)}.marketplace-behavior{display:grid;gap:12px;padding:15px}.marketplace-behavior h3{display:flex;align-items:center;gap:7px;margin:0;color:#26344a;font-size:11px}.marketplace-behavior>div{display:grid;grid-template-columns:20px 1fr;align-items:start;gap:8px}.marketplace-behavior>div>span{display:grid;width:19px;height:19px;place-items:center;border-radius:50%;color:#8a650e;background:#fff0cf}.marketplace-behavior>div>span.active{color:#087b54;background:#e2f6ec}.marketplace-behavior p,.marketplace-behavior strong,.marketplace-behavior small{display:block;margin:0}.marketplace-behavior strong{color:#334157;font-size:9px}.marketplace-behavior small{color:var(--muted);margin-top:3px;font-size:8px;line-height:1.45}
@media(max-width:1050px){.integration-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.marketplace-editor__layout{grid-template-columns:minmax(0,1fr) 290px}}
@media(max-width:900px){.marketplace-editor__layout{grid-template-columns:1fr}.marketplace-preview{position:static;grid-template-columns:1fr 1fr}}
@media(max-width:700px){.marketplace-hero{grid-template-columns:auto 1fr}.marketplace-hero__status{grid-column:1/-1;width:max-content}.marketplace-section{padding:16px}.integration-grid,.marketplace-preview{grid-template-columns:1fr}.form-grid>.field{grid-column:1/-1}.marketplace-editor__actions{position:static}.marketplace-editor__actions .btn{flex:1}.integration-actions .btn{width:100%}}
</style>
