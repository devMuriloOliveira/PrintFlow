<script setup lang="ts">
type Overview = { tenants:number; activeTenants:number; suspendedTenants:number; paymentAttention:number; agents:number; onlineAgents:number; printers:number; connectedPrinters:number }
type Tenant = { id:string; name:string; email:string; accountStatus:string; billingStatus:string; billingDueAt?:string; users:number; activeUsers:number; agents:number; onlineAgents:number; printers:number }
type Audit = { id:string; action:string; actorType:string; entityType:string; entityId:string; createdAt:string }
const session = useAdminSession()
const overview = ref<Overview | null>(null)
const tenants = ref<Tenant[]>([])
const selected = ref<Tenant | null>(null)
const audit = ref<Audit[]>([])
const search = ref('')
const loading = ref(false)

const filtered = computed(() => tenants.value.filter((tenant) => `${tenant.name} ${tenant.email} ${tenant.id}`.toLowerCase().includes(search.value.toLowerCase())))
const load = async () => {
  session.restore()
  if (!session.token.value) return navigateTo('/login')
  loading.value = true
  try {
    ;[overview.value, tenants.value] = await Promise.all([session.request<Overview>('/api/platform-admin/overview'), session.request<Tenant[]>('/api/platform-admin/tenants')])
  } catch { session.clear(); await navigateTo('/login') }
  finally { loading.value = false }
}
const openAudit = async (tenant: Tenant) => { selected.value = tenant; audit.value = await session.request<Audit[]>(`/api/platform-admin/tenants/${encodeURIComponent(tenant.id)}/audit?limit=100`) }
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
    <section class="surface"><div class="section-head"><div><h2>Empresas clientes</h2><p>Dados de plataforma. Cada acesso e alteracao e auditado.</p></div><input v-model="search" placeholder="Buscar empresa, e-mail ou ID"></div>
      <div class="table-wrap"><table><thead><tr><th>Empresa</th><th>Usuarios</th><th>Agents</th><th>Impressoras</th><th>Conta</th><th>Cobranca</th><th></th></tr></thead><tbody>
        <tr v-for="tenant in filtered" :key="tenant.id"><td><strong>{{ tenant.name || 'Empresa sem nome' }}</strong><small>{{ tenant.email }}</small></td><td>{{ tenant.activeUsers }}/{{ tenant.users }}</td><td>{{ tenant.onlineAgents }}/{{ tenant.agents }}</td><td>{{ tenant.printers }}</td><td><select v-model="tenant.accountStatus" @change="updateStatus(tenant)"><option value="active">Ativa</option><option value="suspended">Suspensa</option><option value="blocked">Bloqueada</option></select></td><td><select v-model="tenant.billingStatus" @change="updateStatus(tenant)"><option value="not_configured">Nao configurada</option><option value="active">Em dia</option><option value="pending">Pendente</option><option value="overdue">Atrasada</option><option value="cancelled">Cancelada</option></select></td><td><button @click="openAudit(tenant)">Auditoria</button></td></tr>
      </tbody></table></div>
    </section>
    <section v-if="selected" class="surface audit"><div class="section-head"><div><h2>Auditoria: {{ selected.name }}</h2><p>{{ selected.id }}</p></div><button @click="selected = null">Fechar</button></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Acao</th><th>Origem</th><th>Recurso</th></tr></thead><tbody><tr v-for="event in audit" :key="event.id"><td>{{ new Date(event.createdAt).toLocaleString('pt-BR') }}</td><td>{{ event.action }}</td><td>{{ event.actorType }}</td><td>{{ event.entityType }} {{ event.entityId }}</td></tr><tr v-if="!audit.length"><td colspan="4">Nenhum evento operacional encontrado.</td></tr></tbody></table></div></section>
  </main>
</template>
