<script setup lang="ts">
type Overview = { tenants: number; activeTenants: number; suspendedTenants: number; paymentAttention: number; agents: number; onlineAgents: number; printers: number; connectedPrinters: number }
type Tenant = { id: string; name: string; cnpj: string; accountStatus: string; billingStatus: string; users: number; activeUsers: number; agents: number; onlineAgents: number; printers: number }
type Audit = { id: string; action: string; summary: string; context?: string; actorType: string; entityType: string; entityId: string; createdAt: string }
type PlatformAudit = { id: string; action: string; summary: string; context?: string; targetTenantId?: string; targetResource: string; targetResourceId: string; reason: string; createdAt: string }
type DeletionAudit = { id: string; requestId: string; eventType: string; summary: string; context?: string; evidence: Record<string, unknown>; createdAt: string }
type AccessRequest = { tenant: Tenant; id: string; reason: string; cnpj: string; status: 'reason' | 'verify' }

const session = useAdminSession()
const overview = ref<Overview | null>(null)
const tenants = ref<Tenant[]>([])
const selected = ref<Tenant | null>(null)
const audit = ref<Audit[]>([])
const authorizedAccessRequestId = ref('')
const auditExportFormat = ref<'csv' | 'xlsx'>('xlsx')
const platformAudit = ref<PlatformAudit[]>([])
const showingPlatformAudit = ref(false)
const deletionAudit = ref<DeletionAudit[]>([])
const showingDeletionAudit = ref(false)
const accessRequest = ref<AccessRequest | null>(null)
const ownerAuditRequests = ref<Array<{ id: string; tenantId: string; status: string; reason: string; scope: { entityType?: string; entityId?: string }; createdAt: string }>>([])
const activeOwnerAuditRequest = ref<any>(null)
const ownerAuditMessages = ref<any[]>([])
const ownerAuditDraft = ref('')
const search = ref('')
const loading = ref(false)
const error = ref('')

const filtered = computed(() => tenants.value.filter((tenant) => `${tenant.name} ${tenant.cnpj}`.toLowerCase().includes(search.value.toLowerCase())))
const filteredAuditRequests = computed(() => ownerAuditRequests.value.filter((request) => `${request.id} ${request.tenantId} ${request.status}`.toLowerCase().includes(search.value.toLowerCase())))
const formatDate = (value: string) => new Date(value).toLocaleString('pt-BR')

const load = async () => {
  session.restore()
  if (!session.token.value) return navigateTo('/login')
  loading.value = true
  error.value = ''
  try {
    ;[overview.value, tenants.value, ownerAuditRequests.value] = await Promise.all([
      session.request<Overview>('/api/platform-admin/overview'),
      session.request<Tenant[]>('/api/platform-admin/tenants'),
      session.request('/api/platform-admin/audit-requests')
    ])
  } catch {
    session.clear()
    await navigateTo('/login')
  } finally {
    loading.value = false
  }
}

const openAudit = (tenant: Tenant) => {
  selected.value = null
  audit.value = []
  accessRequest.value = { tenant, id: '', reason: '', cnpj: '', status: 'reason' }
}
const openOwnerAuditRequest = async (request: any) => {
  activeOwnerAuditRequest.value = request
  ownerAuditMessages.value = await session.request(`/api/platform-admin/audit-requests/${encodeURIComponent(request.id)}/messages`)
}
const sendOwnerAuditMessage = async () => {
  if (!activeOwnerAuditRequest.value || !ownerAuditDraft.value.trim()) return
  await session.request(`/api/platform-admin/audit-requests/${encodeURIComponent(activeOwnerAuditRequest.value.id)}/messages`, { method: 'POST', body: { body: ownerAuditDraft.value } })
  ownerAuditDraft.value = ''
  await openOwnerAuditRequest(activeOwnerAuditRequest.value)
}
const closeOwnerAuditChat = async () => {
  if (!activeOwnerAuditRequest.value) return
  await session.request(`/api/platform-admin/audit-requests/${encodeURIComponent(activeOwnerAuditRequest.value.id)}/close-chat`, { method: 'POST' })
  activeOwnerAuditRequest.value = null
  ownerAuditRequests.value = await session.request('/api/platform-admin/audit-requests')
}

const requestAuditAccess = async () => {
  if (!accessRequest.value || accessRequest.value.reason.trim().length < 12) return
  error.value = ''
  try {
    const response = await session.request<{ id: string }>(`/api/platform-admin/tenants/${encodeURIComponent(accessRequest.value.tenant.id)}/data-access-requests`, {
      method: 'POST', body: { reason: accessRequest.value.reason }
    })
    accessRequest.value.id = response.id
    accessRequest.value.status = 'verify'
  } catch (requestError: any) {
    error.value = requestError?.message || 'Nao foi possivel iniciar a solicitacao.'
  }
}

const verifyAuditAccess = async () => {
  if (!accessRequest.value) return
  error.value = ''
  try {
    await session.request(`/api/platform-admin/data-access-requests/${encodeURIComponent(accessRequest.value.id)}/verify`, {
      method: 'POST', body: { cnpj: accessRequest.value.cnpj }
    })
    selected.value = accessRequest.value.tenant
    authorizedAccessRequestId.value = accessRequest.value.id
    audit.value = await session.request<Audit[]>(`/api/platform-admin/tenants/${encodeURIComponent(selected.value.id)}/audit?accessRequestId=${encodeURIComponent(accessRequest.value.id)}&limit=100`)
    accessRequest.value = null
  } catch (requestError: any) {
    error.value = requestError?.message || 'CNPJ nao confirmado.'
  }
}

const openPlatformAudit = async () => {
  selected.value = null
  authorizedAccessRequestId.value = ''
  accessRequest.value = null
  platformAudit.value = await session.request<PlatformAudit[]>('/api/platform-admin/audit?limit=100')
  showingPlatformAudit.value = true
}

const openDeletionAudit = async () => {
  selected.value = null
  accessRequest.value = null
  deletionAudit.value = await session.request<DeletionAudit[]>('/api/platform-admin/tenant-deletions?limit=100')
  showingDeletionAudit.value = true
}

const downloadAuditReport = async () => {
  if (!selected.value || !authorizedAccessRequestId.value) return
  error.value = ''
  try {
    await session.download(
      `/api/platform-admin/tenants/${encodeURIComponent(selected.value.id)}/audit-export?accessRequestId=${encodeURIComponent(authorizedAccessRequestId.value)}&format=${auditExportFormat.value}`,
      `Relatorio_Auditoria_de_Empresa.${auditExportFormat.value}`
    )
  } catch (downloadError: any) {
    error.value = downloadError?.message || 'Nao foi possivel baixar o relatorio.'
  }
}

const updateStatus = async (tenant: Tenant) => {
  const reason = window.prompt('Informe o motivo da alteracao. Esta acao sera auditada.') || ''
  if (reason.trim().length < 8) return
  const response = await session.request<Tenant>(`/api/platform-admin/tenants/${encodeURIComponent(tenant.id)}/status`, {
    method: 'POST', body: { accountStatus: tenant.accountStatus, billingStatus: tenant.billingStatus, reason }
  })
  tenants.value = tenants.value.map((item) => item.id === response.id ? { ...item, ...response } : item)
}

onMounted(() => void load())
</script>

<template>
  <main class="admin-shell">
    <header class="admin-header">
      <div class="brand"><span class="eyebrow">PrintFlow / interno</span><h1>Central da plataforma</h1><p>Visao operacional com acesso a dados protegido e auditado.</p></div>
      <div class="header-actions"><span class="operator">Sessao administrativa</span><button class="button button--quiet" @click="session.clear(); navigateTo('/login')">Sair</button></div>
    </header>

    <section v-if="overview" class="metrics" aria-label="Resumo da plataforma">
      <article class="metric-card"><span>Empresas</span><strong>{{ overview.tenants }}</strong><small>{{ overview.activeTenants }} ativas</small></article>
      <article class="metric-card metric-card--attention"><span>Atencao financeira</span><strong>{{ overview.paymentAttention }}</strong><small>pendentes ou atrasadas</small></article>
      <article class="metric-card"><span>Agents online</span><strong>{{ overview.onlineAgents }}/{{ overview.agents }}</strong><small>conexoes ativas agora</small></article>
      <article class="metric-card"><span>Impressoras</span><strong>{{ overview.connectedPrinters }}/{{ overview.printers }}</strong><small>conectadas ou produzindo</small></article>
    </section>

    <p v-if="error" class="feedback feedback--error">{{ error }}</p>

    <section class="surface company-panel"><div class="section-head"><div><span class="section-kicker">Consentimento do owner</span><h2>Solicitacoes de auditoria</h2><p>Busque pelo protocolo para localizar conversas abertas ou encerradas.</p></div></div><div class="table-wrap"><table><thead><tr><th>Protocolo</th><th>Empresa</th><th>Escopo</th><th>Motivo</th><th>Status</th><th>Solicitada em</th><th></th></tr></thead><tbody><tr v-for="request in filteredAuditRequests" :key="request.id"><td><code>{{ request.id }}</code></td><td><code>{{ request.tenantId }}</code></td><td>{{ request.scope.entityType || 'Eventos operacionais' }} {{ request.scope.entityId || '' }}</td><td>{{ request.reason }}</td><td><span class="status status--pending">{{ request.status }}</span></td><td>{{ formatDate(request.createdAt) }}</td><td><button v-if="['pending','under_review'].includes(request.status)" class="button button--primary" @click="openOwnerAuditRequest(request)">Iniciar atendimento</button></td></tr><tr v-if="!filteredAuditRequests.length"><td colspan="7" class="empty-state">Nenhuma solicitacao encontrada.</td></tr></tbody></table></div></section>
    <section v-if="activeOwnerAuditRequest" class="surface secure-panel"><div class="section-head"><div><span class="section-kicker">Atendimento seguro</span><h2>Conversa do protocolo {{ activeOwnerAuditRequest.id }}</h2><p>Somente owner e superadmin podem acessar estas mensagens.</p></div><button class="button button--quiet" @click="closeOwnerAuditChat">Encerrar conversa</button></div><div class="table-wrap"><p v-for="message in ownerAuditMessages" :key="message.id"><strong>{{ message.sender_type === 'owner' ? 'Owner' : 'Superadmin' }}:</strong> {{ message.body }} <small>{{ formatDate(message.created_at) }}</small></p></div><form class="secure-form" @submit.prevent="sendOwnerAuditMessage"><label>Mensagem<textarea v-model="ownerAuditDraft" maxlength="1000" required></textarea></label><button class="button button--primary">Enviar</button></form></section>

    <section class="surface company-panel">
      <div class="section-head"><div><span class="section-kicker">Base de clientes</span><h2>Empresas</h2><p>Localize pelo nome da empresa ou CNPJ mascarado.</p></div><div class="section-actions"><input v-model="search" aria-label="Buscar empresa ou CNPJ" placeholder="Buscar empresa ou CNPJ"><button class="button button--quiet" @click="openDeletionAudit">Exclusoes</button><button class="button button--quiet" @click="openPlatformAudit">Auditoria interna</button></div></div>
      <div v-if="loading" class="empty-state">Carregando empresas...</div>
      <div v-else class="table-wrap"><table><thead><tr><th>Empresa</th><th>Equipe</th><th>Operacao</th><th>Conta</th><th>Cobranca</th><th><span class="sr-only">Acoes</span></th></tr></thead><tbody>
        <tr v-for="tenant in filtered" :key="tenant.id"><td class="company-cell"><strong>{{ tenant.name || 'Empresa sem nome' }}</strong><small>{{ tenant.cnpj }}</small></td><td><strong>{{ tenant.activeUsers }}/{{ tenant.users }}</strong><small>usuarios ativos</small></td><td><strong>{{ tenant.onlineAgents }}/{{ tenant.agents }}</strong><small>{{ tenant.printers }} impressoras</small></td><td><select v-model="tenant.accountStatus" :class="`status status--${tenant.accountStatus}`" @change="updateStatus(tenant)"><option value="active">Ativa</option><option value="suspended">Suspensa</option><option value="blocked">Bloqueada</option></select></td><td><select v-model="tenant.billingStatus" :class="`status status--${tenant.billingStatus}`" @change="updateStatus(tenant)"><option value="not_configured">Nao configurada</option><option value="active">Em dia</option><option value="pending">Pendente</option><option value="overdue">Atrasada</option><option value="cancelled">Cancelada</option></select></td><td><button class="button button--primary" @click="openAudit(tenant)">Acesso seguro</button></td></tr>
        <tr v-if="!filtered.length"><td colspan="6" class="empty-state">Nenhuma empresa encontrada.</td></tr>
      </tbody></table></div>
    </section>

    <section v-if="accessRequest" class="surface secure-panel"><div class="secure-mark">01</div><div class="secure-content"><span class="section-kicker">Acesso protegido</span><h2>Relatorio da empresa</h2><p><strong>{{ accessRequest.tenant.name }}</strong> · {{ accessRequest.tenant.cnpj }}</p><p class="secure-copy">O acesso exige motivo, confirmacao do CNPJ pelo cliente e expira em 30 minutos. Todas as etapas ficam registradas na auditoria administrativa.</p><div v-if="accessRequest.status === 'reason'" class="secure-form"><label>Motivo da solicitacao<input v-model="accessRequest.reason" placeholder="Ex.: solicitacao de suporte registrada pelo cliente"></label><div class="form-actions"><button class="button button--quiet" @click="accessRequest = null">Cancelar</button><button class="button button--primary" :disabled="accessRequest.reason.trim().length < 12" @click="requestAuditAccess">Continuar</button></div></div><div v-else class="secure-form"><label>Confirme o CNPJ informado pelo cliente<input v-model="accessRequest.cnpj" inputmode="numeric" autocomplete="off" placeholder="Somente numeros do CNPJ"></label><div class="form-actions"><button class="button button--quiet" @click="accessRequest = null">Cancelar</button><button class="button button--primary" @click="verifyAuditAccess">Confirmar e abrir</button></div></div></div></section>

    <section v-if="selected" class="surface report-panel"><div class="section-head"><div><span class="section-kicker">Acesso autorizado</span><h2>Eventos da empresa</h2><p>{{ selected.name }} · acesso temporario validado.</p></div><div class="section-actions"><select v-model="auditExportFormat" aria-label="Formato do relatorio"><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option></select><button class="button button--quiet" @click="downloadAuditReport">Baixar relatorio</button><button class="button button--quiet" @click="selected = null; authorizedAccessRequestId = ''">Fechar relatorio</button></div></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Acao</th><th>Origem</th><th>Recurso</th></tr></thead><tbody><tr v-for="event in audit" :key="event.id"><td>{{ formatDate(event.createdAt) }}</td><td><strong>{{ event.summary }}</strong><small v-if="event.context">{{ event.context }}</small><code>{{ event.action }}</code></td><td>{{ event.actorType }}</td><td>{{ event.entityType }} {{ event.entityId }}</td></tr><tr v-if="!audit.length"><td colspan="4" class="empty-state">Nenhum evento operacional encontrado.</td></tr></tbody></table></div></section>

    <section v-if="showingPlatformAudit" class="surface report-panel"><div class="section-head"><div><span class="section-kicker">Rastreabilidade interna</span><h2>Auditoria administrativa</h2><p>Acoes executadas por super administradores.</p></div><button class="button button--quiet" @click="showingPlatformAudit = false">Fechar</button></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Acao</th><th>Empresa</th><th>Recurso</th><th>Motivo</th></tr></thead><tbody><tr v-for="event in platformAudit" :key="event.id"><td>{{ formatDate(event.createdAt) }}</td><td><strong>{{ event.summary }}</strong><small v-if="event.context">{{ event.context }}</small><code>{{ event.action }}</code></td><td>{{ event.targetTenantId || '-' }}</td><td>{{ event.targetResource }} {{ event.targetResourceId }}</td><td>{{ event.reason || '-' }}</td></tr><tr v-if="!platformAudit.length"><td colspan="5" class="empty-state">Nenhuma acao administrativa encontrada.</td></tr></tbody></table></div></section>
    <section v-if="showingDeletionAudit" class="surface report-panel"><div class="section-head"><div><span class="section-kicker">Evidencia preservada</span><h2>Exclusoes de empresas</h2><p>Trilha imutavel, sem dados pessoais ou CNPJ em texto.</p></div><button class="button button--quiet" @click="showingDeletionAudit = false">Fechar</button></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Etapa</th><th>Solicitacao</th><th>Evidencia</th></tr></thead><tbody><tr v-for="event in deletionAudit" :key="event.id"><td>{{ formatDate(event.createdAt) }}</td><td><strong>{{ event.summary }}</strong><small v-if="event.context">{{ event.context }}</small><code>{{ event.eventType }}</code></td><td><code>{{ event.requestId }}</code></td><td><small>Impressao criptografica da empresa e do solicitante preservada para verificacao.</small></td></tr><tr v-if="!deletionAudit.length"><td colspan="4" class="empty-state">Nenhuma exclusao registrada.</td></tr></tbody></table></div></section>
  </main>
</template>
