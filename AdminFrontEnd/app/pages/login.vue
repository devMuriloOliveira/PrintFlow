<script setup lang="ts">
const session = useAdminSession()
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

onMounted(() => { session.restore(); if (session.token.value) void navigateTo('/') })

const submit = async () => {
  loading.value = true; error.value = ''
  try { await session.login(email.value, password.value); await navigateTo('/') }
  catch { error.value = 'Acesso administrativo nao autorizado.' }
  finally { loading.value = false }
}
</script>
<template>
  <main class="login-page"><form class="login-box" @submit.prevent="submit">
    <span class="eyebrow">PRINTFLOW</span><h1>Administracao da plataforma</h1>
    <p>Area restrita a super administradores autorizados.</p>
    <label>E-mail<input v-model="email" type="email" autocomplete="username" required></label>
    <label>Senha<input v-model="password" type="password" autocomplete="current-password" required></label>
    <p v-if="error" class="error">{{ error }}</p>
    <button :disabled="loading" type="submit">{{ loading ? 'Verificando...' : 'Acessar administracao' }}</button>
  </form></main>
</template>
