<script setup lang="ts">
const props = defineProps<{ requestId: string; status: string }>()
const { listSupportMessages, sendSupportMessage } = useAppData()
const { refresh: refreshRequests } = useSupportRequests()
const openStatuses = ['pending', 'under_review', 'approved', 'rejected']
const canWrite = computed(() => openStatuses.includes(props.status))
const open = ref(false)
const messages = ref<any[]>([])
const draft = ref('')
const loading = ref(false)
const latestAdminMessageId = ref('')
let refreshTimer: ReturnType<typeof setInterval> | undefined

const refresh = async (autoOpen = false) => {
  if (!props.requestId || loading.value) return
  loading.value = true
  try {
    const next = await listSupportMessages(props.requestId)
    const latestAdmin = [...next].reverse().find(message => message.senderType === 'superadmin')
    if (autoOpen && latestAdmin?.id && latestAdmin.id !== latestAdminMessageId.value) open.value = true
    latestAdminMessageId.value = latestAdmin?.id || ''
    messages.value = next
  } finally {
    loading.value = false
  }
}

watch(() => props.requestId, async () => {
  latestAdminMessageId.value = ''
  open.value = true
  await refresh()
}, { immediate: true })

const poll = async () => {
  try { await Promise.all([refresh(true), refreshRequests()]) } catch { /* A proxima atualizacao tenta novamente. */ }
}
onMounted(() => { refreshTimer = setInterval(() => void poll(), 10000) })
onBeforeUnmount(() => { if (refreshTimer) clearInterval(refreshTimer) })

const send = async () => {
  if (!draft.value.trim() || !canWrite.value) return
  await sendSupportMessage(props.requestId, draft.value)
  draft.value = ''
  await refresh()
}
const copyProtocol = async () => { await navigator.clipboard.writeText(props.requestId) }
</script>

<template>
  <div v-if="requestId" class="audit-chat" :class="{ 'audit-chat--open': open }">
    <button class="audit-chat__toggle" @click="open = !open">{{ open ? 'Minimizar conversa' : 'Ajuda e suporte' }}</button>
    <section v-if="open" class="audit-chat__panel">
      <header><strong>Conversa do atendimento</strong><small>Protocolo {{ requestId }} <button type="button" class="audit-chat__copy" @click="copyProtocol">Copiar</button></small></header>
      <div class="audit-chat__messages"><p v-if="loading && !messages.length">Carregando...</p><p v-for="message in messages" :key="message.id" :class="message.senderType"><b>{{ message.senderType === 'superadmin' ? 'Superadmin' : 'Voce' }}</b><span>{{ message.body }}</span><small>{{ new Date(message.createdAt).toLocaleString('pt-BR') }}</small></p><p v-if="!messages.length && !loading" class="empty-message">Aguardando o inicio do atendimento.</p></div>
      <form v-if="canWrite" @submit.prevent="send"><textarea v-model="draft" maxlength="1000" placeholder="Escreva sua mensagem"></textarea><button class="btn btn--primary">Enviar</button></form>
      <p v-else class="info-note">Conversa encerrada pelo superadmin.</p>
    </section>
  </div>
</template>

<style scoped>
.audit-chat{position:fixed;right:22px;bottom:22px;z-index:30}.audit-chat__toggle{border:0;border-radius:18px;background:var(--blue);color:#fff;padding:12px 16px;box-shadow:0 10px 30px #0003}.audit-chat__panel{width:min(360px,calc(100vw - 32px));margin-top:8px;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 45px #0003;padding:12px}.audit-chat header{display:grid;gap:3px}.audit-chat header small,.audit-chat__messages small{color:var(--muted)}.audit-chat__copy{border:0;background:none;color:var(--blue);padding:0 4px}.audit-chat__messages{max-height:310px;overflow:auto;margin:12px 0}.audit-chat__messages p{display:grid;gap:4px;padding:8px;border-radius:8px;background:#eaf3ff}.audit-chat__messages p.superadmin{background:#f4f6f8}.audit-chat__messages .empty-message{display:block;color:var(--muted);background:transparent;text-align:center}.audit-chat textarea{width:100%;min-height:64px;margin-bottom:8px}
</style>
