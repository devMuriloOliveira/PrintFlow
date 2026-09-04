import type { SupportRequest } from './useAppData'

export const useSupportRequests = () => {
  const auth = useAuth()
  const api = useAppData()
  const requests = useState<SupportRequest[]>('support-requests', () => [])
  const activeRequestId = useState('support-active-request-id', () => '')
  const loadedTenantId = useState('support-loaded-tenant-id', () => '')
  const openChatStatuses = ['pending', 'under_review', 'approved', 'rejected']
  const activeRequest = computed(() => {
    const openRequests = requests.value.filter(request => openChatStatuses.includes(request.status))
    return openRequests.find(request => request.id === activeRequestId.value) || openRequests[0] || null
  })

  const refresh = async () => {
    const tenantId = auth.user.value?.tenantId || ''
    if (loadedTenantId.value && loadedTenantId.value !== tenantId) {
      requests.value = []
      activeRequestId.value = ''
    }
    requests.value = await api.listSupportRequests()
    loadedTenantId.value = tenantId
    const selectedRequest = requests.value.find(request => request.id === activeRequestId.value)
    if (!selectedRequest || !openChatStatuses.includes(selectedRequest.status)) activeRequestId.value = activeRequest.value?.id || ''
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
