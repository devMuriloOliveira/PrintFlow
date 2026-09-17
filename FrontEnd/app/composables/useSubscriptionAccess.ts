const activeSubscriptionStatuses = new Set(['trial', 'active', 'past_due', 'grace', 'paused'])
const lockedPrefixes = ['/vendas', '/produtos', '/clientes', '/marketplaces', '/filamentos', '/impressoras', '/estoque', '/despesas', '/relatorios', '/metas']

export const useSubscriptionAccess = () => {
  const auth = useAuth()
  const { getStripeBilling } = useAppData()
  const billing = useState<Awaited<ReturnType<typeof getStripeBilling>> | null>('subscription-access-billing', () => null)
  const loading = useState('subscription-access-loading', () => false)
  const loaded = useState('subscription-access-loaded', () => false)
  const isDeveloper = computed(() => auth.user.value?.platformRole === 'platform_super_admin' || auth.user.value?.role === 'platform_super_admin')
  const isOwner = computed(() => auth.user.value?.role === 'owner')
  const hasActiveSubscription = computed(() => {
    const subscription = billing.value?.subscription
    return Boolean(subscription && subscription.planCode !== 'free' && activeSubscriptionStatuses.has(subscription.status))
  })

  const load = async () => {
    if (loaded.value || loading.value || !isOwner.value || isDeveloper.value) return
    loading.value = true
    try { billing.value = await getStripeBilling() } catch { /* O backend continua sendo a fonte de autorizacao. */ }
    finally { loaded.value = true; loading.value = false }
  }

  const isLocked = (to: string) => {
    if (!isOwner.value || isDeveloper.value || !loaded.value || hasActiveSubscription.value) return false
    const path = String(to).split('?')[0]
    return lockedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  }

  return { billing, loading, loaded, hasActiveSubscription, isDeveloper, load, isLocked, upgradePath: '/perfil?upgrade=1' }
}
