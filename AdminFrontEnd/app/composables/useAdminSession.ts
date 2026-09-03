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
  const download = async (path: string, fallbackFilename: string) => {
    const response = await fetch(`${apiBase}${path}`, { headers: headers.value })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || 'Nao foi possivel gerar o relatorio.')
    }
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    const disposition = response.headers.get('content-disposition') || ''
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackFilename
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }
  return { token, user, headers, restore, login, clear, request, download }
}
