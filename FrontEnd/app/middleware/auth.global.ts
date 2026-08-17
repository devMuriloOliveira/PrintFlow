export default defineNuxtRouteMiddleware((to) => {
  const auth = useAuth()
  return auth.restore().then(() => {
    if (to.path === '/login') {
      if (auth.isAuthenticated.value) return navigateTo('/')
      return
    }

    if (!auth.isAuthenticated.value) {
      return navigateTo('/login')
    }
  })
})
