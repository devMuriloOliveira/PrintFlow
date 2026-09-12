<script setup lang="ts">
const props = withDefaults(defineProps<{ initialActive?: string; standalone?: boolean }>(), { initialActive: 'Empresa', standalone: false })
const { notify } = useUi()
const auth = useAuth()
const route = useRoute()
const { settings, updateSettings, lookupCompanyByCnpj, exportTenantData, listSettingsExports, loadBackupStatus, loadIntegrationsOverview, getStripeBilling, createStripeCheckout, changeStripeSubscriptionPlan, cancelStripeSubscription, resumeStripeSubscription } = useAppData()
const { members, loading: membersLoading, invitations, refreshMembers, updateMember, createInvitation, refreshInvitations, revokeInvitation, resendInvitation } = useTenantMembers()
const { requests: supportRequests, refresh: refreshSupportRequests, createRequest: createSupportRequest, cancelRequest: cancelSupportRequest, selectRequest: selectSupportRequest } = useSupportRequests()

const active = ref(props.initialActive)
const savingMemberId = ref('')
const inviting = ref(false)
const invitationActionId = ref('')
const sessions = ref<{ sessionId: string; createdAt: string; expiresAt: string }[]>([])
const sessionsLoading = ref(false)
const changingPassword = ref(false)
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmation: '' })
const mfaLoading = ref(false)
const mfaSetup = ref<{ secret: string; otpauthUri: string } | null>(null)
const mfaCode = ref('')
const mfaDisablePassword = ref('')
const mfaEnabled = ref(false)
const deletingTenant = ref(false)
const savingSettings = ref(false)
const companyLookupLoading = ref(false)
const exportingData = ref(false)
const exportHistory = ref<Array<{ id: string; fileName: string; format: string; recordCount: number; status: string; createdAt: string }>>([])
const backupLoading = ref(false)
const backupStatus = ref<{ databaseAvailable: boolean; export: { enabled: boolean; format: string; excludes: string[] }; restore: { enabled: boolean; reason: string } }>({ databaseAvailable: false, export: { enabled: false, format: 'json', excludes: [] }, restore: { enabled: false, reason: '' } })
const submittingSupport = ref(false)
const supportDraft = reactive({
  subject: props.initialActive === 'Ajuda e Suporte' ? String(route.query.assunto || '') : '',
  category: props.initialActive === 'Ajuda e Suporte' && ['privacy', 'account'].includes(String(route.query.categoria || '')) ? String(route.query.categoria) : 'technical',
  privacyRight: props.initialActive === 'Ajuda e Suporte' ? String(route.query.direito || '') : '',
  priority: 'normal', reason: '', entityType: '', entityId: '', currentPassword: ''
})
const supportFilter = ref<'open' | 'closed' | 'all'>('open')
const integrationsLoading = ref(false)
const integrationsOverview = ref<{ marketplaces: Array<{ id?: string; platform: string; connectionName: string; accountExternalId: string; status: string; lastSyncAt?: string | null }>; agents: Array<{ id: string; name: string; machineName: string; platform: string; status: string; lastSeenAt?: string | null }>; email: { provider: string; status: 'connected' | 'not_configured' } }>({ marketplaces: [], agents: [], email: { provider: 'Resend', status: 'not_configured' } })
const billingLoading = ref(false)
const creatingBillingLink = ref(false)
const subscriptionActionLoading = ref(false)
const stripeBilling = ref<Awaited<ReturnType<typeof getStripeBilling>> | null>(null)
const billingForm = reactive<{ billingCycle: 'monthly' | 'yearly' }>({ billingCycle: 'monthly' })
const deletionForm = reactive({ currentPassword: '', acknowledged: false, confirmation: '' })
const memberDrafts = reactive<Record<string, { role: string; status: string }>>({})
const invite = reactive({ email: '', role: 'usuario' as 'admin' | 'financeiro' | 'producao' | 'usuario' })
const tabs = [
  ['Empresa', 'building', 'Informacoes da empresa'],
  ['Financeiro', 'money', 'Impostos, moedas e contas'],
  ['Assinatura', 'money', 'Plano e pagamento da plataforma'],
  ['Notificacoes', 'bell', 'E-mails e alertas do sistema']
]
const sectionPresentation: Record<string, { title: string; subtitle: string; asideTitle: string; asideDescription: string; checks: string[] }> = {
  'Usuarios e Permissoes': { title: 'Usuários e permissões', subtitle: 'Gerencie a equipe, os perfis de acesso e os convites da empresa.', asideTitle: 'Governança de acesso', asideDescription: 'Cada pessoa recebe apenas as permissões necessárias para sua função.', checks: ['Papéis separados por responsabilidade.', 'Mudanças de acesso encerram sessões anteriores.', 'Convites possuem prazo de validade.'] },
  Seguranca: { title: 'Segurança da conta', subtitle: 'Proteja sua senha, segundo fator e sessões conectadas.', asideTitle: 'Proteção da conta', asideDescription: 'Controles para reduzir acessos indevidos e recuperar o controle da conta.', checks: ['Senhas protegidas e sessões revogáveis.', 'MFA disponível para perfis privilegiados.', 'Dispositivos podem ser encerrados individualmente.'] },
  Integracoes: { title: 'Integrações', subtitle: 'Acompanhe marketplaces, agentes e serviços conectados.', asideTitle: 'Conexões protegidas', asideDescription: 'A tela mostra o estado das integrações sem revelar credenciais.', checks: ['Tokens e segredos não são exibidos.', 'Conexões permanecem isoladas por empresa.', 'Última sincronização visível para diagnóstico.'] },
  'Backup e Dados': { title: 'Backup e dados', subtitle: 'Exporte os dados da empresa e acompanhe o histórico de arquivos.', asideTitle: 'Portabilidade e segurança', asideDescription: 'As exportações preservam a rastreabilidade sem incluir credenciais.', checks: ['Arquivos gerados ficam registrados.', 'Credenciais e sessões são excluídas.', 'Restauração permanece controlada.'] },
  'Privacidade e LGPD': { title: 'Privacidade e LGPD', subtitle: 'Acompanhe direitos dos titulares, exportações e solicitações.', asideTitle: 'Privacidade por padrão', asideDescription: 'Os controles preservam protocolo, finalidade e isolamento da empresa.', checks: ['Solicitações possuem protocolo e prazo.', 'Ações sensíveis exigem confirmação.', 'Histórico mínimo é preservado para auditoria.'] },
  'Ajuda e Suporte': { title: 'Ajuda e suporte', subtitle: 'Abra solicitações e acompanhe cada atendimento pelo protocolo.', asideTitle: 'Atendimento seguro', asideDescription: 'O suporte funciona dentro da conta autenticada e mantém o histórico da conversa.', checks: ['Conversas vinculadas ao solicitante.', 'Status e responsável ficam visíveis.', 'Atendimentos encerrados permanecem separados.'] }
}
const currentPresentation = computed(() => sectionPresentation[active.value])
const pageTitle = computed(() => props.standalone && currentPresentation.value ? currentPresentation.value.title : 'Configurações')
const pageSubtitle = computed(() => props.standalone && currentPresentation.value ? currentPresentation.value.subtitle : 'Gerencie os dados essenciais da empresa e da plataforma.')
const showContextExport = computed(() => ['Backup e Dados', 'Privacidade e LGPD'].includes(active.value))
const privacyExportGroups = ref<string[]>(['company', 'customers', 'catalog', 'production', 'financial', 'marketplaces'])
const privacyExportOptions = [
  { value: 'company', label: 'Cadastro e configurações da empresa', description: 'Dados cadastrais e preferências.' },
  { value: 'customers', label: 'Clientes e pedidos', description: 'Cadastros de clientes e pedidos vinculados.' },
  { value: 'catalog', label: 'Produtos e materiais', description: 'Produtos e filamentos.' },
  { value: 'production', label: 'Produção e impressoras', description: 'Fila de produção e equipamentos.' },
  { value: 'financial', label: 'Financeiro', description: 'Despesas, metas e divisões financeiras.' },
  { value: 'marketplaces', label: 'Marketplaces', description: 'Canais e conexões autorizadas, sem credenciais.' }
]
const privacyRequestRight = ref('correction')
const privacyRequestOptions = [
  { value: 'correction', label: 'Corrigir dados', subject: 'Solicitação de correção de dados' },
  { value: 'deletion', label: 'Solicitar eliminação', subject: 'Solicitação de eliminação de dados' },
  { value: 'opposition', label: 'Registrar oposição', subject: 'Solicitação de oposição ao tratamento' },
  { value: 'sharing', label: 'Consultar compartilhamentos', subject: 'Informações sobre compartilhamento de dados' }
]
const selectedPrivacyRequest = computed(() => privacyRequestOptions.find((option) => option.value === privacyRequestRight.value) || privacyRequestOptions[0])
const company = reactive({ name: '', cnpj: '', phone: '', email: '', address: '', district: '', city: '', state: '', zip: '', country: 'Brasil', currency: 'Real (R$)', timezone: '(GMT-03:00) Brasilia', kwh: 0, documentLocked: false, documentType: '' })
const companyDocumentKind = ref<'cpf' | 'cnpj'>('cnpj')
const companyDocumentLabel = computed(() => companyDocumentKind.value === 'cpf' ? 'CPF' : 'CNPJ')
const companyDocumentPlaceholder = computed(() => companyDocumentKind.value === 'cpf' ? '000.000.000-00' : '00.000.000/0000-00')
const companyDocumentMaxLength = computed(() => companyDocumentKind.value === 'cpf' ? 14 : 18)
const companyDocumentKindFrom = (value: string, stored = ''): 'cpf' | 'cnpj' => stored === 'cpf' || String(value || '').replace(/\D/g, '').length === 11 ? 'cpf' : 'cnpj'
const formatCompanyDocument = () => {
  const digits = String(company.cnpj || '').replace(/\D/g, '').slice(0, companyDocumentKind.value === 'cpf' ? 11 : 14)
  company.cnpj = companyDocumentKind.value === 'cpf'
    ? digits.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    : digits.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}
const selectCompanyDocumentKind = (kind: 'cpf' | 'cnpj') => {
  if (company.documentLocked || companyDocumentKind.value === kind) return
  companyDocumentKind.value = kind
  company.cnpj = ''
}
const preferences = reactive({ emailAlerts: true, productionAlerts: true, marketplaceAlerts: true, dailySummary: false, compactLayout: false, logoUrl: '', brandName: '', accentColor: '#1768f2', defaultMargin: 40, monthlyFixedCost: 0, plannedMonthlyUnits: 0 })
const previewBrandName = computed(() => preferences.brandName.trim() || company.name.trim() || 'PrintFlow 3D')
const roles = [
  { value: 'owner', label: 'Owner', description: 'Controle total da empresa, inclusive outros Owners.', access: ['Todas as configuracoes', 'Membros e Owners', 'Auditoria e dados'] },
  { value: 'admin', label: 'Administrador', description: 'Gerencia membros e a operacao, sem poderes reservados de Owner.', access: ['Catalogo e producao', 'Financeiro e marketplaces', 'Membros, sem Owners'] },
  { value: 'financeiro', label: 'Financeiro', description: 'Acessa vendas, despesas e informacoes financeiras.', access: ['Vendas e despesas', 'Clientes', 'Consulta de catalogo'] },
  { value: 'producao', label: 'Producao', description: 'Gerencia producao, impressoras e catalogo.', access: ['Produtos e filamentos', 'Impressoras e fila', 'Pedidos e clientes'] },
  { value: 'usuario', label: 'Usuario', description: 'Acesso operacional basico.', access: ['Consulta de catalogo', 'Consulta de pedidos', 'Consulta de producao'] }
]

const canManageMembers = computed(() => ['owner', 'admin'].includes(String(auth.user.value?.role || '')))
const isOwner = computed(() => auth.user.value?.role === 'owner')
const isPrivileged = computed(() => ['owner', 'platform_super_admin'].includes(String(auth.user.value?.role || auth.user.value?.platformRole || '')))
const selectedBillingPlan = computed(() => stripeBilling.value?.plans[0] || null)
const billingPlanValue = computed(() => selectedBillingPlan.value?.[billingForm.billingCycle] || 0)
const billingActionLoading = computed(() => creatingBillingLink.value || subscriptionActionLoading.value)
const currency = (value: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const subscriptionStatus = (status: string) => ({ trial: 'Em teste', active: 'Ativa', past_due: 'Em atraso', grace: 'Em carencia', paused: 'Pausada', courtesy: 'Cortesia', cancelled: 'Cancelada', ended: 'Encerrada' }[status] || status)
const supportCategoryLabel = (category: string) => ({ technical: 'Suporte tecnico', financial: 'Financeiro', integration: 'Integracoes', account: 'Conta e permissoes', data_backup: 'Backup e dados', privacy: 'Privacidade e LGPD', audit: 'Auditoria excepcional' }[category] || category)
const supportStatusLabel = (status: string) => ({ pending: 'Aberta', under_review: 'Em atendimento', approved: 'Aprovada', rejected: 'Rejeitada', cancelled: 'Cancelada', closed: 'Encerrada', expired: 'Expirada' }[status] || status)
const supportStatusClass = (status: string) => ['closed', 'cancelled', 'expired'].includes(status) ? 'badge badge--gray' : status === 'pending' ? 'badge badge--orange' : 'badge'
const filteredSupportRequests = computed(() => supportRequests.value.filter((request) => supportFilter.value === 'all' || (supportFilter.value === 'open' ? !['closed', 'cancelled', 'expired'].includes(request.status) : ['closed', 'cancelled', 'expired'].includes(request.status))))
const supportStats = computed(() => ({ open: supportRequests.value.filter((request) => !['closed', 'cancelled', 'expired'].includes(request.status)).length, waiting: supportRequests.value.filter((request) => request.status === 'pending').length, closed: supportRequests.value.filter((request) => ['closed', 'cancelled', 'expired'].includes(request.status)).length }))
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
    country: String(value.country || 'Brasil'), currency: String(value.currency || 'Real (R$)'), timezone: String(value.timezone || '(GMT-03:00) Brasilia'), kwh: Number(value.kwh || 0), documentLocked: Boolean(value.documentLocked), documentType: String(value.documentType || '')
  })
  companyDocumentKind.value = companyDocumentKindFrom(company.cnpj, company.documentType)
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

const downloadTenantData = async (groups: string[] = ['all']) => {
  if (!groups.length) return notify('Selecione pelo menos um grupo de dados para exportar.')
  exportingData.value = true
  try {
    const blob = await exportTenantData(groups)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `printflow-dados-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    notify('Arquivo CSV gerado e registrado na auditoria.')
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
  } catch (error: any) {
    notify(error?.data?.error || 'Nao foi possivel verificar a disponibilidade do backup.')
  } finally { backupLoading.value = false }
}
const loadSupport = async () => {
  try {
    await refreshSupportRequests()
  } catch (error: any) {
    notify(error?.data?.error || 'Nao foi possivel carregar suas solicitacoes.')
  }
}
const submitSupportRequest = async () => {
  submittingSupport.value = true
  try {
    const created = await createSupportRequest({
      subject: supportDraft.subject, category: supportDraft.category, privacyRight: supportDraft.category === 'privacy' ? supportDraft.privacyRight : undefined, priority: supportDraft.priority, reason: supportDraft.reason,
      currentPassword: supportDraft.category === 'audit' ? supportDraft.currentPassword : undefined,
      scope: supportDraft.category === 'audit' ? { entityType: supportDraft.entityType, entityId: supportDraft.entityId } : {}
    })
    Object.assign(supportDraft, { subject: '', category: 'technical', privacyRight: '', priority: 'normal', reason: '', entityType: '', entityId: '', currentPassword: '' })
    notify(`Solicitacao criada. Protocolo ${created.id}`)
  } catch (error: any) {
    notify(error?.data?.error || 'Nao foi possivel criar a solicitacao.')
  } finally { submittingSupport.value = false }
}
const cancelSupport = async (request: any) => {
  if (!window.confirm(`Cancelar a solicitacao ${request.id}?`)) return
  try { await cancelSupportRequest(request.id); notify('Solicitacao cancelada.') } catch (error: any) { notify(error?.data?.error || 'Nao foi possivel cancelar a solicitacao.') }
}

const loadIntegrations = async () => {
  integrationsLoading.value = true
  try { integrationsOverview.value = await loadIntegrationsOverview() } catch (error: any) { notify(error?.data?.error || 'Nao foi possivel carregar as integracoes.') } finally { integrationsLoading.value = false }
}
const loadStripeBilling = async () => {
  if (!isOwner.value) return
  billingLoading.value = true
  try {
    stripeBilling.value = await getStripeBilling()
    if (selectedBillingPlan.value && !selectedBillingPlan.value[billingForm.billingCycle === 'monthly' ? 'monthlyEnabled' : 'yearlyEnabled']) {
      billingForm.billingCycle = selectedBillingPlan.value.monthlyEnabled ? 'monthly' : 'yearly'
    }
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel consultar a assinatura.')
  } finally { billingLoading.value = false }
}
const startStripeCheckout = async (cycle: 'monthly' | 'yearly' = billingForm.billingCycle) => {
  billingForm.billingCycle = cycle
  const amount = selectedBillingPlan.value?.[cycle] || 0
  if (!selectedBillingPlan.value || amount <= 0) return notify('A assinatura ainda nao possui um valor configurado.')
  const current = stripeBilling.value?.subscription
  if (current && ['trial', 'active', 'past_due', 'grace'].includes(current.status)) {
    if (current.billingCycle === cycle) return notify('Sua assinatura ja esta ativa neste ciclo de cobranca.')
    if (!window.confirm(`Alterar para o plano ${cycle === 'yearly' ? 'anual' : 'mensal'}? A Stripe calculara a cobranca proporcional da alteracao.`)) return
    subscriptionActionLoading.value = true
    try {
      stripeBilling.value = await changeStripeSubscriptionPlan(cycle)
      notify('Plano alterado. A Stripe aplicou a cobranca proporcional, quando aplicavel.')
    } catch (error: any) {
      notify(error?.data?.error || error?.message || 'Nao foi possivel alterar o plano.')
    } finally { subscriptionActionLoading.value = false }
    return
  }
  creatingBillingLink.value = true
  try {
    const result = await createStripeCheckout({ planCode: selectedBillingPlan.value.code, billingCycle: cycle })
    window.location.assign(result.url)
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel gerar o link de pagamento.')
  } finally { creatingBillingLink.value = false }
}

const lookupCompany = async () => {
  if (company.documentLocked || companyDocumentKind.value !== 'cnpj') return
  companyLookupLoading.value = true
  try {
    const result = await lookupCompanyByCnpj(company.cnpj)
    Object.assign(company, {
      name: result.name || company.name,
      phone: result.phone || company.phone,
      email: result.email || company.email,
      address: result.address || company.address,
      district: result.district || company.district,
      city: result.city || company.city,
      state: result.state || company.state,
      zip: result.zip || company.zip
    })
    notify(`Dados de ${result.legalName || result.name || 'empresa'} preenchidos. Revise antes de salvar.`)
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel consultar o CNPJ.')
  } finally {
    companyLookupLoading.value = false
  }
}
const startMfaSetup = async () => {
  mfaLoading.value = true
  try { mfaSetup.value = await auth.setupMfa(); mfaCode.value = ''; notify('Escaneie o QR Code ou use a chave no seu aplicativo autenticador.') } catch (error: any) { notify(error?.data?.error || 'Nao foi possivel iniciar o MFA.') } finally { mfaLoading.value = false }
}
const confirmMfaSetup = async () => {
  if (!mfaSetup.value || !mfaCode.value.trim()) return notify('Informe o codigo do aplicativo autenticador.')
  mfaLoading.value = true
  try { await auth.enableMfa(mfaSetup.value.secret, mfaCode.value); mfaEnabled.value = true; mfaSetup.value = null; mfaCode.value = ''; notify('MFA ativado para este perfil.') } catch (error: any) { notify(error?.data?.error || 'Codigo MFA invalido.') } finally { mfaLoading.value = false }
}
const turnOffMfa = async () => {
  if (!mfaDisablePassword.value) return notify('Informe sua senha atual para desativar o MFA.')
  mfaLoading.value = true
  try { await auth.disableMfa(mfaDisablePassword.value); mfaEnabled.value = false; mfaDisablePassword.value = ''; notify('MFA desativado.') } catch (error: any) { notify(error?.data?.error || 'Nao foi possivel desativar o MFA.') } finally { mfaLoading.value = false }
}
const changeStripeCancellation = async (cancelAtPeriodEnd: boolean) => {
  if (!stripeBilling.value?.subscription || subscriptionActionLoading.value) return
  const message = cancelAtPeriodEnd
    ? 'A assinatura continuará ativa até o fim do período atual. Deseja programar o cancelamento?'
    : 'Deseja continuar a assinatura e remover o cancelamento programado?'
  if (!window.confirm(message)) return
  subscriptionActionLoading.value = true
  try {
    stripeBilling.value = cancelAtPeriodEnd ? await cancelStripeSubscription() : await resumeStripeSubscription()
    notify(cancelAtPeriodEnd ? 'Cancelamento programado para o fim do período.' : 'Assinatura retomada com sucesso.')
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel atualizar a assinatura.')
  } finally { subscriptionActionLoading.value = false }
}

const integrationStatus = (status: string) => ({ connected: 'Conectado', active: 'Conectado', online: 'Online', not_configured: 'Nao configurado', offline: 'Offline', revoked: 'Revogado' }[status] || status)
const integrationBadge = (status: string) => ['connected', 'active', 'online'].includes(status) ? 'badge badge--green' : status === 'not_configured' || status === 'revoked' ? 'badge badge--orange' : 'badge badge--gray'
const openPrivacySupport = (subject = 'Solicitacao de privacidade e LGPD', privacyRight = 'access') => {
  if (props.standalone) {
    void navigateTo({ path: '/configuracoes/suporte', query: { categoria: 'privacy', direito: privacyRight, assunto: subject } })
    return
  }
  supportDraft.category = 'privacy'
  supportDraft.privacyRight = privacyRight
  supportDraft.priority = 'normal'
  supportDraft.subject = subject
  supportDraft.reason = ''
  active.value = 'Ajuda e Suporte'
}
const openBackupSettings = () => { active.value = 'Backup e Dados' }

// Evita repetir chamadas caras ao alternar rapidamente entre as seções.
// Os botões "Atualizar" continuam permitindo uma nova consulta explícita.
const sectionLoadedAt = reactive<Record<string, number>>({})
const sectionRequests = reactive<Record<string, Promise<unknown> | null>>({})
const sectionCacheTtlMs = 15_000
const loadSectionOnce = (key: string, loader: () => Promise<unknown>, force = false) => {
  if (!force && sectionLoadedAt[key] && Date.now() - sectionLoadedAt[key] < sectionCacheTtlMs) return Promise.resolve()
  if (sectionRequests[key]) return sectionRequests[key] as Promise<unknown>
  const request = loader().then(() => { sectionLoadedAt[key] = Date.now() }).finally(() => { sectionRequests[key] = null })
  sectionRequests[key] = request
  return request
}
const openDocumentChangeRequest = () => void navigateTo({ path: '/configuracoes/suporte', query: { categoria: 'account', assunto: 'Solicitação de troca de CPF para CNPJ' } })

watch(active, (tab) => {
  if (tab === 'Usuarios e Permissoes') void loadSectionOnce('members', loadMembers)
  if (tab === 'Seguranca') {
    void loadSectionOnce('sessions', loadSessions)
    if (isPrivileged.value) void loadSectionOnce('mfa-status', async () => { mfaEnabled.value = (await auth.mfaStatus()).enabled })
  }
  if (tab === 'Backup e Dados') void loadSectionOnce('backup', loadBackup)
  if (tab === 'Integracoes') void loadSectionOnce('integrations', loadIntegrations)
  if (tab === 'Assinatura') void loadSectionOnce('billing', loadStripeBilling)
  if (tab === 'Ajuda e Suporte') void loadSectionOnce('support', loadSupport)
}, { immediate: true })

watch(members, syncMemberDrafts, { immediate: true })
watch(settings, syncSettings, { immediate: true })
watch(() => supportDraft.category, (category) => {
  if (category === 'audit') supportDraft.priority = 'high'
  if (category === 'privacy' && !supportDraft.privacyRight) supportDraft.privacyRight = 'access'
  if (category !== 'privacy') supportDraft.privacyRight = ''
})
</script>

<template>
  <div>
    <PageHeader :title="pageTitle" :subtitle="pageSubtitle" />

    <div class="settings-layout" :class="{ 'settings-layout--standalone': standalone }">
      <ConfiguracoesConfigSettingsNav v-if="!standalone" :tabs="tabs" :active="active" @select="active = $event" />

      <section class="settings-panel settings-panel--content">
        <NuxtLink v-if="standalone" class="settings-page-back" to="/configuracoes"><UiIcon name="chevron" :size="14" />Central de configurações</NuxtLink>
        <div v-if="active === 'Empresa'">
          <div style="display:flex;justify-content:space-between;gap:12px">
            <div><h2>Informacoes da Empresa</h2><p>Atualize os dados principais da sua empresa.</p></div>
            <button class="btn btn--primary" :disabled="savingSettings" @click="saveSettings">{{ savingSettings ? 'Salvando...' : 'Salvar alteracoes' }}</button>
          </div>
          <div class="form-grid">
            <div class="field col-7"><label>Nome da Empresa *</label><input v-model="company.name"></div><div class="field col-5"><label>{{ companyDocumentLabel }} <small v-if="company.documentLocked">· documento registrado</small></label><div v-if="!company.documentLocked" class="settings-document-kind" role="group" aria-label="Tipo de documento"><button type="button" class="settings-document-kind__item" :class="{ 'settings-document-kind__item--active': companyDocumentKind === 'cpf' }" @click="selectCompanyDocumentKind('cpf')">CPF</button><button type="button" class="settings-document-kind__item" :class="{ 'settings-document-kind__item--active': companyDocumentKind === 'cnpj' }" @click="selectCompanyDocumentKind('cnpj')">CNPJ</button></div><div class="settings-document-control"><input v-model="company.cnpj" inputmode="numeric" :maxlength="companyDocumentMaxLength" :placeholder="companyDocumentPlaceholder" :disabled="company.documentLocked" @input="formatCompanyDocument"><button v-if="!company.documentLocked && companyDocumentKind === 'cnpj'" class="btn" type="button" :disabled="companyLookupLoading || !company.cnpj.trim()" @click="lookupCompany">{{ companyLookupLoading ? 'Consultando...' : 'Buscar CNPJ' }}</button></div><small v-if="!company.documentLocked">Contas existentes podem permanecer sem documento. Ao salvar um CPF ou CNPJ, ele ficará bloqueado.</small><small v-if="company.documentLocked && company.documentType === 'cpf'">Para substituir o CPF por CNPJ, <button class="link-button" type="button" @click="openDocumentChangeRequest">abra uma solicitação</button>.</small></div><div class="field col-6"><label>Telefone</label><input v-model="company.phone"></div><div class="field col-6"><label>E-mail *</label><input v-model="company.email" type="email"></div><div class="field col-8"><label>Endereco</label><input v-model="company.address"></div><div class="field col-4"><label>Bairro</label><input v-model="company.district"></div><div class="field col-4"><label>Cidade</label><input v-model="company.city"></div><div class="field col-2"><label>Estado</label><input v-model="company.state"></div><div class="field col-3"><label>CEP</label><input v-model="company.zip"></div><div class="field col-3"><label>Pais</label><input v-model="company.country"></div><div class="field col-12"><label>Fuso Horario</label><input v-model="company.timezone"></div>
          </div>
        </div>

        <div v-else-if="active === 'Financeiro'">
          <h2>Parametros Financeiros</h2><p>Esses valores sao usados como padrao em novos calculos de produto.</p>
          <div class="form-grid"><label class="field col-4"><span>Moeda</span><select v-model="company.currency"><option value="Real (R$)">Real (R$)</option><option value="Dolar (US$)">Dolar (US$)</option><option value="Euro (EUR)">Euro (EUR)</option></select></label><label class="field col-4"><span>Custo do kWh</span><input v-model.number="company.kwh" type="number" min="0" step=".01"></label><label class="field col-4"><span>Margem padrao (%)</span><input v-model.number="preferences.defaultMargin" type="number" min="0" step=".1"></label><label class="field col-6"><span>Custos fixos mensais</span><input v-model.number="preferences.monthlyFixedCost" type="number" min="0" step=".01"></label><label class="field col-6"><span>Unidades planejadas por mes</span><input v-model.number="preferences.plannedMonthlyUnits" type="number" min="0" step="1"></label></div>
          <div class="info-note" style="margin:16px 0"><UiIcon name="info" />O custo fixo e rateado por unidade somente em novos calculos. Produtos ja salvos preservam a composicao financeira original.</div>
          <button class="btn btn--primary" :disabled="savingSettings" @click="saveSettings">{{ savingSettings ? 'Salvando...' : 'Salvar parametros' }}</button>
        </div>

        <div v-else-if="active === 'Assinatura'" class="settings-security-card">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h2>Assinatura da plataforma</h2><p>Escolha a cobranca mensal ou anual e conclua o pagamento em uma pagina segura do Stripe.</p></div><button v-if="isOwner" class="btn" :disabled="billingLoading" @click="loadStripeBilling">Atualizar</button></div>
          <div v-if="!isOwner" class="info-note" style="margin-top:16px"><UiIcon name="shield" />Somente o Owner pode consultar ou alterar a assinatura da empresa.</div>
          <div v-else-if="billingLoading" class="empty-state"><div><h3>Consultando assinatura</h3></div></div>
          <template v-else-if="stripeBilling">
            <div v-if="stripeBilling.subscription" class="billing-subscription-summary">
              <div class="billing-subscription-summary__status"><UiIcon name="check" /><div><span>Assinatura atual</span><strong>{{ stripeBilling.subscription.planName || stripeBilling.subscription.planCode }} · {{ subscriptionStatus(stripeBilling.subscription.status) }}</strong></div></div>
              <div v-if="stripeBilling.subscription.currentPeriodEnd" class="billing-subscription-summary__date"><span>{{ stripeBilling.subscription.status === 'trial' ? 'Teste termina em' : 'Próxima cobrança em' }}</span><strong>{{ new Date(stripeBilling.subscription.currentPeriodEnd).toLocaleDateString('pt-BR') }}</strong><small v-if="stripeBilling.subscription.status !== 'trial'">{{ currency(stripeBilling.plans[0]?.[stripeBilling.subscription.billingCycle === 'yearly' ? 'yearly' : 'monthly'] || 0) }} · {{ stripeBilling.subscription.billingCycle === 'yearly' ? 'anual' : 'mensal' }}</small></div>
              <div class="billing-subscription-summary__actions"><span v-if="stripeBilling.subscription.cancelAtPeriodEnd" class="badge badge--orange">Cancelamento programado</span><button v-if="stripeBilling.subscription.cancelAtPeriodEnd" class="btn" :disabled="subscriptionActionLoading" @click="changeStripeCancellation(false)">{{ subscriptionActionLoading ? 'Atualizando...' : 'Continuar assinatura' }}</button><button v-else-if="['trial', 'active', 'past_due', 'grace'].includes(stripeBilling.subscription.status)" class="btn btn--danger" :disabled="subscriptionActionLoading" @click="changeStripeCancellation(true)">{{ subscriptionActionLoading ? 'Atualizando...' : 'Cancelar assinatura' }}</button></div>
            </div>
            <div v-if="stripeBilling.checkout" class="info-note" style="margin-top:16px"><UiIcon name="info" />Ha um link de pagamento pendente criado em {{ new Date(stripeBilling.checkout.createdAt).toLocaleString('pt-BR') }}. <a :href="stripeBilling.checkout.url" rel="noopener noreferrer">Abrir link</a>.</div>
            <div v-if="!stripeBilling.configured" class="info-note" style="margin-top:16px"><UiIcon name="shield" />O Stripe ainda precisa do segredo de webhook no ambiente antes de gerar um checkout.</div>
            <form v-else class="integration-section" style="margin-top:16px" @submit.prevent="startStripeCheckout">
              <div class="integration-section__head"><div><h3>Assinatura PrintFlow</h3><p>Os dados do meio de pagamento sao informados diretamente ao Stripe e nao ficam no PrintFlow.</p></div><span class="badge badge--orange">Producao</span></div>
              <div v-if="selectedBillingPlan" class="billing-plans">
                <article class="billing-plan-card">
                  <div class="billing-plan-card__title"><h3>Mensal</h3><span class="billing-plan-card__caption">Flexível, cancele quando quiser.</span></div>
                  <div class="billing-plan-card__price"><small>R$</small>{{ currency(selectedBillingPlan.monthly || 0).replace('R$', '').trim() }}<span>/mês</span></div>
                  <ul class="billing-plan-card__features"><li>Calculadora 3D completa</li><li>Pedidos, clientes e produtos</li><li>Impressoras conectadas e fila de impressão</li><li>Filamentos, despesas e metas</li></ul>
                  <button class="billing-plan-card__button" type="button" :disabled="billingActionLoading || (selectedBillingPlan?.monthly || 0) <= 0" @click="startStripeCheckout('monthly')">{{ billingActionLoading ? 'Atualizando...' : (stripeBilling?.subscription?.billingCycle === 'monthly' ? 'Plano mensal atual' : 'Começar teste grátis') }}</button>
                </article>
                <article class="billing-plan-card billing-plan-card--featured">
                  <span class="billing-plan-card__ribbon">Melhor custo-benefício</span>
                  <div class="billing-plan-card__title"><h3>Anual</h3><span class="billing-plan-card__caption">Tudo do plano mensal com economia.</span></div>
                  <div class="billing-plan-card__price"><small>12x R$</small>{{ currency((selectedBillingPlan.yearly || 0) / 12).replace('R$', '').trim() }}<span>/mês</span></div>
                  <div class="billing-plan-card__saving">De {{ currency((selectedBillingPlan.monthly || 0) * 12) }} <strong>por {{ currency(selectedBillingPlan.yearly || 0) }}/ano</strong></div>
                  <ul class="billing-plan-card__features"><li>Tudo do plano mensal</li><li>Marketplaces integrados e taxas por canal</li><li>Equipe com convites e permissões</li><li>Relatórios avançados e exportações</li></ul>
                  <button class="billing-plan-card__button billing-plan-card__button--featured" type="button" :disabled="billingActionLoading || (selectedBillingPlan?.yearly || 0) <= 0" @click="startStripeCheckout('yearly')">{{ billingActionLoading ? 'Atualizando...' : (stripeBilling?.subscription?.billingCycle === 'yearly' ? 'Plano anual atual' : 'Assinar com 7 dias grátis') }} <span aria-hidden="true">→</span></button>
                </article>
              </div>
              <div v-if="selectedBillingPlan" class="billing-payment-note"><UiIcon name="wallet" /> Cartão para iniciar o teste — só cobramos se você continuar.</div>
            </form>
          </template>
        </div>

        <div v-else-if="active === 'Usuarios e Permissoes'">
          <div class="settings-section-heading">
            <div><h2>Usuarios e Permissoes</h2><p>Altere o acesso de membros ja cadastrados nesta empresa.</p></div>
            <button class="btn" :disabled="membersLoading" @click="loadMembers">Atualizar</button>
          </div>

          <div v-if="!canManageMembers" class="info-note"><UiIcon name="shield" />Somente Owner e Administrador podem gerenciar acessos.</div>
          <form v-if="canManageMembers" class="filters" style="margin-top:16px" @submit.prevent="sendInvitation"><label class="field field--search"><span>E-mail do novo usuario</span><input v-model="invite.email" type="email" required placeholder="usuario@empresa.com"></label><label class="field"><span>Perfil inicial</span><select v-model="invite.role"><option value="admin">Administrador</option><option value="financeiro">Financeiro</option><option value="producao">Producao</option><option value="usuario">Usuario</option></select></label><button class="btn btn--primary" type="submit" :disabled="inviting">{{ inviting ? 'Enviando...' : 'Convidar usuario' }}</button></form>
          <div v-if="canManageMembers && membersLoading && !members.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="users" :size="29" /></div><h3>Carregando usuarios</h3><p>Consultando os membros autorizados desta empresa.</p></div></div>
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
          <PanelCard title="Funcoes de Usuario" subtitle="Os acessos sao protegidos e registrados no historico de seguranca." style="margin-top:20px">
            <LazyConfigRoleGrid :roles="roles" :members="members" />
          </PanelCard>
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
          <div v-if="isPrivileged" class="settings-security-card" style="margin-top:16px">
            <div><h2>Autenticacao em dois fatores (MFA)</h2><p>Adicione um codigo do seu aplicativo autenticador para proteger perfis privilegiados.</p></div>
            <div v-if="mfaEnabled" class="info-note" style="margin-top:16px"><UiIcon name="check" />MFA ativo neste perfil. Para desativar, confirme sua senha atual.</div>
            <div v-else-if="mfaSetup" style="margin-top:16px">
              <div class="info-note"><UiIcon name="shield" /><div>Cadastre esta chave no seu aplicativo autenticador: <code>{{ mfaSetup.secret }}</code><br><small>{{ mfaSetup.otpauthUri }}</small></div></div>
              <div class="form-grid" style="margin-top:12px"><label class="field col-4"><span>Codigo de confirmacao</span><input v-model="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required></label></div>
              <button class="btn btn--primary" :disabled="mfaLoading" @click="confirmMfaSetup">{{ mfaLoading ? 'Confirmando...' : 'Ativar MFA' }}</button>
            </div>
            <div v-else style="margin-top:16px"><button class="btn btn--primary" :disabled="mfaLoading" @click="startMfaSetup">{{ mfaLoading ? 'Gerando...' : 'Configurar MFA' }}</button></div>
            <div v-if="mfaEnabled" class="form-grid" style="margin-top:12px"><label class="field col-4"><span>Senha atual</span><input v-model="mfaDisablePassword" type="password" autocomplete="current-password"></label><div><button class="btn btn--danger" :disabled="mfaLoading" @click="turnOffMfa">Desativar MFA</button></div></div>
          </div>
          <hr style="border:0;border-top:1px solid var(--line);margin:24px 0">
          <div class="settings-section-heading"><div><h2>Sessoes ativas</h2><p>Encerre acessos que voce nao reconhece.</p></div><button class="btn" :disabled="sessionsLoading" @click="loadSessions">Atualizar</button></div>
          <div v-if="sessionsLoading" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="shield" :size="29" /></div><h3>Carregando sessoes</h3></div></div>
          <div v-else-if="!sessions.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="shield" :size="29" /></div><h3>Nenhuma sessao ativa</h3><p>Entre novamente para continuar usando o PrintFlow.</p></div></div>
          <div v-else><div class="table-scroll" style="margin-top:16px"><table class="data-table"><thead><tr><th>Dispositivo</th><th>IP</th><th>Inicio</th><th>Ultima atividade</th><th>Expira em</th><th>Acao</th></tr></thead><tbody><tr v-for="session in sessions" :key="session.sessionId"><td>{{ session.deviceLabel || 'Dispositivo nao identificado' }}</td><td>{{ session.ipMasked || '-' }}</td><td>{{ new Date(session.createdAt).toLocaleString('pt-BR') }}</td><td>{{ session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString('pt-BR') : '-' }}</td><td>{{ new Date(session.expiresAt).toLocaleString('pt-BR') }}</td><td><button class="btn btn--danger" @click="endSession(session.sessionId)">Encerrar</button></td></tr></tbody></table></div><button class="btn btn--danger" style="margin-top:16px" @click="endAllSessions">Encerrar todas as sessoes</button></div>
        </div>

        <div v-else-if="active === 'Backup e Dados'" class="settings-security-card">
          <div class="settings-section-heading"><div><h2>Backup e dados</h2><p>Exporte uma copia dos dados da sua empresa. Credenciais, integracoes e sessoes nao entram no arquivo.</p></div><button class="btn" :disabled="backupLoading" @click="loadBackup">Atualizar</button></div>
          <div v-if="backupLoading" class="empty-state"><div><h3>Verificando disponibilidade</h3></div></div>
          <template v-else>
            <div v-if="!backupStatus.export.enabled" class="info-note" style="margin-top:16px"><UiIcon name="shield" />Exportacao indisponivel no momento. Tente novamente mais tarde ou entre em contato com a equipe de suporte.</div>
            <div v-else style="margin-top:16px"><div class="info-note"><UiIcon name="check" />Exportacao habilitada em {{ backupStatus.export.format.toUpperCase() }}. Cada arquivo fica registrado no historico de seguranca da empresa.</div><button class="btn btn--primary" style="margin-top:12px" :disabled="exportingData" @click="downloadTenantData">{{ exportingData ? 'Gerando...' : 'Exportar dados da empresa' }}</button></div>
            <div v-if="exportHistory.length" class="table-scroll" style="margin-top:16px"><table class="data-table"><thead><tr><th>Arquivo</th><th>Formato</th><th>Registros</th><th>Status</th><th>Gerado em</th></tr></thead><tbody><tr v-for="item in exportHistory" :key="item.id"><td>{{ item.fileName }}</td><td>{{ item.format.toUpperCase() }}</td><td>{{ item.recordCount }}</td><td><span class="badge badge--green">{{ item.status }}</span></td><td>{{ new Date(item.createdAt).toLocaleString('pt-BR') }}</td></tr></tbody></table></div>
            <div v-else-if="backupStatus.export.enabled" class="info-note" style="margin-top:16px"><UiIcon name="info" />Nenhuma exportacao registrada para esta empresa.</div>
            <div class="info-note" style="margin-top:16px"><UiIcon name="shield" />Restauracao automatica permanece bloqueada. {{ backupStatus.restore.reason }}</div>
          </template>
          <hr style="border:0;border-top:1px solid var(--line);margin:24px 0">
          <div><h2>Excluir empresa e dados</h2><p>Esta acao agenda a exclusao completa da empresa, usuarios, dados operacionais, arquivos e informacoes no banco em sete dias.</p></div>
          <form v-if="isOwner" style="margin-top:16px" @submit.prevent="requestTenantDeletion">
            <div class="info-note" style="margin-bottom:16px"><UiIcon name="shield" />Ao entrar novamente no PrintFlow durante os 7 dias, a exclusao sera cancelada automaticamente. Esta confirmacao sera registrada em auditoria.</div>
            <label class="field"><span>Senha atual</span><input v-model="deletionForm.currentPassword" type="password" autocomplete="current-password" required></label>
            <label class="field" style="margin-top:12px"><span>Para confirmar, digite EXCLUIR</span><input v-model="deletionForm.confirmation" required autocomplete="off"></label>
            <label style="display:flex;gap:8px;align-items:flex-start;margin:16px 0"><input v-model="deletionForm.acknowledged" type="checkbox" required><span>Li e estou ciente de que um novo login cancelara esta solicitacao de exclusao.</span></label>
            <button class="btn btn--danger" type="submit" :disabled="deletingTenant">{{ deletingTenant ? 'Programando...' : 'Programar exclusao da empresa' }}</button>
          </form>
          <div v-else class="info-note"><UiIcon name="shield" />Somente o Owner pode solicitar a exclusao da empresa.</div>
        </div>

        <div v-else-if="active === 'Privacidade e LGPD'" class="settings-security-card">
          <div><h2>Privacidade e LGPD</h2><p>Escolha os dados que deseja exportar ou o direito que deseja exercer.</p></div>
          <div class="info-note" style="margin-top:16px"><UiIcon name="info" />As exportações são geradas em CSV, sem credenciais, tokens ou sessões. A seleção limita o arquivo aos grupos escolhidos.</div>

          <form class="integration-section" @submit.prevent="downloadTenantData(privacyExportGroups)">
            <div class="integration-section__head"><div><h3>Exportar dados da empresa</h3><p>Selecione exatamente quais grupos devem entrar no arquivo CSV.</p></div><UiIcon name="download" /></div>
            <div class="privacy-export-options">
              <label v-for="option in privacyExportOptions" :key="option.value" class="privacy-export-option">
                <input v-model="privacyExportGroups" type="checkbox" :value="option.value">
                <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
              </label>
            </div>
            <div class="privacy-export-actions"><span>{{ privacyExportGroups.length }} grupo(s) selecionado(s)</span><button class="btn btn--primary" type="submit" :disabled="exportingData || !privacyExportGroups.length"><UiIcon name="download" />{{ exportingData ? 'Gerando CSV...' : 'Exportar seleção em CSV' }}</button></div>
          </form>

          <div class="integration-section">
            <div class="integration-section__head"><div><h3>Solicitar outro direito</h3><p>Correção, eliminação, oposição e informações de compartilhamento continuam rastreáveis por protocolo.</p></div><UiIcon name="shield" /></div>
            <div class="form-grid"><label class="field col-8"><span>O que você precisa?</span><select v-model="privacyRequestRight"><option v-for="option in privacyRequestOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><div class="privacy-request-action col-4"><button class="btn" @click="openPrivacySupport(selectedPrivacyRequest.subject, selectedPrivacyRequest.value)">Continuar solicitação</button></div></div>
          </div>

          <div class="integration-section">
            <div class="integration-section__head"><div><h3>Acompanhar solicitações</h3><p>Veja protocolos, status, prazo e converse com a equipe responsável.</p></div><button class="btn" @click="openPrivacySupport()">Abrir solicitações</button></div>
          </div>

          <div class="integration-section">
            <div class="integration-section__head"><div><h3>Documentos e transparência</h3><p>Os documentos públicos serão disponibilizados assim que o controlador e o canal oficial forem cadastrados.</p></div><UiIcon name="receipt" /></div>
            <div class="info-note"><UiIcon name="info" />Retenção operacional definida: solicitações LGPD encerradas são anonimizadas após 7 dias, preservando protocolo, status e trilha de auditoria. Finalidades, bases legais, operadores, transferências internacionais e contato do encarregado ainda precisam ser cadastrados pelo controlador.</div>
          </div>
        </div>

        <div v-else-if="active === 'Notificacoes'" class="settings-security-card"><div><h2>Notificacoes</h2><p>Defina quais alertas operacionais devem aparecer para a sua equipe no sistema.</p></div><div class="info-note" style="margin-top:16px"><UiIcon name="info" />O envio automático de resumo diário por e-mail ainda não está disponível; por isso ele não é oferecido como preferência.</div><div class="form-grid" style="margin-top:16px"><label class="field col-6"><span>Alertas de producao</span><input v-model="preferences.productionAlerts" type="checkbox"></label><label class="field col-6"><span>Alertas de marketplace</span><input v-model="preferences.marketplaceAlerts" type="checkbox"></label></div><button class="btn btn--primary" :disabled="savingSettings" @click="saveSettings">Salvar preferencias</button></div>
        <div v-else-if="active === 'Integracoes'">
          <div class="settings-section-heading"><div><h2>Integracoes</h2><p>Visao operacional das conexoes, sem expor tokens, chaves ou senhas.</p></div><button class="btn" :disabled="integrationsLoading" @click="loadIntegrations">Atualizar</button></div>
          <div v-if="integrationsLoading" class="empty-state"><div><h3>Consultando integracoes</h3></div></div>
          <template v-else>
            <div class="integration-summary"><div class="stat-box"><small>Marketplaces</small><strong>{{ integrationsOverview.marketplaces.length }}</strong></div><div class="stat-box"><small>Agents</small><strong>{{ integrationsOverview.agents.length }}</strong></div><div class="stat-box"><small>E-mail</small><strong><span :class="integrationBadge(integrationsOverview.email.status)">{{ integrationStatus(integrationsOverview.email.status) }}</span></strong></div></div>
            <div class="integration-section"><div class="integration-section__head"><div><h3>Marketplaces</h3><p>Contas autorizadas e sincronizacao mais recente.</p></div><NuxtLink class="btn" to="/marketplaces">Gerenciar</NuxtLink></div><div v-if="integrationsOverview.marketplaces.length" class="table-scroll"><table class="data-table"><thead><tr><th>Plataforma</th><th>Conta</th><th>Status</th><th>Ultima sincronizacao</th></tr></thead><tbody><tr v-for="integration in integrationsOverview.marketplaces" :key="integration.id || integration.platform"><td>{{ integration.connectionName || integration.platform }}</td><td>{{ integration.accountExternalId || '-' }}</td><td><span :class="integrationBadge(integration.status)">{{ integrationStatus(integration.status) }}</span></td><td>{{ integration.lastSyncAt ? new Date(integration.lastSyncAt).toLocaleString('pt-BR') : '-' }}</td></tr></tbody></table></div><div v-else class="info-note"><UiIcon name="info" />Nenhum marketplace conectado.</div></div>
            <div class="integration-section"><div class="integration-section__head"><div><h3>PrintFlow Agent</h3><p>Computadores autorizados para conectar e controlar impressoras.</p></div><NuxtLink class="btn" to="/impressoras/nova">Gerenciar</NuxtLink></div><div v-if="integrationsOverview.agents.length" class="table-scroll"><table class="data-table"><thead><tr><th>Computador</th><th>Plataforma</th><th>Status</th><th>Ultimo contato</th></tr></thead><tbody><tr v-for="agent in integrationsOverview.agents" :key="agent.id"><td>{{ agent.name || agent.machineName }}</td><td>{{ agent.platform || '-' }}</td><td><span :class="integrationBadge(agent.status)">{{ integrationStatus(agent.status) }}</span></td><td>{{ agent.lastSeenAt ? new Date(agent.lastSeenAt).toLocaleString('pt-BR') : '-' }}</td></tr></tbody></table></div><div v-else class="info-note"><UiIcon name="info" />Nenhum Agent pareado.</div></div>
            <div class="integration-section"><div class="integration-section__head"><div><h3>Envio de e-mail</h3><p>Usado para convites e comunicacoes transacionais.</p></div><span :class="integrationBadge(integrationsOverview.email.status)">{{ integrationStatus(integrationsOverview.email.status) }}</span></div><div class="info-note"><UiIcon name="shield" />Provedor: {{ integrationsOverview.email.provider }}. Credenciais nunca sao exibidas nesta tela.</div></div>
          </template>
        </div>

        <div v-else-if="active === 'Ajuda e Suporte'" class="settings-security-card">
          <div class="settings-section-heading"><div><h2>Ajuda e Suporte</h2><p>Abra uma solicitação, acompanhe o prazo e converse com a equipe pelo protocolo.</p></div><span class="badge badge--green">Canal autenticado</span></div>
          <div class="support-overview" style="margin-top:18px"><div class="stat-box"><small>Em andamento</small><strong>{{ supportStats.open }}</strong><span>Solicitações abertas</span></div><div class="stat-box"><small>Aguardando triagem</small><strong>{{ supportStats.waiting }}</strong><span>A equipe analisará em breve</span></div><div class="stat-box"><small>Encerradas</small><strong>{{ supportStats.closed }}</strong><span>Histórico preservado</span></div></div>
          <div class="info-note" style="margin-top:16px"><UiIcon name="info" /><div><strong>Como funciona</strong><br>Descreva o problema com o impacto e o resultado esperado. A equipe responderá no chat deste protocolo; solicitações de privacidade e LGPD permanecem rastreáveis separadamente.</div></div>
          <form class="integration-section" @submit.prevent="submitSupportRequest">
            <div class="form-grid">
              <label class="field col-8"><span>Assunto</span><input v-model="supportDraft.subject" minlength="4" maxlength="120" required placeholder="Resuma o que voce precisa"></label>
              <label class="field col-4"><span>Categoria</span><select v-model="supportDraft.category"><option value="technical">Suporte tecnico</option><option value="financial">Financeiro</option><option value="integration">Integracoes</option><option value="account">Conta e permissoes</option><option value="data_backup">Backup e dados</option><option value="privacy">Privacidade e LGPD</option><option value="audit">Auditoria excepcional</option></select></label>
              <label v-if="supportDraft.category === 'privacy'" class="field col-4"><span>Direito relacionado</span><select v-model="supportDraft.privacyRight" required><option value="access">Consulta e acesso</option><option value="correction">Correcao</option><option value="deletion">Eliminacao</option><option value="opposition">Oposicao</option><option value="portability">Portabilidade</option><option value="sharing">Compartilhamento</option></select></label>
              <label class="field col-4"><span>Prioridade</span><select v-model="supportDraft.priority" :disabled="supportDraft.category === 'audit'"><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select></label>
              <label class="field col-12"><span>Descricao detalhada</span><textarea v-model="supportDraft.reason" minlength="12" maxlength="1000" required placeholder="Descreva o problema, impacto e resultado esperado"></textarea></label>
              <template v-if="supportDraft.category === 'audit'">
                <div class="col-12 info-note"><UiIcon name="shield" />Auditorias podem envolver dados sensiveis e exigem confirmacao de identidade, escopo e aprovacao da equipe responsavel.</div>
                <label class="field col-6"><span>Tipo de item</span><input v-model="supportDraft.entityType" maxlength="80" required></label>
                <label class="field col-6"><span>Identificador</span><input v-model="supportDraft.entityId" maxlength="160" required></label>
                <label class="field col-6"><span>Senha atual</span><input v-model="supportDraft.currentPassword" type="password" autocomplete="current-password" required></label>
              </template>
            </div>
            <button class="btn btn--primary" type="submit" :disabled="submittingSupport">{{ submittingSupport ? 'Criando...' : 'Criar solicitacao' }}</button>
          </form>

          <div class="settings-section-heading settings-section-heading--spaced"><div><h2>Minhas solicitações</h2><p>Somente você e a equipe de suporte acessam estas conversas.</p></div><div class="settings-section-heading__actions"><select v-model="supportFilter" class="select-compact" aria-label="Filtrar solicitações"><option value="open">Em andamento</option><option value="closed">Encerradas</option><option value="all">Todas</option></select><button class="btn" @click="loadSupport">Atualizar</button></div></div>
          <div v-if="!filteredSupportRequests.length" class="empty-state"><div><h3>{{ supportFilter === 'closed' ? 'Nenhuma solicitação encerrada' : 'Nenhuma solicitação em andamento' }}</h3><p>{{ supportFilter === 'closed' ? 'O histórico aparecerá aqui quando um atendimento for encerrado.' : 'Use o formulário acima para iniciar um atendimento.' }}</p></div></div>
          <div v-else class="table-scroll" style="margin-top:12px"><table class="data-table"><thead><tr><th>Protocolo</th><th>Assunto</th><th>Tipo</th><th>Status</th><th>Prazo</th><th>Responsável</th><th>Criada em</th><th>Ação</th></tr></thead><tbody><tr v-for="request in filteredSupportRequests" :key="request.id"><td><strong class="support-protocol">{{ request.id }}</strong></td><td>{{ request.subject }}<small v-if="request.requestKind === 'privacy'">{{ request.privacyRight || 'Direito do titular' }}</small></td><td>{{ request.requestKind === 'privacy' ? 'LGPD' : supportCategoryLabel(request.category) }}</td><td><span :class="supportStatusClass(request.status)">{{ supportStatusLabel(request.status) }}</span></td><td>{{ request.dueAt ? new Date(request.dueAt).toLocaleDateString('pt-BR') : '-' }}</td><td>{{ request.responsibleName || 'Ainda não atribuído' }}</td><td>{{ new Date(request.createdAt).toLocaleString('pt-BR') }}</td><td style="display:flex;gap:6px"><button class="btn" @click="selectSupportRequest(request.id)">Abrir chat</button><button v-if="request.status === 'pending'" class="btn btn--danger" @click="cancelSupport(request)">Cancelar</button></td></tr></tbody></table></div>
        </div>
      </section>

      <aside class="settings-panel settings-context-panel">
        <template v-if="standalone && currentPresentation">
          <span class="settings-context-panel__eyebrow"><UiIcon name="shield" :size="14" /> Controle da empresa</span>
          <h2>{{ currentPresentation.asideTitle }}</h2>
          <p>{{ currentPresentation.asideDescription }}</p>
          <ul class="check-list settings-context-panel__checks">
            <li v-for="check in currentPresentation.checks" :key="check"><span><UiIcon name="check" :size="15" /></span>{{ check }}</li>
          </ul>
          <button v-if="showContextExport" class="btn btn--wide" :disabled="exportingData" @click="downloadTenantData"><UiIcon name="download" />{{ exportingData ? 'Gerando arquivo...' : 'Exportar dados' }}</button>
        </template>
        <template v-else>
          <span class="settings-context-panel__eyebrow"><UiIcon name="shield" :size="14" /> Proteção ativa</span>
          <h2>Dados e segurança</h2>
          <p>Os dados da sua empresa são protegidos e mantidos separados de outras empresas.</p>
          <ul class="check-list settings-context-panel__checks"><li><span><UiIcon name="check" :size="15" /></span>Permissões aplicadas com segurança.</li><li><span><UiIcon name="check" :size="15" /></span>Exportações registradas no histórico.</li><li><span><UiIcon name="check" :size="15" /></span>Credenciais de integrações não são exibidas.</li></ul>
          <NuxtLink class="btn btn--wide" to="/configuracoes/backup"><UiIcon name="download" />Backup e dados</NuxtLink>
          <NuxtLink class="btn btn--wide" to="/configuracoes/privacidade"><UiIcon name="shield" />Privacidade e LGPD</NuxtLink>
        </template>
      </aside>
    </div>

  </div>
</template>
