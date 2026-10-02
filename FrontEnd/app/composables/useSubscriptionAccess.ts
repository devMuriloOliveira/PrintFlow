export const useSubscriptionAccess = () => {
  const auth = useAuth()
  const { getSubscriptionAccess } = useAppData()
  const access = useState<Awaited<ReturnType<typeof getSubscriptionAccess>> | null>('subscription-access', () => null)
  const loading = useState('subscription-access-loading', () => false)
  const loaded = useState('subscription-access-loaded', () => false)
  const error = useState<string | null>('subscription-access-error', () => null)
  const isDeveloper = computed(() => auth.user.value?.platformRole === 'platform_super_admin' || auth.user.value?.role === 'platform_super_admin')
  const isFree = computed(() => access.value?.planCode === 'free')
  const isLimitReached = (resource: string) => {
    const usage = access.value?.usage?.[resource]
    return Boolean(isFree.value && usage && usage.used >= usage.limit)
  }

  const load = async (force = false) => {
    if (force) loaded.value = false
    if (loading.value) {
      if (!force) return
      await new Promise<void>((resolve) => {
        const stop = watch(loading, (active) => {
          if (!active) {
            stop()
            resolve()
          }
        })
      })
      return load(true)
    }
    if (loaded.value || !auth.user.value || isDeveloper.value) return
    loading.value = true
    error.value = null
    try {
      access.value = await getSubscriptionAccess()
    } catch {
      access.value = null
      error.value = 'Não foi possível consultar o plano agora.'
    }
    finally { loaded.value = true; loading.value = false }
  }

  const refreshAfterLimitError = async (error: unknown) => {
    const apiError = error as { data?: { error?: string }; message?: string }
    const message = apiError?.data?.error || apiError?.message || ''
    if (!/plano atual permite no maximo/i.test(String(message))) return false
    await load(true)
    return true
  }

  const isLocked = (to: string) => {
    if (!isFree.value) return false
    if (to.startsWith('/marketplaces')) return access.value?.features.marketplaces === false
    if (to.startsWith('/relatorios')) return access.value?.features.advancedReports === false
    return false
  }

  return { access, loading, loaded, error, isFree, isDeveloper, load, refreshAfterLimitError, isLocked, isLimitReached, upgradePath: '/perfil?upgrade=1' }
}
