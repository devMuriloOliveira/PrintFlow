<script setup lang="ts">
type Overview = { tenants:number; activeTenants:number; suspendedTenants:number; paymentAttention:number; agents:number; onlineAgents:number; printers:number; connectedPrinters:number }
type Tenant = { id:string; name:string; cnpj:string; accountStatus:string; billingStatus:string; billingDueAt?:string; users:number; activeUsers:number; agents:number; onlineAgents:number; printers:number }
type Audit = { id:string; tenantId?:string; action:string; actorType:string; actorId?:string; actorName?:string; entityType:string; entityId:string; createdAt:string }
type PlatformAudit = { id:string; action:string; targetTenantId?:string; targetResource:string; targetResourceId:string; reason:string; createdAt:string }
const session = useAdminSession()
const overview = ref<Overview | null>(null)
const tenants = ref<Tenant[]>([])
const selected = ref<Tenant | null>(null)
const audit = ref<Audit[]>([])
const platformAudit = ref<PlatformAudit[]>([])
const userAudit = ref<Audit[]>([])
const showingPlatformAudit = ref(false)
const search = ref('')
const loading = ref(false)
const accessRequest = ref<{ tenant: Tenant; id: string; reason: string; cnpj: string; status: 'reason' | 'verify' } | null>(null)

const filtered = computed(() => tenants.value.filter((tenant) => `${tenant.name} ${tenant.cnpj} ${tenant.id}`.toLowerCase().includes(search.value.toLowerCase())))
const load = async () => {
  session.restore()
  if (!session.token.value) return navigateTo('/login')
  loading.value = true
  try {
    ;[overview.value, tenants.value] = await Promise.all([session.request<Overview>('/api/platform-admin/overview'), session.request<Tenant[]>('/api/platform-admin/tenants')])
  } catch { session.clear(); await navigateTo('/login') }
  finally { loading.value = false }
}
const openAudit = (tenant: Tenant) => { accessRequest.value = { tenant, id: '', reason: '', cnpj: '', status: 'reason' } }
const requestAuditAccess = async () => {
  if (!accessRequest.value || accessRequest.value.reason.trim().length < 12) return
  const response = await session.request<{ id: string }>(`/api/platform-admin/tenants/${encodeURIComponent(accessRequest.value.tenant.id)}/data-access-requests`, { method: 'POST', body: { reason: accessRequest.value.reason } })
  accessRequest.value.id = response.id; accessRequest.value.status = 'verify'
}
const verifyAuditAccess = async () => {
  if (!accessRequest.value) return
  await session.request(`/api/platform-admin/data-access-requests/${encodeURIComponent(accessRequest.value.id)}/verify`, { method: 'POST', body: { cnpj: accessRequest.value.cnpj } })
  selected.value = accessRequest.value.tenant
  audit.value = await session.request<Audit[]>(`/api/platform-admin/tenants/${encodeURIComponent(selected.value.id)}/audit?accessRequestId=${encodeURIComponent(accessRequest.value.id)}&limit=100`)
  accessRequest.value = null
}
const openPlatformAudit = async () => {
  selected.value = null
  platformAudit.value = await session.request<PlatformAudit[]>('/api/platform-admin/audit?limit=100')
  showingPlatformAudit.value = true
}
const openUserAudit = async () => {
  selected.value = null
  userAudit.value = await session.request<Audit[]>('/api/platform-admin/user-audit?limit=200')
}
const updateStatus = async (tenant: Tenant) => {
  const reason = window.prompt('Motivo da alteracao (sera registrado na auditoria):') || ''
  if (reason.trim().length < 8) return
  const response = await session.request<Tenant>(`/api/platform-admin/tenants/${encodeURIComponent(tenant.id)}/status`, { method: 'POST', body: { accountStatus: tenant.accountStatus, billingStatus: tenant.billingStatus, reason } })
  tenants.value = tenants.value.map((item) => item.id === response.id ? { ...item, ...response } : item)
}
onMounted(() => void load())
</script>
<template>
  <main class="admin-shell">
    <header><div><span class="eyebrow">PRINTFLOW INTERNAL</span><h1>Administracao da plataforma</h1></div><div class="header-actions"><span>{{ session.user.value?.name }}</span><button @click="session.clear(); navigateTo('/login')">Sair</button></div></header>
    <section v-if="overview" class="metrics">
      <article><small>Empresas</small><strong>{{ overview.tenants }}</strong><span>{{ overview.activeTenants }} ativas</span></article>
      <article><small>Atencao financeira</small><strong>{{ overview.paymentAttention }}</strong><span>pendentes ou atrasadas</span></article>
      <article><small>Agents</small><strong>{{ overview.onlineAgents }}/{{ overview.agents }}</strong><span>online agora</span></article>
      <article><small>Impressoras</small><strong>{{ overview.connectedPrinters }}/{{ overview.printers }}</strong><span>conectadas</span></article>
    </section>
    <section class="surface"><div class="section-head"><div><h2>Empresas clientes</h2><p>Dados de plataforma. Cada acesso e alteracao e auditado.</p></div><div class="section-actions"><button @click="openUserAudit">Relatorio de usuarios</button><button @click="openPlatformAudit">Auditoria administrativa</button><input v-model="search" placeholder="Buscar empresa, e-mail ou ID"></div></div>
      <div class="table-wrap"><table><thead><tr><th>Empresa</th><th>Usuarios</th><th>Agents</th><th>Impressoras</th><th>Conta</th><th>Cobranca</th><th></th></tr></thead><tbody>
        <tr v-for="tenant in filtered" :key="tenant.id"><td><strong>{{ tenant.name || 'Empresa sem nome' }}</strong><small>{{ tenant.cnpj }}</small></td><td>{{ tenant.activeUsers }}/{{ tenant.users }}</td><td>{{ tenant.onlineAgents }}/{{ tenant.agents }}</td><td>{{ tenant.printers }}</td><td><select v-model="tenant.accountStatus" @change="updateStatus(tenant)"><option value="active">Ativa</option><option value="suspended">Suspensa</option><option value="blocked">Bloqueada</option></select></td><td><select v-model="tenant.billingStatus" @change="updateStatus(tenant)"><option value="not_configured">Nao configurada</option><option value="active">Em dia</option><option value="pending">Pendente</option><option value="overdue">Atrasada</option><option value="cancelled">Cancelada</option></select></td><td><button @click="openAudit(tenant)">Solicitar relatorio</button></td></tr>
      </tbody></table></div>
    </section>
    <section v-if="accessRequest" class="surface audit"><div class="section-head"><div><h2>Solicitacao segura de relatorio</h2><p>{{ accessRequest.tenant.name }} - {{ accessRequest.tenant.cnpj }}</p></div><button @click="accessRequest = null">Cancelar</button></div><div v-if="accessRequest.status === 'reason'" class="section-actions"><input v-model="accessRequest.reason" placeholder="Motivo detalhado da solicitacao"><button :disabled="accessRequest.reason.trim().length < 12" @click="requestAuditAccess">Continuar</button></div><div v-else class="section-actions"><input v-model="accessRequest.cnpj" inputmode="numeric" placeholder="CNPJ confirmado pelo cliente"><button @click="verifyAuditAccess">Confirmar e abrir relatorio</button></div></section>
    <section v-if="selected" class="surface audit"><div class="section-head"><div><h2>Auditoria: {{ selected.name }}</h2><p>{{ selected.id }}</p></div><button @click="selected = null">Fechar</button></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Acao</th><th>Origem</th><th>Recurso</th></tr></thead><tbody><tr v-for="event in audit" :key="event.id"><td>{{ new Date(event.createdAt).toLocaleString('pt-BR') }}</td><td>{{ event.action }}</td><td>{{ event.actorType }}</td><td>{{ event.entityType }} {{ event.entityId }}</td></tr><tr v-if="!audit.length"><td colspan="4">Nenhum evento operacional encontrado.</td></tr></tbody></table></div></section>
    <section v-if="showingPlatformAudit" class="surface audit"><div class="section-head"><div><h2>Auditoria administrativa</h2><p>Acoes executadas no portal interno.</p></div><button @click="showingPlatformAudit = false">Fechar</button></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Acao</th><th>Empresa</th><th>Recurso</th><th>Motivo</th></tr></thead><tbody><tr v-for="event in platformAudit" :key="event.id"><td>{{ new Date(event.createdAt).toLocaleString('pt-BR') }}</td><td>{{ event.action }}</td><td>{{ event.targetTenantId || '-' }}</td><td>{{ event.targetResource }} {{ event.targetResourceId }}</td><td>{{ event.reason || '-' }}</td></tr><tr v-if="!platformAudit.length"><td colspan="5">Nenhuma acao administrativa encontrada.</td></tr></tbody></table></div></section>
    <section v-if="userAudit.length" class="surface audit"><div class="section-head"><div><h2>Relatorio de eventos de usuarios</h2><p>Alteracoes de acesso, sessoes, convites e outras acoes auditaveis.</p></div><button @click="userAudit = []">Fechar</button></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Tenant</th><th>Acao</th><th>Ator</th><th>Recurso</th></tr></thead><tbody><tr v-for="event in userAudit" :key="event.id"><td>{{ new Date(event.createdAt).toLocaleString('pt-BR') }}</td><td>{{ event.tenantId }}</td><td>{{ event.action }}</td><td>{{ event.actorName || event.actorId }}</td><td>{{ event.entityType }} {{ event.entityId }}</td></tr></tbody></table></div></section>
  </main>
</template>
