import type { AuditRequest, AuthorizedTenantAudit, Message, Overview, PlatformAudit, PlatformNotification, SupportAttachment, SupportMacro, SupportMetrics, SupportSlaRule, Tenant, PlatformPlan, TenantDetails, TenantSubscriptionEvent, TenantUser, TenantBillingRecord } from '~/types/platform-admin'

type LoadOptions = { overview?: boolean; tenants?: boolean; requests?: boolean }
type Resource = keyof LoadOptions
const chatOpenStatuses = ['pending', 'under_review', 'approved', 'rejected']
const cacheTtlMs = 20_000
const inFlight = new Map<string, Promise<unknown>>()

export const usePlatformAdminWorkspace = () => {
  const session = useAdminSession()
  const overview = useState<Overview | null>('platform-admin-overview', () => null)
  const tenants = useState<Tenant[]>('platform-admin-tenants', () => [])
  const requests = useState<AuditRequest[]>('platform-admin-requests', () => [])
  const messagesByRequest = useState<Record<string, Message[]>>('platform-admin-request-messages', () => ({}))
  const resourceUpdatedAt = useState<Record<Resource, number>>('platform-admin-resource-updated-at', () => ({ overview: 0, tenants: 0, requests: 0 }))
  const messagesUpdatedAt = useState<Record<string, number>>('platform-admin-messages-updated-at', () => ({}))
  const workspaceUserId = useState('platform-admin-workspace-user-id', () => '')
  const authorizedTenantAudit = useState<AuthorizedTenantAudit | null>('platform-admin-authorized-tenant-audit', () => null)
  const loading = useState('platform-admin-loading', () => false)
  const error = useState('platform-admin-error', () => '')
  const notifications = useState<PlatformNotification[]>('platform-admin-notifications', () => [])
  const supportMacros = useState<SupportMacro[]>('platform-admin-support-macros', () => [])
  const supportMetrics = useState<SupportMetrics | null>('platform-admin-support-metrics', () => null)
  const supportSlaRules = useState<SupportSlaRule[]>('platform-admin-support-sla-rules', () => [])
  const supportHistory = useState<Record<string, PlatformAudit[]>>('platform-admin-support-history', () => ({}))
  const supportAttachments = useState<Record<string, SupportAttachment[]>>('platform-admin-support-attachments', () => ({}))
  const tenantDetails = useState<TenantDetails | null>('platform-admin-tenant-details', () => null)
  const tenantUsers = useState<TenantUser[]>('platform-admin-tenant-users', () => [])
  const tenantSubscriptionEvents = useState<TenantSubscriptionEvent[]>('platform-admin-tenant-subscription-events', () => [])
  const platformPlans = useState<PlatformPlan[]>('platform-admin-plans', () => [])
  const tenantBillingRecords = useState<TenantBillingRecord[]>('platform-admin-tenant-billing-records', () => [])

  const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('pt-BR') : '-'
  const tenantFor = (id: string) => tenants.value.find(tenant => tenant.id === id)
  const statusLabel = (status: string) => ({
    pending: 'Aberta', under_review: 'Em atendimento', approved: 'Aprovada', rejected: 'Rejeitada',
    new: 'Novo', in_progress: 'Em atendimento', waiting_customer: 'Aguardando cliente', waiting_internal: 'Aguardando equipe', resolved: 'Resolvido', reopened: 'Reaberto',
    cancelled: 'Cancelada', closed: 'Encerrada', expired: 'Expirada', active: 'Ativa',
    suspended: 'Suspensa', blocked: 'Bloqueada', overdue: 'Atrasada', pending: 'Pendente', paid: 'Paga', void: 'Anulada', not_configured: 'Nao configurada', trial: 'Em teste', past_due: 'Inadimplente', grace: 'Em carencia', paused: 'Pausada', courtesy: 'Cortesia', ended: 'Encerrada'
  }[status] || status)
  const statusClass = (status: string) => `status-pill status-pill--${status.replace('_', '-')}`
  const isChatOpen = (status: string) => chatOpenStatuses.includes(status)

  const clearWorkspace = () => {
    overview.value = null
    tenants.value = []
    requests.value = []
    messagesByRequest.value = {}
    resourceUpdatedAt.value = { overview: 0, tenants: 0, requests: 0 }
    messagesUpdatedAt.value = {}
    authorizedTenantAudit.value = null
    error.value = ''
    notifications.value = []
    supportMacros.value = []
    supportMetrics.value = null
    supportSlaRules.value = []
    supportHistory.value = {}
    supportAttachments.value = {}
    tenantDetails.value = null
    tenantUsers.value = []
    tenantSubscriptionEvents.value = []
    platformPlans.value = []
    tenantBillingRecords.value = []
    workspaceUserId.value = ''
    inFlight.clear()
  }

  const handleLoadError = async (cause: any) => {
    const status = Number(cause?.statusCode || cause?.status || cause?.response?.status || 0)
    if (status === 401 || status === 403) {
      clearWorkspace()
      session.clear()
      await navigateTo('/login')
      return
    }
    error.value = cause?.data?.error || cause?.message || 'Nao foi possivel carregar os dados da plataforma.'
  }

  const ensureSession = async () => {
    await session.restore()
    if (session.token.value) return true
    clearWorkspace()
    await navigateTo('/login')
    return false
  }

  const resetForDifferentAdmin = () => {
    const userId = session.user.value?.id || ''
    if (workspaceUserId.value && workspaceUserId.value !== userId) clearWorkspace()
    workspaceUserId.value = userId
    return userId
  }

  const isFresh = (updatedAt: number) => updatedAt > 0 && Date.now() - updatedAt < cacheTtlMs
  const fetchResource = async <T>(resource: Resource, path: string, apply: (value: T) => void, force = false) => {
    const userId = resetForDifferentAdmin()
    if (!force && isFresh(resourceUpdatedAt.value[resource])) return
    const key = `${userId}:${resource}`
    const existing = inFlight.get(key) as Promise<void> | undefined
    if (existing) return existing
    const request = session.request<T>(path).then((value) => {
      if ((session.user.value?.id || '') === userId) {
        apply(value)
        resourceUpdatedAt.value = { ...resourceUpdatedAt.value, [resource]: Date.now() }
      }
    }).finally(() => { inFlight.delete(key) })
    inFlight.set(key, request)
    return request
  }

  const loadOverview = (force = false) => fetchResource<Overview>('overview', '/api/platform-admin/overview', value => { overview.value = value }, force)
  const loadTenants = (force = false) => fetchResource<Tenant[]>('tenants', '/api/platform-admin/tenants', value => { tenants.value = value }, force)
  const loadRequests = (force = false) => fetchResource<AuditRequest[]>('requests', '/api/platform-admin/support-requests', value => { requests.value = value }, force)

  const loadMessages = async (requestId: string, force = false) => {
    const userId = resetForDifferentAdmin()
    if (!force && isFresh(messagesUpdatedAt.value[requestId])) return messagesByRequest.value[requestId] || []
    const key = `${userId}:messages:${requestId}`
    const existing = inFlight.get(key) as Promise<Message[]> | undefined
    if (existing) return existing
    const request = session.request<Message[]>(`/api/platform-admin/support-requests/${encodeURIComponent(requestId)}/messages`).then((value) => {
      if ((session.user.value?.id || '') === userId) {
        messagesByRequest.value = { ...messagesByRequest.value, [requestId]: value }
        messagesUpdatedAt.value = { ...messagesUpdatedAt.value, [requestId]: Date.now() }
      }
      return value
    }).finally(() => { inFlight.delete(key) })
    inFlight.set(key, request)
    return request
  }
  const loadSupportHistory = async (requestId: string) => {
    const value = await session.request<PlatformAudit[]>(`/api/platform-admin/support-requests/${encodeURIComponent(requestId)}/history`)
    supportHistory.value = { ...supportHistory.value, [requestId]: value }
    return value
  }
  const loadSupportAttachments = async (requestId: string) => {
    const value = await session.request<SupportAttachment[]>(`/api/platform-admin/support-requests/${encodeURIComponent(requestId)}/attachments`)
    supportAttachments.value = { ...supportAttachments.value, [requestId]: value }
    return value
  }
  const uploadSupportAttachment = async (requestId: string, file: File) => {
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '').split(',').pop() || ''); reader.onerror = reject; reader.readAsDataURL(file) })
    const value = await session.request<SupportAttachment>(`/api/platform-admin/support-requests/${encodeURIComponent(requestId)}/attachments`, { method: 'POST', body: { fileName: file.name, mimeType: file.type, data } })
    supportAttachments.value = { ...supportAttachments.value, [requestId]: [...(supportAttachments.value[requestId] || []), value] }
    return value
  }
  const downloadSupportAttachment = (requestId: string, attachment: SupportAttachment) => session.download(`/api/platform-admin/support-requests/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(attachment.id)}`, attachment.originalName)

  const load = async (options: LoadOptions) => {
    if (!await ensureSession()) return false
    loading.value = true
    error.value = ''
    try {
      const jobs: Promise<unknown>[] = []
      if (options.overview) jobs.push(loadOverview())
      if (options.tenants) jobs.push(loadTenants())
      if (options.requests) jobs.push(loadRequests())
      await Promise.all(jobs)
      return true
    } catch (cause) {
      await handleLoadError(cause)
      return false
    } finally {
      loading.value = false
    }
  }

  const refreshRequests = async (filters: Record<string, string> = {}) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    const suffix = params.toString() ? `?${params.toString()}` : ''
    const value = await session.request<AuditRequest[]>(`/api/platform-admin/support-requests${suffix}`)
    requests.value = value
    resourceUpdatedAt.value = { ...resourceUpdatedAt.value, requests: Date.now() }
    return value
  }
  const updatePrivacyRequest = async (requestId: string, body: { status: string; dueAt?: string; reason: string }) => {
    const updated = await session.request<AuditRequest>(`/api/platform-admin/privacy-requests/${encodeURIComponent(requestId)}`, { method: 'POST', body })
    requests.value = requests.value.map(request => request.id === requestId ? updated : request)
    resourceUpdatedAt.value = { ...resourceUpdatedAt.value, requests: Date.now() }
    return updated
  }
  const loadChatAssignees = () => session.request<Array<{ id: string; name: string }>>('/api/platform-admin/chat-assignees')
  const loadNotifications = async () => {
    notifications.value = await session.request<PlatformNotification[]>('/api/platform-admin/notifications')
    return notifications.value
  }
  const loadSupportMacros = async () => {
    supportMacros.value = await session.request<SupportMacro[]>('/api/platform-admin/support-macros')
    return supportMacros.value
  }
  const loadSupportMetrics = async () => {
    supportMetrics.value = await session.request<SupportMetrics>('/api/platform-admin/support-metrics')
    return supportMetrics.value
  }
  const loadSupportSlaRules = async () => {
    supportSlaRules.value = await session.request<SupportSlaRule[]>('/api/platform-admin/support-sla-rules')
    return supportSlaRules.value
  }
  const loadPlatformPlans = async () => { platformPlans.value = await session.request<PlatformPlan[]>('/api/platform-admin/plans'); return platformPlans.value }
  const loadTenantDetails = async (tenantId: string) => { tenantDetails.value = await session.request<TenantDetails>(`/api/platform-admin/tenants/${encodeURIComponent(tenantId)}/details`); return tenantDetails.value }
  const loadTenantUsers = async (tenantId: string) => { tenantUsers.value = await session.request<TenantUser[]>(`/api/platform-admin/tenants/${encodeURIComponent(tenantId)}/users`); return tenantUsers.value }
  const loadTenantSubscriptionEvents = async (tenantId: string) => { tenantSubscriptionEvents.value = await session.request<TenantSubscriptionEvent[]>(`/api/platform-admin/tenants/${encodeURIComponent(tenantId)}/subscription-events`); return tenantSubscriptionEvents.value }
  const loadTenantBillingRecords = async (tenantId: string) => { tenantBillingRecords.value = await session.request<TenantBillingRecord[]>(`/api/platform-admin/tenants/${encodeURIComponent(tenantId)}/billing-records`); return tenantBillingRecords.value }
  const updateTenantSubscription = async (tenantId: string, body: Record<string, unknown>) => { const value = await session.request<TenantDetails>(`/api/platform-admin/tenants/${encodeURIComponent(tenantId)}/subscription`, { method: 'POST', body }); tenantDetails.value = value; await loadTenantSubscriptionEvents(tenantId); return value }
  const createTenantBillingRecord = async (tenantId: string, body: Record<string, unknown>) => { const value = await session.request<TenantBillingRecord>(`/api/platform-admin/tenants/${encodeURIComponent(tenantId)}/billing-records`, { method: 'POST', body }); tenantBillingRecords.value = [value, ...tenantBillingRecords.value]; await loadTenantSubscriptionEvents(tenantId); return value }
  const updateSupportSlaRule = async (ruleId: string, body: Partial<SupportSlaRule>) => {
    const updated = await session.request<SupportSlaRule>(`/api/platform-admin/support-sla-rules/${encodeURIComponent(ruleId)}`, { method: 'POST', body })
    supportSlaRules.value = supportSlaRules.value.map(rule => rule.id === ruleId ? updated : rule)
    return updated
  }
  const bulkUpdateSupport = async (requestIds: string[], operation: 'claim' | 'status', supportStatus?: string) => {
    const result = await session.request<{ updated: Array<{ id: string; supportStatus: string; chatAssigneeId?: string | null }> }>('/api/platform-admin/support-requests/bulk', { method: 'POST', body: { requestIds, operation, supportStatus } })
    await refreshRequests()
    return result
  }
  const autoAssignSupport = async (requestIds: string[], reason: string) => {
    const result = await session.request<{ updated: Array<{ id: string; supportStatus: string; chatAssigneeId?: string | null }> }>('/api/platform-admin/support-requests/auto-assign', { method: 'POST', body: { requestIds, reason } })
    await refreshRequests()
    return result
  }
  const markNotificationRead = async (notificationId: string) => {
    await session.request(`/api/platform-admin/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' })
    notifications.value = notifications.value.map(notification => notification.id === notificationId ? { ...notification, readAt: new Date().toISOString() } : notification)
  }
  const snoozeSupport = async (requestId: string, until: string) => {
    const updated = await session.request<AuditRequest>(`/api/platform-admin/support-requests/${encodeURIComponent(requestId)}/snooze`, { method: 'POST', body: { until } })
    requests.value = requests.value.map(request => request.id === requestId ? updated : request)
    return updated
  }
  const exportSupportRequestsReport = () => session.download('/api/platform-admin/support-requests/report', 'Relatorio_Solicitacoes_PrintFlow.csv')
  const claimChat = async (requestId: string) => {
    const updated = await session.request<AuditRequest>(`/api/platform-admin/support-requests/${encodeURIComponent(requestId)}/claim`, { method: 'POST', body: {} })
    requests.value = requests.value.map(request => request.id === requestId ? updated : request)
    return updated
  }
  const transferChat = async (requestId: string, targetUserId: string, reason: string) => {
    await session.request(`/api/platform-admin/support-requests/${encodeURIComponent(requestId)}/transfer`, { method: 'POST', body: { targetUserId, reason } })
    await refreshRequests()
  }
  const addChatCollaborator = async (requestId: string, targetUserId: string) => {
    await session.request(`/api/platform-admin/support-requests/${encodeURIComponent(requestId)}/collaborators`, { method: 'POST', body: { targetUserId } })
    await refreshRequests()
  }
  const updateSupportMetadata = async (requestId: string, body: { supportStatus: string; tags: string; firstResponseDueAt?: string; resolutionDueAt?: string }) => {
    const updated = await session.request<AuditRequest>(`/api/platform-admin/support-requests/${encodeURIComponent(requestId)}/metadata`, { method: 'POST', body })
    requests.value = requests.value.map(request => request.id === requestId ? updated : request)
    return updated
  }
  const reopenSupportChat = async (requestId: string, reason: string) => {
    const updated = await session.request<AuditRequest>(`/api/platform-admin/support-requests/${encodeURIComponent(requestId)}/reopen`, { method: 'POST', body: { reason } })
    requests.value = requests.value.map(request => request.id === requestId ? { ...request, ...updated, status: 'under_review', supportStatus: 'reopened' } : request)
    return updated
  }
  const exportPrivacyPortability = (requestId: string) => session.download(`/api/platform-admin/privacy-requests/${encodeURIComponent(requestId)}/export`, `PrintFlow_Portabilidade_${requestId}.csv`)
  const refreshTenants = () => loadTenants(true)

  const activeRequests = computed(() => requests.value.filter(request => isChatOpen(request.status) && request.supportStatus !== 'resolved'))
  const closedRequests = computed(() => requests.value.filter(request => ['closed', 'cancelled', 'expired'].includes(request.status) || request.supportStatus === 'resolved'))

  return {
    session, overview, tenants, requests, messagesByRequest, supportHistory, supportAttachments, authorizedTenantAudit, notifications, supportMacros, supportMetrics, supportSlaRules, tenantDetails, tenantUsers, tenantSubscriptionEvents, tenantBillingRecords, platformPlans, loading, error,
    formatDate, tenantFor, statusLabel, statusClass, isChatOpen, load, loadMessages, loadSupportHistory, loadSupportAttachments, uploadSupportAttachment, downloadSupportAttachment, refreshRequests, updatePrivacyRequest, updateSupportMetadata, reopenSupportChat, snoozeSupport, exportPrivacyPortability, loadChatAssignees, loadNotifications, loadSupportMacros, loadSupportMetrics, loadSupportSlaRules, loadPlatformPlans, loadTenantDetails, loadTenantUsers, loadTenantSubscriptionEvents, loadTenantBillingRecords, updateTenantSubscription, createTenantBillingRecord, updateSupportSlaRule, bulkUpdateSupport, autoAssignSupport, markNotificationRead, exportSupportRequestsReport, claimChat, transferChat, addChatCollaborator, refreshTenants, clearWorkspace, activeRequests, closedRequests
  }
}
