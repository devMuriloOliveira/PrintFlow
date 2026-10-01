export const useSubscriptionAccess = () => {
  const auth = useAuth()
  const { getSubscriptionAccess } = useAppData()
  const access = useState<Awaited<ReturnType<typeof getSubscriptionAccess>> | null>('subscription-access', () => null)
  const loading = useState('subscription-access-loading', () => false)
  const loaded = useState('subscription-access-loaded', () => false)
  const isDeveloper = computed(() => auth.user.value?.platformRole === 'platform_super_admin' || auth.user.value?.role === 'platform_super_admin')
  const isFree = computed(() => access.value?.planCode === 'free')

  const load = async () => {
    if (loaded.value || loading.value || !auth.user.value || isDeveloper.value) return
    loading.value = true
    try { access.value = await getSubscriptionAccess() } catch { /* O backend continua sendo a fonte de autorizacao. */ }
    finally { loaded.value = true; loading.value = false }
  }

  const isLocked = (to: string) => {
    if (!isFree.value) return false
    if (to.startsWith('/marketplaces')) return access.value?.features.marketplaces === false
    if (to.startsWith('/relatorios')) return access.value?.features.advancedReports === false
    return false
  }

  return { access, loading, loaded, isFree, isDeveloper, load, isLocked, upgradePath: '/perfil?upgrade=1' }
}
