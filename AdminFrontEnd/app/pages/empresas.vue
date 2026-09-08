<script setup lang="ts">
import type { Tenant, TenantAudit } from '~/types/platform-admin'

type AccessRequest = { tenant: Tenant; id: string; reason: string; cnpj: string; status: 'reason' | 'verify' }

const {
  session, tenants, requests, authorizedTenantAudit, error, activeRequests,
  statusClass, load, refreshTenants
} = usePlatformAdminWorkspace()
const search = ref('')
const accessRequest = ref<AccessRequest | null>(null)
const actionError = ref('')
const actionLoading = ref(false)
const statusChange = ref<{ tenant: Tenant; accountStatus: string; billingStatus: string; reason: string } | null>(null)

const filteredTenants = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return tenants.value
  return tenants.value.filter(tenant => `${tenant.name} ${tenant.cnpj} ${tenant.id}`.toLowerCase().includes(term))
})

const openTenantAccess = (tenant: Tenant) => {
  actionError.value = ''
  accessRequest.value = { tenant, id: '', reason: '', cnpj: '', status: 'reason' }
}

const requestTenantAccess = async () => {
  if (!accessRequest.value) return
  actionLoading.value = true
  actionError.value = ''
  try {
    const response = await session.request<{ id: string }>(`/api/platform-admin/tenants/${encodeURIComponent(accessRequest.value.tenant.id)}/data-access-requests`, { method: 'POST', body: { reason: accessRequest.value.reason } })
    accessRequest.value.id = response.id
    accessRequest.value.status = 'verify'
  } catch (cause: any) {
    actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel solicitar o acesso protegido.'
  } finally {
    actionLoading.value = false
  }
}

const verifyTenantAccess = async () => {
  if (!accessRequest.value) return
  actionLoading.value = true
  actionError.value = ''
  try {
    await session.request(`/api/platform-admin/data-access-requests/${encodeURIComponent(accessRequest.value.id)}/verify`, { method: 'POST', body: { cnpj: accessRequest.value.cnpj } })
    const events = await session.request<TenantAudit[]>(`/api/platform-admin/tenants/${encodeURIComponent(accessRequest.value.tenant.id)}/audit?accessRequestId=${encodeURIComponent(accessRequest.value.id)}&limit=100`)
    authorizedTenantAudit.value = { tenant: accessRequest.value.tenant, accessRequestId: accessRequest.value.id, events }
    accessRequest.value = null
    await navigateTo('/auditoria')
  } catch (cause: any) {
    actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel validar o acesso protegido.'
  } finally {
    actionLoading.value = false
  }
}

const requestTenantStatusChange = (tenant: Tenant, field: 'accountStatus' | 'billingStatus', value: string) => {
  statusChange.value = { tenant, accountStatus: field === 'accountStatus' ? value : tenant.accountStatus, billingStatus: field === 'billingStatus' ? value : tenant.billingStatus, reason: '' }
}

const updateTenantStatus = async () => {
  const change = statusChange.value
  if (!change || change.reason.trim().length < 8) return
  actionError.value = ''
  actionLoading.value = true
  try {
    const updated = await session.request<Tenant>(`/api/platform-admin/tenants/${encodeURIComponent(change.tenant.id)}/status`, { method: 'POST', body: { accountStatus: change.accountStatus, billingStatus: change.billingStatus, reason: change.reason } })
    tenants.value = tenants.value.map(item => item.id === updated.id ? { ...item, ...updated } : item)
    statusChange.value = null
  } catch (cause: any) {
    actionError.value = cause?.data?.error || cause?.message || 'Nao foi possivel alterar o estado da empresa.'
    await refreshTenants()
  } finally { actionLoading.value = false }
}

onMounted(() => void load({ tenants: true, requests: true }))
</script>

<template>
  <AdminShell v-model:search="search" title="Empresas" subtitle="Gerencie os tenants da plataforma" :request-count="activeRequests.length">
    <p v-if="error || actionError" class="feedback feedback--error">{{ actionError || error }}</p>
    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Empresa</th><th>CNPJ</th><th>Usuarios</th><th>Agents</th><th>Impressoras</th><th>Conta</th><th>Cobranca</th><th></th></tr></thead><tbody><tr v-for="tenant in filteredTenants" :key="tenant.id"><td><strong>{{ tenant.name || 'Empresa sem nome' }}</strong><small>{{ tenant.id }}</small></td><td>{{ tenant.cnpj }}</td><td>{{ tenant.activeUsers }}/{{ tenant.users }}</td><td>{{ tenant.onlineAgents }}/{{ tenant.agents }}</td><td>{{ tenant.printers }}</td><td><select :value="tenant.accountStatus" :class="statusClass(tenant.accountStatus)" @change="requestTenantStatusChange(tenant, 'accountStatus', ($event.target as HTMLSelectElement).value)"><option value="active">Ativa</option><option value="suspended">Suspensa</option><option value="blocked">Bloqueada</option></select></td><td><select :value="tenant.billingStatus" :class="statusClass(tenant.billingStatus)" @change="requestTenantStatusChange(tenant, 'billingStatus', ($event.target as HTMLSelectElement).value)"><option value="not_configured">Nao configurada</option><option value="active">Em dia</option><option value="pending">Pendente</option><option value="overdue">Atrasada</option><option value="cancelled">Cancelada</option></select></td><td><button class="table-action" @click="openTenantAccess(tenant)">Acesso seguro</button></td></tr><tr v-if="!filteredTenants.length"><td colspan="8" class="empty-state">Nenhuma empresa encontrada.</td></tr></tbody></table></div></section>
    <section v-if="accessRequest" class="access-modal"><div class="modal-card"><button class="modal-close" @click="accessRequest = null">Fechar</button><span class="section-kicker">Acesso protegido</span><h2>{{ accessRequest.tenant.name }}</h2><p>O acesso exige motivo, confirmacao do CNPJ e expira em 30 minutos.</p><p v-if="actionError" class="feedback feedback--error">{{ actionError }}</p><form v-if="accessRequest.status === 'reason'" @submit.prevent="requestTenantAccess"><label>Motivo detalhado<textarea v-model="accessRequest.reason" minlength="12" maxlength="500" required></textarea></label><button class="button button--primary" :disabled="actionLoading">Continuar</button></form><form v-else @submit.prevent="verifyTenantAccess"><label>Confirme o CNPJ informado pelo cliente<input v-model="accessRequest.cnpj" inputmode="numeric" autocomplete="off" required></label><button class="button button--primary" :disabled="actionLoading">Confirmar e abrir</button></form></div></section>
    <section v-if="statusChange" class="access-modal"><div class="modal-card"><button class="modal-close" :disabled="actionLoading" @click="statusChange = null">Cancelar</button><span class="section-kicker">Alteracao auditada</span><h2>{{ statusChange.tenant.name }}</h2><p>Conta: <strong>{{ statusChange.accountStatus }}</strong> · Cobranca: <strong>{{ statusChange.billingStatus }}</strong></p><form @submit.prevent="updateTenantStatus"><label>Motivo da alteracao<textarea v-model="statusChange.reason" minlength="8" maxlength="500" required autofocus></textarea></label><button class="button button--primary" :disabled="actionLoading || statusChange.reason.trim().length < 8">{{ actionLoading ? 'Salvando...' : 'Confirmar alteracao' }}</button></form></div></section>
  </AdminShell>
</template>
