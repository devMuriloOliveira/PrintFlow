type AuthUser = {
  id: string
  tenantId: string
  name: string
  email: string
  role: string
  status: string
}

type AuthResponse = {
  user: AuthUser
  accessToken?: string
  token?: string
  deletionCancelled?: boolean
}

export type AuthSession = { sessionId: string; createdAt: string; expiresAt: string; lastSeenAt: string; deviceLabel: string; ipMasked: string }

let logoutTimer: ReturnType<typeof setTimeout> | undefined

const decodeTokenExpiresAt = (token: string) => {
  try {
    const payload = token.split('.')[1]
    if (!payload) return 0

    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const parsed = JSON.parse(atob(padded))
    return Number(parsed.exp || 0) * 1000
  } catch {
    return 0
  }
}

export const useAuth = () => {
  const config = useRuntimeConfig()
  const apiBase = String(config.public.apiBase || '').replace(/\/$/, '')
  const token = useState<string>('auth-token', () => '')
  const user = useState<AuthUser | null>('auth-user', () => null)
  const expiresAt = useState<number>('auth-expires-at', () => 0)
  const ready = useState('auth-ready', () => false)
  const tenantDeletionCancelled = useState('tenant-deletion-cancelled', () => false)

  const apiUrl = (path: string) => `${apiBase}${path}`

  const clearSession = () => {
    token.value = ''
    user.value = null
    expiresAt.value = 0
    if (logoutTimer) clearTimeout(logoutTimer)
    logoutTimer = undefined

  }

  const sessionIsExpired = () => !expiresAt.value || expiresAt.value <= Date.now()

  const scheduleLogout = () => {
    if (!process.client) return
    if (logoutTimer) clearTimeout(logoutTimer)

    const delay = expiresAt.value - Date.now()
    if (delay <= 0) {
      void refreshSession().catch(() => {
        clearSession()
        void navigateTo('/login')
      })
      return
    }

    logoutTimer = setTimeout(() => {
      void refreshSession().catch(() => {
        clearSession()
        void navigateTo('/login')
      })
    }, delay)
  }

  const setSession = (session: AuthResponse) => {
    const accessToken = session.accessToken || session.token || ''
    const tokenExpiresAt = decodeTokenExpiresAt(accessToken)

    token.value = accessToken
    user.value = session.user
    expiresAt.value = tokenExpiresAt || Date.now() + 15 * 60 * 1000
    if (process.client) {
      scheduleLogout()
    }
  }

  const refreshSession = async () => {
    const session = await $fetch<AuthResponse>(apiUrl('/api/auth/refresh'), {
      method: 'POST',
      credentials: 'include'
    })
    setSession(session)
    return session.user
  }

  const restore = async () => {
    if (!process.client) return

    if (ready.value) {
      if (token.value && user.value && expiresAt.value) scheduleLogout()
      return
    }

    try {
      await refreshSession()
    } catch {
      clearSession()
    }

    ready.value = true
  }

  const login = async (email: string, password: string) => {
    const session = await $fetch<AuthResponse>(apiUrl('/api/auth/login'), {
      method: 'POST',
      body: { email, password },
      credentials: 'include'
    })
    setSession(session)
    tenantDeletionCancelled.value = Boolean(session.deletionCancelled)
    return session.user
  }

  const register = async (payload: { name: string; email: string; password: string; company: string }) => {
    const session = await $fetch<AuthResponse>(apiUrl('/api/auth/register'), {
      method: 'POST',
      body: payload,
      credentials: 'include'
    })
    setSession(session)
    return session.user
  }

  const acceptInvitation = async (payload: { token: string; name: string; password: string }) => {
    const session = await $fetch<AuthResponse>(apiUrl('/api/auth/invitations/accept'), { method: 'POST', body: payload, credentials: 'include' })
    setSession(session)
    tenantDeletionCancelled.value = Boolean(session.deletionCancelled)
    return session.user
  }

  const listSessions = () => $fetch<AuthSession[]>(apiUrl('/api/auth/sessions'), { headers: authHeaders.value })
  const revokeSession = (sessionId: string) => $fetch(apiUrl(`/api/auth/sessions/${encodeURIComponent(sessionId)}`), { method: 'DELETE', headers: authHeaders.value })
  const revokeAllSessions = () => $fetch(apiUrl('/api/auth/sessions/revoke-all'), { method: 'POST', headers: authHeaders.value })
  const changePassword = async (currentPassword: string, newPassword: string) => {
    const session = await $fetch<AuthResponse>(apiUrl('/api/auth/change-password'), {
      method: 'POST',
      headers: authHeaders.value,
      body: { currentPassword, newPassword },
      credentials: 'include'
    })
    setSession(session)
    return session.user
  }

  const requestTenantDeletion = (currentPassword: string) => $fetch<{ scheduledFor: string }>(apiUrl('/api/auth/tenant-deletion-request'), {
    method: 'POST', headers: authHeaders.value,
    body: { currentPassword, confirmation: 'EXCLUIR', acknowledgedCancellation: true }
  })

  const logout = async () => {
    try {
      await $fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        credentials: 'include'
      })
    } catch {
      // Local logout still proceeds if the session is already invalid server-side.
    }
    clearSession()
    await navigateTo('/login')
  }

  const authHeaders = computed(() => token.value && !sessionIsExpired() ? { Authorization: `Bearer ${token.value}` } : {})

  return {
    token,
    user,
    expiresAt,
    ready,
    tenantDeletionCancelled,
    isAuthenticated: computed(() => Boolean(token.value && user.value && !sessionIsExpired())),
    authHeaders,
    clearSession,
    restore,
    refreshSession,
    login,
    register,
    acceptInvitation,
    listSessions,
    revokeSession,
    revokeAllSessions,
    changePassword,
    requestTenantDeletion,
    logout
  }
}
