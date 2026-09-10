<script setup lang="ts">
definePageMeta({ layout: false })

const { acceptInvitation } = useAuth()
const route = useRoute()
const loading = ref(false)
const error = ref('')
const form = reactive({ name: '', password: '' })
const token = computed(() => String(route.query.token || ''))

const submit = async () => {
  error.value = ''
  if (!token.value) { error.value = 'Convite invalido ou expirado.'; return }
  loading.value = true
  try {
    await acceptInvitation({ token: token.value, name: form.name, password: form.password })
    await navigateTo('/')
  } catch (err: any) {
    error.value = err?.data?.error || err?.message || 'Nao foi possivel aceitar o convite.'
  } finally { loading.value = false }
}
</script>

<template><main class="auth-page"><section class="auth-panel"><div class="auth-brand"><AppLogo /><p>Voce recebeu um convite para acessar o PrintFlow.</p></div><form class="auth-form" @submit.prevent="submit"><div><span class="auth-kicker">Convite seguro</span><h1>Defina seu acesso</h1></div><label class="field"><span>Nome</span><input v-model="form.name" required autocomplete="name"></label><label class="field"><span>Senha</span><input v-model="form.password" type="password" required minlength="10" autocomplete="new-password" placeholder="Minimo 10 caracteres"></label><p v-if="error" class="auth-error">{{ error }}</p><button class="btn btn--primary auth-submit" type="submit" :disabled="loading">{{ loading ? 'Aguarde...' : 'Ativar acesso' }}</button></form></section></main></template>
