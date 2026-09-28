<script setup lang="ts">
import { computed, nextTick, reactive, ref, watchEffect } from 'vue'
import { navigateTo } from '#app'

const { clients, createItem, updateItem } = useAppData()
const { notify } = useUi()
const route = useRoute()

const defaultForm = () => ({
  name: '', type: 'Pessoa Física', document: '', phone: '', email: '', zip: '', address: '', number: '',
  complement: '', district: '', city: '', state: '', origin: 'Instagram', notes: '', tags: '', status: 'active'
})

const form = reactive(defaultForm())
const errors = reactive<Record<string, string>>({})
const saving = ref(false)
const hydrated = ref(false)
const initialSnapshot = ref(JSON.stringify(defaultForm()))
const editId = computed(() => typeof route.query.id === 'string' ? route.query.id : '')
const isEditing = computed(() => Boolean(editId.value))
const editingClient = computed(() => clients.value.find(client => String(client.id || '') === editId.value) || null)
const initials = computed(() => form.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'NC')
const documentLabel = computed(() => form.type === 'Pessoa Jurídica' ? 'CNPJ' : 'CPF')
const documentPlaceholder = computed(() => form.type === 'Pessoa Jurídica' ? '00.000.000/0000-00' : '000.000.000-00')
const tags = computed(() => form.tags.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 8))
const hasChanges = computed(() => JSON.stringify(form) !== initialSnapshot.value)
const completionItems = computed(() => [
  { label: 'Identificação', ready: Boolean(form.name.trim()) },
  { label: 'Contato', ready: Boolean(form.phone.trim() || form.email.trim()) },
  { label: 'Endereço', ready: Boolean(form.city.trim() || form.address.trim()) },
  { label: 'Perfil comercial', ready: Boolean(form.origin) }
])
const completion = computed(() => Math.round(completionItems.value.filter(item => item.ready).length / completionItems.value.length * 100))
const addressPreview = computed(() => {
  const street = [form.address, form.number].filter(Boolean).join(', ')
  const place = [form.district, form.city, form.state].filter(Boolean).join(' · ')
  return [street, place].filter(Boolean).join(' — ') || 'Endereço não informado'
})
const stateOptions = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']

const normalizeClientType = (value: unknown) => /jur/i.test(String(value || '')) ? 'Pessoa Jurídica' : 'Pessoa Física'

watchEffect(() => {
  if (!editId.value || hydrated.value || !editingClient.value) return
  const client = editingClient.value
  Object.assign(form, {
    name: client.name || '', email: /^(?:nao-informado|sem-email@printflow\.local)$/i.test(client.email || '') ? '' : client.email,
    phone: /^(?:nao-informado|-)$/i.test(client.phone || '') ? '' : client.phone, type: normalizeClientType(client.type),
    document: client.document || '', zip: client.zip || '', address: client.address || '', number: client.number || '',
    complement: client.complement || '', district: client.district || '', city: client.city || '', state: String(client.state || '').toUpperCase(),
    origin: client.origin || 'Outro', notes: client.notes || '', tags: client.tags || '', status: client.status || 'active'
  })
  initialSnapshot.value = JSON.stringify(form)
  hydrated.value = true
})

const validate = () => {
  Object.keys(errors).forEach(key => delete errors[key])
  if (!form.name.trim()) errors.name = 'Informe o nome do cliente.'
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Informe um e-mail válido.'
  if (form.state && !stateOptions.includes(form.state.toUpperCase())) errors.state = 'Selecione uma UF válida.'
  const first = Object.keys(errors)[0]
  if (first) nextTick(() => document.querySelector(`[data-field="${first}"] input,[data-field="${first}"] select`)?.focus())
  return !first
}

const resetForm = () => {
  Object.assign(form, defaultForm())
  Object.keys(errors).forEach(key => delete errors[key])
  initialSnapshot.value = JSON.stringify(form)
  nextTick(() => document.querySelector<HTMLElement>('[data-field="name"] input')?.focus())
}

const save = async (again = false) => {
  if (!validate() || saving.value) return
  saving.value = true
  const current = editingClient.value
  const payload = {
    id: editId.value, name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), type: form.type,
    document: form.document.trim(), zip: form.zip.trim(), address: form.address.trim(), number: form.number.trim(),
    complement: form.complement.trim(), district: form.district.trim(), city: form.city.trim(), state: form.state.trim().toUpperCase(),
    origin: form.origin, notes: form.notes.trim(), tags: form.tags.trim(), status: form.status,
    orders: Number(current?.orders || 0), revenue: Number(current?.revenue || 0), ticket: Number(current?.ticket || 0), last: current?.last || ''
  }

  try {
    if (isEditing.value) await updateItem('clients', payload)
    else await createItem('clients', payload)
    notify(isEditing.value ? 'Cliente atualizado com sucesso.' : 'Cliente cadastrado com sucesso.')
    if (again) return resetForm()
    await navigateTo('/clientes')
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Não foi possível salvar o cliente.', 'info')
  } finally {
    saving.value = false
  }
}

const cancel = () => {
  if (!hasChanges.value || window.confirm('Descartar alterações?\n\nAs informações preenchidas ainda não foram salvas.')) navigateTo('/clientes')
}
</script>

<template>
  <main class="client-editor">
    <div class="breadcrumb client-editor__breadcrumb"><span>Clientes</span><UiIcon name="chevron" :size="12" /><strong>{{ isEditing ? 'Editar cliente' : 'Novo cliente' }}</strong></div>

    <header class="client-editor__hero">
      <span class="client-editor__hero-icon"><UiIcon name="users" :size="22" /></span>
      <div><span>RELACIONAMENTO COMERCIAL</span><h1>{{ isEditing ? 'Editar cliente' : 'Novo cliente' }}</h1><p>{{ isEditing ? 'Atualize os dados sem perder o histórico de compras vinculado.' : 'Crie um cadastro para conectar vendas, contatos e histórico comercial.' }}</p></div>
      <span class="client-editor__status"><i :class="{ inactive: form.status === 'inactive' }" />{{ form.status === 'inactive' ? 'INATIVO' : isEditing ? 'CADASTRO ATIVO' : 'NOVO CADASTRO' }}</span>
    </header>

    <div class="client-editor__layout">
      <form class="client-editor__form" @submit.prevent="save(false)">
        <section class="client-section">
          <div class="client-section__heading"><span>01</span><div><small>IDENTIFICAÇÃO</small><h2>Quem é este cliente?</h2><p>Use os dados fiscais apenas quando forem necessários para a operação.</p></div></div>
          <div class="client-type-grid" role="group" aria-label="Tipo de cliente">
            <button v-for="option in [{ value: 'Pessoa Física', icon: 'users', text: 'CPF e dados pessoais' }, { value: 'Pessoa Jurídica', icon: 'building', text: 'CNPJ e razão social' }]" :key="option.value" type="button" :class="{ active: form.type === option.value }" @click="form.type = option.value"><span><UiIcon :name="option.icon" :size="18" /></span><div><strong>{{ option.value }}</strong><small>{{ option.text }}</small></div><i /></button>
          </div>
          <div class="form-grid client-section__fields">
            <div class="field col-7" data-field="name" :class="{'field--error':errors.name}"><label>{{ form.type === 'Pessoa Jurídica' ? 'Razão social' : 'Nome completo' }} <b>*</b></label><input v-model="form.name" autocomplete="name" :placeholder="form.type === 'Pessoa Jurídica' ? 'Ex.: Oficina Criativa Ltda.' : 'Ex.: Mariana Oliveira'"><small v-if="errors.name" class="field__error">{{ errors.name }}</small></div>
            <div class="field col-5"><label>{{ documentLabel }}</label><input v-model="form.document" inputmode="numeric" :placeholder="documentPlaceholder"><small class="field__hint">Opcional. Armazenado de forma protegida.</small></div>
          </div>
        </section>

        <section class="client-section">
          <div class="client-section__heading"><span>02</span><div><small>CONTATO</small><h2>Como falar com o cliente?</h2><p>Telefone e e-mail são opcionais, mas ajudam no acompanhamento do pedido.</p></div></div>
          <div class="form-grid client-section__fields">
            <div class="field col-6"><label>Telefone / WhatsApp</label><input v-model="form.phone" type="tel" autocomplete="tel" placeholder="(11) 99999-9999"></div>
            <div class="field col-6" data-field="email" :class="{'field--error':errors.email}"><label>E-mail</label><input v-model="form.email" type="email" autocomplete="email" placeholder="cliente@empresa.com"><small v-if="errors.email" class="field__error">{{ errors.email }}</small></div>
          </div>
        </section>

        <section class="client-section">
          <div class="client-section__heading"><span>03</span><div><small>LOCALIZAÇÃO</small><h2>Endereço</h2><p>Preencha quando precisar organizar entregas ou documentos.</p></div></div>
          <div class="form-grid client-section__fields">
            <div class="field col-3"><label>CEP</label><input v-model="form.zip" inputmode="numeric" autocomplete="postal-code" placeholder="00000-000"></div>
            <div class="field col-6"><label>Endereço</label><input v-model="form.address" autocomplete="street-address" placeholder="Rua, avenida ou condomínio"></div>
            <div class="field col-3"><label>Número</label><input v-model="form.number" placeholder="123"></div>
            <div class="field col-4"><label>Complemento</label><input v-model="form.complement" placeholder="Sala, bloco ou referência"></div>
            <div class="field col-3"><label>Bairro</label><input v-model="form.district"></div>
            <div class="field col-3"><label>Cidade</label><input v-model="form.city" autocomplete="address-level2"></div>
            <div class="field col-2" data-field="state" :class="{'field--error':errors.state}"><label>UF</label><select v-model="form.state" autocomplete="address-level1"><option value="">Selecione</option><option v-for="state in stateOptions" :key="state">{{ state }}</option></select><small v-if="errors.state" class="field__error">{{ errors.state }}</small></div>
          </div>
        </section>

        <section class="client-section">
          <div class="client-section__heading"><span>04</span><div><small>PERFIL COMERCIAL</small><h2>Contexto do relacionamento</h2><p>A origem e as tags ajudam a encontrar e segmentar sua base.</p></div></div>
          <div class="form-grid client-section__fields">
            <div class="field col-4"><label>Origem do cliente</label><select v-model="form.origin"><option>Shopee</option><option>Mercado Livre</option><option>Amazon</option><option>Instagram</option><option>Site Próprio</option><option>Indicação</option><option>WhatsApp</option><option>Outro</option></select></div>
            <div class="field col-8"><label>Tags</label><input v-model="form.tags" placeholder="Recorrente, Personalizados, Atacado"><small class="field__hint">Separe as tags por vírgulas.</small></div>
            <div class="field col-12"><label>Observações</label><textarea v-model="form.notes" rows="4" placeholder="Preferências, contexto do atendimento ou informações úteis." /></div>
          </div>
        </section>

        <div class="form-actions client-editor__actions"><button class="btn" type="button" @click="cancel">Cancelar</button><button v-if="!isEditing" class="btn" type="button" :disabled="saving" @click="save(true)">Salvar e adicionar outro</button><button class="btn btn--primary" type="submit" :disabled="saving"><UiIcon name="check" :size="16" />{{ saving ? 'Salvando...' : isEditing ? 'Salvar alterações' : 'Salvar cliente' }}</button></div>
      </form>

      <aside class="client-preview">
        <section class="client-preview__card">
          <header><span class="avatar client-preview__avatar">{{ initials }}</span><div><small>PRÉVIA DO CADASTRO</small><h3>{{ form.name || 'Novo cliente' }}</h3><p>{{ form.type }}</p></div></header>
          <div class="client-preview__contact"><div><UiIcon name="chat" :size="15" /><span>{{ form.phone || 'Telefone não informado' }}</span></div><div><UiIcon name="send" :size="15" /><span>{{ form.email || 'E-mail não informado' }}</span></div><div><UiIcon name="home" :size="15" /><span>{{ addressPreview }}</span></div></div>
          <div v-if="tags.length" class="client-preview__tags"><span v-for="tag in tags" :key="tag">{{ tag }}</span></div>
          <div class="client-preview__metrics"><article><span>Pedidos</span><strong>{{ formatNumber(editingClient?.orders || 0) }}</strong></article><article><span>Faturamento</span><strong>{{ formatCurrency(editingClient?.revenue || 0) }}</strong></article><article><span>Ticket médio</span><strong>{{ formatCurrency(editingClient?.ticket || 0) }}</strong></article><article><span>Última compra</span><strong>{{ editingClient?.last || '-' }}</strong></article></div>
          <p class="client-preview__note"><UiIcon name="info" :size="15" />Os indicadores vêm das vendas diretas vinculadas e não são alterados por este formulário.</p>
        </section>

        <section class="client-progress">
          <div class="client-progress__heading"><div><small>QUALIDADE DO CADASTRO</small><strong>{{ completion }}% preenchido</strong></div><span>{{ completionItems.filter(item => item.ready).length }}/{{ completionItems.length }}</span></div>
          <div class="client-progress__bar"><i :style="{ width: `${completion}%` }" /></div>
          <div class="client-progress__list"><div v-for="item in completionItems" :key="item.label" :class="{ ready: item.ready }"><span><UiIcon :name="item.ready ? 'check' : 'info'" :size="12" /></span>{{ item.label }}</div></div>
        </section>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.client-editor{width:min(100%,1280px);margin:0 auto}.client-editor__breadcrumb{margin-bottom:10px}.client-editor__hero{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:14px;overflow:hidden;margin-bottom:16px;border:1px solid #d7e4f7;border-radius:14px;background:linear-gradient(135deg,#fbfdff,#edf5ff);padding:18px 20px}.client-editor__hero:after{position:absolute;right:-40px;top:-80px;width:170px;height:170px;border-radius:50%;background:rgba(23,104,242,.06);content:''}.client-editor__hero-icon{display:grid;width:46px;height:46px;place-items:center;border-radius:13px;color:#fff;background:linear-gradient(145deg,#1768f2,#0d4eb8);box-shadow:0 8px 20px rgba(23,104,242,.22)}.client-editor__hero>div>span,.client-preview__card header small,.client-progress__heading small{display:block;color:var(--blue);font-size:8px;font-weight:800;letter-spacing:.09em}.client-editor__hero h1{margin:3px 0;color:#152037;font-size:21px}.client-editor__hero p{margin:0;color:var(--muted);font-size:10px}.client-editor__status{position:relative;z-index:1;display:flex;align-items:center;gap:6px;border:1px solid #d9e5f5;border-radius:999px;color:#45617f;background:rgba(255,255,255,.82);padding:6px 10px;font-size:8px;font-weight:800}.client-editor__status i{width:7px;height:7px;border-radius:50%;background:#16a36a;box-shadow:0 0 0 3px rgba(22,163,106,.12)}.client-editor__status i.inactive{background:#8996a8;box-shadow:0 0 0 3px rgba(137,150,168,.12)}.client-editor__layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;align-items:start;gap:16px}.client-editor__form{display:grid;gap:12px}.client-section{border:1px solid var(--line);border-radius:12px;background:#fff;padding:20px}.client-section__heading{display:flex;align-items:flex-start;gap:12px;padding-bottom:15px;border-bottom:1px solid #edf1f6}.client-section__heading>span{display:grid;width:34px;height:34px;flex:0 0 auto;place-items:center;border-radius:9px;color:var(--blue);background:var(--blue-soft);font-size:10px;font-weight:800}.client-section__heading small{display:block;color:var(--blue);font-size:8px;font-weight:800;letter-spacing:.08em}.client-section__heading h2{margin:3px 0;color:#192338;font-size:14px}.client-section__heading p{margin:0;color:var(--muted);font-size:9px}.client-section__fields{margin-top:16px}.client-type-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}.client-type-grid button{display:grid;grid-template-columns:36px 1fr 14px;align-items:center;gap:10px;border:1px solid var(--line);border-radius:10px;color:#2b3850;background:#fff;padding:10px;text-align:left;cursor:pointer}.client-type-grid button:hover{border-color:#bdd0ee}.client-type-grid button.active{border-color:var(--blue);background:#f5f9ff;box-shadow:inset 0 0 0 1px rgba(23,104,242,.1)}.client-type-grid button>span{display:grid;width:36px;height:36px;place-items:center;border-radius:9px;color:#64748b;background:#eef2f7}.client-type-grid button.active>span{color:var(--blue);background:#e5efff}.client-type-grid strong,.client-type-grid small{display:block}.client-type-grid strong{font-size:10px}.client-type-grid small{color:var(--muted);margin-top:3px;font-size:8px}.client-type-grid button>i{width:13px;height:13px;border:1px solid #bdc8d7;border-radius:50%}.client-type-grid button.active>i{border:4px solid var(--blue)}.field label b{color:var(--red)}.field__hint{color:var(--muted);font-size:8px}.client-editor__actions{position:sticky;bottom:12px;z-index:4;margin-top:0;box-shadow:0 10px 30px rgba(30,48,80,.1)}.client-preview{position:sticky;top:84px;display:grid;gap:12px}.client-preview__card,.client-progress{overflow:hidden;border:1px solid var(--line);border-radius:12px;background:#fff}.client-preview__card header{display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line);background:linear-gradient(145deg,#fff,#f5f9ff);padding:17px}.client-preview__avatar{width:54px;height:54px;font-size:16px}.client-preview__card h3{overflow:hidden;max-width:190px;margin:3px 0;color:#192338;font-size:14px;text-overflow:ellipsis;white-space:nowrap}.client-preview__card header p{margin:0;color:var(--muted);font-size:9px}.client-preview__contact{display:grid;gap:9px;padding:14px 16px}.client-preview__contact>div{display:grid;grid-template-columns:18px 1fr;align-items:start;gap:7px;color:#657287;font-size:9px;line-height:1.45}.client-preview__contact svg{color:#73839a}.client-preview__contact span{overflow-wrap:anywhere}.client-preview__tags{display:flex;flex-wrap:wrap;gap:5px;padding:0 16px 14px}.client-preview__tags span{border-radius:999px;color:#36577d;background:#e9f2ff;padding:4px 7px;font-size:8px;font-weight:700}.client-preview__metrics{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--line);background:#fbfcfe}.client-preview__metrics article{display:grid;gap:3px;padding:11px 14px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.client-preview__metrics article:nth-child(even){border-right:0}.client-preview__metrics article:nth-last-child(-n+2){border-bottom:0}.client-preview__metrics span{color:var(--muted);font-size:8px}.client-preview__metrics strong{font-size:10px}.client-preview__note{display:flex;gap:7px;margin:0;border-top:1px solid var(--line);color:var(--muted);background:#f8fbff;padding:12px 14px;font-size:8px;line-height:1.5}.client-preview__note svg{flex:0 0 auto;color:var(--blue)}.client-progress{padding:15px}.client-progress__heading{display:flex;align-items:center;justify-content:space-between}.client-progress__heading strong{display:block;margin-top:3px;font-size:11px}.client-progress__heading>span{color:var(--blue);font-size:10px;font-weight:800}.client-progress__bar{height:5px;margin:11px 0;border-radius:99px;background:#e8edf5}.client-progress__bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#1768f2,#2f91ff);transition:width .2s}.client-progress__list{display:grid;grid-template-columns:1fr 1fr;gap:7px}.client-progress__list>div{display:flex;align-items:center;gap:5px;color:#7b8798;font-size:8px}.client-progress__list>div>span{display:grid;width:16px;height:16px;place-items:center;border-radius:50%;background:#eef1f5}.client-progress__list>div.ready{color:#247252}.client-progress__list>div.ready>span{color:#087b54;background:#e4f7ee}
@media(max-width:980px){.client-editor__layout{grid-template-columns:1fr}.client-preview{position:static;grid-template-columns:1fr 1fr}}
@media(max-width:700px){.client-editor__hero{grid-template-columns:auto 1fr}.client-editor__status{grid-column:1/-1;width:max-content}.client-section{padding:16px}.client-type-grid,.client-preview{grid-template-columns:1fr}.form-grid>.field{grid-column:1/-1}.client-editor__actions{position:static}.client-editor__actions .btn{flex:1}}
</style>
