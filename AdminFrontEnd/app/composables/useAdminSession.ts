type AdminUser = { id: string; name: string; email: string; role: string }

export const useAdminSession = () => {
  const config = useRuntimeConfig()
  const apiBase = String(config.public.apiBase || '').replace(/\/$/, '')
  const token = useState<string>('platform-admin-token', () => '')
  const user = useState<AdminUser | null>('platform-admin-user', () => null)

  const headers = computed(() => token.value ? { Authorization: `Bearer ${token.value}` } : {})
  const clear = () => {
    token.value = ''; user.value = null
  }
  const restore = async () => {
    if (!process.client || token.value) return
    try {
      const session = await $fetch<{ accessToken: string; user: AdminUser }>(`${apiBase}/api/auth/refresh`, {
        method: 'POST', credentials: 'include'
      })
      token.value = session.accessToken
      user.value = session.user
    } catch { clear() }
  }
  const login = async (email: string, password: string) => {
    const session = await $fetch<{ accessToken: string; user: AdminUser }>(`${apiBase}/api/auth/login`, { method: 'POST', body: { email, password }, credentials: 'include' })
    token.value = session.accessToken
    user.value = session.user
    await $fetch(`${apiBase}/api/platform-admin/overview`, { headers: headers.value }).catch((error) => { clear(); throw error })
  }
  const logout = async () => {
    try { await $fetch(`${apiBase}/api/auth/logout`, { method: 'POST', credentials: 'include' }) }
    finally { clear() }
  }
  const request = <T>(path: string, options: Record<string, unknown> = {}) => $fetch<T>(`${apiBase}${path}`, { ...options, credentials: 'include', headers: { ...headers.value, ...(options.headers as Record<string, string> || {}) } })
  const download = async (path: string, fallbackFilename: string) => {
    const response = await fetch(`${apiBase}${path}`, { credentials: 'include', headers: headers.value })
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
  return { token, user, headers, restore, login, logout, clear, request, download }
}
