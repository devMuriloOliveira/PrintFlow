export type TenantMember = {
  userId: string
  name: string
  email: string
  role: 'owner' | 'admin' | 'financeiro' | 'producao' | 'usuario'
  status: 'active' | 'suspended'
  createdAt?: string
  updatedAt?: string
}
export type PendingInvitation = { id: string; email: string; role: TenantMember['role']; expiresAt: string; createdAt: string }

export const useTenantMembers = () => {
  const config = useRuntimeConfig()
  const auth = useAuth()
  const apiBase = String(config.public.apiBase || '').replace(/\/$/, '')
  const members = useState<TenantMember[]>('tenant-members', () => [])
  const loading = useState('tenant-members-loading', () => false)
  const invitations = useState<PendingInvitation[]>('tenant-invitations', () => [])

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

  const refreshInvitations = async () => {
    invitations.value = await $fetch<PendingInvitation[]>(`${apiBase}/api/members/invitations`, { headers: auth.authHeaders.value })
    return invitations.value
  }
  const revokeInvitation = async (id: string) => {
    await $fetch(`${apiBase}/api/members/invitations/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth.authHeaders.value })
    invitations.value = invitations.value.filter((item) => item.id !== id)
  }
  const resendInvitation = async (id: string) => {
    await $fetch(`${apiBase}/api/members/invitations/${encodeURIComponent(id)}/resend`, { method: 'POST', headers: auth.authHeaders.value, body: {} })
    return refreshInvitations()
  }

  return { members, loading, invitations, refreshMembers, updateMember, createInvitation, refreshInvitations, revokeInvitation, resendInvitation }
}
