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

export const useAuth = () => {
  const config = useRuntimeConfig()
  const apiBase = String(config.public.apiBase || '').replace(/\/$/, '')
  const token = useState<string>('auth-token', () => '')
  const user = useState<AuthUser | null>('auth-user', () => null)
  const ready = useState('auth-ready', () => false)

  const apiUrl = (path: string) => `${apiBase}${path}`

  const setSession = (session: AuthResponse) => {
    token.value = session.token
    user.value = session.user
    if (process.client) {
      localStorage.setItem(AUTH_TOKEN_KEY, session.token)
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(session.user))
      localStorage.setItem('printflow-workspace-id', session.user.tenantId)
    }
  }

  const restore = () => {
    if (!process.client || ready.value) return

    token.value = localStorage.getItem(AUTH_TOKEN_KEY) || ''
    const storedUser = localStorage.getItem(AUTH_USER_KEY)
    if (storedUser) {
      try {
        user.value = JSON.parse(storedUser)
      } catch {
        user.value = null
      }
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
    token.value = ''
    user.value = null
    if (process.client) {
      localStorage.removeItem(AUTH_TOKEN_KEY)
      localStorage.removeItem(AUTH_USER_KEY)
    }
    await navigateTo('/login')
  }

  const authHeaders = computed(() => token.value ? { Authorization: `Bearer ${token.value}` } : {})

  return {
    token,
    user,
    ready,
    isAuthenticated: computed(() => Boolean(token.value && user.value)),
    authHeaders,
    restore,
    login,
    register,
    logout
  }
}
