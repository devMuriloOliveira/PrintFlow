<script setup lang="ts">
import { computed, nextTick, reactive } from 'vue'
import { navigateTo } from '#app'

const { clients } = useAppData()
const { notify } = useUi()
const form = reactive({ name: '', type: 'Pessoa Fisica', document: '', phone: '', email: '', zip: '', address: '', number: '', complement: '', district: '', city: '', state: '', origin: 'Instagram', notes: '', tags: '' })
const errors = reactive<Record<string, string>>({})
const initials = computed(() => form.name.split(' ').filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase() || 'NC')
const validate = () => {
  Object.keys(errors).forEach(key => delete errors[key])
  if (!form.name.trim()) errors.name = 'Informe o nome do cliente.'
  if (form.email && !form.email.includes('@')) errors.email = 'Informe um e-mail valido.'
  const first = Object.keys(errors)[0]
  if (first) nextTick(() => document.querySelector(`[data-field="${first}"] input`)?.focus())
  return !first
}
const save = (again = false) => {
  if (!validate()) return
  clients.value.unshift({ name: form.name, email: form.email || 'sem-email@printflow.local', phone: form.phone || '-', orders: 0, revenue: 0, ticket: 0, last: '-' })
  notify('Cliente cadastrado com sucesso.')
  if (again) { form.name = ''; form.document = ''; form.phone = ''; form.email = ''; return }
  navigateTo('/clientes')
}
const cancel = () => {
  if ((!form.name && !form.phone && !form.email) || window.confirm('Descartar alteracoes?\n\nAs informacoes preenchidas ainda nao foram salvas.')) navigateTo('/clientes')
}
</script>

<template>
  <div>
    <div class="breadcrumb"><span>Clientes</span><UiIcon name="chevron" :size="12" /><strong>Novo Cliente</strong></div>
    <PageHeader title="Novo Cliente" subtitle="Cadastre um novo cliente para acompanhar pedidos, compras e relacionamento." />
    <div class="split-layout" style="grid-template-columns:minmax(0,1fr) 330px">
      <form @submit.prevent="save(false)">
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="users" />1. Dados do Cliente</h2><div class="form-grid"><div class="field col-5" data-field="name" :class="{'field--error':errors.name}"><label>Nome completo / Razao Social *</label><input v-model="form.name"><small v-if="errors.name" class="field__error">{{errors.name}}</small></div><div class="field col-3"><label>Tipo de cliente</label><select v-model="form.type"><option>Pessoa Fisica</option><option>Pessoa Juridica</option></select></div><div class="field col-4"><label>CPF / CNPJ</label><input v-model="form.document"></div><div class="field col-4"><label>Telefone</label><input v-model="form.phone"></div><div class="field col-4" data-field="email" :class="{'field--error':errors.email}"><label>E-mail</label><input v-model="form.email" type="email"><small v-if="errors.email" class="field__error">{{errors.email}}</small></div></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="home" />2. Endereco</h2><div class="form-grid"><div class="field col-3"><label>CEP</label><input v-model="form.zip"></div><div class="field col-6"><label>Endereco</label><input v-model="form.address"></div><div class="field col-3"><label>Numero</label><input v-model="form.number"></div><div class="field col-4"><label>Complemento</label><input v-model="form.complement"></div><div class="field col-3"><label>Bairro</label><input v-model="form.district"></div><div class="field col-3"><label>Cidade</label><input v-model="form.city"></div><div class="field col-2"><label>Estado</label><input v-model="form.state" maxlength="2"></div></div></div>
        <div class="form-card"><h2 class="form-card__title"><UiIcon name="store" />3. Informacoes Comerciais</h2><div class="form-grid"><div class="field col-4"><label>Origem do cliente</label><select v-model="form.origin"><option>Shopee</option><option>Mercado Livre</option><option>Amazon</option><option>Instagram</option><option>Site Proprio</option><option>Indicacao</option><option>WhatsApp</option><option>Outro</option></select></div><div class="field col-8"><label>Tags</label><input v-model="form.tags" placeholder="Cliente recorrente, Personalizados, Atacado"></div><div class="field col-12"><label>Observacoes</label><textarea v-model="form.notes" /></div></div></div>
        <div class="form-actions"><button class="btn" type="button" @click="cancel">Cancelar</button><button class="btn" type="button" @click="save(true)">Salvar e adicionar outro</button><button class="btn btn--primary" type="submit">Salvar Cliente</button></div>
      </form>
      <aside class="detail-card"><div class="detail-card__head"><span class="avatar" style="width:72px;height:72px;font-size:22px">{{initials}}</span><div><h3>{{form.name || 'Novo cliente'}}</h3><p>{{form.phone || 'Telefone nao informado'}}</p><p>{{form.email || 'E-mail nao informado'}}</p><p>Origem: {{form.origin}}</p></div></div><div class="detail-card__body"><div class="summary-box"><div class="detail-list__row"><span>Pedidos</span><strong>0</strong></div><div class="detail-list__row"><span>Faturamento</span><strong>R$ 0,00</strong></div><div class="detail-list__row"><span>Ticket medio</span><strong>R$ 0,00</strong></div><div class="detail-list__row"><span>Ultima compra</span><strong>-</strong></div></div><div class="info-note" style="margin-top:12px"><UiIcon name="info" :size="18" />Os indicadores serao atualizados automaticamente conforme novas vendas forem registradas.</div></div></aside>
    </div>
  </div>
</template>
