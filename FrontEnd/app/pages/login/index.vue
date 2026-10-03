<script setup lang="ts">
definePageMeta({ layout: false })

const auth = useAuth()
const { notify } = useUi()
const mode = ref<'login' | 'register'>('login')
const loading = ref(false)
const changingMode = ref(false)
const accessCard = ref<HTMLElement | null>(null)
const modeHeading = ref<HTMLElement | null>(null)
const error = ref('')
const mfaChallenge = ref('')
const mfaCode = ref('')
const showPassword = ref(false)
const form = reactive({ name: '', company: '', document: '', email: '', password: '', passwordConfirmation: '' })
const documentKind = ref<'cpf' | 'cnpj'>('cnpj')
const documentLabel = computed(() => documentKind.value === 'cpf' ? 'CPF' : 'CNPJ')
const documentPlaceholder = computed(() => documentKind.value === 'cpf' ? '000.000.000-00' : '00.000.000/0000-00')
const documentMaxLength = computed(() => documentKind.value === 'cpf' ? 14 : 18)
const passwordType = computed(() => showPassword.value ? 'text' : 'password')
const title = computed(() => mode.value === 'login' ? 'Bem-vindo de volta' : 'Crie seu espaço de trabalho')
const subtitle = computed(() => mode.value === 'login' ? 'Entre para continuar sua operação.' : 'Organize produção, pedidos e custos em um só lugar.')
const actionLabel = computed(() => mode.value === 'login' ? 'Entrar no Filamind' : 'Criar conta e continuar')

const formatDocument = (value: string, kind = documentKind.value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, kind === 'cpf' ? 11 : 14)
  if (kind === 'cpf') return digits.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  return digits.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}
const selectDocumentKind = (kind: 'cpf' | 'cnpj') => { if (documentKind.value !== kind) { documentKind.value = kind; form.document = '' } }
const changeMode = async (nextMode: 'login' | 'register') => {
  if (loading.value || changingMode.value || mode.value === nextMode) return
  changingMode.value = true
  const card = accessCard.value
  const currentHeight = card?.getBoundingClientRect().height || 0
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reducedMotion) await new Promise(resolve => window.setTimeout(resolve, 90))
  mode.value = nextMode
  error.value = ''
  mfaChallenge.value = ''
  mfaCode.value = ''
  await nextTick()
  if (card && !reducedMotion) {
    // Measure the natural height so the return to login can shrink as well.
    const targetHeight = card.getBoundingClientRect().height
    const animation = card.animate(
      [{ height: `${currentHeight}px` }, { height: `${targetHeight}px` }],
      { duration: 300, easing: 'cubic-bezier(.2,.75,.25,1)' }
    )
    try { await animation.finished } catch { /* Resizing or leaving the page can cancel the animation. */ }
    finally { animation.cancel() }
  }
  changingMode.value = false
  await nextTick()
  modeHeading.value?.focus({ preventScroll: true })
  modeHeading.value?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
}

const submit = async () => {
  error.value = ''
  if (mode.value === 'register' && form.password !== form.passwordConfirmation) { error.value = 'As senhas não conferem.'; return }
  loading.value = true
  try {
    if (mode.value === 'login') {
      if (mfaChallenge.value) { await auth.completeMfaLogin(mfaChallenge.value, mfaCode.value); mfaChallenge.value = '' }
      else {
        const result = await auth.login(form.email, form.password)
        if (result?.mfaRequired) { mfaChallenge.value = result.challengeToken || ''; return }
      }
      notify(auth.tenantDeletionCancelled.value ? 'A exclusão da empresa foi cancelada pelo seu login.' : 'Login realizado com sucesso.')
    } else {
      const result = await auth.register({ name: form.name, company: form.company, document: form.document, email: form.email, password: form.password })
      if (result.verificationRequired) { notify('Verifique seu e-mail para ativar a conta.'); return }
      notify('Conta criada com sucesso.')
    }
    await navigateTo('/')
  } catch (err: any) {
    const isNetworkError = err?.message === 'Failed to fetch' || err?.cause?.message === 'Failed to fetch'
    error.value = isNetworkError ? 'Não foi possível conectar ao serviço. Verifique sua internet e tente novamente.' : err?.data?.error || err?.message || 'Não foi possível autenticar.'
  } finally { loading.value = false }
}
</script>

<template>
  <main class="auth-page auth-page--workspace">
    <section class="auth-shell">
      <div ref="accessCard" class="auth-access" :class="{ 'auth-access--switching': changingMode }">
        <header class="auth-access__header"><AppLogo /><span class="auth-access__badge"><i /> Ambiente seguro</span></header>
        <div class="auth-access__content" :inert="changingMode">
          <div class="auth-copy"><span class="auth-kicker">{{ mode === 'login' ? 'ACESSO À OPERAÇÃO' : 'COMECE SEM COMPLICAÇÃO' }}</span><h1 id="auth-title" ref="modeHeading" tabindex="-1">{{ title }}</h1><p>{{ subtitle }}</p></div>
          <form class="auth-form" aria-labelledby="auth-title" @submit.prevent="submit">
            <template v-if="mode === 'register'">
              <label class="field"><span>Seu nome</span><input v-model="form.name" autocomplete="name" required placeholder="Como podemos chamar você?"></label>
              <label class="field"><span>Nome da empresa</span><input v-model="form.company" autocomplete="organization" required placeholder="Ex.: Studio Maker"></label>
              <div class="field"><span>Tipo de cadastro</span><div class="auth-document-kind" role="group" aria-label="Tipo de documento"><button type="button" class="auth-document-kind__item" :class="{ 'auth-document-kind__item--active': documentKind === 'cpf' }" @click="selectDocumentKind('cpf')">Pessoa física · CPF</button><button type="button" class="auth-document-kind__item" :class="{ 'auth-document-kind__item--active': documentKind === 'cnpj' }" @click="selectDocumentKind('cnpj')">Pessoa jurídica · CNPJ</button></div></div>
              <label class="field"><span>{{ documentLabel }}</span><input v-model="form.document" inputmode="numeric" autocomplete="off" required :maxlength="documentMaxLength" :placeholder="documentPlaceholder" @input="form.document = formatDocument(form.document)"><small class="auth-hint">Usamos esse documento apenas para identificar a conta.</small></label>
            </template>
            <label class="field"><span>E-mail</span><input v-model="form.email" type="email" autocomplete="email" required placeholder="voce@empresa.com"></label>
            <label class="field"><span>Senha</span><span class="auth-password-input"><input v-model="form.password" :type="passwordType" :autocomplete="mode === 'register' ? 'new-password' : 'current-password'" required minlength="10" placeholder="Sua senha"><button type="button" @click="showPassword = !showPassword">{{ showPassword ? 'Ocultar' : 'Mostrar' }}</button></span></label>
            <label v-if="mode === 'register'" class="field"><span>Confirmar senha</span><input v-model="form.passwordConfirmation" :type="passwordType" autocomplete="new-password" required minlength="10" placeholder="Repita sua senha"></label>
            <label v-if="mode === 'login' && mfaChallenge" class="field"><span>Código do aplicativo autenticador</span><input v-model="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required placeholder="000000"></label>
            <p v-if="mode === 'register'" class="auth-hint">Use ao menos 10 caracteres, com maiúscula, minúscula, número e caractere especial.</p>
            <div v-if="mode === 'login' && !mfaChallenge" class="auth-form__support"><span>Use seu e-mail e senha cadastrados.</span><NuxtLink to="/redefinir-senha">Esqueci minha senha</NuxtLink></div>
            <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
            <button class="auth-submit" type="submit" :disabled="loading"><span>{{ loading ? 'Aguarde...' : (mfaChallenge ? 'Confirmar código' : actionLabel) }}</span><UiIcon name="chevron" :size="17" /></button>
          </form>
          <p class="auth-switch">{{ mode === 'login' ? 'Ainda não usa o Filamind?' : 'Já tem uma conta?' }} <button type="button" :disabled="changingMode || loading" @click="changeMode(mode === 'login' ? 'register' : 'login')">{{ mode === 'login' ? 'Criar conta' : 'Entrar' }}</button></p>
        </div>
      </div>
      <aside class="auth-context" aria-label="Recursos do Filamind"><div class="auth-context__pattern" aria-hidden="true" /><div class="auth-context__top"><span class="auth-context__dot" /> Filamind</div><div class="auth-context__content"><span class="auth-kicker">DO ORÇAMENTO À ENTREGA</span><h2>Mais clareza para transformar cada ideia em produção.</h2><p>Centralize pedidos, custos, materiais e a rotina das suas impressoras no fluxo que você já usa.</p><ul><li><UiIcon name="check" :size="15" /> Produção e filas organizadas</li><li><UiIcon name="check" :size="15" /> Custos e margem por produto</li><li><UiIcon name="check" :size="15" /> Estoque e pedidos no mesmo lugar</li></ul></div><div class="auth-context__footer"><UiIcon name="shield" :size="16" /> Seus dados ficam separados por empresa.</div></aside>
    </section>
  </main>
</template>

<style scoped>
.auth-page--workspace{display:grid;min-height:100vh;place-items:center;background:var(--canvas);padding:24px;color:var(--ink)}.auth-shell{display:grid;width:min(1180px,100%);min-height:720px;grid-template-columns:minmax(0,1fr) minmax(390px,.92fr);overflow:hidden;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:0 32px 90px rgba(16,26,53,.12)}.auth-access{display:flex;min-width:0;flex-direction:column;padding:28px clamp(28px,6vw,78px) 34px;background:var(--surface)}.auth-access__header{display:flex;align-items:center;justify-content:space-between;gap:20px}.auth-access :deep(.brand){gap:10px}.auth-access :deep(.brand__mark){width:32px;height:32px}.auth-access :deep(.brand__name){color:var(--ink);font-size:18px;letter-spacing:-.04em}.auth-access__badge{display:inline-flex;align-items:center;gap:7px;color:var(--muted);font-size:11px;font-weight:700}.auth-access__badge i,.auth-context__dot{width:8px;height:8px;border-radius:50%;background:var(--blue);box-shadow:0 0 0 4px rgba(23,104,242,.1)}.auth-access__content{width:min(430px,100%);margin:auto}.auth-copy{margin:34px 0 26px}.auth-kicker{display:block;color:var(--blue);font-size:10px;font-weight:800;letter-spacing:.11em}.auth-copy h1{margin:10px 0 8px;color:var(--ink);font-size:30px;letter-spacing:-.045em;line-height:1.08}.auth-copy p{margin:0;color:var(--muted);font-size:14px;line-height:1.55}.auth-form{display:grid;gap:15px;margin-top:24px;padding:0}.field{display:grid;gap:7px;color:var(--text);font-size:12px;font-weight:750}.field input{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;outline:0;color:var(--ink);background:var(--surface);padding:12px 13px;font:inherit;font-size:14px;transition:border-color .16s,box-shadow .16s}.field input::placeholder{color:var(--muted)}.field input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(23,104,242,.12)}.auth-password-input{position:relative;display:block}.auth-password-input input{padding-right:78px}.auth-password-input button{position:absolute;right:8px;top:50%;border:0;border-radius:5px;color:var(--blue);background:var(--blue-soft);padding:5px 8px;font:inherit;font-size:10px;font-weight:800;transform:translateY(-50%);cursor:pointer}.auth-document-kind{display:grid;grid-template-columns:1fr 1fr;gap:7px}.auth-document-kind__item{min-height:42px;border:1px solid var(--line);border-radius:8px;color:var(--muted);background:var(--surface);padding:7px;font:inherit;font-size:10px;font-weight:700;cursor:pointer}.auth-document-kind__item--active{border-color:var(--blue);color:var(--blue);background:var(--blue-soft)}.auth-hint{margin:-3px 0 0;color:var(--muted);font-size:10px;font-weight:500;line-height:1.45}.auth-form__support{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--muted);font-size:11px}.auth-form__support a,.auth-switch button{border:0;color:var(--blue);background:transparent;padding:0;font:inherit;font-weight:800;text-decoration:none;cursor:pointer}.auth-error{margin:0;border:1px solid #ffd1d1;border-radius:8px;color:#b42318;background:#fff5f5;padding:10px 12px;font-size:11px;line-height:1.45}.auth-submit{display:flex;min-height:47px;align-items:center;justify-content:center;gap:9px;border:1px solid var(--blue);border-radius:8px;color:#fff;background:var(--blue);padding:0 16px;font:inherit;font-size:13px;font-weight:850;cursor:pointer;transition:filter .16s,transform .16s}.auth-submit:hover:not(:disabled){filter:brightness(1.07);transform:translateY(-1px)}.auth-submit:disabled{cursor:wait;opacity:.65}.auth-switch{margin:21px 0 0;color:var(--muted);text-align:center;font-size:12px}.auth-switch button{margin-left:5px}.auth-context{position:relative;display:flex;overflow:hidden;flex-direction:column;justify-content:space-between;border-left:1px solid #21345b;background:radial-gradient(circle at 78% 22%,rgba(23,104,242,.24),transparent 28%),linear-gradient(155deg,#10274f,#06183d 68%);padding:31px clamp(28px,5vw,60px)}.auth-context__pattern{position:absolute;inset:auto -160px -120px auto;width:430px;height:430px;border:1px solid rgba(66,193,242,.18);border-radius:50%;box-shadow:0 0 0 50px rgba(66,193,242,.035),0 0 0 100px rgba(66,193,242,.025)}.auth-context__top,.auth-context__footer{position:relative;display:flex;align-items:center;gap:8px;color:#b7c8e4;font-size:11px;font-weight:750}.auth-context__content{position:relative;max-width:390px;margin:auto 0}.auth-context h2{margin:13px 0;color:#f4f8ff;font-size:35px;letter-spacing:-.045em;line-height:1.12}.auth-context p{margin:0;color:#b7c8e4;font-size:14px;line-height:1.65}.auth-context ul{display:grid;gap:12px;margin:30px 0 0;padding:0;list-style:none}.auth-context li{display:flex;align-items:center;gap:10px;color:#e5efff;font-size:12px;font-weight:700}.auth-context li :deep(svg){color:#62d2ef}.auth-context__footer{padding-top:20px;border-top:1px solid rgba(183,200,228,.17)}
.auth-context .auth-kicker{color:#9fc4ff;background:rgba(23,104,242,.16)}
.auth-submit:hover:not(:disabled){background:var(--blue-dark);border-color:var(--blue-dark)}
.auth-access button:focus-visible,.auth-access a:focus-visible{outline:2px solid var(--blue);outline-offset:3px}
.auth-page--workspace{display:block;min-height:100svh;padding:0;background:#eef3fa}
.auth-shell{width:100%;min-height:100svh;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:center;overflow:visible;border:0;border-radius:0;background:transparent;box-shadow:none}
.auth-access{position:relative;z-index:1;grid-column:2;grid-row:1;width:min(520px,calc(100% - 64px));box-sizing:border-box;justify-self:center;margin:40px 0;padding:32px clamp(24px,3vw,44px);border:1px solid rgba(255,255,255,.8);border-radius:24px;box-shadow:0 24px 70px rgba(16,38,79,.15),0 3px 12px rgba(16,38,79,.05)}
.auth-access__content{width:100%;margin:0}
.auth-access__content{transition:opacity .18s ease,transform .18s ease}
.auth-access--switching{overflow:hidden}
.auth-copy h1:focus{outline:none}
.auth-access--switching .auth-access__content{opacity:.35;transform:translateY(7px)}
.auth-switch button:disabled{cursor:wait;opacity:.6}
.auth-access__header{flex-wrap:wrap;gap:12px}
.auth-copy h1{font-size:clamp(26px,2.6vw,34px);line-height:1.15}
.auth-access .auth-form{display:grid;width:100%;box-sizing:border-box;min-width:0;padding:0}
.auth-form .field{min-width:0}
.field input{min-width:0;font-size:16px;min-height:46px}
.auth-context{grid-column:1;grid-row:1;align-self:stretch;min-height:100svh;box-sizing:border-box;border:0;padding:40px clamp(24px,4vw,64px);background-image:linear-gradient(180deg,rgba(3,15,43,.15),rgba(3,15,43,.05) 40%,rgba(3,15,43,.94) 85%),url('~/assets/img/imagemLoginEntrar.png');background-size:cover;background-position:65% center}
.auth-context__pattern{display:none}
.auth-context__content{max-width:440px;margin:auto 0 28px;padding-top:clamp(180px,28vh,340px)}
.auth-context h2{font-size:clamp(27px,3vw,42px)}
.auth-context ul{margin-top:20px;gap:10px}
.auth-context .auth-kicker{background:transparent}
@media(max-width:1000px){.auth-access{width:calc(100% - 32px);padding:28px 24px}.auth-access__badge{font-size:10px}.auth-context{padding:32px 28px}.auth-form__support{flex-wrap:wrap}}
@media(max-width:760px){
  .auth-shell{grid-template-columns:minmax(0,1fr);align-items:start}
  .auth-context{grid-column:1;grid-row:1;min-height:290px;padding:24px;background-position:65% 60%;background-image:linear-gradient(90deg,rgba(3,15,43,.7),rgba(3,15,43,.05)),url('~/assets/img/imagemLoginEntrar.png')}
  .auth-context__content{max-width:260px;margin:28px 0 60px;padding:0}
  .auth-context h2{font-size:26px}
  .auth-context__content p,.auth-context ul,.auth-context__footer{display:none}
  .auth-access{grid-column:1;grid-row:2;width:min(520px,calc(100% - 32px));margin:-44px 0 28px;padding:28px;border-radius:20px}
  .auth-copy{margin:28px 0 20px}
}
@media(max-width:380px){.auth-access{width:calc(100% - 24px);padding:24px 20px}.auth-access__badge{display:none}.auth-form__support{align-items:flex-start;flex-direction:column;gap:10px}.auth-document-kind{grid-template-columns:1fr}.auth-copy h1{font-size:26px}}
@media(prefers-reduced-motion:reduce){.auth-access__content{transition:none}.auth-access--switching .auth-access__content{transform:none;opacity:1}}
</style>
