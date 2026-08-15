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
  token: string
}

const AUTH_TOKEN_KEY = 'printflow-auth-token'
const AUTH_USER_KEY = 'printflow-auth-user'
const AUTH_EXPIRES_KEY = 'printflow-auth-expires-at'

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

  const apiUrl = (path: string) => `${apiBase}${path}`

  const clearSession = () => {
    token.value = ''
    user.value = null
    expiresAt.value = 0
    if (logoutTimer) clearTimeout(logoutTimer)
    logoutTimer = undefined

    if (process.client) {
      localStorage.removeItem(AUTH_TOKEN_KEY)
      localStorage.removeItem(AUTH_USER_KEY)
      localStorage.removeItem(AUTH_EXPIRES_KEY)
    }
  }

  const sessionIsExpired = () => !expiresAt.value || expiresAt.value <= Date.now()

  const scheduleLogout = () => {
    if (!process.client) return
    if (logoutTimer) clearTimeout(logoutTimer)

    const delay = expiresAt.value - Date.now()
    if (delay <= 0) {
      clearSession()
      void navigateTo('/login')
      return
    }

    logoutTimer = setTimeout(() => {
      clearSession()
      void navigateTo('/login')
    }, delay)
  }

  const setSession = (session: AuthResponse) => {
    const tokenExpiresAt = decodeTokenExpiresAt(session.token)

    token.value = session.token
    user.value = session.user
    expiresAt.value = tokenExpiresAt || Date.now() + 7 * 24 * 60 * 60 * 1000
    if (process.client) {
      localStorage.setItem(AUTH_TOKEN_KEY, session.token)
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(session.user))
      localStorage.setItem(AUTH_EXPIRES_KEY, String(expiresAt.value))
      localStorage.setItem('printflow-workspace-id', session.user.tenantId)
      scheduleLogout()
    }
  }

  const restore = () => {
    if (!process.client) return

    const storedExpiresAt = Number(localStorage.getItem(AUTH_EXPIRES_KEY) || 0)

    if (storedExpiresAt && storedExpiresAt <= Date.now()) {
      clearSession()
      ready.value = true
      return
    }

    if (ready.value) {
      if (token.value && user.value && expiresAt.value) scheduleLogout()
      return
    }

    token.value = localStorage.getItem(AUTH_TOKEN_KEY) || ''
    expiresAt.value = storedExpiresAt
    const storedUser = localStorage.getItem(AUTH_USER_KEY)
    if (storedUser) {
      try {
        user.value = JSON.parse(storedUser)
      } catch {
        user.value = null
      }
    }

    if (!token.value || !user.value || sessionIsExpired()) {
      clearSession()
    } else {
      scheduleLogout()
    }

    ready.value = true
  }

  const login = async (email: string, password: string) => {
    const session = await $fetch<AuthResponse>(apiUrl('/api/auth/login'), {
      method: 'POST',
      body: { email, password }
    })
    setSession(session)
    return session.user
  }

  const register = async (payload: { name: string; email: string; password: string; company: string }) => {
    const session = await $fetch<AuthResponse>(apiUrl('/api/auth/register'), {
      method: 'POST',
      body: payload
    })
    setSession(session)
    return session.user
  }

  const logout = async () => {
    clearSession()
    await navigateTo('/login')
  }

  const authHeaders = computed(() => token.value && !sessionIsExpired() ? { Authorization: `Bearer ${token.value}` } : {})

  return {
    token,
    user,
    expiresAt,
    ready,
    isAuthenticated: computed(() => Boolean(token.value && user.value && !sessionIsExpired())),
    authHeaders,
    restore,
    login,
    register,
    logout
  }
}
