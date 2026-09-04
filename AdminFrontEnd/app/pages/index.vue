<script setup lang="ts">
type Section = 'central' | 'requests' | 'chats' | 'companies' | 'audit' | 'deletions'
type Overview = { tenants:number; activeTenants:number; suspendedTenants:number; paymentAttention:number; agents:number; onlineAgents:number; printers:number; connectedPrinters:number }
type Tenant = { id:string; name:string; cnpj:string; accountStatus:string; billingStatus:string; users:number; activeUsers:number; agents:number; onlineAgents:number; printers:number }
type Request = { id:string; tenantId:string; requestedBy:string; status:string; reason:string; scope:{ entityType?:string; entityId?:string; periodStart?:string; periodEnd?:string }; reviewerId?:string|null; reviewReason?:string; expiresAt?:string|null; createdAt:string; updatedAt:string }
type Message = { id:string; sender_type:'owner'|'superadmin'; sender_id:string; body:string; created_at:string }
type Audit = { id:string; action:string; summary:string; context?:string; actorType:string; entityType:string; entityId:string; createdAt:string }
type PlatformAudit = { id:string; action:string; summary:string; context?:string; targetTenantId?:string; targetResource:string; targetResourceId:string; reason:string; createdAt:string }
type DeletionAudit = { id:string; requestId:string; eventType:string; summary:string; context?:string; createdAt:string }
type AccessRequest = { tenant:Tenant; id:string; reason:string; cnpj:string; status:'reason'|'verify' }

const session = useAdminSession()
const section = ref<Section>('central')
const overview = ref<Overview|null>(null)
const tenants = ref<Tenant[]>([])
const requests = ref<Request[]>([])
const selectedRequest = ref<Request|null>(null)
const messages = ref<Message[]>([])
const messageDraft = ref('')
const platformAudit = ref<PlatformAudit[]>([])
const deletionAudit = ref<DeletionAudit[]>([])
const selectedTenant = ref<Tenant|null>(null)
const tenantAudit = ref<Audit[]>([])
const authorizedAccessRequestId = ref('')
const auditExportFormat = ref<'csv'|'xlsx'>('xlsx')
const accessRequest = ref<AccessRequest|null>(null)
const search = ref('')
const requestFilter = ref('all')
const loading = ref(false)
const actionLoading = ref(false)
const error = ref('')

const nav = [
  { id:'central', label:'Central', mark:'C' }, { id:'requests', label:'Solicitacoes', mark:'S' },
  { id:'chats', label:'Chats', mark:'M' }, { id:'companies', label:'Empresas', mark:'E' },
  { id:'audit', label:'Auditoria', mark:'A' }, { id:'deletions', label:'Exclusoes', mark:'X' }
] as const
const copy = { central:['Central da plataforma','Visao operacional e indicadores em tempo real'], requests:['Solicitacoes','Gerencie solicitacoes enviadas pelos owners'], chats:['Chats','Atendimento seguro entre superadmin e owners'], companies:['Empresas','Gerencie os tenants da plataforma'], audit:['Auditoria','Acompanhe acessos e acoes administrativas'], deletions:['Exclusoes auditadas','Consulte evidencias preservadas de exclusao'] } as const
const pageTitle = computed(() => copy[section.value][0])
const pageSubtitle = computed(() => copy[section.value][1])
const formatDate = (value?:string|null) => value ? new Date(value).toLocaleString('pt-BR') : '-'
const tenantFor = (id:string) => tenants.value.find((tenant) => tenant.id === id)
const statusLabel = (status:string) => ({ pending:'Aberta', under_review:'Em atendimento', approved:'Aprovada', rejected:'Rejeitada', cancelled:'Cancelada', closed:'Encerrada', expired:'Expirada', active:'Ativa', suspended:'Suspensa', blocked:'Bloqueada', overdue:'Atrasada', not_configured:'Nao configurada' }[status] || status)
const statusClass = (status:string) => `status-pill status-pill--${status.replace('_','-')}`
const matches = (value:string) => value.toLowerCase().includes(search.value.trim().toLowerCase())
const filteredRequests = computed(() => requests.value.filter((request) => (requestFilter.value === 'all' || request.status === requestFilter.value) && matches(`${request.id} ${request.reason} ${request.status} ${tenantFor(request.tenantId)?.name || request.tenantId}`)))
const filteredTenants = computed(() => tenants.value.filter((tenant) => matches(`${tenant.name} ${tenant.cnpj} ${tenant.id}`)))
const activeRequests = computed(() => requests.value.filter((request) => ['pending','under_review'].includes(request.status)))
const closedRequests = computed(() => requests.value.filter((request) => ['closed','rejected','cancelled','expired'].includes(request.status)))

const load = async () => {
  session.restore()
  if (!session.token.value) return navigateTo('/login')
  loading.value = true; error.value = ''
  try {
    ;[overview.value, tenants.value, requests.value] = await Promise.all([
      session.request<Overview>('/api/platform-admin/overview'), session.request<Tenant[]>('/api/platform-admin/tenants'), session.request<Request[]>('/api/platform-admin/audit-requests')
    ])
  } catch { session.clear(); await navigateTo('/login') }
  finally { loading.value = false }
}
const switchSection = async (next:Section) => {
  section.value = next; search.value = ''; error.value = ''
  if (next === 'audit') platformAudit.value = await session.request<PlatformAudit[]>('/api/platform-admin/audit?limit=100')
  if (next === 'deletions') deletionAudit.value = await session.request<DeletionAudit[]>('/api/platform-admin/tenant-deletions?limit=100')
}
const refreshRequests = async () => { requests.value = await session.request<Request[]>('/api/platform-admin/audit-requests') }
const openChat = async (request:Request) => {
  selectedRequest.value = request; section.value = 'chats'; actionLoading.value = true; error.value = ''
  try { messages.value = await session.request<Message[]>(`/api/platform-admin/audit-requests/${encodeURIComponent(request.id)}/messages`) }
  catch (err:any) { error.value = err?.data?.error || err?.message || 'Nao foi possivel abrir a conversa.' }
  finally { actionLoading.value = false }
}
const sendMessage = async () => {
  if (!selectedRequest.value || !messageDraft.value.trim()) return
  actionLoading.value = true; error.value = ''
  try {
    await session.request(`/api/platform-admin/audit-requests/${encodeURIComponent(selectedRequest.value.id)}/messages`, { method:'POST', body:{ body:messageDraft.value } })
    messageDraft.value = ''; await refreshRequests()
    const updated = requests.value.find((request) => request.id === selectedRequest.value?.id)
    if (updated) await openChat(updated)
  } catch (err:any) { error.value = err?.data?.error || err?.message || 'Nao foi possivel enviar a mensagem.' }
  finally { actionLoading.value = false }
}
const closeChat = async () => {
  if (!selectedRequest.value || !confirm(`Encerrar definitivamente o atendimento ${selectedRequest.value.id}?`)) return
  actionLoading.value = true; error.value = ''
  try { await session.request(`/api/platform-admin/audit-requests/${encodeURIComponent(selectedRequest.value.id)}/close-chat`, { method:'POST' }); await refreshRequests(); selectedRequest.value = null; messages.value = []; section.value = 'requests' }
  catch (err:any) { error.value = err?.data?.error || err?.message || 'Nao foi possivel encerrar o atendimento.' }
  finally { actionLoading.value = false }
}
const decideRequest = async (approved:boolean) => {
  if (!selectedRequest.value) return
  const reason = window.prompt(approved ? 'Justifique a aprovacao do acesso.' : 'Justifique a rejeicao da solicitacao.') || ''
  if (reason.trim().length < 12) return
  actionLoading.value = true
  try { await session.request(`/api/platform-admin/audit-requests/${encodeURIComponent(selectedRequest.value.id)}/decision`, { method:'POST', body:{ approved, reason } }); await refreshRequests(); selectedRequest.value = requests.value.find((request) => request.id === selectedRequest.value?.id) || null }
  catch (err:any) { error.value = err?.data?.error || err?.message || 'Nao foi possivel registrar a decisao.' }
  finally { actionLoading.value = false }
}
const openTenantAccess = (tenant:Tenant) => { accessRequest.value = { tenant, id:'', reason:'', cnpj:'', status:'reason' } }
const requestTenantAccess = async () => {
  if (!accessRequest.value) return
  const response = await session.request<{id:string}>(`/api/platform-admin/tenants/${encodeURIComponent(accessRequest.value.tenant.id)}/data-access-requests`, { method:'POST', body:{ reason:accessRequest.value.reason } })
  accessRequest.value.id = response.id; accessRequest.value.status = 'verify'
}
const verifyTenantAccess = async () => {
  if (!accessRequest.value) return
  await session.request(`/api/platform-admin/data-access-requests/${encodeURIComponent(accessRequest.value.id)}/verify`, { method:'POST', body:{ cnpj:accessRequest.value.cnpj } })
  selectedTenant.value = accessRequest.value.tenant; authorizedAccessRequestId.value = accessRequest.value.id
  tenantAudit.value = await session.request<Audit[]>(`/api/platform-admin/tenants/${encodeURIComponent(selectedTenant.value.id)}/audit?accessRequestId=${encodeURIComponent(accessRequest.value.id)}&limit=100`)
  accessRequest.value = null; section.value = 'audit'
}
const downloadAuditReport = () => selectedTenant.value && authorizedAccessRequestId.value ? session.download(`/api/platform-admin/tenants/${encodeURIComponent(selectedTenant.value.id)}/audit-export?accessRequestId=${encodeURIComponent(authorizedAccessRequestId.value)}&format=${auditExportFormat.value}`, `Relatorio_Auditoria_de_Empresa.${auditExportFormat.value}`) : undefined
const updateTenantStatus = async (tenant:Tenant) => {
  const reason = window.prompt('Informe o motivo da alteracao. Esta acao sera auditada.') || ''
  if (reason.trim().length < 8) return void load()
  const updated = await session.request<Tenant>(`/api/platform-admin/tenants/${encodeURIComponent(tenant.id)}/status`, { method:'POST', body:{ accountStatus:tenant.accountStatus, billingStatus:tenant.billingStatus, reason } })
  tenants.value = tenants.value.map((item) => item.id === updated.id ? { ...item, ...updated } : item)
}
onMounted(() => void load())
</script>

<template>
  <div class="admin-app">
    <aside class="admin-sidebar">
      <div class="admin-logo"><svg viewBox="0 0 44 44" aria-hidden="true"><path d="m22 2 13 7.5v15L22 32 9 24.5v-15L22 2Z" fill="#6f4df6"/><path d="m22 17 13-7.5v15L22 32V17Z" fill="#2348d8"/><path d="M22 17 9 9.5v15L22 32V17Z" fill="#42c1f2"/><path d="m22 17 13 7.5L22 42 9 34.5l13-7.5V17Z" fill="#1768f2" opacity=".9"/><path d="m9 24.5 13 7.5v10L9 34.5v-10Z" fill="#62d2ef"/></svg><span><strong>PrintFlow</strong><small>Superadmin</small></span></div>
      <nav><button v-for="item in nav" :key="item.id" :class="{ active:section === item.id }" @click="switchSection(item.id)"><span class="nav-mark">{{ item.mark }}</span>{{ item.label }}<span v-if="item.id === 'requests' && activeRequests.length" class="nav-count">{{ activeRequests.length }}</span></button></nav>
      <div class="sidebar-foot"><span class="security-dot"></span><div><strong>Ambiente auditado</strong><small>Acoes monitoradas</small></div></div>
    </aside>
    <div class="admin-main">
      <header class="admin-topbar"><div class="top-search"><span></span><input v-model="search" placeholder="Buscar no sistema..."></div><div class="admin-user"><span class="avatar">SA</span><div><strong>{{ session.user.value?.name || 'Superadmin' }}</strong><small>Administrador da plataforma</small></div><button class="logout" @click="session.clear(); navigateTo('/login')">Sair</button></div></header>
      <main class="admin-content">
        <div class="page-heading"><div><h1>{{ pageTitle }}</h1><p>{{ pageSubtitle }}</p></div><button v-if="section === 'requests' || section === 'chats'" class="button button--quiet" @click="refreshRequests">Atualizar</button></div>
        <p v-if="error" class="feedback feedback--error">{{ error }}</p>

        <template v-if="section === 'central'">
          <section v-if="overview" class="metrics-grid"><article><span>Solicitacoes</span><strong>{{ requests.length }}</strong><small>{{ activeRequests.length }} aguardando acao</small></article><article><span>Em atendimento</span><strong>{{ requests.filter(r => r.status === 'under_review').length }}</strong><small>Conversas em andamento</small></article><article><span>Empresas</span><strong>{{ overview.tenants }}</strong><small>{{ overview.activeTenants }} ativas</small></article><article><span>Usuarios ativos</span><strong>{{ tenants.reduce((sum,t) => sum + t.activeUsers,0) }}</strong><small>Em todos os tenants</small></article><article><span>Agents online</span><strong>{{ overview.onlineAgents }}</strong><small>de {{ overview.agents }} pareados</small></article><article><span>Impressoras</span><strong>{{ overview.connectedPrinters }}</strong><small>de {{ overview.printers }} conectadas</small></article><article><span>Atencao financeira</span><strong>{{ overview.paymentAttention }}</strong><small>Empresas com pendencias</small></article><article><span>Encerrados</span><strong>{{ closedRequests.length }}</strong><small>Protocolos preservados</small></article></section>
          <section class="dashboard-columns"><article class="panel"><div class="panel-head"><div><h2>Atividade da plataforma</h2><p>Resumo operacional atual</p></div></div><div class="activity-chart"><div v-for="height in [24,31,29,42,46,58,54,68,73,86,82,96]" :key="height" :style="{height:`${height}%`}"></div></div><div class="chart-labels"><span>Inicio</span><span>Agora</span></div></article><article class="panel"><div class="panel-head"><div><h2>Solicitacoes recentes</h2><p>Ultimos protocolos abertos</p></div><button @click="switchSection('requests')">Ver todas</button></div><button v-for="request in requests.slice(0,5)" :key="request.id" class="activity-row" @click="openChat(request)"><span class="activity-icon">S</span><div><strong>{{ tenantFor(request.tenantId)?.name || request.tenantId }}</strong><small>{{ request.id }}</small></div><time>{{ formatDate(request.createdAt) }}</time></button><p v-if="!requests.length" class="empty-state">Nenhuma solicitacao registrada.</p></article></section>
        </template>

        <template v-else-if="section === 'requests'">
          <div class="request-tabs"><button :class="{active:requestFilter==='all'}" @click="requestFilter='all'">Todas <span>{{ requests.length }}</span></button><button :class="{active:requestFilter==='pending'}" @click="requestFilter='pending'">Abertas <span>{{ requests.filter(r=>r.status==='pending').length }}</span></button><button :class="{active:requestFilter==='under_review'}" @click="requestFilter='under_review'">Em atendimento <span>{{ requests.filter(r=>r.status==='under_review').length }}</span></button><button :class="{active:requestFilter==='closed'}" @click="requestFilter='closed'">Encerradas <span>{{ requests.filter(r=>r.status==='closed').length }}</span></button></div>
          <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Protocolo</th><th>Empresa</th><th>Assunto</th><th>Escopo</th><th>Status</th><th>Aberto em</th><th></th></tr></thead><tbody><tr v-for="request in filteredRequests" :key="request.id"><td><code>{{ request.id }}</code></td><td><strong>{{ tenantFor(request.tenantId)?.name || request.tenantId }}</strong></td><td>{{ request.reason }}</td><td>{{ request.scope.entityType || 'Auditoria operacional' }}<small>{{ request.scope.entityId }}</small></td><td><span :class="statusClass(request.status)">{{ statusLabel(request.status) }}</span></td><td>{{ formatDate(request.createdAt) }}</td><td><button class="table-action" @click="openChat(request)">{{ ['pending','under_review'].includes(request.status)?'Atender':'Visualizar' }}</button></td></tr><tr v-if="!filteredRequests.length"><td colspan="7" class="empty-state">Nenhuma solicitacao encontrada.</td></tr></tbody></table></div></section>
        </template>

        <template v-else-if="section === 'chats'">
          <div class="chat-layout"><aside class="chat-overview"><h2>Visao geral</h2><div><span>Em atendimento</span><strong>{{ requests.filter(r=>r.status==='under_review').length }}</strong></div><div><span>Aguardando resposta</span><strong>{{ requests.filter(r=>r.status==='pending').length }}</strong></div><div><span>Encerrados</span><strong>{{ closedRequests.length }}</strong></div></aside>
            <aside class="conversation-list"><div class="conversation-title"><h2>Conversas</h2><span>Mais recentes</span></div><button v-for="request in filteredRequests" :key="request.id" :class="{active:selectedRequest?.id===request.id}" @click="openChat(request)"><span class="company-avatar">{{ (tenantFor(request.tenantId)?.name||'PF').slice(0,2).toUpperCase() }}</span><div><code>{{ request.id }}</code><strong>{{ tenantFor(request.tenantId)?.name || request.tenantId }}</strong><small>{{ request.reason }}</small><span :class="statusClass(request.status)">{{ statusLabel(request.status) }}</span></div><time>{{ formatDate(request.updatedAt||request.createdAt) }}</time></button><p v-if="!filteredRequests.length" class="empty-state">Nenhuma conversa encontrada.</p></aside>
            <section class="chat-panel"><div v-if="!selectedRequest" class="chat-empty"><span>M</span><h2>Selecione uma conversa</h2><p>Escolha um protocolo para iniciar ou revisar o atendimento.</p></div><template v-else><header class="chat-header"><span class="company-avatar">{{ (tenantFor(selectedRequest.tenantId)?.name||'PF').slice(0,2).toUpperCase() }}</span><div><h2>{{ tenantFor(selectedRequest.tenantId)?.name || selectedRequest.tenantId }} <span>Conversa segura</span></h2><p>Protocolo: {{ selectedRequest.id }}</p></div><div class="chat-actions"><button v-if="['pending','under_review'].includes(selectedRequest.status)" class="button button--danger" :disabled="actionLoading" @click="closeChat">Encerrar conversa</button></div></header>
              <div class="chat-body"><div class="message-stream"><div class="day-marker">Atendimento auditado</div><article v-for="message in messages" :key="message.id" :class="['message',message.sender_type==='superadmin'?'message--admin':'message--owner']"><span class="company-avatar">{{ message.sender_type==='superadmin'?'SA':'OW' }}</span><div><label>{{ message.sender_type==='superadmin'?'Superadmin':'Owner' }}</label><p>{{ message.body }}</p><time>{{ formatDate(message.created_at) }}</time></div></article><p v-if="!messages.length&&!actionLoading" class="empty-state">Envie a primeira mensagem para iniciar o atendimento.</p></div><aside class="request-context"><h3>Fluxo de acesso protegido</h3><ol><li><span>1</span><div><strong>Motivo registrado</strong><p>{{ selectedRequest.reason }}</p></div></li><li><span>2</span><div><strong>Escopo restrito</strong><p>{{ selectedRequest.scope.entityType||'Auditoria operacional' }} {{ selectedRequest.scope.entityId }}</p></div></li><li><span>3</span><div><strong>Acesso temporario</strong><p>{{ selectedRequest.expiresAt?`Expira em ${formatDate(selectedRequest.expiresAt)}`:'Aguardando decisao' }}</p></div></li></ol><div class="request-card"><span>Dados da solicitacao</span><dl><dt>Protocolo</dt><dd>{{ selectedRequest.id }}</dd><dt>Solicitado em</dt><dd>{{ formatDate(selectedRequest.createdAt) }}</dd><dt>Status</dt><dd>{{ statusLabel(selectedRequest.status) }}</dd></dl><div v-if="['pending','under_review'].includes(selectedRequest.status)" class="decision-actions"><button class="button button--approve" @click="decideRequest(true)">Aprovar</button><button class="button button--quiet" @click="decideRequest(false)">Rejeitar</button></div></div></aside></div>
              <form v-if="['pending','under_review'].includes(selectedRequest.status)" class="message-form" @submit.prevent="sendMessage"><textarea v-model="messageDraft" maxlength="1000" placeholder="Digite uma mensagem..." required></textarea><button :disabled="actionLoading||!messageDraft.trim()">Enviar</button></form><div v-else class="chat-closed">Atendimento encerrado. O historico permanece disponivel para auditoria.</div></template></section></div>
        </template>

        <template v-else-if="section === 'companies'">
          <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Empresa</th><th>CNPJ</th><th>Usuarios</th><th>Agents</th><th>Impressoras</th><th>Conta</th><th>Cobranca</th><th></th></tr></thead><tbody><tr v-for="tenant in filteredTenants" :key="tenant.id"><td><strong>{{ tenant.name||'Empresa sem nome' }}</strong><small>{{ tenant.id }}</small></td><td>{{ tenant.cnpj }}</td><td>{{ tenant.activeUsers }}/{{ tenant.users }}</td><td>{{ tenant.onlineAgents }}/{{ tenant.agents }}</td><td>{{ tenant.printers }}</td><td><select v-model="tenant.accountStatus" :class="statusClass(tenant.accountStatus)" @change="updateTenantStatus(tenant)"><option value="active">Ativa</option><option value="suspended">Suspensa</option><option value="blocked">Bloqueada</option></select></td><td><select v-model="tenant.billingStatus" :class="statusClass(tenant.billingStatus)" @change="updateTenantStatus(tenant)"><option value="not_configured">Nao configurada</option><option value="active">Em dia</option><option value="pending">Pendente</option><option value="overdue">Atrasada</option><option value="cancelled">Cancelada</option></select></td><td><button class="table-action" @click="openTenantAccess(tenant)">Acesso seguro</button></td></tr></tbody></table></div></section>
          <section v-if="accessRequest" class="access-modal"><div class="modal-card"><button class="modal-close" @click="accessRequest=null">Fechar</button><span class="section-kicker">Acesso protegido</span><h2>{{ accessRequest.tenant.name }}</h2><p>O acesso exige motivo, confirmacao do CNPJ e expira em 30 minutos.</p><form v-if="accessRequest.status==='reason'" @submit.prevent="requestTenantAccess"><label>Motivo detalhado<textarea v-model="accessRequest.reason" minlength="12" maxlength="500" required></textarea></label><button class="button button--primary">Continuar</button></form><form v-else @submit.prevent="verifyTenantAccess"><label>Confirme o CNPJ informado pelo cliente<input v-model="accessRequest.cnpj" inputmode="numeric" autocomplete="off" required></label><button class="button button--primary">Confirmar e abrir</button></form></div></section>
        </template>

        <template v-else-if="section === 'audit'"><section v-if="selectedTenant" class="panel"><div class="panel-head"><div><h2>Eventos de {{ selectedTenant.name }}</h2><p>Acesso temporario validado</p></div><div class="inline-actions"><select v-model="auditExportFormat"><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option></select><button class="button button--primary" @click="downloadAuditReport">Exportar</button><button class="button button--quiet" @click="selectedTenant=null">Fechar</button></div></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Acao</th><th>Origem</th><th>Recurso</th></tr></thead><tbody><tr v-for="event in tenantAudit" :key="event.id"><td>{{ formatDate(event.createdAt) }}</td><td><strong>{{ event.summary }}</strong><small>{{ event.context }}</small><code>{{ event.action }}</code></td><td>{{ event.actorType }}</td><td>{{ event.entityType }} {{ event.entityId }}</td></tr></tbody></table></div></section><section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Data e hora</th><th>Acao</th><th>Empresa</th><th>Recurso</th><th>Motivo</th></tr></thead><tbody><tr v-for="event in platformAudit" :key="event.id"><td>{{ formatDate(event.createdAt) }}</td><td><strong>{{ event.summary }}</strong><small>{{ event.context }}</small><code>{{ event.action }}</code></td><td>{{ event.targetTenantId||'-' }}</td><td>{{ event.targetResource }} {{ event.targetResourceId }}</td><td>{{ event.reason||'-' }}</td></tr><tr v-if="!platformAudit.length"><td colspan="5" class="empty-state">Nenhum evento administrativo registrado.</td></tr></tbody></table></div></section></template>
        <template v-else-if="section === 'deletions'"><section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Data</th><th>Etapa</th><th>Protocolo</th><th>Evidencia preservada</th></tr></thead><tbody><tr v-for="event in deletionAudit" :key="event.id"><td>{{ formatDate(event.createdAt) }}</td><td><strong>{{ event.summary }}</strong><small>{{ event.context }}</small></td><td><code>{{ event.requestId }}</code></td><td>Impressao criptografica preservada para verificacao.</td></tr><tr v-if="!deletionAudit.length"><td colspan="4" class="empty-state">Nenhuma exclusao registrada.</td></tr></tbody></table></div></section></template>
      </main>
    </div>
  </div>
</template>
