export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return

  const session = useAdminSession()
  await session.restore()

  if (!session.user.value || session.user.value.platformRole !== 'platform_super_admin') {
    session.clear()
    return navigateTo('/login')
  }
})
