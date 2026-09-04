import type { AuditRequest, AuthorizedTenantAudit, Message, Overview, Tenant } from '~/types/platform-admin'

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

  const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('pt-BR') : '-'
  const tenantFor = (id: string) => tenants.value.find(tenant => tenant.id === id)
  const statusLabel = (status: string) => ({
    pending: 'Aberta', under_review: 'Em atendimento', approved: 'Aprovada', rejected: 'Rejeitada',
    cancelled: 'Cancelada', closed: 'Encerrada', expired: 'Expirada', active: 'Ativa',
    suspended: 'Suspensa', blocked: 'Bloqueada', overdue: 'Atrasada', not_configured: 'Nao configurada'
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
    session.restore()
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

  const refreshRequests = () => loadRequests(true)

  const activeRequests = computed(() => requests.value.filter(request => isChatOpen(request.status)))
  const closedRequests = computed(() => requests.value.filter(request => ['closed', 'cancelled', 'expired'].includes(request.status)))

  return {
    session, overview, tenants, requests, messagesByRequest, authorizedTenantAudit, loading, error,
    formatDate, tenantFor, statusLabel, statusClass, isChatOpen, load, loadMessages, refreshRequests, clearWorkspace, activeRequests, closedRequests
  }
}
