<script setup lang="ts">
definePageMeta({ layout: false })

const auth = useAuth()
const { notify } = useUi()
const config = useRuntimeConfig()
const mode = ref<'login' | 'register'>('login')
const loading = ref(false)
const error = ref('')
const mfaChallenge = ref('')
const mfaCode = ref('')
const form = reactive({
  name: '',
  company: '',
  email: '',
  password: '',
  passwordConfirmation: ''
})

const title = computed(() => mode.value === 'login' ? 'Entrar no PrintFlow' : 'Criar conta')
const actionLabel = computed(() => mode.value === 'login' ? 'Entrar' : 'Criar conta e entrar')
const apiBase = computed(() => String(config.public.apiBase || '').replace(/\/$/, ''))

const submit = async () => {
  error.value = ''
  if (mode.value === 'register' && form.password !== form.passwordConfirmation) {
    error.value = 'As senhas nao conferem.'
    return
  }
  loading.value = true

  try {
    if (mode.value === 'login') {
      if (mfaChallenge.value) {
        await auth.completeMfaLogin(mfaChallenge.value, mfaCode.value)
        mfaChallenge.value = ''
      } else {
        const result = await auth.login(form.email, form.password)
        if (result?.mfaRequired) { mfaChallenge.value = result.challengeToken || ''; return }
      }
      notify(auth.tenantDeletionCancelled.value ? 'A exclusao da empresa foi cancelada pelo seu login.' : 'Login realizado com sucesso.')
    } else {
      const result = await auth.register({
        name: form.name,
        company: form.company,
        email: form.email,
        password: form.password
      })
      if (result.verificationRequired) {
        notify('Verifique seu e-mail para ativar a conta.')
        return
      }
      notify('Conta criada com sucesso.')
    }
    await navigateTo('/')
  } catch (err: any) {
    const isNetworkError = err?.message === 'Failed to fetch' || err?.cause?.message === 'Failed to fetch'
    error.value = isNetworkError
      ? 'Nao foi possivel conectar ao servico. Verifique sua internet e tente novamente.'
      : err?.data?.error || err?.message || 'Não foi possível autenticar.'
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
        <p>Gestão financeira e operacional para impressão 3D.</p>
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
          <input v-model="form.password" type="password" autocomplete="current-password" required minlength="10" placeholder="Mínimo 10 caracteres">
        </label>

        <label v-if="mode === 'register'" class="field">
          <span>Confirmar senha</span>
          <input v-model="form.passwordConfirmation" type="password" autocomplete="new-password" required minlength="10" placeholder="Digite a senha novamente">
        </label>

        <label v-if="mode === 'login' && mfaChallenge" class="field">
          <span>Codigo do aplicativo autenticador</span>
          <input v-model="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required placeholder="000000">
        </label>

        <p v-if="mode === 'register'" class="auth-hint">Use 10 caracteres, letras maiusculas e minusculas, numero e caractere especial.</p>
        <NuxtLink v-if="mode === 'login' && !mfaChallenge" class="auth-recovery" to="/redefinir-senha">Esqueci minha senha</NuxtLink>
        <p v-if="error" class="auth-error">{{ error }}</p>

        <button class="btn btn--primary auth-submit" type="submit" :disabled="loading">
          <UiIcon name="shield" :size="18" />
          <span>{{ loading ? 'Aguarde...' : (mfaChallenge ? 'Confirmar codigo' : actionLabel) }}</span>
        </button>
      </form>
    </section>
  </main>
</template>
