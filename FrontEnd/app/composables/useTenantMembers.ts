export type TenantMember = {
  userId: string
  name: string
  email: string
  role: 'owner' | 'admin' | 'financeiro' | 'producao' | 'usuario'
  status: 'active' | 'suspended'
  createdAt?: string
  updatedAt?: string
}

export const useTenantMembers = () => {
  const config = useRuntimeConfig()
  const auth = useAuth()
  const apiBase = String(config.public.apiBase || '').replace(/\/$/, '')
  const members = useState<TenantMember[]>('tenant-members', () => [])
  const loading = useState('tenant-members-loading', () => false)

  const refreshMembers = async () => {
    if (!process.client || loading.value || !auth.authHeaders.value.Authorization) return members.value

    loading.value = true
    try {
      members.value = await $fetch<TenantMember[]>(`${apiBase}/api/members`, {
        headers: auth.authHeaders.value
      })
    } finally {
      loading.value = false
    }

    return members.value
  }

  const updateMember = async (userId: string, payload: Pick<TenantMember, 'role' | 'status'>) => {
    const member = await $fetch<TenantMember>(`${apiBase}/api/members/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: auth.authHeaders.value,
      body: payload
    })

    members.value = members.value.map((item) => item.userId === member.userId ? member : item)
    return member
  }

  const createInvitation = async (payload: { email: string; role: TenantMember['role'] }) =>
    $fetch(`${apiBase}/api/members/invitations`, { method: 'POST', headers: auth.authHeaders.value, body: payload })

  return { members, loading, refreshMembers, updateMember, createInvitation }
}
