export default defineNuxtRouteMiddleware((to) => {
  const auth = useAuth()
  const publicRoutes = ['/login', '/redefinir-senha', '/verificar-email', '/aceitar-convite']

  return auth.restore().then(() => {
    if (publicRoutes.includes(to.path)) {
      if (auth.isAuthenticated.value) return navigateTo('/')
      return
    }

    if (!auth.isAuthenticated.value) {
      return navigateTo('/login')
    }
  })
})
