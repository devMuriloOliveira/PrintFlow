<script setup lang="ts">
const { notify } = useUi()
const auth = useAuth()
const { settings, marketplaceIntegrations, updateSettings, exportTenantData, listSettingsExports, loadBackupStatus, listAuditRequests, createAuditRequest, loadIntegrationsOverview } = useAppData()
const { members, loading: membersLoading, invitations, refreshMembers, updateMember, createInvitation, refreshInvitations, revokeInvitation, resendInvitation } = useTenantMembers()

const active = ref('Empresa')
const savingMemberId = ref('')
const inviting = ref(false)
const invitationActionId = ref('')
const sessions = ref<{ sessionId: string; createdAt: string; expiresAt: string }[]>([])
const sessionsLoading = ref(false)
const changingPassword = ref(false)
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmation: '' })
const deletingTenant = ref(false)
const savingSettings = ref(false)
const exportingData = ref(false)
const exportHistory = ref<Array<{ id: string; fileName: string; format: string; recordCount: number; status: string; createdAt: string }>>([])
const backupLoading = ref(false)
const backupStatus = ref<{ databaseAvailable: boolean; export: { enabled: boolean; format: string; excludes: string[] }; restore: { enabled: boolean; reason: string } }>({ databaseAvailable: false, export: { enabled: false, format: 'json', excludes: [] }, restore: { enabled: false, reason: '' } })
const auditRequests = ref<any[]>([])
const auditDraft = reactive({ reason: '', entityType: '', entityId: '', currentPassword: '' })
const integrationsLoading = ref(false)
const integrationsOverview = ref<{ marketplaces: Array<{ id?: string; platform: string; connectionName: string; accountExternalId: string; status: string; lastSyncAt?: string | null }>; agents: Array<{ id: string; name: string; machineName: string; platform: string; status: string; lastSeenAt?: string | null }>; email: { provider: string; status: 'connected' | 'not_configured' } }>({ marketplaces: [], agents: [], email: { provider: 'Resend', status: 'not_configured' } })
const deletionForm = reactive({ currentPassword: '', acknowledged: false, confirmation: '' })
const memberDrafts = reactive<Record<string, { role: string; status: string }>>({})
const invite = reactive({ email: '', role: 'usuario' as 'admin' | 'financeiro' | 'producao' | 'usuario' })
const tabs = [
  ['Empresa', 'building', 'Informacoes da empresa'],
  ['Financeiro', 'money', 'Impostos, moedas e contas'],
  ['Usuarios e Permissoes', 'users', 'Gestao de usuarios e acessos'],
  ['Notificacoes', 'bell', 'E-mails e alertas do sistema'],
  ['Seguranca', 'shield', 'Acesso, 2FA e sessoes'],
  ['Personalizacao', 'settings', 'Marca, aparencia e preferencias'],
  ['Integracoes', 'box', 'Marketplaces e servicos'],
  ['Backup e Dados', 'download', 'Exportar e restaurar dados']
]
const company = reactive({ name: '', cnpj: '', phone: '', email: '', address: '', district: '', city: '', state: '', zip: '', country: 'Brasil', currency: 'Real (R$)', timezone: '(GMT-03:00) Brasilia', kwh: 0 })
const preferences = reactive({ emailAlerts: true, productionAlerts: true, marketplaceAlerts: true, dailySummary: false, compactLayout: false, logoUrl: '', brandName: '', accentColor: '#1768f2', defaultMargin: 40, monthlyFixedCost: 0, plannedMonthlyUnits: 0 })
const previewBrandName = computed(() => preferences.brandName.trim() || company.name.trim() || 'PrintFlow 3D')
const roles = [
  { value: 'owner', label: 'Owner', description: 'Controle total do tenant, inclusive outros Owners.', access: ['Todas as configuracoes', 'Membros e Owners', 'Auditoria e dados'] },
  { value: 'admin', label: 'Administrador', description: 'Gerencia membros e a operacao, sem poderes reservados de Owner.', access: ['Catalogo e producao', 'Financeiro e marketplaces', 'Membros, sem Owners'] },
  { value: 'financeiro', label: 'Financeiro', description: 'Acessa vendas, despesas e informacoes financeiras.', access: ['Vendas e despesas', 'Clientes', 'Consulta de catalogo'] },
  { value: 'producao', label: 'Producao', description: 'Gerencia producao, impressoras e catalogo.', access: ['Produtos e filamentos', 'Impressoras e fila', 'Pedidos e clientes'] },
  { value: 'usuario', label: 'Usuario', description: 'Acesso operacional basico.', access: ['Consulta de catalogo', 'Consulta de pedidos', 'Consulta de producao'] }
]

const canManageMembers = computed(() => ['owner', 'admin'].includes(String(auth.user.value?.role || '')))
const roleCount = (role: string) => members.value.filter((member) => member.role === role).length
const memberBadge = (status: string) => status === 'active' ? 'badge badge--green' : 'badge badge--orange'
const memberStatusLabel = (status: string) => status === 'active' ? 'Ativo' : 'Suspenso'
const canEditMember = (member: { role: string }) => canManageMembers.value &&
  (auth.user.value?.role === 'owner' || member.role !== 'owner')

const syncMemberDrafts = () => {
  for (const member of members.value) {
    memberDrafts[member.userId] = { role: member.role, status: member.status }
  }
}

const loadMembers = async () => {
  try {
    await Promise.all([refreshMembers(), refreshInvitations()])
    syncMemberDrafts()
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel carregar os usuarios.')
  }
}

const saveMember = async (userId: string) => {
  const draft = memberDrafts[userId]
  if (!draft) return
  const member = members.value.find((item) => item.userId === userId)
  if (member?.status === 'active' && draft.status === 'suspended' && !window.confirm(`Suspender ${member.name}? As sessoes ativas serao encerradas.`)) return

  savingMemberId.value = userId
  try {
    await updateMember(userId, {
      role: draft.role as 'owner' | 'admin' | 'financeiro' | 'producao' | 'usuario',
      status: draft.status as 'active' | 'suspended'
    })
    notify('Acesso do usuario atualizado. As sessoes dele foram encerradas.')
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel atualizar o acesso.')
    await loadMembers()
  } finally {
    savingMemberId.value = ''
  }
}

const sendInvitation = async () => {
  inviting.value = true
  try {
    await createInvitation(invite)
    invite.email = ''
    invite.role = 'usuario'
    notify('Convite enviado por e-mail.')
    await refreshInvitations()
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel enviar o convite.')
  } finally {
    inviting.value = false
  }
}
const resendPendingInvitation = async (id: string) => {
  invitationActionId.value = id
  try { await resendInvitation(id); notify('Novo convite enviado. O link anterior foi cancelado.') } catch (error: any) { notify(error?.data?.error || error?.message || 'Nao foi possivel reenviar o convite.') } finally { invitationActionId.value = '' }
}
const cancelPendingInvitation = async (id: string, email: string) => {
  if (!window.confirm(`Cancelar o convite enviado para ${email}?`)) return
  invitationActionId.value = id
  try { await revokeInvitation(id); notify('Convite cancelado.') } catch (error: any) { notify(error?.data?.error || error?.message || 'Nao foi possivel cancelar o convite.') } finally { invitationActionId.value = '' }
}

const loadSessions = async () => {
  sessionsLoading.value = true
  try { sessions.value = await auth.listSessions() } catch (error: any) { notify(error?.data?.error || 'Nao foi possivel carregar as sessoes.') } finally { sessionsLoading.value = false }
}
const endSession = async (sessionId: string) => {
  try { await auth.revokeSession(sessionId); sessions.value = sessions.value.filter((session) => session.sessionId !== sessionId); notify('Sessao encerrada.') } catch (error: any) { notify(error?.data?.error || 'Nao foi possivel encerrar a sessao.') }
}
const endAllSessions = async () => {
  try { await auth.revokeAllSessions(); auth.clearSession(); await navigateTo('/login') } catch (error: any) { notify(error?.data?.error || 'Nao foi possivel encerrar as sessoes.') }
}

const submitPasswordChange = async () => {
  if (passwordForm.newPassword !== passwordForm.confirmation) {
    notify('A confirmacao da nova senha nao confere.')
    return
  }

  changingPassword.value = true
  try {
    await auth.changePassword(passwordForm.currentPassword, passwordForm.newPassword)
    passwordForm.currentPassword = ''
    passwordForm.newPassword = ''
    passwordForm.confirmation = ''
    await loadSessions()
    notify('Senha alterada. As sessoes anteriores foram encerradas por seguranca.')
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel alterar a senha.')
  } finally {
    changingPassword.value = false
  }
}

const requestTenantDeletion = async () => {
  if (auth.user.value?.role !== 'owner') return notify('Somente o Owner pode solicitar a exclusao da empresa.')
  if (!deletionForm.acknowledged || deletionForm.confirmation !== 'EXCLUIR') return notify('Leia o aviso, marque a confirmacao e digite EXCLUIR.')
  deletingTenant.value = true
  try {
    const result = await auth.requestTenantDeletion(deletionForm.currentPassword)
    auth.clearSession()
    notify(`Exclusao programada para ${new Date(result.scheduledFor).toLocaleString('pt-BR')}. Entre novamente para cancelar.`)
    await navigateTo('/login')
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel solicitar a exclusao.')
  } finally {
    deletingTenant.value = false
  }
}

const syncSettings = () => {
  const value = settings.value || {}
  Object.assign(company, {
    name: String(value.name || ''), cnpj: String(value.document || ''), phone: String(value.phone || ''), email: String(value.email || ''),
    address: String(value.address || ''), district: String(value.district || ''), city: String(value.city || ''), state: String(value.state || ''), zip: String(value.zip || ''),
    country: String(value.country || 'Brasil'), currency: String(value.currency || 'Real (R$)'), timezone: String(value.timezone || '(GMT-03:00) Brasilia'), kwh: Number(value.kwh || 0)
  })
  Object.assign(preferences, (value.preferences && typeof value.preferences === 'object' ? value.preferences : {}))
}

const saveSettings = async () => {
  if (!company.name.trim() || !company.email.trim()) return notify('Informe o nome e o e-mail da empresa.')
  savingSettings.value = true
  try {
    await updateSettings({ ...company, document: company.cnpj, preferences: { ...preferences } })
    notify('Configuracoes salvas com seguranca.')
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel salvar as configuracoes.')
  } finally { savingSettings.value = false }
}

const downloadTenantData = async () => {
  exportingData.value = true
  try {
    const result = await exportTenantData()
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = result.fileName
    link.click()
    URL.revokeObjectURL(url)
    notify('Arquivo de dados gerado e registrado na auditoria.')
    await loadExportHistory()
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel exportar seus dados.')
  } finally { exportingData.value = false }
}

const loadExportHistory = async () => {
  try { exportHistory.value = await listSettingsExports() } catch (error: any) { notify(error?.data?.error || 'Nao foi possivel carregar o historico de exportacoes.') }
}

const loadBackup = async () => {
  backupLoading.value = true
  try {
    backupStatus.value = await loadBackupStatus()
    if (backupStatus.value.export.enabled) await loadExportHistory()
    auditRequests.value = await listAuditRequests()
  } catch (error: any) {
    notify(error?.data?.error || 'Nao foi possivel verificar a disponibilidade do backup.')
  } finally { backupLoading.value = false }
}
const submitAuditRequest = async () => { try { await createAuditRequest({ ...auditDraft, scope: { entityType: auditDraft.entityType, entityId: auditDraft.entityId } }); Object.assign(auditDraft, { reason: '', entityType: '', entityId: '', currentPassword: '' }); await loadBackup(); notify('Solicitacao enviada ao superadmin.') } catch (error: any) { notify(error?.data?.error || 'Nao foi possivel criar a solicitacao.') } }

const loadIntegrations = async () => {
  integrationsLoading.value = true
  try { integrationsOverview.value = await loadIntegrationsOverview() } catch (error: any) { notify(error?.data?.error || 'Nao foi possivel carregar as integracoes.') } finally { integrationsLoading.value = false }
}

const integrationStatus = (status: string) => ({ connected: 'Conectado', active: 'Conectado', online: 'Online', not_configured: 'Nao configurado', offline: 'Offline', revoked: 'Revogado' }[status] || status)
const integrationBadge = (status: string) => ['connected', 'active', 'online'].includes(status) ? 'badge badge--green' : status === 'not_configured' || status === 'revoked' ? 'badge badge--orange' : 'badge badge--gray'

watch(active, (tab) => {
  if (tab === 'Usuarios e Permissoes') void loadMembers()
  if (tab === 'Seguranca') void loadSessions()
  if (tab === 'Backup e Dados') void loadBackup()
  if (tab === 'Integracoes') void loadIntegrations()
})

watch(members, syncMemberDrafts, { immediate: true })
watch(settings, syncSettings, { immediate: true })
</script>

<template>
  <div>
    <PageHeader title="Configuracoes" subtitle="Gerencie as configuracoes da sua empresa e da plataforma" />

    <div class="settings-layout">
      <nav class="settings-nav">
        <button v-for="tab in tabs" :key="tab[0]" :class="{ active: active === tab[0] }" @click="active = tab[0]">
          <span class="settings-nav__icon"><UiIcon :name="tab[1]" /></span>
          <span><strong>{{ tab[0] }}</strong><small>{{ tab[2] }}</small></span>
        </button>
      </nav>

      <section class="settings-panel">
        <div v-if="active === 'Empresa'">
          <div style="display:flex;justify-content:space-between;gap:12px">
            <div><h2>Informacoes da Empresa</h2><p>Atualize os dados principais da sua empresa.</p></div>
            <button class="btn btn--primary" :disabled="savingSettings" @click="saveSettings">{{ savingSettings ? 'Salvando...' : 'Salvar alteracoes' }}</button>
          </div>
          <div class="form-grid">
            <div class="field col-7"><label>Nome da Empresa *</label><input v-model="company.name"></div><div class="field col-5"><label>CNPJ</label><input v-model="company.cnpj"></div><div class="field col-6"><label>Telefone</label><input v-model="company.phone"></div><div class="field col-6"><label>E-mail *</label><input v-model="company.email" type="email"></div><div class="field col-8"><label>Endereco</label><input v-model="company.address"></div><div class="field col-4"><label>Bairro</label><input v-model="company.district"></div><div class="field col-4"><label>Cidade</label><input v-model="company.city"></div><div class="field col-2"><label>Estado</label><input v-model="company.state"></div><div class="field col-3"><label>CEP</label><input v-model="company.zip"></div><div class="field col-3"><label>Pais</label><input v-model="company.country"></div><div class="field col-4"><label>Moeda</label><input v-model="company.currency"></div><div class="field col-4"><label>Fuso Horario</label><input v-model="company.timezone"></div><div class="field col-4"><label>Custo medio do kWh</label><input v-model.number="company.kwh" type="number" min="0" step=".01"></div>
          </div>
        </div>

        <div v-else-if="active === 'Financeiro'">
          <h2>Parametros Financeiros</h2><p>Esses valores sao usados como padrao em novos calculos de produto.</p>
          <div class="form-grid"><label class="field col-4"><span>Moeda</span><select v-model="company.currency"><option value="Real (R$)">Real (R$)</option><option value="Dolar (US$)">Dolar (US$)</option><option value="Euro (EUR)">Euro (EUR)</option></select></label><label class="field col-4"><span>Fuso horario</span><input v-model="company.timezone"></label><label class="field col-4"><span>Custo do kWh</span><input v-model.number="company.kwh" type="number" min="0" step=".01"></label><label class="field col-4"><span>Margem padrao (%)</span><input v-model.number="preferences.defaultMargin" type="number" min="0" step=".1"></label><label class="field col-4"><span>Custos fixos mensais</span><input v-model.number="preferences.monthlyFixedCost" type="number" min="0" step=".01"></label><label class="field col-4"><span>Unidades planejadas por mes</span><input v-model.number="preferences.plannedMonthlyUnits" type="number" min="0" step="1"></label></div>
          <div class="info-note" style="margin:16px 0"><UiIcon name="info" />O custo fixo e rateado por unidade somente em novos calculos. Produtos ja salvos preservam a composicao financeira original.</div>
          <button class="btn btn--primary" :disabled="savingSettings" @click="saveSettings">{{ savingSettings ? 'Salvando...' : 'Salvar parametros' }}</button>
        </div>

        <div v-else-if="active === 'Usuarios e Permissoes'">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
            <div><h2>Usuarios e Permissoes</h2><p>Altere o acesso de membros ja cadastrados neste tenant.</p></div>
            <button class="btn" :disabled="membersLoading" @click="loadMembers">Atualizar</button>
          </div>

          <div v-if="!canManageMembers" class="info-note"><UiIcon name="shield" />Somente Owner e Administrador podem gerenciar acessos.</div>
          <form v-if="canManageMembers" class="filters" style="margin-top:16px" @submit.prevent="sendInvitation"><label class="field field--search"><span>E-mail do novo usuario</span><input v-model="invite.email" type="email" required placeholder="usuario@empresa.com"></label><label class="field"><span>Perfil inicial</span><select v-model="invite.role"><option value="admin">Administrador</option><option value="financeiro">Financeiro</option><option value="producao">Producao</option><option value="usuario">Usuario</option></select></label><button class="btn btn--primary" type="submit" :disabled="inviting">{{ inviting ? 'Enviando...' : 'Convidar usuario' }}</button></form>
          <div v-if="canManageMembers && membersLoading && !members.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="users" :size="29" /></div><h3>Carregando usuarios</h3><p>Consultando os membros autorizados deste tenant.</p></div></div>
          <div v-if="canManageMembers && !membersLoading && !members.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="users" :size="29" /></div><h3>Nenhum usuario encontrado</h3><p>Use o formulario acima para convidar o primeiro usuario.</p></div></div>
          <div v-if="canManageMembers && members.length" class="table-scroll" style="margin-top:16px">
            <table class="data-table">
              <thead><tr><th>Usuario</th><th>Perfil</th><th>Status</th><th>Criado em</th><th>Atualizado em</th><th>Acao</th></tr></thead>
              <tbody>
                <tr v-for="member in members" :key="member.userId">
                  <td><div class="table-product"><span class="avatar">{{ member.name.slice(0, 2).toUpperCase() }}</span><div><strong>{{ member.name }}</strong><small>{{ member.email }}</small></div></div></td>
                  <td><select v-model="memberDrafts[member.userId].role" class="select-compact" :disabled="!canEditMember(member)"><option v-for="role in roles" :key="role.value" :value="role.value">{{ role.label }}</option></select></td>
                  <td><select v-model="memberDrafts[member.userId].status" class="select-compact" :disabled="!canEditMember(member)"><option value="active">Ativo</option><option value="suspended">Suspenso</option></select><span :class="memberBadge(member.status)" style="margin-left:6px">{{ memberStatusLabel(member.status) }}</span></td><td>{{ member.createdAt ? new Date(member.createdAt).toLocaleString('pt-BR') : '-' }}</td><td>{{ member.updatedAt ? new Date(member.updatedAt).toLocaleString('pt-BR') : '-' }}</td>
                  <td><button class="btn btn--primary" :disabled="!canEditMember(member) || savingMemberId === member.userId" @click="saveMember(member.userId)">{{ savingMemberId === member.userId ? 'Salvando...' : 'Salvar' }}</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="canManageMembers" style="margin-top:20px"><h3 style="font-size:12px;margin:0 0 6px">Convites pendentes</h3><p style="color:var(--muted);font-size:10px;margin:0 0 10px">Cada link expira em 48 horas. Reenviar cancela o link anterior.</p><div v-if="!invitations.length" class="info-note"><UiIcon name="check" />Nenhum convite pendente.</div><div v-else class="table-scroll"><table class="data-table"><thead><tr><th>E-mail</th><th>Perfil</th><th>Expira em</th><th>Acoes</th></tr></thead><tbody><tr v-for="invitation in invitations" :key="invitation.id"><td>{{ invitation.email }}</td><td>{{ roles.find((role) => role.value === invitation.role)?.label || invitation.role }}</td><td>{{ new Date(invitation.expiresAt).toLocaleString('pt-BR') }}</td><td style="display:flex;gap:6px"><button class="btn" :disabled="Boolean(invitationActionId)" @click="resendPendingInvitation(invitation.id)">{{ invitationActionId === invitation.id ? 'Aguarde...' : 'Reenviar' }}</button><button class="btn btn--danger" :disabled="Boolean(invitationActionId)" @click="cancelPendingInvitation(invitation.id, invitation.email)">Cancelar</button></td></tr></tbody></table></div></div>
        </div>

        <div v-else-if="active === 'Seguranca'">
          <form class="settings-security-card" @submit.prevent="submitPasswordChange">
            <div><h2>Alterar senha</h2><p>Confirme sua senha atual. Os outros acessos serao encerrados automaticamente.</p></div>
            <div class="form-grid" style="margin-top:16px">
              <label class="field col-4"><span>Senha atual</span><input v-model="passwordForm.currentPassword" type="password" autocomplete="current-password" required></label>
              <label class="field col-4"><span>Nova senha</span><input v-model="passwordForm.newPassword" type="password" autocomplete="new-password" minlength="10" required placeholder="Minimo 10 caracteres"></label>
              <label class="field col-4"><span>Confirmar nova senha</span><input v-model="passwordForm.confirmation" type="password" autocomplete="new-password" minlength="10" required></label>
            </div>
            <button class="btn btn--primary" type="submit" :disabled="changingPassword">{{ changingPassword ? 'Alterando...' : 'Alterar senha' }}</button>
          </form>
          <hr style="border:0;border-top:1px solid var(--line);margin:24px 0">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h2>Sessoes ativas</h2><p>Encerre acessos que voce nao reconhece.</p></div><button class="btn" :disabled="sessionsLoading" @click="loadSessions">Atualizar</button></div>
          <div v-if="sessionsLoading" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="shield" :size="29" /></div><h3>Carregando sessoes</h3></div></div>
          <div v-else-if="!sessions.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="shield" :size="29" /></div><h3>Nenhuma sessao ativa</h3><p>Entre novamente para continuar usando o PrintFlow.</p></div></div>
          <div v-else><div class="table-scroll" style="margin-top:16px"><table class="data-table"><thead><tr><th>Dispositivo</th><th>IP</th><th>Inicio</th><th>Ultima atividade</th><th>Expira em</th><th>Acao</th></tr></thead><tbody><tr v-for="session in sessions" :key="session.sessionId"><td>{{ session.deviceLabel || 'Dispositivo nao identificado' }}</td><td>{{ session.ipMasked || '-' }}</td><td>{{ new Date(session.createdAt).toLocaleString('pt-BR') }}</td><td>{{ session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString('pt-BR') : '-' }}</td><td>{{ new Date(session.expiresAt).toLocaleString('pt-BR') }}</td><td><button class="btn btn--danger" @click="endSession(session.sessionId)">Encerrar</button></td></tr></tbody></table></div><button class="btn btn--danger" style="margin-top:16px" @click="endAllSessions">Encerrar todas as sessoes</button></div>
        </div>

        <div v-else-if="active === 'Backup e Dados'" class="settings-security-card">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h2>Backup e dados</h2><p>Exporte uma copia dos dados deste tenant. Credenciais, tokens e sessoes nao entram no arquivo.</p></div><button class="btn" :disabled="backupLoading" @click="loadBackup">Atualizar</button></div>
          <div v-if="backupLoading" class="empty-state"><div><h3>Verificando disponibilidade</h3></div></div>
          <template v-else>
            <div v-if="!backupStatus.export.enabled" class="info-note" style="margin-top:16px"><UiIcon name="shield" />Exportacao indisponivel: o ambiente nao possui banco de dados configurado. Configure `DATABASE_URL` no backend para habilitar backup e historico.</div>
            <div v-else style="margin-top:16px"><div class="info-note"><UiIcon name="check" />Exportacao habilitada em {{ backupStatus.export.format.toUpperCase() }}. Cada arquivo fica registrado na auditoria do tenant.</div><button class="btn btn--primary" style="margin-top:12px" :disabled="exportingData" @click="downloadTenantData">{{ exportingData ? 'Gerando...' : 'Exportar dados deste tenant' }}</button></div>
            <div v-if="exportHistory.length" class="table-scroll" style="margin-top:16px"><table class="data-table"><thead><tr><th>Arquivo</th><th>Formato</th><th>Registros</th><th>Status</th><th>Gerado em</th></tr></thead><tbody><tr v-for="item in exportHistory" :key="item.id"><td>{{ item.fileName }}</td><td>{{ item.format.toUpperCase() }}</td><td>{{ item.recordCount }}</td><td><span class="badge badge--green">{{ item.status }}</span></td><td>{{ new Date(item.createdAt).toLocaleString('pt-BR') }}</td></tr></tbody></table></div>
            <div v-else-if="backupStatus.export.enabled" class="info-note" style="margin-top:16px"><UiIcon name="info" />Nenhuma exportacao registrada para este tenant.</div>
            <div class="info-note" style="margin-top:16px"><UiIcon name="shield" />Restauracao automatica permanece bloqueada. {{ backupStatus.restore.reason }}</div>
            <form v-if="auth.user?.role === 'owner'" class="integration-section" @submit.prevent="submitAuditRequest"><h2>Solicitar auditoria excepcional</h2><p>O superadmin somente acessa eventos apos esta solicitacao formal.</p><label class="field"><span>Motivo</span><textarea v-model="auditDraft.reason" minlength="12" maxlength="500" required></textarea></label><div class="form-grid"><label class="field col-6"><span>Tipo de item</span><input v-model="auditDraft.entityType" maxlength="80"></label><label class="field col-6"><span>Identificador</span><input v-model="auditDraft.entityId" maxlength="160"></label></div><label class="field"><span>Senha atual</span><input v-model="auditDraft.currentPassword" type="password" required></label><button class="btn btn--primary" type="submit">Enviar solicitacao</button></form>
            <div v-if="auditRequests.length" class="table-scroll" style="margin-top:16px"><table class="data-table"><thead><tr><th>Protocolo</th><th>Status do chat</th><th>Decisao</th><th>Solicitada em</th></tr></thead><tbody><tr v-for="request in auditRequests" :key="request.id"><td>{{ request.id }}</td><td>{{ request.status }}</td><td>{{ request.decision || 'Aguardando' }}</td><td>{{ new Date(request.createdAt).toLocaleString('pt-BR') }}</td></tr></tbody></table></div>
          </template>
          <hr style="border:0;border-top:1px solid var(--line);margin:24px 0">
          <div><h2>Excluir empresa e dados</h2><p>Esta acao agenda a exclusao completa da empresa, usuarios, dados operacionais, arquivos e informacoes no banco em sete dias.</p></div>
          <form v-if="auth.user?.role === 'owner'" style="margin-top:16px" @submit.prevent="requestTenantDeletion">
            <div class="info-note" style="margin-bottom:16px"><UiIcon name="shield" />Ao entrar novamente no PrintFlow durante os 7 dias, a exclusao sera cancelada automaticamente. Esta confirmacao sera registrada em auditoria.</div>
            <label class="field"><span>Senha atual</span><input v-model="deletionForm.currentPassword" type="password" autocomplete="current-password" required></label>
            <label class="field" style="margin-top:12px"><span>Para confirmar, digite EXCLUIR</span><input v-model="deletionForm.confirmation" required autocomplete="off"></label>
            <label style="display:flex;gap:8px;align-items:flex-start;margin:16px 0"><input v-model="deletionForm.acknowledged" type="checkbox" required><span>Li e estou ciente de que um novo login cancelara esta solicitacao de exclusao.</span></label>
            <button class="btn btn--danger" type="submit" :disabled="deletingTenant">{{ deletingTenant ? 'Programando...' : 'Programar exclusao da empresa' }}</button>
          </form>
          <div v-else class="info-note"><UiIcon name="shield" />Somente o Owner pode solicitar a exclusao da empresa.</div>
        </div>

        <div v-else-if="active === 'Notificacoes'" class="settings-security-card"><div><h2>Notificacoes</h2><p>Suas preferencias sao salvas para este tenant.</p></div><div class="form-grid" style="margin-top:16px"><label class="field col-6"><span>Alertas por e-mail</span><input v-model="preferences.emailAlerts" type="checkbox"></label><label class="field col-6"><span>Alertas de producao</span><input v-model="preferences.productionAlerts" type="checkbox"></label><label class="field col-6"><span>Alertas de marketplace</span><input v-model="preferences.marketplaceAlerts" type="checkbox"></label><label class="field col-6"><span>Resumo diario</span><input v-model="preferences.dailySummary" type="checkbox"></label></div><button class="btn btn--primary" :disabled="savingSettings" @click="saveSettings">Salvar preferencias</button></div>
        <div v-else-if="active === 'Personalizacao'" class="settings-security-card">
          <div><h2>Identidade visual</h2><p>Personalize a marca exibida para todos os membros deste tenant.</p></div>
          <div class="branding-preview" :style="{ '--brand-preview': preferences.accentColor }">
            <AppLogo :logo-url="preferences.logoUrl" :brand-name="previewBrandName" />
            <span>Pre-visualizacao da barra lateral</span>
          </div>
          <div class="form-grid" style="margin-top:16px">
            <label class="field col-6"><span>Nome exibido</span><input v-model="preferences.brandName" maxlength="60" placeholder="Usa o nome da empresa se ficar vazio"></label>
            <label class="field col-6"><span>Cor de destaque</span><div class="color-field"><input v-model="preferences.accentColor" type="color" aria-label="Cor de destaque"><input v-model="preferences.accentColor" maxlength="7" pattern="^#[0-9A-Fa-f]{6}$" placeholder="#1768f2"></div></label>
            <label class="field col-12"><span>URL publica do logotipo</span><input v-model="preferences.logoUrl" type="url" placeholder="https://..."><small>Somente URLs HTTPS sao aceitas.</small></label>
          </div>
          <label class="switch-row" style="margin-top:16px"><span><strong>Layout compacto</strong><small>Reduz os espacamentos das paginas para exibir mais informacoes.</small></span><button type="button" class="switch" :class="{ active: preferences.compactLayout }" :aria-pressed="preferences.compactLayout" @click="preferences.compactLayout = !preferences.compactLayout"></button></label>
          <button class="btn btn--primary" style="margin-top:18px" :disabled="savingSettings" @click="saveSettings">{{ savingSettings ? 'Salvando...' : 'Salvar identidade visual' }}</button>
        </div>
        <div v-else-if="active === 'Integracoes'">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h2>Integracoes</h2><p>Visao operacional das conexoes, sem expor tokens, chaves ou senhas.</p></div><button class="btn" :disabled="integrationsLoading" @click="loadIntegrations">Atualizar</button></div>
          <div v-if="integrationsLoading" class="empty-state"><div><h3>Consultando integracoes</h3></div></div>
          <template v-else>
            <div class="integration-summary"><div class="stat-box"><small>Marketplaces</small><strong>{{ integrationsOverview.marketplaces.length }}</strong></div><div class="stat-box"><small>Agents</small><strong>{{ integrationsOverview.agents.length }}</strong></div><div class="stat-box"><small>E-mail</small><strong><span :class="integrationBadge(integrationsOverview.email.status)">{{ integrationStatus(integrationsOverview.email.status) }}</span></strong></div></div>
            <div class="integration-section"><div class="integration-section__head"><div><h3>Marketplaces</h3><p>Contas autorizadas e sincronizacao mais recente.</p></div><NuxtLink class="btn" to="/marketplaces">Gerenciar</NuxtLink></div><div v-if="integrationsOverview.marketplaces.length" class="table-scroll"><table class="data-table"><thead><tr><th>Plataforma</th><th>Conta</th><th>Status</th><th>Ultima sincronizacao</th></tr></thead><tbody><tr v-for="integration in integrationsOverview.marketplaces" :key="integration.id || integration.platform"><td>{{ integration.connectionName || integration.platform }}</td><td>{{ integration.accountExternalId || '-' }}</td><td><span :class="integrationBadge(integration.status)">{{ integrationStatus(integration.status) }}</span></td><td>{{ integration.lastSyncAt ? new Date(integration.lastSyncAt).toLocaleString('pt-BR') : '-' }}</td></tr></tbody></table></div><div v-else class="info-note"><UiIcon name="info" />Nenhum marketplace conectado.</div></div>
            <div class="integration-section"><div class="integration-section__head"><div><h3>PrintFlow Agent</h3><p>Computadores autorizados para conectar e controlar impressoras.</p></div><NuxtLink class="btn" to="/impressoras/nova">Gerenciar</NuxtLink></div><div v-if="integrationsOverview.agents.length" class="table-scroll"><table class="data-table"><thead><tr><th>Computador</th><th>Plataforma</th><th>Status</th><th>Ultimo contato</th></tr></thead><tbody><tr v-for="agent in integrationsOverview.agents" :key="agent.id"><td>{{ agent.name || agent.machineName }}</td><td>{{ agent.platform || '-' }}</td><td><span :class="integrationBadge(agent.status)">{{ integrationStatus(agent.status) }}</span></td><td>{{ agent.lastSeenAt ? new Date(agent.lastSeenAt).toLocaleString('pt-BR') : '-' }}</td></tr></tbody></table></div><div v-else class="info-note"><UiIcon name="info" />Nenhum Agent pareado.</div></div>
            <div class="integration-section"><div class="integration-section__head"><div><h3>Envio de e-mail</h3><p>Usado para convites e comunicacoes transacionais.</p></div><span :class="integrationBadge(integrationsOverview.email.status)">{{ integrationStatus(integrationsOverview.email.status) }}</span></div><div class="info-note"><UiIcon name="shield" />Provedor: {{ integrationsOverview.email.provider }}. Credenciais nunca sao exibidas nesta tela.</div></div>
          </template>
        </div>
      </section>

      <AuditRequestChat v-if="auth.user?.role === 'owner' && auditRequests[0]" :request-id="auditRequests[0].id" :status="auditRequests[0].status" />

      <aside class="settings-panel"><h2>Dados e Seguranca</h2><p>Os dados empresariais sensiveis sao protegidos no BackEnd e isolados por tenant.</p><ul class="check-list"><li><span><UiIcon name="check" :size="15" /></span>Permissoes aplicadas no servidor.</li><li><span><UiIcon name="check" :size="15" /></span>Exportacao registrada em auditoria.</li><li><span><UiIcon name="check" :size="15" /></span>Tokens de integracoes nao sao exibidos.</li></ul><button class="btn btn--wide" :disabled="exportingData" @click="downloadTenantData"><UiIcon name="download" />Exportar dados</button></aside>
    </div>

    <PanelCard v-if="active === 'Usuarios e Permissoes'" title="Funcoes de Usuario" subtitle="Os acessos sao aplicados pelo backend e registrados em auditoria." style="margin-top:12px">
      <div class="role-grid"><div v-for="(role, index) in roles" :key="role.value" class="role-card"><div class="role-card__icon" :style="index === 1 ? { color: '#1768f2', background: '#eef5ff' } : index === 2 ? { color: '#0da566', background: '#eaf9f1' } : index === 3 ? { color: '#f57c1f', background: '#fff3e9' } : {}"><UiIcon :name="index === 0 ? 'shield' : index === 2 ? 'money' : index === 3 ? 'box' : 'users'" /></div><h3>{{ role.label }}</h3><p>{{ role.description }}</p><ul style="margin:10px 0;padding-left:16px;color:var(--muted);font-size:10px"><li v-for="access in role.access" :key="access">{{ access }}</li></ul><span class="badge">{{ roleCount(role.value) }} usuarios</span></div></div>
    </PanelCard>
  </div>
</template>
