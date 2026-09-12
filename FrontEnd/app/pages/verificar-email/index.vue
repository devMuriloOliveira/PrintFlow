<script setup lang="ts">
definePageMeta({ layout: false })
const route = useRoute()
const config = useRuntimeConfig()
const status = ref<'loading' | 'success' | 'error'>('loading')
const message = ref('Validando seu e-mail...')
onMounted(async () => {
  const token = String(route.query.token || '')
  if (!token) { status.value = 'error'; message.value = 'Link de verificacao invalido.'; return }
  try {
    await $fetch(`${String(config.public.apiBase || '').replace(/\/$/, '')}/api/auth/verify-email`, { method: 'POST', body: { token } })
    status.value = 'success'; message.value = 'E-mail confirmado. Agora voce ja pode entrar.'
  } catch (error: any) { status.value = 'error'; message.value = error?.data?.error || error?.message || 'Nao foi possivel confirmar o e-mail.' }
})
</script>
<template><main class="auth-page"><section class="auth-panel"><div class="auth-brand"><AppLogo /><p>Seguranca para sua operacao.</p></div><div class="auth-form"><span class="auth-kicker">Confirmacao de e-mail</span><h1>{{ status === 'loading' ? 'Aguarde' : status === 'success' ? 'Tudo certo' : 'Link invalido' }}</h1><p :class="status === 'error' ? 'auth-error' : 'auth-hint'">{{ message }}</p><NuxtLink class="btn btn--primary auth-submit" to="/login">Ir para o login</NuxtLink></div></section></main></template>
