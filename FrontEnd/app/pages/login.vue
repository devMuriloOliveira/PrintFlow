<script setup lang="ts">
definePageMeta({ layout: false })

const auth = useAuth()
const { notify } = useUi()
const config = useRuntimeConfig()
const mode = ref<'login' | 'register'>('login')
const loading = ref(false)
const error = ref('')
const form = reactive({
  name: '',
  company: '',
  email: '',
  password: ''
})

const title = computed(() => mode.value === 'login' ? 'Entrar no PrintFlow' : 'Criar conta')
const actionLabel = computed(() => mode.value === 'login' ? 'Entrar' : 'Criar conta e entrar')
const apiBase = computed(() => String(config.public.apiBase || '').replace(/\/$/, ''))

const submit = async () => {
  error.value = ''
  loading.value = true

  try {
    if (mode.value === 'login') {
      await auth.login(form.email, form.password)
      notify('Login realizado com sucesso.')
    } else {
      await auth.register({
        name: form.name,
        company: form.company,
        email: form.email,
        password: form.password
      })
      notify('Conta criada com sucesso.')
    }
    await navigateTo('/')
  } catch (err: any) {
    const isNetworkError = err?.message === 'Failed to fetch' || err?.cause?.message === 'Failed to fetch'
    error.value = isNetworkError
      ? `Nao foi possivel conectar na API (${apiBase.value}). Verifique se o backend esta rodando.`
      : err?.data?.error || err?.message || 'Nao foi possivel autenticar.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-panel">
      <div class="auth-brand">
        <AppLogo />
        <p>Gestao financeira e operacional para impressao 3D.</p>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <div>
          <span class="auth-kicker">Acesso seguro</span>
          <h1>{{ title }}</h1>
        </div>

        <div class="auth-tabs" role="tablist">
          <button type="button" :class="{ 'auth-tabs__item--active': mode === 'login' }" class="auth-tabs__item" @click="mode = 'login'">Entrar</button>
          <button type="button" :class="{ 'auth-tabs__item--active': mode === 'register' }" class="auth-tabs__item" @click="mode = 'register'">Criar conta</button>
        </div>

        <label v-if="mode === 'register'" class="field">
          <span>Nome</span>
          <input v-model="form.name" autocomplete="name" required placeholder="Seu nome">
        </label>

        <label v-if="mode === 'register'" class="field">
          <span>Empresa</span>
          <input v-model="form.company" autocomplete="organization" required placeholder="Nome da empresa">
        </label>

        <label class="field">
          <span>E-mail</span>
          <input v-model="form.email" type="email" autocomplete="email" required placeholder="voce@empresa.com">
        </label>

        <label class="field">
          <span>Senha</span>
          <input v-model="form.password" type="password" autocomplete="current-password" required minlength="6" placeholder="Minimo 6 caracteres">
        </label>

        <p v-if="error" class="auth-error">{{ error }}</p>

        <button class="btn btn--primary auth-submit" type="submit" :disabled="loading">
          <UiIcon name="shield" :size="18" />
          <span>{{ loading ? 'Aguarde...' : actionLabel }}</span>
        </button>
      </form>
    </section>
  </main>
</template>
