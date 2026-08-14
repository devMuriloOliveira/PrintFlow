const STORAGE_KEY = 'printflow-workspace-id'

const createWorkspaceId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export const useTenantId = () => {
  const tenantId = useState<string>('printflow-workspace-id', () => '')

  if (process.client && !tenantId.value) {
    tenantId.value = localStorage.getItem(STORAGE_KEY) || createWorkspaceId()
    localStorage.setItem(STORAGE_KEY, tenantId.value)
  }

  return tenantId
}
