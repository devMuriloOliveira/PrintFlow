export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login' || to.path === '/perfil') return
  const access = useSubscriptionAccess()
  await access.load()
  if (access.isLocked(to.path)) return navigateTo(access.upgradePath)
})
