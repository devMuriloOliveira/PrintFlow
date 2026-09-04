import type { SupportRequest } from './useAppData'

export const useSupportRequests = () => {
  const auth = useAuth()
  const api = useAppData()
  const requests = useState<SupportRequest[]>('support-requests', () => [])
  const activeRequestId = useState('support-active-request-id', () => '')
  const loadedTenantId = useState('support-loaded-tenant-id', () => '')
  const activeRequest = computed(() => requests.value.find(request => request.id === activeRequestId.value) || requests.value[0] || null)

  const refresh = async () => {
    const tenantId = auth.user.value?.tenantId || ''
    if (loadedTenantId.value && loadedTenantId.value !== tenantId) {
      requests.value = []
      activeRequestId.value = ''
    }
    requests.value = await api.listSupportRequests()
    loadedTenantId.value = tenantId
    if (!activeRequestId.value && requests.value[0]) activeRequestId.value = requests.value[0].id
    return requests.value
  }

  const createRequest = async (payload: Record<string, unknown>) => {
    const created = await api.createSupportRequest(payload)
    activeRequestId.value = created.id
    await refresh()
    return created
  }

  const cancelRequest = async (id: string) => {
    await api.cancelSupportRequest(id)
    await refresh()
  }

  const selectRequest = (id: string) => { activeRequestId.value = id }

  return { requests, activeRequestId, activeRequest, refresh, createRequest, cancelRequest, selectRequest }
}
