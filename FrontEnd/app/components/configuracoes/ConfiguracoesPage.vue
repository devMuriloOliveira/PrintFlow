<script setup lang="ts">
const props = withDefaults(defineProps<{ initialActive?: string; standalone?: boolean }>(), { initialActive: 'Empresa', standalone: false })
const { notify } = useUi()
const auth = useAuth()
const route = useRoute()
const { settings, updateSettings, lookupCompanyByCnpj, exportTenantData, listSettingsExports, loadBackupStatus, loadIntegrationsOverview, getStripeBilling, createStripeCheckout, cancelStripeSubscription, resumeStripeSubscription, createSupportRequest } = useAppData()
const { members, loading: membersLoading, invitations, refreshMembers, updateMember, createInvitation, refreshInvitations, revokeInvitation, resendInvitation } = useTenantMembers()

const active = ref(String(route.query.billing || '') ? 'Assinatura' : props.initialActive)
const savingMemberId = ref('')
const inviting = ref(false)
const invitationActionId = ref('')
const sessions = ref<{ sessionId: string; createdAt: string; expiresAt: string; lastSeenAt: string; deviceLabel: string; ipMasked: string }[]>([])
const sessionsLoading = ref(false)
const endingSessionGroupKey = ref('')
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
const submittedSupportProtocol = ref('')
const supportDraft = reactive({
  subject: props.initialActive === 'Ajuda e Suporte' ? String(route.query.assunto || '') : '',
  category: props.initialActive === 'Ajuda e Suporte' && ['privacy', 'account'].includes(String(route.query.categoria || '')) ? String(route.query.categoria) : 'technical',
  privacyRight: props.initialActive === 'Ajuda e Suporte' ? String(route.query.direito || '') : '',
  reason: ''
})
const integrationsLoading = ref(false)
const integrationsOverview = ref<{ marketplaces: Array<{ id?: string; platform: string; connectionName: string; accountExternalId: string; status: string; lastSyncAt?: string | null }>; agents: Array<{ id: string; name: string; machineName: string; platform: string; status: string; lastSeenAt?: string | null }>; email: { provider: string; status: 'connected' | 'not_configured' } }>({ marketplaces: [], agents: [], email: { provider: 'Resend', status: 'not_configured' } })
const billingLoading = ref(false)
const creatingBillingLink = ref(false)
const subscriptionActionLoading = ref(false)
const stripeBilling = ref<Awaited<ReturnType<typeof getStripeBilling>> | null>(null)
const stripeReturnRetries = ref(0)
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
  'Backup e Dados': { title: 'Backup e dados', subtitle: 'Gere cópias operacionais e acompanhe cada exportação da empresa.', asideTitle: 'Cópias rastreáveis', asideDescription: 'Esta área separa exportação, restauração e exclusão para evitar ações ambíguas.', checks: ['Arquivos gerados ficam registrados.', 'Credenciais e sessões não são exportadas.', 'Exclusão permanece restrita ao Owner.'] },
  'Privacidade e LGPD': { title: 'Privacidade e LGPD', subtitle: 'Exporte dados da empresa e registre solicitações de titulares no fluxo correto.', asideTitle: 'Fluxos separados e rastreáveis', asideDescription: 'Exportações operacionais, direitos do titular e exclusão da empresa seguem controles próprios.', checks: ['Exportações respeitam a seleção informada.', 'Direitos são registrados com protocolo.', 'Exclusão da empresa exige confirmação do Owner.'] },
  'Ajuda e Suporte': { title: 'Ajuda e suporte', subtitle: 'Envie uma mensagem diretamente para a equipe do PrintFlow.', asideTitle: 'Contato protegido', asideDescription: 'Sua mensagem permanece vinculada à sua conta e chega ao painel administrativo da equipe.', checks: ['Identidade confirmada pela conta.', 'Mensagem registrada com protocolo.', 'Nenhum aplicativo externo é aberto.'] }
}
const currentPresentation = computed(() => sectionPresentation[active.value])
const pageTitle = computed(() => props.standalone && currentPresentation.value ? currentPresentation.value.title : 'Configurações')
const pageSubtitle = computed(() => props.standalone && currentPresentation.value ? currentPresentation.value.subtitle : 'Gerencie os dados essenciais da empresa e da plataforma.')
const canExportCompanyData = computed(() => ['owner', 'admin'].includes(String(auth.user.value?.role || '')))
const latestExport = computed(() => exportHistory.value[0] || null)
const privacyExportGroups = ref<string[]>(['company', 'customers', 'catalog', 'production', 'financial', 'marketplaces'])
const privacyExportOptions = [
  { value: 'company', label: 'Cadastro e configurações da empresa', description: 'Dados cadastrais e preferências.' },
  { value: 'customers', label: 'Clientes e pedidos', description: 'Cadastros de clientes e pedidos vinculados.' },
  { value: 'catalog', label: 'Produtos e materiais', description: 'Produtos e filamentos.' },
  { value: 'production', label: 'Produção e impressoras', description: 'Fila de produção e equipamentos.' },
  { value: 'financial', label: 'Financeiro', description: 'Despesas, metas e divisões financeiras.' },
  { value: 'marketplaces', label: 'Marketplaces', description: 'Canais e conexões autorizadas, sem credenciais.' }
]
const privacyRequestRight = ref('access')
const privacyRequestOptions = [
  { value: 'access', label: 'Confirmar e acessar', description: 'Confirmar o tratamento e solicitar acesso aos dados pessoais.', subject: 'Solicitação de confirmação e acesso a dados', icon: 'eye' },
  { value: 'correction', label: 'Corrigir dados', description: 'Atualizar dados incompletos, incorretos ou desatualizados.', subject: 'Solicitação de correção de dados', icon: 'edit' },
  { value: 'deletion', label: 'Eliminar ou anonimizar', description: 'Pedir análise de eliminação, bloqueio ou anonimização.', subject: 'Solicitação de eliminação ou anonimização de dados', icon: 'close' },
  { value: 'opposition', label: 'Registrar oposição', description: 'Questionar um tratamento realizado em situação específica.', subject: 'Solicitação de oposição ao tratamento', icon: 'alert' },
  { value: 'portability', label: 'Solicitar portabilidade', description: 'Pedir uma cópia portável dos dados pessoais aplicáveis.', subject: 'Solicitação de portabilidade de dados pessoais', icon: 'download' },
  { value: 'sharing', label: 'Consultar compartilhamentos', description: 'Saber com quais entidades os dados foram compartilhados.', subject: 'Informações sobre compartilhamento de dados', icon: 'users' }
]
const selectedPrivacyRequest = computed(() => privacyRequestOptions.find((option) => option.value === privacyRequestRight.value) || privacyRequestOptions[0])
const allPrivacyExportGroupsSelected = computed(() => privacyExportGroups.value.length === privacyExportOptions.length)
const selectAllPrivacyExportGroups = () => { privacyExportGroups.value = privacyExportOptions.map(option => option.value) }
const clearPrivacyExportGroups = () => { privacyExportGroups.value = [] }
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
const activeMemberCount = computed(() => members.value.filter(member => member.status === 'active').length)
const suspendedMemberCount = computed(() => members.value.filter(member => member.status === 'suspended').length)
const ownerCount = computed(() => members.value.filter(member => member.role === 'owner' && member.status === 'active').length)
const roleLabel = (value: string) => roles.find(role => role.value === value)?.label || value
const availableRolesFor = (member: { role: string }) => isOwner.value || member.role === 'owner' ? roles : roles.filter(role => role.value !== 'owner')
const memberHasChanges = (member: { userId: string; role: string; status: string }) => {
  const draft = memberDrafts[member.userId]
  return Boolean(draft && (draft.role !== member.role || draft.status !== member.status))
}
const memberInitials = (name: string) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase()
const formatMemberDate = (value?: string) => value ? new Date(value).toLocaleDateString('pt-BR') : 'Não registrado'
const isPrivileged = computed(() => ['owner', 'platform_super_admin'].includes(String(auth.user.value?.role || auth.user.value?.platformRole || '')))
const currentSessionId = computed(() => {
  try {
    const payload = String(auth.token.value || '').split('.')[1]
    if (!payload) return ''
    const parsed = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')))
    return String(parsed.sid || '')
  } catch { return '' }
})
const groupedSessions = computed(() => {
  const groups = new Map<string, {
    key: string
    sessionIds: string[]
    deviceLabel: string
    ipMasked: string
    createdAt: string
    lastSeenAt: string
    expiresAt: string
    containsCurrent: boolean
  }>()

  for (const session of sessions.value) {
    const device = sessionDevice(session.deviceLabel)
    const key = `${device.browser}|${device.system}|${session.ipMasked || 'unknown'}`
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        key,
        sessionIds: [session.sessionId],
        deviceLabel: session.deviceLabel,
        ipMasked: session.ipMasked,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        containsCurrent: session.sessionId === currentSessionId.value
      })
      continue
    }

    existing.sessionIds.push(session.sessionId)
    existing.containsCurrent ||= session.sessionId === currentSessionId.value
    if (new Date(session.lastSeenAt).getTime() > new Date(existing.lastSeenAt).getTime()) {
      existing.lastSeenAt = session.lastSeenAt
      existing.deviceLabel = session.deviceLabel
    }
    if (new Date(session.createdAt).getTime() < new Date(existing.createdAt).getTime()) existing.createdAt = session.createdAt
    if (new Date(session.expiresAt).getTime() > new Date(existing.expiresAt).getTime()) existing.expiresAt = session.expiresAt
  }

  return [...groups.values()].sort((left, right) => new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime())
})
const passwordRules = computed(() => [
  { label: '10 caracteres ou mais', met: passwordForm.newPassword.length >= 10 },
  { label: 'Letra maiúscula e minúscula', met: /[A-Z]/.test(passwordForm.newPassword) && /[a-z]/.test(passwordForm.newPassword) },
  { label: 'Número', met: /[0-9]/.test(passwordForm.newPassword) },
  { label: 'Caractere especial', met: /[^A-Za-z0-9]/.test(passwordForm.newPassword) }
])
const passwordReady = computed(() => Boolean(passwordForm.currentPassword) && passwordRules.value.every(rule => rule.met) && passwordForm.newPassword === passwordForm.confirmation)
const securityStatus = computed(() => isPrivileged.value && mfaEnabled.value
  ? { label: 'Proteção reforçada', detail: 'MFA ativo', tone: 'success' }
  : { label: 'Proteção básica', detail: isPrivileged.value ? 'MFA recomendado' : 'Senha e sessões ativas', tone: 'warning' })
const selectedBillingPlan = computed(() => stripeBilling.value?.plans[0] || null)
const billingActionLoading = computed(() => creatingBillingLink.value || subscriptionActionLoading.value)
const currency = (value: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fixedCostPerUnitPreview = computed(() => {
  const monthlyCost = Number(preferences.monthlyFixedCost || 0)
  const plannedUnits = Number(preferences.plannedMonthlyUnits || 0)
  return plannedUnits > 0 ? monthlyCost / plannedUnits : 0
})
const subscriptionStatus = (status: string) => ({ trial: 'Trial histórico', active: 'Ativa', past_due: 'Em atraso', grace: 'Em carência', paused: 'Pausada', courtesy: 'Cortesia', cancelled: 'Cancelada', ended: 'Encerrada' }[status] || status)
const hasProSubscription = computed(() => stripeBilling.value?.subscription?.planCode !== 'free' && ['trial', 'active', 'past_due', 'grace', 'courtesy'].includes(stripeBilling.value?.subscription?.status || ''))
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
  if (!member || !memberHasChanges(member)) return
  const action = member.status === 'active' && draft.status === 'suspended'
    ? `Suspender ${member.name}?`
    : `Atualizar o acesso de ${member.name}?`
  if (!window.confirm(`${action} As sessões ativas desta pessoa serão encerradas.`)) return

  savingMemberId.value = userId
  try {
    await updateMember(userId, {
      role: draft.role as 'owner' | 'admin' | 'financeiro' | 'producao' | 'usuario',
      status: draft.status as 'active' | 'suspended'
    })
    notify('Acesso do usuário atualizado. As sessões anteriores foram encerradas.')
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
const endSessionGroup = async (group: typeof groupedSessions.value[number]) => {
  const hiddenSessions = group.sessionIds.length - 1
  const message = group.containsCurrent
    ? `Encerrar este dispositivo${hiddenSessions ? ` e suas ${group.sessionIds.length} sessões` : ''}? Você precisará entrar novamente.`
    : `Encerrar este dispositivo${hiddenSessions ? ` e suas ${group.sessionIds.length} sessões` : ''}?`
  if (!window.confirm(message)) return
  endingSessionGroupKey.value = group.key
  try {
    const orderedIds = [...group.sessionIds].sort((left, right) => Number(left === currentSessionId.value) - Number(right === currentSessionId.value))
    for (const sessionId of orderedIds) await auth.revokeSession(sessionId)
    if (group.containsCurrent) { auth.clearSession(); await navigateTo('/login'); return }
    const removed = new Set(group.sessionIds)
    sessions.value = sessions.value.filter(session => !removed.has(session.sessionId))
    notify(group.sessionIds.length > 1 ? 'Sessões deste dispositivo encerradas.' : 'Sessão encerrada.')
  } catch (error: any) {
    await loadSessions()
    notify(error?.data?.error || 'Não foi possível encerrar todas as sessões deste dispositivo.')
  } finally { endingSessionGroupKey.value = '' }
}
const endAllSessions = async () => {
  if (!window.confirm('Encerrar todas as sessões, inclusive esta? Você precisará entrar novamente.')) return
  try { await auth.revokeAllSessions(); auth.clearSession(); await navigateTo('/login') } catch (error: any) { notify(error?.data?.error || 'Não foi possível encerrar as sessões.') }
}

function sessionDevice(label: string) {
  const value = String(label || '')
  const browser = value.includes('Edg/') ? 'Microsoft Edge' : value.includes('Firefox/') ? 'Firefox' : value.includes('Chrome/') ? 'Google Chrome' : value.includes('Safari/') ? 'Safari' : 'Navegador'
  const system = value.includes('Windows') ? 'Windows' : value.includes('Android') ? 'Android' : /iPhone|iPad/.test(value) ? 'iOS' : value.includes('Mac OS') ? 'macOS' : value.includes('Linux') ? 'Linux' : 'Sistema não identificado'
  return { browser, system }
}
const formatSecurityDate = (value?: string | null) => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Não registrado'

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
const submitSupportRequest = async () => {
  submittingSupport.value = true
  submittedSupportProtocol.value = ''
  try {
    const created = await createSupportRequest({
      subject: supportDraft.subject,
      category: supportDraft.category,
      privacyRight: supportDraft.category === 'privacy' ? supportDraft.privacyRight : undefined,
      priority: 'normal',
      reason: supportDraft.reason,
      scope: {}
    })
    submittedSupportProtocol.value = created.protocolNumber || created.id
    supportDraft.subject = ''
    supportDraft.reason = ''
    notify('Mensagem enviada para a equipe de suporte.')
  } catch (error: any) {
    notify(error?.data?.error || 'Nao foi possivel enviar a mensagem.')
  } finally { submittingSupport.value = false }
}
const formatSupportProtocol = (value: string) => String(value || '').replace(/(\d{4})(?=\d)/g, '$1 ')

const loadIntegrations = async () => {
  integrationsLoading.value = true
  try { integrationsOverview.value = await loadIntegrationsOverview() } catch (error: any) { notify(error?.data?.error || 'Nao foi possivel carregar as integracoes.') } finally { integrationsLoading.value = false }
}
const loadStripeBilling = async () => {
  if (!isOwner.value) return
  billingLoading.value = true
  try {
    stripeBilling.value = await getStripeBilling()
    const billingReturn = String(route.query.billing || '')
    if (billingReturn === 'cancelled' && stripeReturnRetries.value === 0) notify('Checkout cancelado. Nenhuma cobrança foi criada.')
    if (billingReturn === 'success') {
      if (hasProSubscription.value) notify('Assinatura confirmada com sucesso.')
      else if (stripeReturnRetries.value < 3 && import.meta.client) {
        if (stripeReturnRetries.value === 0) notify('Pagamento recebido. Confirmando sua assinatura...')
        stripeReturnRetries.value += 1
        window.setTimeout(() => { void loadStripeBilling() }, 2_000)
      }
    }
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel consultar a assinatura.')
  } finally { billingLoading.value = false }
}
const startStripeCheckout = async () => {
  const cycle = 'monthly'
  const amount = selectedBillingPlan.value?.monthly || 0
  if (!selectedBillingPlan.value || amount <= 0) return notify('A assinatura ainda nao possui um valor configurado.')
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
  if (!window.confirm('Desativar a verificação em duas etapas reduzirá a proteção desta conta. Deseja continuar?')) return
  mfaLoading.value = true
  try { await auth.disableMfa(mfaDisablePassword.value); mfaEnabled.value = false; mfaDisablePassword.value = ''; notify('MFA desativado.') } catch (error: any) { notify(error?.data?.error || 'Nao foi possivel desativar o MFA.') } finally { mfaLoading.value = false }
}
const copyMfaSecret = async () => {
  if (!mfaSetup.value?.secret) return
  try { await navigator.clipboard.writeText(mfaSetup.value.secret); notify('Chave de configuração copiada.') } catch { notify('Não foi possível copiar. Selecione a chave manualmente.') }
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

const integrationStatus = (status: string) => ({ connected: 'Conectado', active: 'Conectado', online: 'Online', pending: 'Pendente', error: 'Com falha', disconnected: 'Desconectado', not_configured: 'Não configurado', offline: 'Offline', revoked: 'Revogado' }[status] || status)
const integrationBadge = (status: string) => ['connected', 'active', 'online'].includes(status) ? 'badge badge--green' : ['pending', 'error', 'disconnected', 'not_configured', 'revoked'].includes(status) ? 'badge badge--orange' : 'badge badge--gray'
const healthyIntegrationStatus = (status: string) => ['connected', 'active', 'online'].includes(String(status || '').toLowerCase())
const connectedMarketplaceCount = computed(() => integrationsOverview.value.marketplaces.filter(item => healthyIntegrationStatus(item.status)).length)
const onlineAgentCount = computed(() => integrationsOverview.value.agents.filter(item => healthyIntegrationStatus(item.status)).length)
const integrationsAttentionCount = computed(() =>
  integrationsOverview.value.marketplaces.filter(item => !healthyIntegrationStatus(item.status)).length +
  integrationsOverview.value.agents.filter(item => !healthyIntegrationStatus(item.status)).length
)
const integrationOverviewStatus = computed(() => {
  if (integrationsAttentionCount.value) return { label: `${integrationsAttentionCount.value} ${integrationsAttentionCount.value === 1 ? 'conexão requer' : 'conexões requerem'} atenção`, tone: 'warning' }
  if (!integrationsOverview.value.marketplaces.length && !integrationsOverview.value.agents.length) return { label: 'Nenhuma conexão configurada', tone: 'neutral' }
  return { label: 'Conexões operacionais', tone: 'success' }
})
const formatIntegrationDate = (value?: string | null) => value
  ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  : 'Ainda não registrado'
const marketplaceName = (integration: { platform: string; connectionName: string }) => integration.connectionName || ({ mercado_livre: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon' }[integration.platform] || integration.platform)
const openPrivacySupport = (subject = 'Solicitacao de privacidade e LGPD', privacyRight = 'access') => {
  if (props.standalone) {
    void navigateTo({ path: '/configuracoes/suporte', query: { categoria: 'privacy', direito: privacyRight, assunto: subject } })
    return
  }
  supportDraft.category = 'privacy'
  supportDraft.privacyRight = privacyRight
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
  if (tab === 'Usuarios e Permissoes' && canManageMembers.value) void loadSectionOnce('members', loadMembers)
  if (tab === 'Seguranca') {
    void loadSectionOnce('sessions', loadSessions)
    if (isPrivileged.value) void loadSectionOnce('mfa-status', async () => { mfaEnabled.value = (await auth.mfaStatus()).enabled })
  }
  if (tab === 'Backup e Dados' && canExportCompanyData.value) void loadSectionOnce('backup', loadBackup)
  if (tab === 'Integracoes') void loadSectionOnce('integrations', loadIntegrations)
  if (tab === 'Assinatura') void loadSectionOnce('billing', loadStripeBilling)
}, { immediate: true })
watch(canExportCompanyData, (allowed) => {
  if (allowed && active.value === 'Backup e Dados') void loadSectionOnce('backup', loadBackup)
})

watch(members, syncMemberDrafts, { immediate: true })
watch(settings, syncSettings, { immediate: true })
watch(() => supportDraft.category, (category) => {
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
        <div v-if="active === 'Empresa'" class="company-settings">
          <header class="company-settings__hero">
            <span class="company-settings__hero-icon"><UiIcon name="building" :size="23" /></span>
            <div class="company-settings__hero-copy">
              <span class="company-settings__eyebrow">Perfil da empresa</span>
              <h2>Informações da empresa</h2>
              <p>Mantenha os dados cadastrais e de contato atualizados.</p>
            </div>
            <button class="btn btn--primary company-settings__save" :disabled="savingSettings" @click="saveSettings"><UiIcon name="save" :size="16" />{{ savingSettings ? 'Salvando...' : 'Salvar alterações' }}</button>
          </header>

          <div class="company-settings__sections">
            <section class="company-settings__section">
              <div class="company-settings__section-head"><span><UiIcon name="building" :size="17" /></span><div><h3>Identificação</h3><p>Nome e documento usados no cadastro da conta.</p></div></div>
              <div class="form-grid">
                <div class="field col-7"><label for="company-name">Nome da empresa *</label><input id="company-name" v-model="company.name" autocomplete="organization" placeholder="Nome da sua empresa"></div>
                <div class="field col-5"><label for="company-document">{{ companyDocumentLabel }} <small v-if="company.documentLocked" class="company-settings__locked">· documento registrado</small></label><div v-if="!company.documentLocked" class="settings-document-kind" role="group" aria-label="Tipo de documento"><button type="button" class="settings-document-kind__item" :class="{ 'settings-document-kind__item--active': companyDocumentKind === 'cpf' }" @click="selectCompanyDocumentKind('cpf')">CPF</button><button type="button" class="settings-document-kind__item" :class="{ 'settings-document-kind__item--active': companyDocumentKind === 'cnpj' }" @click="selectCompanyDocumentKind('cnpj')">CNPJ</button></div><div class="settings-document-control"><input id="company-document" v-model="company.cnpj" inputmode="numeric" :maxlength="companyDocumentMaxLength" :placeholder="companyDocumentPlaceholder" :disabled="company.documentLocked" @input="formatCompanyDocument"><button v-if="!company.documentLocked && companyDocumentKind === 'cnpj'" class="btn" type="button" :disabled="companyLookupLoading || !company.cnpj.trim()" @click="lookupCompany">{{ companyLookupLoading ? 'Consultando...' : 'Buscar CNPJ' }}</button></div><small v-if="!company.documentLocked">Depois de salvo, o documento fica protegido contra alterações diretas.</small><small v-if="company.documentLocked && company.documentType === 'cpf'">Para substituir o CPF por CNPJ, <button class="link-button" type="button" @click="openDocumentChangeRequest">abra uma solicitação</button>.</small></div>
              </div>
            </section>

            <section class="company-settings__section">
              <div class="company-settings__section-head"><span><UiIcon name="users" :size="17" /></span><div><h3>Contato</h3><p>Canais principais para comunicação com a empresa.</p></div></div>
              <div class="form-grid">
                <div class="field col-6"><label for="company-phone">Telefone</label><input id="company-phone" v-model="company.phone" type="tel" autocomplete="tel" placeholder="(00) 00000-0000"></div>
                <div class="field col-6"><label for="company-email">E-mail *</label><input id="company-email" v-model="company.email" type="email" autocomplete="email" placeholder="contato@empresa.com.br"></div>
              </div>
            </section>

            <section class="company-settings__section">
              <div class="company-settings__section-head"><span><UiIcon name="store" :size="17" /></span><div><h3>Endereço e localização</h3><p>Localização operacional e fuso horário da empresa.</p></div></div>
              <div class="form-grid">
                <div class="field col-8"><label for="company-address">Endereço</label><input id="company-address" v-model="company.address" autocomplete="street-address" placeholder="Rua, número e complemento"></div>
                <div class="field col-4"><label for="company-district">Bairro</label><input id="company-district" v-model="company.district" placeholder="Bairro"></div>
                <div class="field col-4"><label for="company-city">Cidade</label><input id="company-city" v-model="company.city" autocomplete="address-level2" placeholder="Cidade"></div>
                <div class="field col-2"><label for="company-state">Estado</label><input id="company-state" v-model="company.state" autocomplete="address-level1" maxlength="2" placeholder="UF"></div>
                <div class="field col-3"><label for="company-zip">CEP</label><input id="company-zip" v-model="company.zip" inputmode="numeric" autocomplete="postal-code" placeholder="00000-000"></div>
                <div class="field col-3"><label for="company-country">País</label><input id="company-country" v-model="company.country" autocomplete="country-name" placeholder="Brasil"></div>
                <div class="field col-12"><label for="company-timezone">Fuso horário</label><input id="company-timezone" v-model="company.timezone" placeholder="America/Sao_Paulo"></div>
              </div>
            </section>
          </div>
        </div>

        <div v-else-if="active === 'Financeiro'" class="settings-feature-page">
          <header class="settings-feature-hero settings-feature-hero--finance">
            <span class="settings-feature-hero__icon"><UiIcon name="wallet" :size="23" /></span>
            <div class="settings-feature-hero__copy"><span>Custos e precificação</span><h2>Parâmetros financeiros</h2><p>Defina os valores que serão preenchidos automaticamente em novos cálculos e produtos.</p></div>
            <button class="btn btn--primary settings-feature-hero__action" :disabled="savingSettings" @click="saveSettings"><UiIcon name="save" :size="16" />{{ savingSettings ? 'Salvando...' : 'Salvar parâmetros' }}</button>
          </header>

          <section class="settings-feature-section">
            <div class="settings-feature-section__head"><span><UiIcon name="calculator" :size="17" /></span><div><h3>Padrões de cálculo</h3><p>Valores iniciais usados pela Calculadora 3D e no cadastro de produtos.</p></div></div>
            <div class="form-grid">
              <label class="field col-6" for="financial-kwh"><span>Custo da energia (R$/kWh)</span><input id="financial-kwh" v-model.number="company.kwh" type="number" min="0" step=".01" placeholder="0,00"><small>Usado para calcular o consumo elétrico durante a impressão.</small></label>
              <label class="field col-6" for="financial-margin"><span>Margem desejada padrão (%)</span><input id="financial-margin" v-model.number="preferences.defaultMargin" type="number" min="0" step=".1" placeholder="40"><small>Preenche a margem inicial; ela ainda pode ser ajustada em cada cálculo.</small></label>
            </div>
          </section>

          <section class="settings-feature-section">
            <div class="settings-feature-section__head"><span><UiIcon name="money" :size="17" /></span><div><h3>Rateio dos custos fixos</h3><p>Distribua despesas mensais, como aluguel e internet, entre as unidades planejadas.</p></div></div>
            <div class="form-grid">
              <label class="field col-6" for="financial-fixed-cost"><span>Custos fixos mensais (R$)</span><input id="financial-fixed-cost" v-model.number="preferences.monthlyFixedCost" type="number" min="0" step=".01" placeholder="0,00"></label>
              <label class="field col-6" for="financial-units"><span>Produção planejada por mês</span><input id="financial-units" v-model.number="preferences.plannedMonthlyUnits" type="number" min="0" step="1" placeholder="0"><small>Quantidade estimada de peças produzidas no mês.</small></label>
            </div>
            <div class="financial-preview" :class="{ 'financial-preview--empty': Number(preferences.plannedMonthlyUnits || 0) <= 0 }"><span class="financial-preview__icon"><UiIcon name="trend" :size="19" /></span><div><small>Custo fixo estimado por unidade</small><strong>{{ currency(fixedCostPerUnitPreview) }}</strong><p>{{ Number(preferences.plannedMonthlyUnits || 0) > 0 ? 'Esse valor entra automaticamente em cada novo cálculo.' : 'Informe a produção mensal para visualizar o rateio.' }}</p></div></div>
          </section>

          <div class="info-note"><UiIcon name="info" />As alterações valem somente para novos cálculos. Produtos já salvos mantêm sua composição financeira original.</div>
        </div>

        <div v-else-if="active === 'Assinatura'" class="settings-security-card">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h2>Assinatura da plataforma</h2><p>PRO mensal por preço de lançamento vigente. Cobrança recorrente pelo Stripe, sem fidelidade.</p></div><button v-if="isOwner" class="btn" :disabled="billingLoading" @click="loadStripeBilling">Atualizar</button></div>
          <div v-if="!isOwner" class="info-note" style="margin-top:16px"><UiIcon name="shield" />Somente o Owner pode consultar ou alterar a assinatura da empresa.</div>
          <div v-else-if="billingLoading" class="empty-state"><div><h3>Consultando assinatura</h3></div></div>
          <template v-else-if="stripeBilling">
            <div v-if="stripeBilling.subscription" class="billing-subscription-summary">
              <div class="billing-subscription-summary__status"><UiIcon name="check" /><div><span>Assinatura atual</span><strong>{{ stripeBilling.subscription.planName || stripeBilling.subscription.planCode }} · {{ subscriptionStatus(stripeBilling.subscription.status) }}</strong></div></div>
              <div v-if="stripeBilling.subscription.status === 'grace' && stripeBilling.subscription.graceEndsAt" class="billing-subscription-summary__date"><span>Carência termina em</span><strong>{{ new Date(stripeBilling.subscription.graceEndsAt).toLocaleString('pt-BR') }}</strong><small>Você mantém o PRO por 3 dias. Depois, a empresa volta ao FREE sem excluir dados.</small></div><div v-else-if="stripeBilling.subscription.currentPeriodEnd" class="billing-subscription-summary__date"><span>{{ stripeBilling.subscription.status === 'trial' ? 'Período histórico termina em' : 'Próxima cobrança em' }}</span><strong>{{ new Date(stripeBilling.subscription.currentPeriodEnd).toLocaleDateString('pt-BR') }}</strong><small v-if="stripeBilling.subscription.status !== 'trial'">{{ currency(stripeBilling.plans[0]?.[stripeBilling.subscription.billingCycle === 'yearly' ? 'yearly' : 'monthly'] || 0) }} · {{ stripeBilling.subscription.billingCycle === 'yearly' ? 'anual existente' : 'mensal' }}</small></div>
              <div class="billing-subscription-summary__actions"><span v-if="stripeBilling.subscription.cancelAtPeriodEnd" class="badge badge--orange">Cancelamento programado</span><button v-if="stripeBilling.subscription.cancelAtPeriodEnd" class="btn" :disabled="subscriptionActionLoading" @click="changeStripeCancellation(false)">{{ subscriptionActionLoading ? 'Atualizando...' : 'Continuar assinatura' }}</button><button v-else-if="['trial', 'active', 'past_due', 'grace'].includes(stripeBilling.subscription.status)" class="btn btn--danger" :disabled="subscriptionActionLoading" @click="changeStripeCancellation(true)">{{ subscriptionActionLoading ? 'Atualizando...' : 'Cancelar assinatura' }}</button></div>
            </div>
            <div v-if="stripeBilling.checkout" class="info-note" style="margin-top:16px"><UiIcon name="info" />Ha um link de pagamento pendente criado em {{ new Date(stripeBilling.checkout.createdAt).toLocaleString('pt-BR') }}. <a :href="stripeBilling.checkout.url" rel="noopener noreferrer">Abrir link</a>.</div>
            <div v-if="!stripeBilling.configured" class="info-note" style="margin-top:16px"><UiIcon name="shield" />O Stripe ainda precisa do segredo de webhook no ambiente antes de gerar um checkout.</div>
            <form v-else-if="!hasProSubscription" class="integration-section" style="margin-top:16px" @submit.prevent="startStripeCheckout">
              <div class="integration-section__head"><div><h3>Assinatura PrintFlow</h3><p>Os dados do meio de pagamento sao informados diretamente ao Stripe e nao ficam no PrintFlow.</p></div><span class="badge badge--orange">Producao</span></div>
              <div v-if="selectedBillingPlan" class="billing-plans">
                <article class="billing-plan-card">
                  <div class="billing-plan-card__title"><h3>PRO mensal</h3><span class="billing-plan-card__caption">Preço de lançamento vigente. Cancele quando quiser.</span></div>
                  <div class="billing-plan-card__price"><small>R$</small>{{ currency(selectedBillingPlan.monthly || 0).replace('R$', '').trim() }}<span>/mês</span></div>
                  <ul class="billing-plan-card__features"><li>Automação com PrintFlow Agent e fila de impressão</li><li>Marketplaces e relatórios avançados</li><li>Equipe com até 8 pessoas</li><li>Operação sem os limites do plano FREE</li></ul>
                  <button class="billing-plan-card__button" type="button" :disabled="billingActionLoading || (selectedBillingPlan?.monthly || 0) <= 0" @click="startStripeCheckout">{{ billingActionLoading ? 'Atualizando...' : 'Assinar PRO' }}</button>
                </article>
              </div>
              <div v-if="selectedBillingPlan" class="billing-payment-note"><UiIcon name="wallet" /> Cobrança mensal recorrente pelo Stripe. Você pode programar o cancelamento para o fim do período pago.</div>
            </form>
          </template>
        </div>

        <div v-else-if="active === 'Usuarios e Permissoes'" class="members-page">
          <header class="members-hero">
            <span class="members-hero__icon"><UiIcon name="users" :size="23" /></span>
            <div><span class="members-hero__eyebrow">Equipe e acesso</span><h2>Usuários e permissões</h2><p>Defina quem pode acessar a empresa e qual responsabilidade cada pessoa terá no sistema.</p></div>
            <div v-if="canManageMembers" class="members-hero__actions"><span><i></i>{{ activeMemberCount }} {{ activeMemberCount === 1 ? 'acesso ativo' : 'acessos ativos' }}</span><button class="btn" type="button" :disabled="membersLoading" @click="loadMembers"><UiIcon name="refresh" :size="14" />{{ membersLoading ? 'Atualizando...' : 'Atualizar equipe' }}</button></div>
            <span v-else class="members-hero__restricted"><UiIcon name="lock" :size="14" /> Acesso restrito</span>
          </header>

          <div v-if="!canManageMembers" class="members-access-restricted"><span><UiIcon name="lock" :size="21" /></span><div><strong>Gerenciamento restrito</strong><p>Somente Owner e Administrador podem consultar membros, enviar convites e alterar acessos.</p></div></div>

          <template v-else>
            <section class="members-summary" aria-label="Resumo da equipe">
              <article><span><UiIcon name="users" :size="17" /></span><div><small>Membros ativos</small><strong>{{ activeMemberCount }}</strong></div></article>
              <article><span><UiIcon name="shield" :size="17" /></span><div><small>Owners ativos</small><strong>{{ ownerCount }}</strong></div></article>
              <article><span><UiIcon name="clock" :size="17" /></span><div><small>Convites pendentes</small><strong>{{ invitations.length }}</strong></div></article>
              <article><span><UiIcon name="alert" :size="17" /></span><div><small>Acessos suspensos</small><strong>{{ suspendedMemberCount }}</strong></div></article>
            </section>

            <form class="members-invite" @submit.prevent="sendInvitation">
              <div class="members-invite__head"><span><UiIcon name="plus" :size="18" /></span><div><small>Novo acesso</small><h3>Convidar uma pessoa</h3><p>O convite expira em 48 horas e só pode ser usado pelo e-mail informado.</p></div></div>
              <label class="field"><span>E-mail</span><input v-model="invite.email" type="email" required autocomplete="email" placeholder="pessoa@empresa.com"></label>
              <label class="field"><span>Perfil inicial</span><select v-model="invite.role"><option value="admin">Administrador</option><option value="financeiro">Financeiro</option><option value="producao">Produção</option><option value="usuario">Usuário</option></select></label>
              <button class="btn btn--primary" type="submit" :disabled="inviting || !invite.email.trim()"><UiIcon name="send" :size="15" />{{ inviting ? 'Enviando...' : 'Enviar convite' }}</button>
            </form>

            <section class="members-panel">
              <div class="members-panel__head"><span><UiIcon name="users" :size="18" /></span><div><small>Equipe cadastrada</small><h3>Membros da empresa</h3><p>Alterações de perfil ou status encerram as sessões anteriores da pessoa.</p></div><span>{{ members.length }} {{ members.length === 1 ? 'membro' : 'membros' }}</span></div>
              <div v-if="membersLoading && !members.length" class="members-loading" role="status"><i></i>Consultando membros...</div>
              <div v-else-if="!members.length" class="members-empty"><span><UiIcon name="users" :size="21" /></span><div><strong>Nenhum membro encontrado</strong><p>Envie um convite para adicionar a primeira pessoa da equipe.</p></div></div>
              <div v-else class="member-list">
                <article v-for="member in members" :key="member.userId" class="member-row" :class="{ 'member-row--suspended': member.status === 'suspended' }">
                  <span class="member-row__avatar">{{ memberInitials(member.name) }}</span>
                  <div class="member-row__identity"><strong>{{ member.name }} <em v-if="member.userId === auth.user.value?.id">Você</em></strong><span>{{ member.email }}</span><small>Desde {{ formatMemberDate(member.createdAt) }}</small></div>
                  <label class="field member-row__control"><span>Perfil</span><select v-model="memberDrafts[member.userId].role" :disabled="!canEditMember(member)"><option v-for="role in availableRolesFor(member)" :key="role.value" :value="role.value">{{ role.label }}</option></select></label>
                  <label class="field member-row__control"><span>Status</span><select v-model="memberDrafts[member.userId].status" :disabled="!canEditMember(member)"><option value="active">Ativo</option><option value="suspended">Suspenso</option></select></label>
                  <div class="member-row__state"><span :class="memberBadge(memberDrafts[member.userId]?.status || member.status)">{{ memberStatusLabel(memberDrafts[member.userId]?.status || member.status) }}</span><small v-if="!canEditMember(member)"><UiIcon name="lock" :size="11" />Protegido</small><small v-else-if="memberHasChanges(member)" class="member-row__pending"><UiIcon name="alert" :size="11" />Alteração não salva</small></div>
                  <button class="btn" :class="{ 'btn--primary': memberHasChanges(member) }" type="button" :disabled="!canEditMember(member) || !memberHasChanges(member) || savingMemberId === member.userId" @click="saveMember(member.userId)">{{ savingMemberId === member.userId ? 'Salvando...' : 'Salvar acesso' }}</button>
                </article>
              </div>
            </section>

            <section class="members-panel">
              <div class="members-panel__head"><span><UiIcon name="clock" :size="18" /></span><div><small>Aguardando aceite</small><h3>Convites pendentes</h3><p>Reenviar cria um novo link e invalida imediatamente o anterior.</p></div><span>{{ invitations.length }} pendentes</span></div>
              <div v-if="!invitations.length" class="members-empty"><span><UiIcon name="check" :size="21" /></span><div><strong>Nenhum convite pendente</strong><p>Todos os convites enviados já foram aceitos ou cancelados.</p></div></div>
              <div v-else class="invitation-list"><article v-for="invitation in invitations" :key="invitation.id" class="invitation-row"><span class="invitation-row__icon"><UiIcon name="send" :size="17" /></span><div><strong>{{ invitation.email }}</strong><span>Perfil: {{ roleLabel(invitation.role) }}</span></div><div><small>Expira em</small><strong>{{ new Date(invitation.expiresAt).toLocaleString('pt-BR') }}</strong></div><div class="invitation-row__actions"><button class="btn" type="button" :disabled="Boolean(invitationActionId)" @click="resendPendingInvitation(invitation.id)">{{ invitationActionId === invitation.id ? 'Aguarde...' : 'Reenviar' }}</button><button class="btn btn--danger" type="button" :disabled="Boolean(invitationActionId)" @click="cancelPendingInvitation(invitation.id, invitation.email)">Cancelar</button></div></article></div>
            </section>

            <section class="members-panel members-roles-panel">
              <div class="members-panel__head"><span><UiIcon name="shield" :size="18" /></span><div><small>Matriz de acesso</small><h3>O que cada perfil pode fazer</h3><p>Use estes perfis para separar administração, financeiro e produção.</p></div></div>
              <LazyConfigRoleGrid :roles="roles" :members="members" />
            </section>
          </template>
        </div>

        <div v-else-if="active === 'Seguranca'" class="security-page">
          <header class="security-hero">
            <span class="security-hero__icon"><UiIcon name="shield" :size="24" /></span>
            <div><span class="security-hero__eyebrow">Segurança da conta</span><h2>Proteja seu acesso ao PrintFlow</h2><p>Gerencie sua senha, a verificação em duas etapas e os dispositivos que permanecem conectados.</p></div>
            <div :class="['security-hero__status', `security-hero__status--${securityStatus.tone}`]"><i></i><span><strong>{{ securityStatus.label }}</strong><small>{{ securityStatus.detail }}</small></span></div>
          </header>

          <section class="security-summary" aria-label="Resumo de segurança">
            <article><span><UiIcon name="lock" :size="17" /></span><div><small>Método principal</small><strong>Senha protegida</strong></div></article>
            <article><span><UiIcon name="shield" :size="17" /></span><div><small>Verificação adicional</small><strong>{{ isPrivileged ? (mfaEnabled ? 'MFA ativo' : 'MFA desativado') : 'Não disponível para este perfil' }}</strong></div></article>
            <article><span><UiIcon name="users" :size="17" /></span><div><small>Dispositivos conectados</small><strong>{{ sessionsLoading ? 'Consultando...' : groupedSessions.length }}</strong></div></article>
          </section>

          <form class="security-panel security-password-panel" @submit.prevent="submitPasswordChange">
            <div class="security-panel__head"><span><UiIcon name="lock" :size="18" /></span><div><small>Credencial de acesso</small><h3>Alterar senha</h3><p>Use uma senha exclusiva. Ao salvar, os outros dispositivos serão desconectados.</p></div></div>
            <div class="security-password-grid">
              <label class="field"><span>Senha atual</span><input v-model="passwordForm.currentPassword" type="password" autocomplete="current-password" required placeholder="Confirme sua identidade"></label>
              <label class="field"><span>Nova senha</span><input v-model="passwordForm.newPassword" type="password" autocomplete="new-password" minlength="10" required placeholder="Crie uma senha forte"></label>
              <label class="field"><span>Confirmar nova senha</span><input v-model="passwordForm.confirmation" type="password" autocomplete="new-password" minlength="10" required placeholder="Repita a nova senha"><small v-if="passwordForm.confirmation" :class="passwordForm.newPassword === passwordForm.confirmation ? 'field-hint--success' : 'field-hint--error'">{{ passwordForm.newPassword === passwordForm.confirmation ? 'As senhas conferem.' : 'As senhas ainda não conferem.' }}</small></label>
            </div>
            <div class="security-password-footer">
              <ul class="security-password-rules"><li v-for="rule in passwordRules" :key="rule.label" :class="{ 'is-met': rule.met }"><UiIcon :name="rule.met ? 'check' : 'close'" :size="13" />{{ rule.label }}</li></ul>
              <button class="btn btn--primary" type="submit" :disabled="changingPassword || !passwordReady"><UiIcon name="lock" :size="15" />{{ changingPassword ? 'Alterando...' : 'Atualizar senha' }}</button>
            </div>
          </form>

          <section v-if="isPrivileged" class="security-panel security-mfa-panel">
            <div class="security-panel__head"><span><UiIcon name="shield" :size="18" /></span><div><small>Segundo fator</small><h3>Aplicativo autenticador</h3><p>Além da senha, um código temporário será solicitado ao entrar nesta conta privilegiada.</p></div><span :class="mfaEnabled ? 'badge badge--green' : 'badge badge--orange'">{{ mfaEnabled ? 'Ativo' : 'Recomendado' }}</span></div>

            <div v-if="mfaEnabled" class="security-mfa-active">
              <span><UiIcon name="check" :size="20" /></span><div><strong>Verificação em duas etapas ativada</strong><p>Seu aplicativo autenticador já está vinculado. Para desativar, confirme sua senha atual.</p></div>
              <div class="security-mfa-disable"><label class="field"><span>Senha atual</span><input v-model="mfaDisablePassword" type="password" autocomplete="current-password" placeholder="Confirme para desativar"></label><button class="btn btn--danger" type="button" :disabled="mfaLoading || !mfaDisablePassword" @click="turnOffMfa">Desativar MFA</button></div>
            </div>

            <div v-else-if="mfaSetup" class="security-mfa-setup">
              <div class="security-mfa-steps"><span>1</span><div><strong>Adicione a conta no autenticador</strong><p>Escolha a opção de inserir uma chave de configuração e use o código abaixo.</p></div></div>
              <div class="security-mfa-secret"><code>{{ mfaSetup.secret }}</code><button class="btn" type="button" @click="copyMfaSecret">Copiar chave</button></div>
              <div class="security-mfa-steps"><span>2</span><div><strong>Confirme o código gerado</strong><p>Digite o código temporário exibido pelo aplicativo.</p></div></div>
              <div class="security-mfa-confirm"><label class="field"><span>Código de confirmação</span><input v-model="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required placeholder="000000"></label><button class="btn btn--primary" type="button" :disabled="mfaLoading || !mfaCode.trim()" @click="confirmMfaSetup">{{ mfaLoading ? 'Confirmando...' : 'Ativar MFA' }}</button></div>
              <p class="security-mfa-warning"><UiIcon name="alert" :size="15" />Não compartilhe essa chave. Ela permite gerar códigos de acesso à sua conta.</p>
            </div>

            <div v-else class="security-mfa-inactive"><span><UiIcon name="shield" :size="22" /></span><div><strong>Adicione uma segunda camada de proteção</strong><p>Compatível com aplicativos autenticadores que geram códigos temporários.</p></div><button class="btn btn--primary" type="button" :disabled="mfaLoading" @click="startMfaSetup">{{ mfaLoading ? 'Preparando...' : 'Configurar MFA' }}</button></div>
          </section>

          <section class="security-panel security-sessions-panel">
            <div class="security-panel__head"><span><UiIcon name="users" :size="18" /></span><div><small>Acessos à conta</small><h3>Dispositivos e sessões</h3><p>Revise os acessos ativos e encerre qualquer dispositivo que você não reconheça.</p></div><button class="btn" type="button" :disabled="sessionsLoading" @click="loadSessions"><UiIcon name="refresh" :size="14" />{{ sessionsLoading ? 'Atualizando...' : 'Atualizar' }}</button></div>
            <div v-if="sessionsLoading" class="security-sessions-loading" role="status"><span></span>Consultando sessões ativas...</div>
            <div v-else-if="!sessions.length" class="security-sessions-empty"><span><UiIcon name="check" :size="21" /></span><div><strong>Nenhuma sessão ativa encontrada</strong><p>Uma nova sessão aparecerá aqui após o próximo acesso.</p></div></div>
            <div v-else class="security-session-list">
              <article v-for="session in groupedSessions" :key="session.key" class="security-session" :class="{ 'security-session--current': session.containsCurrent }">
                <span class="security-session__device"><UiIcon name="settings" :size="19" /></span>
                <div class="security-session__identity"><strong>{{ sessionDevice(session.deviceLabel).browser }} <em v-if="session.containsCurrent">Este dispositivo</em></strong><span>{{ sessionDevice(session.deviceLabel).system }} · IP {{ session.ipMasked || 'não disponível' }}</span><small v-if="session.sessionIds.length > 1">{{ session.sessionIds.length }} sessões agrupadas</small></div>
                <div class="security-session__activity"><small>Última atividade</small><strong>{{ formatSecurityDate(session.lastSeenAt) }}</strong><span>Primeiro acesso em {{ formatSecurityDate(session.createdAt) }}</span></div>
                <div class="security-session__expiry"><small>Expira em</small><strong>{{ formatSecurityDate(session.expiresAt) }}</strong></div>
                <button class="btn btn--danger" type="button" :disabled="Boolean(endingSessionGroupKey)" @click="endSessionGroup(session)">{{ endingSessionGroupKey === session.key ? 'Encerrando...' : session.containsCurrent ? 'Sair deste dispositivo' : 'Encerrar' }}</button>
              </article>
            </div>
            <div v-if="sessions.length" class="security-sessions-footer"><p><UiIcon name="info" :size="15" />Não reconhece um acesso? Encerre a sessão e altere sua senha.</p><button class="btn btn--danger" type="button" @click="endAllSessions">Encerrar todas</button></div>
          </section>
        </div>

        <div v-else-if="active === 'Backup e Dados'" class="backup-data-page">
          <header class="backup-data-hero">
            <span class="backup-data-hero__icon"><UiIcon name="download" :size="24" /></span>
            <div><span class="backup-data-hero__eyebrow">Portabilidade da empresa</span><h2>Cópias dos dados, sem ações escondidas</h2><p>Gere um CSV dos dados operacionais e acompanhe o histórico. Esta tela não restaura nem sobrescreve informações automaticamente.</p></div>
            <button v-if="canExportCompanyData" type="button" class="btn" :disabled="backupLoading" @click="loadBackup"><UiIcon name="refresh" :size="15" />{{ backupLoading ? 'Atualizando...' : 'Atualizar status' }}</button>
          </header>

          <section v-if="!canExportCompanyData" class="backup-access-restricted">
            <span><UiIcon name="lock" :size="22" /></span><div><small>Acesso administrativo</small><h3>Exportação restrita</h3><p>Somente o Owner ou um Administrador pode exportar e consultar o histórico dos dados operacionais da empresa.</p></div>
          </section>

          <template v-else>
            <div v-if="backupLoading" class="backup-loading" role="status"><span></span><div><strong>Verificando disponibilidade</strong><p>Consultando exportação e histórico desta empresa.</p></div></div>
            <template v-else>
              <section class="backup-status-grid" aria-label="Resumo da exportação">
                <article><span><UiIcon name="check" :size="17" /></span><div><small>Exportação</small><strong>{{ backupStatus.export.enabled ? 'Disponível' : 'Indisponível' }}</strong></div></article>
                <article><span><UiIcon name="receipt" :size="17" /></span><div><small>Formato</small><strong>{{ backupStatus.export.enabled ? backupStatus.export.format.toUpperCase() : '—' }}</strong></div></article>
                <article><span><UiIcon name="history" :size="17" /></span><div><small>Última exportação</small><strong>{{ latestExport ? new Date(latestExport.createdAt).toLocaleDateString('pt-BR') : 'Nenhuma' }}</strong></div></article>
              </section>

              <section class="backup-export-card" :class="{ 'backup-export-card--disabled': !backupStatus.export.enabled }">
                <div class="backup-export-card__main">
                  <span class="backup-export-card__icon"><UiIcon name="download" :size="21" /></span>
                  <div><small>Cópia operacional</small><h3>Exportar todos os dados da empresa</h3><p>Produtos, pedidos, clientes, produção, financeiro e conexões são organizados em um único arquivo CSV.</p></div>
                </div>
                <button type="button" class="btn btn--primary" :disabled="exportingData || !backupStatus.export.enabled" @click="downloadTenantData()"><UiIcon name="download" :size="16" />{{ exportingData ? 'Gerando arquivo...' : 'Gerar exportação completa' }}</button>
                <div class="backup-export-card__boundary"><UiIcon name="shield" :size="16" /><span><strong>Não entram no arquivo:</strong> {{ backupStatus.export.excludes.join(', ') || 'credenciais e sessões de acesso' }}.</span></div>
              </section>

              <section class="backup-history-card">
                <div class="backup-section-heading"><div><small>Rastreabilidade</small><h3>Histórico de exportações</h3><p>Cada geração registra formato, quantidade de registros e horário.</p></div><span>{{ exportHistory.length }} {{ exportHistory.length === 1 ? 'arquivo' : 'arquivos' }}</span></div>
                <div v-if="exportHistory.length" class="table-scroll"><table class="data-table"><thead><tr><th>Arquivo</th><th>Formato</th><th>Registros</th><th>Status</th><th>Gerado em</th></tr></thead><tbody><tr v-for="item in exportHistory" :key="item.id"><td><strong>{{ item.fileName }}</strong></td><td>{{ item.format.toUpperCase() }}</td><td>{{ item.recordCount.toLocaleString('pt-BR') }}</td><td><span class="badge badge--green">{{ item.status }}</span></td><td>{{ new Date(item.createdAt).toLocaleString('pt-BR') }}</td></tr></tbody></table></div>
                <div v-else class="backup-history-empty"><span><UiIcon name="history" :size="21" /></span><div><strong>Nenhuma exportação gerada</strong><p>Quando uma cópia for criada, ela aparecerá aqui para consulta.</p></div></div>
              </section>

              <section class="backup-restore-note"><span><UiIcon name="shield" :size="20" /></span><div><small>Restauração protegida</small><h3>Nenhum dado será sobrescrito por esta tela</h3><p>{{ backupStatus.restore.reason || 'A restauração permanece controlada para evitar perda ou substituição indevida de informações.' }}</p></div></section>
            </template>
          </template>

          <section class="backup-danger-zone">
            <div class="backup-danger-zone__head"><span><UiIcon name="alert" :size="19" /></span><div><small>Zona de risco</small><h3>Excluir empresa e dados</h3><p>Esta ação é diferente de exportar dados e agenda a remoção integral da empresa após sete dias.</p></div></div>
            <details v-if="isOwner">
              <summary>Solicitar exclusão da empresa</summary>
              <form @submit.prevent="requestTenantDeletion">
                <div class="backup-danger-zone__notice"><UiIcon name="info" :size="17" /><span>Um novo login durante o prazo de sete dias cancela a solicitação. A confirmação e o cancelamento ficam registrados em auditoria.</span></div>
                <div class="form-grid"><label class="field col-6"><span>Senha atual</span><input v-model="deletionForm.currentPassword" type="password" autocomplete="current-password" required></label><label class="field col-6"><span>Digite EXCLUIR para confirmar</span><input v-model="deletionForm.confirmation" required autocomplete="off" placeholder="EXCLUIR"></label></div>
                <label class="backup-danger-zone__ack"><input v-model="deletionForm.acknowledged" type="checkbox" required><span>Li o aviso e entendo que esta solicitação afeta todos os usuários e dados da empresa.</span></label>
                <button class="btn btn--danger" type="submit" :disabled="deletingTenant">{{ deletingTenant ? 'Programando exclusão...' : 'Programar exclusão em 7 dias' }}</button>
              </form>
            </details>
            <div v-else class="backup-danger-zone__restricted"><UiIcon name="lock" :size="16" />Somente o Owner pode solicitar a exclusão da empresa.</div>
          </section>
        </div>

        <div v-else-if="active === 'Privacidade e LGPD'" class="privacy-page">
          <header class="privacy-hero">
            <span class="privacy-hero__icon"><UiIcon name="shield" :size="25" /></span>
            <div><span class="privacy-hero__eyebrow">Central de privacidade</span><h2>Dados da empresa e direitos do titular</h2><p>Escolha o fluxo correspondente ao que você precisa. Cada ação mantém finalidade, permissão e rastreabilidade próprias.</p></div>
            <span class="privacy-hero__status"><i></i> Canal autenticado</span>
          </header>

          <section class="privacy-scope-note">
            <UiIcon name="info" :size="18" />
            <div><strong>Antes de continuar</strong><p>A exportação abaixo é uma cópia operacional dos dados da empresa. Para exercer um direito sobre dados pessoais, use a solicitação por protocolo.</p></div>
          </section>

          <form v-if="canExportCompanyData" class="privacy-panel" @submit.prevent="downloadTenantData(privacyExportGroups)">
            <div class="privacy-panel__head">
              <div class="privacy-panel__title"><span><UiIcon name="download" :size="19" /></span><div><small>Dados operacionais</small><h3>Exportar dados da empresa</h3><p>O arquivo CSV incluirá somente os grupos marcados.</p></div></div>
              <div class="privacy-selection-actions"><button type="button" :disabled="allPrivacyExportGroupsSelected" @click="selectAllPrivacyExportGroups">Selecionar todos</button><button type="button" :disabled="!privacyExportGroups.length" @click="clearPrivacyExportGroups">Limpar seleção</button></div>
            </div>
            <div class="privacy-export-options">
              <label v-for="option in privacyExportOptions" :key="option.value" class="privacy-export-option" :class="{ 'privacy-export-option--selected': privacyExportGroups.includes(option.value) }">
                <input v-model="privacyExportGroups" type="checkbox" :value="option.value">
                <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
                <UiIcon v-if="privacyExportGroups.includes(option.value)" name="check" :size="15" />
              </label>
            </div>
            <div class="privacy-export-actions"><span><strong>{{ privacyExportGroups.length }}</strong> de {{ privacyExportOptions.length }} grupos selecionados</span><button class="btn btn--primary" type="submit" :disabled="exportingData || !privacyExportGroups.length"><UiIcon name="download" :size="16" />{{ exportingData ? 'Gerando CSV...' : 'Gerar arquivo selecionado' }}</button></div>
          </form>
          <section v-else class="privacy-panel privacy-panel--restricted">
            <div class="privacy-panel__title"><span><UiIcon name="lock" :size="19" /></span><div><small>Dados operacionais</small><h3>Exportação restrita</h3><p>Somente o Owner ou um Administrador pode gerar uma cópia dos dados operacionais da empresa. Seus direitos sobre dados pessoais continuam disponíveis abaixo.</p></div></div>
          </section>

          <section class="privacy-panel">
            <div class="privacy-panel__head"><div class="privacy-panel__title"><span><UiIcon name="shield" :size="19" /></span><div><small>Dados pessoais</small><h3>Exercer um direito LGPD</h3><p>Selecione o pedido. Na próxima etapa você poderá descrever o caso antes de gerar o protocolo.</p></div></div></div>
            <div class="privacy-rights" role="radiogroup" aria-label="Direito que deseja exercer">
              <button v-for="option in privacyRequestOptions" :key="option.value" type="button" class="privacy-right" :class="{ 'privacy-right--selected': privacyRequestRight === option.value }" role="radio" :aria-checked="privacyRequestRight === option.value" @click="privacyRequestRight = option.value">
                <span class="privacy-right__icon"><UiIcon :name="option.icon" :size="18" /></span><span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span><i><UiIcon v-if="privacyRequestRight === option.value" name="check" :size="13" /></i>
              </button>
            </div>
            <div class="privacy-request-summary"><div><small>Solicitação selecionada</small><strong>{{ selectedPrivacyRequest.label }}</strong><p>O atendimento será aberto no canal interno e receberá um protocolo exclusivo.</p></div><button type="button" class="btn btn--primary" @click="openPrivacySupport(selectedPrivacyRequest.subject, selectedPrivacyRequest.value)">Continuar solicitação</button></div>
          </section>

          <section class="privacy-secondary-grid">
            <article><span><UiIcon name="alert" :size="19" /></span><div><small>Ação sobre toda a conta</small><h3>Excluir empresa e dados</h3><p>A exclusão integral da empresa é diferente de uma solicitação de titular e permanece restrita ao Owner.</p><NuxtLink v-if="isOwner" class="btn" to="/configuracoes/backup">Ir para exclusão da empresa</NuxtLink><em v-else>Se isso for necessário, solicite a ação ao Owner da empresa.</em></div></article>
            <article><span><UiIcon name="receipt" :size="19" /></span><div><small>Transparência</small><h3>Canal e documentos oficiais</h3><p>O canal comercial e os documentos do controlador ainda não foram cadastrados. Até lá, as solicitações ficam registradas nesta central.</p><em>Solicitações encerradas são anonimizadas conforme a regra operacional vigente.</em></div></article>
          </section>
        </div>

        <div v-else-if="active === 'Notificacoes'" class="settings-feature-page">
          <header class="settings-feature-hero settings-feature-hero--notifications">
            <span class="settings-feature-hero__icon"><UiIcon name="bell" :size="23" /></span>
            <div class="settings-feature-hero__copy"><span>Central de alertas</span><h2>Notificações</h2><p>Escolha quais eventos operacionais devem aparecer para a equipe dentro do PrintFlow.</p></div>
            <button class="btn btn--primary settings-feature-hero__action" :disabled="savingSettings" @click="saveSettings"><UiIcon name="save" :size="16" />{{ savingSettings ? 'Salvando...' : 'Salvar preferências' }}</button>
          </header>

          <div class="notification-preference-list">
            <article class="notification-preference" :class="{ 'notification-preference--active': preferences.productionAlerts }">
              <span class="notification-preference__icon"><UiIcon name="printer" :size="20" /></span>
              <div class="notification-preference__copy"><strong>Produção e impressoras</strong><p>Falhas, conclusão de impressões, fila de produção e estado do PrintFlow Agent.</p></div>
              <div class="notification-preference__control"><small>{{ preferences.productionAlerts ? 'Ativado' : 'Desativado' }}</small><button type="button" class="switch" :class="{ active: preferences.productionAlerts }" role="switch" :aria-checked="preferences.productionAlerts" aria-label="Alternar alertas de produção" @click="preferences.productionAlerts = !preferences.productionAlerts"></button></div>
            </article>

            <article class="notification-preference" :class="{ 'notification-preference--active': preferences.marketplaceAlerts }">
              <span class="notification-preference__icon"><UiIcon name="store" :size="20" /></span>
              <div class="notification-preference__copy"><strong>Marketplaces</strong><p>Novos pedidos, sincronizações e ocorrências nas integrações de vendas.</p></div>
              <div class="notification-preference__control"><small>{{ preferences.marketplaceAlerts ? 'Ativado' : 'Desativado' }}</small><button type="button" class="switch" :class="{ active: preferences.marketplaceAlerts }" role="switch" :aria-checked="preferences.marketplaceAlerts" aria-label="Alternar alertas de marketplace" @click="preferences.marketplaceAlerts = !preferences.marketplaceAlerts"></button></div>
            </article>
          </div>

          <div class="info-note"><UiIcon name="info" />Estas preferências controlam os avisos exibidos dentro do sistema. Resumos automáticos por e-mail ainda não estão disponíveis.</div>
        </div>
        <div v-else-if="active === 'Integracoes'" class="integrations-page">
          <header class="integrations-hero">
            <span class="integrations-hero__icon"><UiIcon name="settings" :size="22" /></span>
            <div class="integrations-hero__copy"><span>Central de conexões</span><h2>Integrações</h2><p>Acompanhe os serviços que ligam vendas, produção e comunicações ao PrintFlow.</p></div>
            <div class="integrations-hero__actions">
              <span :class="['integrations-health', `integrations-health--${integrationOverviewStatus.tone}`]"><i></i>{{ integrationOverviewStatus.label }}</span>
              <button class="btn" type="button" :disabled="integrationsLoading" @click="loadIntegrations"><UiIcon name="refresh" :size="15" />{{ integrationsLoading ? 'Atualizando...' : 'Atualizar estados' }}</button>
            </div>
          </header>

          <div v-if="integrationsLoading && !integrationsOverview.marketplaces.length && !integrationsOverview.agents.length" class="integrations-loading" role="status"><span></span><div><strong>Consultando conexões</strong><p>Buscando o estado mais recente dos serviços.</p></div></div>
          <template v-else>
            <section class="integrations-overview" aria-label="Resumo das integrações">
              <article class="integration-domain-card integration-domain-card--marketplace">
                <span class="integration-domain-card__icon"><UiIcon name="store" :size="20" /></span>
                <div><span>Canais de venda</span><strong>{{ connectedMarketplaceCount }} de {{ integrationsOverview.marketplaces.length }} conectados</strong><p>Pedidos e vendas recebidos dos marketplaces.</p></div>
                <NuxtLink to="/marketplaces?secao=conexoes" aria-label="Gerenciar contas conectadas"><UiIcon name="chevron" :size="17" /></NuxtLink>
              </article>
              <article class="integration-domain-card integration-domain-card--agent">
                <span class="integration-domain-card__icon"><UiIcon name="printer" :size="20" /></span>
                <div><span>Produção local</span><strong>{{ onlineAgentCount }} de {{ integrationsOverview.agents.length }} Agents online</strong><p>Computadores que conectam as impressoras.</p></div>
                <NuxtLink to="/impressoras" aria-label="Gerenciar impressoras e Agents"><UiIcon name="chevron" :size="17" /></NuxtLink>
              </article>
              <article class="integration-domain-card integration-domain-card--email">
                <span class="integration-domain-card__icon"><UiIcon name="send" :size="20" /></span>
                <div><span>Comunicações</span><strong>{{ integrationStatus(integrationsOverview.email.status) }}</strong><p>Serviço transacional administrado pela plataforma.</p></div>
                <span :class="integrationBadge(integrationsOverview.email.status)">{{ integrationsOverview.email.status === 'connected' ? 'Disponível' : 'Indisponível' }}</span>
              </article>
            </section>

            <section class="integration-panel">
              <div class="integration-panel__head"><span><UiIcon name="store" :size="18" /></span><div><h3>Contas conectadas</h3><p>Autorizações de marketplace e o último processamento registrado.</p></div><NuxtLink class="btn" to="/marketplaces?secao=conexoes">Gerenciar contas</NuxtLink></div>
              <div v-if="integrationsOverview.marketplaces.length" class="integration-connection-list">
                <article v-for="integration in integrationsOverview.marketplaces" :key="integration.id || integration.platform" class="integration-connection-row">
                  <span class="integration-connection-row__logo"><MarketplaceLogo :platform="integration.platform" /></span>
                  <div class="integration-connection-row__identity"><strong>{{ marketplaceName(integration) }}</strong><span>{{ integration.accountExternalId ? `Conta ${integration.accountExternalId}` : 'Identificador da conta não informado' }}</span></div>
                  <div class="integration-connection-row__activity"><small>Última sincronização</small><strong>{{ formatIntegrationDate(integration.lastSyncAt) }}</strong></div>
                  <span :class="integrationBadge(integration.status)">{{ integrationStatus(integration.status) }}</span>
                </article>
              </div>
              <div v-else class="integration-empty"><span><UiIcon name="store" :size="21" /></span><div><strong>Nenhuma conta conectada</strong><p>Conecte uma conta para receber e acompanhar pedidos do marketplace.</p></div><NuxtLink class="btn btn--primary" to="/marketplaces/novo">Conectar conta</NuxtLink></div>
            </section>

            <section class="integration-panel">
              <div class="integration-panel__head"><span><UiIcon name="printer" :size="18" /></span><div><h3>PrintFlow Agent</h3><p>Computadores autorizados a operar impressoras nesta empresa.</p></div><NuxtLink class="btn" to="/impressoras">Ver impressoras</NuxtLink></div>
              <div v-if="integrationsOverview.agents.length" class="integration-connection-list">
                <article v-for="agent in integrationsOverview.agents" :key="agent.id" class="integration-connection-row">
                  <span class="integration-connection-row__device"><UiIcon name="printer" :size="18" /></span>
                  <div class="integration-connection-row__identity"><strong>{{ agent.name || agent.machineName }}</strong><span>{{ agent.machineName && agent.machineName !== agent.name ? agent.machineName : (agent.platform || 'Plataforma não informada') }}</span></div>
                  <div class="integration-connection-row__activity"><small>Último contato</small><strong>{{ formatIntegrationDate(agent.lastSeenAt) }}</strong></div>
                  <span :class="integrationBadge(agent.status)">{{ integrationStatus(agent.status) }}</span>
                </article>
              </div>
              <div v-else class="integration-empty"><span><UiIcon name="printer" :size="21" /></span><div><strong>Nenhum Agent pareado</strong><p>Instale ou conecte o Agent para detectar e controlar impressoras locais.</p></div><NuxtLink class="btn btn--primary" to="/impressoras/nova">Configurar Agent</NuxtLink></div>
            </section>

            <section class="integration-service-note">
              <span><UiIcon name="shield" :size="19" /></span><div><strong>Envio transacional · {{ integrationsOverview.email.provider }}</strong><p>{{ integrationsOverview.email.status === 'connected' ? 'O serviço está disponível para comunicações automáticas da plataforma.' : 'O serviço ainda não está configurado no ambiente. Não há ação necessária nesta tela.' }} Credenciais e segredos nunca são exibidos.</p></div><span :class="integrationBadge(integrationsOverview.email.status)">{{ integrationStatus(integrationsOverview.email.status) }}</span>
            </section>
          </template>
        </div>

        <div v-else-if="active === 'Ajuda e Suporte'" class="support-contact-page">
          <header class="support-contact-hero">
            <span class="support-contact-hero__icon"><UiIcon name="chat" :size="24" /></span>
            <div><span class="support-contact-hero__eyebrow">Fale com a equipe</span><h2>Como podemos ajudar?</h2><p>Envie sua dúvida ou descreva o problema. A mensagem será registrada diretamente no painel de suporte do PrintFlow.</p></div>
            <span class="support-contact-hero__status"><i></i> Canal interno</span>
          </header>

          <div v-if="submittedSupportProtocol" class="support-contact-success" role="status">
            <span><UiIcon name="check" :size="22" /></span>
            <div><strong>Mensagem enviada com sucesso</strong><p>A equipe recebeu seu contato. Guarde o protocolo <code>{{ formatSupportProtocol(submittedSupportProtocol) }}</code> caso precise fazer referência a esta solicitação.</p></div>
            <button type="button" class="btn" @click="submittedSupportProtocol = ''">Enviar outra</button>
          </div>

          <form v-else class="support-contact-form" @submit.prevent="submitSupportRequest">
            <div class="support-contact-form__intro"><div><h3>Seus dados de contato</h3><p>Usamos os dados confirmados da sua conta para identificar a solicitação.</p></div><span><UiIcon name="shield" :size="15" /> Conta verificada</span></div>
            <div class="form-grid support-contact-form__fields">
              <label class="field col-6"><span>Nome</span><input :value="auth.user.value?.name || ''" readonly aria-readonly="true"></label>
              <label class="field col-6"><span>E-mail</span><input :value="auth.user.value?.email || ''" type="email" readonly aria-readonly="true"></label>
              <label class="field col-12"><span>Assunto</span><input v-model="supportDraft.subject" minlength="4" maxlength="120" required placeholder="Resuma o que você precisa"></label>
              <label class="field col-12"><span>Mensagem</span><textarea v-model="supportDraft.reason" minlength="12" maxlength="1000" required placeholder="Conte o que aconteceu e inclua as informações necessárias para entendermos o caso"></textarea><small>{{ supportDraft.reason.length }}/1000 caracteres</small></label>
            </div>
            <div class="support-contact-form__footer"><p><UiIcon name="info" :size="15" />Não inclua senhas, tokens ou dados de pagamento.</p><button class="btn btn--primary" type="submit" :disabled="submittingSupport"><UiIcon name="send" :size="15" />{{ submittingSupport ? 'Enviando...' : 'Enviar mensagem' }}</button></div>
          </form>
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
