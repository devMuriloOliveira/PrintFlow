type AdminUser = { id: string; name: string; email: string; role: string }

const TOKEN_KEY = 'printflow-platform-admin-token'
const USER_KEY = 'printflow-platform-admin-user'

export const useAdminSession = () => {
  const config = useRuntimeConfig()
  const apiBase = String(config.public.apiBase || '').replace(/\/$/, '')
  const token = useState<string>('platform-admin-token', () => '')
  const user = useState<AdminUser | null>('platform-admin-user', () => null)

  const headers = computed(() => token.value ? { Authorization: `Bearer ${token.value}` } : {})
  const clear = () => {
    token.value = ''; user.value = null
    if (process.client) { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY) }
  }
  const restore = () => {
    if (!process.client || token.value) return
    token.value = sessionStorage.getItem(TOKEN_KEY) || ''
    try { user.value = JSON.parse(sessionStorage.getItem(USER_KEY) || 'null') } catch { clear() }
  }
  const login = async (email: string, password: string) => {
    const session = await $fetch<{ accessToken: string; user: AdminUser }>(`${apiBase}/api/auth/login`, { method: 'POST', body: { email, password } })
    token.value = session.accessToken
    user.value = session.user
    if (process.client) { sessionStorage.setItem(TOKEN_KEY, token.value); sessionStorage.setItem(USER_KEY, JSON.stringify(user.value)) }
    await $fetch(`${apiBase}/api/platform-admin/overview`, { headers: headers.value }).catch((error) => { clear(); throw error })
  }
  const request = <T>(path: string, options: Record<string, unknown> = {}) => $fetch<T>(`${apiBase}${path}`, { ...options, headers: { ...headers.value, ...(options.headers as Record<string, string> || {}) } })
  return { token, user, headers, restore, login, clear, request }
}
