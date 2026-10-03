<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const config = useRuntimeConfig()

const apiBase = computed(() => String(config.public.apiBase || '').replace(/\/$/, ''))
const token = computed(() => String(route.query.token || ''))
const hasToken = computed(() => Boolean(token.value))
const email = ref('')
const password = ref('')
const confirmation = ref('')
const showPassword = ref(false)
const loading = ref(false)
const sent = ref(false)
const resetDone = ref(false)
const message = ref('')
const error = ref('')

const passwordType = computed(() => showPassword.value ? 'text' : 'password')
const title = computed(() => hasToken.value ? 'Defina sua nova senha' : 'Recupere seu acesso')
const subtitle = computed(() => hasToken.value
  ? 'Crie uma senha forte para voltar a acessar sua conta.'
  : 'Informe o e-mail cadastrado e enviaremos um link seguro de redefinicao.'
)
const actionLabel = computed(() => {
  if (loading.value) return 'Aguarde...'
  return hasToken.value ? 'Redefinir senha' : 'Enviar link de recuperacao'
})
const passwordRules = computed(() => [
  { label: '10 caracteres', met: password.value.length >= 10 },
  { label: 'Maiuscula', met: /[A-Z]/.test(password.value) },
  { label: 'Minuscula', met: /[a-z]/.test(password.value) },
  { label: 'Numero', met: /[0-9]/.test(password.value) },
  { label: 'Especial', met: /[^A-Za-z0-9]/.test(password.value) }
])
const passwordReady = computed(() => passwordRules.value.every(rule => rule.met) && password.value === confirmation.value)

const submit = async () => {
  error.value = ''
  message.value = ''

  if (hasToken.value) {
    if (password.value !== confirmation.value) {
      error.value = 'As senhas nao conferem.'
      return
    }
    if (!passwordReady.value) {
      error.value = 'A senha precisa cumprir todos os requisitos de seguranca.'
      return
    }
  }

  loading.value = true
  try {
    if (hasToken.value) {
      await $fetch(`${apiBase.value}/api/auth/password-reset/confirm`, {
        method: 'POST',
        body: { token: token.value, newPassword: password.value }
      })
      resetDone.value = true
      message.value = 'Senha redefinida com sucesso. Voce ja pode entrar com a nova senha.'
      password.value = ''
      confirmation.value = ''
    } else {
      await $fetch(`${apiBase.value}/api/auth/password-reset/request`, {
        method: 'POST',
        body: { email: email.value }
      })
      sent.value = true
      message.value = 'Se esse e-mail estiver cadastrado, enviamos as instrucoes de recuperacao.'
    }
  } catch (cause: any) {
    const isNetworkError = cause?.message === 'Failed to fetch' || cause?.cause?.message === 'Failed to fetch'
    error.value = isNetworkError
      ? 'Nao foi possivel conectar ao servico. Verifique sua internet e tente novamente.'
      : cause?.data?.error || cause?.message || 'Nao foi possivel processar a solicitacao.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="password-reset-page">
    <section class="password-reset-shell">
      <aside class="password-reset-context" aria-label="Seguranca da conta">
        <div class="password-reset-context__top"><span /> Filamind</div>
        <div class="password-reset-context__content">
          <span class="auth-kicker">ACESSO SEGURO</span>
          <h2>Volte para sua operacao sem perder o ritmo.</h2>
          <p>O link enviado por e-mail expira em 15 minutos e pode ser usado apenas uma vez.</p>
        </div>
        <div class="password-reset-context__footer"><UiIcon name="shield" :size="16" /> Protecao por link temporario</div>
      </aside>

      <div class="password-reset-card">
        <header class="password-reset-card__header">
          <AppLogo />
          <NuxtLink to="/login">Entrar</NuxtLink>
        </header>

        <div class="password-reset-copy">
          <span class="auth-kicker">{{ hasToken ? 'NOVA SENHA' : 'ESQUECI MINHA SENHA' }}</span>
          <h1>{{ title }}</h1>
          <p>{{ subtitle }}</p>
        </div>

        <form class="auth-form" @submit.prevent="submit">
          <label v-if="!hasToken" class="field">
            <span>E-mail</span>
            <input v-model="email" type="email" autocomplete="email" required placeholder="voce@empresa.com">
          </label>

          <template v-else>
            <label class="field">
              <span>Nova senha</span>
              <span class="auth-password-input">
                <input v-model="password" :type="passwordType" autocomplete="new-password" minlength="10" required placeholder="Crie uma senha forte">
                <button type="button" @click="showPassword = !showPassword">{{ showPassword ? 'Ocultar' : 'Mostrar' }}</button>
              </span>
            </label>
            <label class="field">
              <span>Confirmar nova senha</span>
              <input v-model="confirmation" :type="passwordType" autocomplete="new-password" minlength="10" required placeholder="Repita a nova senha">
            </label>
            <ul class="password-reset-rules" aria-label="Requisitos da senha">
              <li v-for="rule in passwordRules" :key="rule.label" :class="{ 'is-met': rule.met }">
                <UiIcon :name="rule.met ? 'check' : 'close'" :size="13" />{{ rule.label }}
              </li>
            </ul>
          </template>

          <p v-if="message" class="password-reset-message" role="status">{{ message }}</p>
          <p v-if="error" class="auth-error" role="alert">{{ error }}</p>

          <button class="auth-submit" type="submit" :disabled="loading || resetDone">
            <span>{{ resetDone ? 'Senha atualizada' : actionLabel }}</span>
            <UiIcon name="chevron" :size="17" />
          </button>

          <p v-if="sent && !hasToken" class="password-reset-help">Nao encontrou o e-mail? Confira spam, lixeira ou solicite novamente daqui a pouco.</p>
          <NuxtLink class="password-reset-back" to="/login">Voltar para o login</NuxtLink>
        </form>
      </div>
    </section>
  </main>
</template>

<style scoped>
.password-reset-page{min-height:100svh;background:#eef3fa;color:var(--ink)}
.password-reset-shell{display:grid;min-height:100svh;grid-template-columns:minmax(0,1.05fr) minmax(420px,.95fr);align-items:center}
.password-reset-context{position:relative;display:flex;min-height:100svh;box-sizing:border-box;flex-direction:column;justify-content:space-between;padding:40px clamp(24px,4vw,64px);color:#e5efff;background-image:linear-gradient(180deg,rgba(3,15,43,.18),rgba(3,15,43,.08) 38%,rgba(3,15,43,.94) 86%),url('~/assets/img/imagemLoginEntrar.png');background-size:cover;background-position:65% center}
.password-reset-context__top,.password-reset-context__footer{display:flex;align-items:center;gap:8px;color:#b7c8e4;font-size:11px;font-weight:750}
.password-reset-context__top span{width:8px;height:8px;border-radius:50%;background:var(--blue);box-shadow:0 0 0 4px rgba(23,104,242,.15)}
.password-reset-context__content{max-width:440px;margin:auto 0 28px;padding-top:clamp(180px,28vh,340px)}
.password-reset-context h2{margin:13px 0;color:#f4f8ff;font-size:clamp(29px,3vw,42px);letter-spacing:0;line-height:1.12}
.password-reset-context p{margin:0;color:#b7c8e4;font-size:14px;line-height:1.65}
.password-reset-context__footer{padding-top:20px;border-top:1px solid rgba(183,200,228,.17)}
.password-reset-card{width:min(520px,calc(100% - 64px));box-sizing:border-box;justify-self:center;margin:40px 0;padding:32px clamp(24px,3vw,44px);border:1px solid rgba(255,255,255,.8);border-radius:24px;background:var(--surface);box-shadow:0 24px 70px rgba(16,38,79,.15),0 3px 12px rgba(16,38,79,.05)}
.password-reset-card__header{display:flex;align-items:center;justify-content:space-between;gap:20px}
.password-reset-card__header :deep(.brand){gap:10px}
.password-reset-card__header :deep(.brand__mark){width:32px;height:32px}
.password-reset-card__header :deep(.brand__name){color:var(--ink);font-size:18px;letter-spacing:0}
.password-reset-card__header a,.password-reset-back{color:var(--blue);font-size:12px;font-weight:800;text-decoration:none}
.password-reset-copy{margin:42px 0 26px}
.auth-kicker{display:block;color:var(--blue);font-size:10px;font-weight:800;letter-spacing:.11em}
.password-reset-copy h1{margin:10px 0 8px;color:var(--ink);font-size:clamp(27px,2.6vw,34px);letter-spacing:0;line-height:1.15}
.password-reset-copy p{margin:0;color:var(--muted);font-size:14px;line-height:1.55}
.auth-form{display:grid;gap:15px;margin-top:24px;padding:0}
.field{display:grid;gap:7px;color:var(--text);font-size:12px;font-weight:750}
.field input{width:100%;min-width:0;min-height:46px;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;outline:0;color:var(--ink);background:var(--surface);padding:12px 13px;font:inherit;font-size:16px;transition:border-color .16s,box-shadow .16s}
.field input::placeholder{color:var(--muted)}
.field input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(23,104,242,.12)}
.auth-password-input{position:relative;display:block}
.auth-password-input input{padding-right:78px}
.auth-password-input button{position:absolute;right:8px;top:50%;border:0;border-radius:5px;color:var(--blue);background:var(--blue-soft);padding:5px 8px;font:inherit;font-size:10px;font-weight:800;transform:translateY(-50%);cursor:pointer}
.password-reset-rules{display:flex;flex-wrap:wrap;gap:7px 13px;margin:-2px 0 0;padding:0;list-style:none}
.password-reset-rules li{display:inline-flex;align-items:center;gap:4px;color:#8792a4;font-size:10px;font-weight:700}
.password-reset-rules li.is-met{color:#18774d}
.password-reset-message{margin:0;border:1px solid #bfe8d3;border-radius:8px;color:#17633f;background:#f2fbf6;padding:10px 12px;font-size:11px;line-height:1.45}
.auth-error{margin:0;border:1px solid #ffd1d1;border-radius:8px;color:#b42318;background:#fff5f5;padding:10px 12px;font-size:11px;line-height:1.45}
.auth-submit{display:flex;min-height:47px;align-items:center;justify-content:center;gap:9px;border:1px solid var(--blue);border-radius:8px;color:#fff;background:var(--blue);padding:0 16px;font:inherit;font-size:13px;font-weight:850;cursor:pointer;transition:filter .16s,transform .16s,background .16s,border-color .16s}
.auth-submit:hover:not(:disabled){border-color:var(--blue-dark);background:var(--blue-dark);filter:brightness(1.07);transform:translateY(-1px)}
.auth-submit:disabled{cursor:wait;opacity:.65}
.password-reset-help{margin:0;color:var(--muted);font-size:11px;line-height:1.45}
.password-reset-back{justify-self:center;margin-top:4px}
.password-reset-card a:focus-visible,.password-reset-card button:focus-visible{outline:2px solid var(--blue);outline-offset:3px}
@media(max-width:860px){
  .password-reset-shell{grid-template-columns:minmax(0,1fr);align-items:start}
  .password-reset-context{min-height:290px;padding:24px;background-position:65% 60%;background-image:linear-gradient(90deg,rgba(3,15,43,.72),rgba(3,15,43,.08)),url('~/assets/img/imagemLoginEntrar.png')}
  .password-reset-context__content{max-width:290px;margin:28px 0 60px;padding:0}
  .password-reset-context h2{font-size:26px}
  .password-reset-context__content p,.password-reset-context__footer{display:none}
  .password-reset-card{width:min(520px,calc(100% - 32px));margin:-44px auto 28px;padding:28px;border-radius:20px}
  .password-reset-copy{margin:28px 0 20px}
}
@media(max-width:380px){
  .password-reset-card{width:calc(100% - 24px);padding:24px 20px}
  .password-reset-card__header{align-items:flex-start;flex-direction:column;gap:12px}
  .password-reset-copy h1{font-size:26px}
}
</style>
