export default defineNuxtRouteMiddleware((to) => {
  const auth = useAuth()
  auth.restore()

  if (to.path === '/login') {
    if (auth.isAuthenticated.value) return navigateTo('/')
    return
  }

  if (!auth.isAuthenticated.value) {
    return navigateTo('/login')
  }
})
