import type { AuditRequest, AuthorizedTenantAudit, Overview, Tenant } from '~/types/platform-admin'

type LoadOptions = { overview?: boolean; tenants?: boolean; requests?: boolean }
const chatOpenStatuses = ['pending', 'under_review', 'approved', 'rejected']

export const usePlatformAdminWorkspace = () => {
  const session = useAdminSession()
  const overview = ref<Overview | null>(null)
  const tenants = ref<Tenant[]>([])
  const requests = ref<AuditRequest[]>([])
  const authorizedTenantAudit = useState<AuthorizedTenantAudit | null>('platform-admin-authorized-tenant-audit', () => null)
  const loading = ref(false)
  const error = ref('')

  const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('pt-BR') : '-'
  const tenantFor = (id: string) => tenants.value.find(tenant => tenant.id === id)
  const statusLabel = (status: string) => ({
    pending: 'Aberta', under_review: 'Em atendimento', approved: 'Aprovada', rejected: 'Rejeitada',
    cancelled: 'Cancelada', closed: 'Encerrada', expired: 'Expirada', active: 'Ativa',
    suspended: 'Suspensa', blocked: 'Bloqueada', overdue: 'Atrasada', not_configured: 'Nao configurada'
  }[status] || status)
  const statusClass = (status: string) => `status-pill status-pill--${status.replace('_', '-')}`
  const isChatOpen = (status: string) => chatOpenStatuses.includes(status)

  const handleLoadError = async (cause: any) => {
    const status = Number(cause?.statusCode || cause?.status || cause?.response?.status || 0)
    if (status === 401 || status === 403) {
      authorizedTenantAudit.value = null
      session.clear()
      await navigateTo('/login')
      return
    }
    error.value = cause?.data?.error || cause?.message || 'Nao foi possivel carregar os dados da plataforma.'
  }

  const ensureSession = async () => {
    session.restore()
    if (session.token.value) return true
    await navigateTo('/login')
    return false
  }

  const load = async (options: LoadOptions) => {
    if (!await ensureSession()) return false
    loading.value = true
    error.value = ''
    try {
      const jobs: Promise<void>[] = []
      if (options.overview) jobs.push(session.request<Overview>('/api/platform-admin/overview').then(value => { overview.value = value }))
      if (options.tenants) jobs.push(session.request<Tenant[]>('/api/platform-admin/tenants').then(value => { tenants.value = value }))
      if (options.requests) jobs.push(session.request<AuditRequest[]>('/api/platform-admin/audit-requests').then(value => { requests.value = value }))
      await Promise.all(jobs)
      return true
    } catch (cause) {
      await handleLoadError(cause)
      return false
    } finally {
      loading.value = false
    }
  }

  const refreshRequests = async () => {
    requests.value = await session.request<AuditRequest[]>('/api/platform-admin/audit-requests')
  }

  const activeRequests = computed(() => requests.value.filter(request => isChatOpen(request.status)))
  const closedRequests = computed(() => requests.value.filter(request => ['closed', 'cancelled', 'expired'].includes(request.status)))

  return {
    session, overview, tenants, requests, authorizedTenantAudit, loading, error,
    formatDate, tenantFor, statusLabel, statusClass, isChatOpen, load, refreshRequests, activeRequests, closedRequests
  }
}
