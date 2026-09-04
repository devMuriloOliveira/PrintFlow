<script setup lang="ts">
import type { SupportMessage } from '../composables/useAppData'

const props = defineProps<{ requestId: string; status: string }>()
const { listSupportMessages, sendSupportMessage } = useAppData()
const { refresh: refreshRequests } = useSupportRequests()
const openStatuses = ['pending', 'under_review', 'approved', 'rejected']
const canWrite = computed(() => openStatuses.includes(props.status))
const open = ref(false)
const messages = ref<SupportMessage[]>([])
const draft = ref('')
const loading = ref(false)
const sending = ref(false)
const sendError = ref('')
const copyFeedback = ref('')
const latestSupportMessageId = ref('')
const latestMessageId = ref('')
const messagesElement = ref<HTMLElement | null>(null)
let refreshTimer: ReturnType<typeof setInterval> | undefined
let refreshSequence = 0

const senderLabel = (senderType: SupportMessage['senderType']) => senderType === 'support' ? 'Suporte tecnico' : 'Você'
const messageTime = (createdAt: string) => new Date(createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const statusLabel = computed(() => ({ pending: 'Aguardando atendimento', under_review: 'Em atendimento', approved: 'Acesso aprovado', rejected: 'Solicitação recusada' }[props.status] || 'Encerrada'))
const scrollToLatest = async () => {
  await nextTick()
  if (messagesElement.value) messagesElement.value.scrollTop = messagesElement.value.scrollHeight
}

const refresh = async (autoOpen = false) => {
  const requestId = props.requestId
  if (!requestId) return
  const sequence = ++refreshSequence
  loading.value = true
  try {
    const next = await listSupportMessages(requestId)
    if (sequence !== refreshSequence || requestId !== props.requestId) return
    const latestSupportMessage = [...next].reverse().find(message => message.senderType === 'support')
    const hasNewMessage = Boolean(next.length && next.at(-1)?.id !== latestMessageId.value)
    if (autoOpen && latestSupportMessage?.id && latestSupportMessage.id !== latestSupportMessageId.value) open.value = true
    latestSupportMessageId.value = latestSupportMessage?.id || ''
    latestMessageId.value = next.at(-1)?.id || ''
    messages.value = next
    if (hasNewMessage && open.value) await scrollToLatest()
  } finally {
    if (sequence === refreshSequence) loading.value = false
  }
}

watch(() => props.requestId, async () => {
  messages.value = []
  latestSupportMessageId.value = ''
  latestMessageId.value = ''
  sendError.value = ''
  open.value = true
  await refresh()
}, { immediate: true })

const poll = async () => {
  try { await Promise.all([refresh(true), refreshRequests()]) } catch { /* A proxima atualizacao tenta novamente. */ }
}
onMounted(() => { refreshTimer = setInterval(() => void poll(), 5000) })
onBeforeUnmount(() => { if (refreshTimer) clearInterval(refreshTimer) })

const send = async () => {
  const body = draft.value.trim()
  if (!body || !canWrite.value || sending.value) return
  sending.value = true
  sendError.value = ''
  try {
    await sendSupportMessage(props.requestId, body)
    draft.value = ''
    await refresh()
    await scrollToLatest()
  } catch {
    sendError.value = 'Não foi possível enviar agora. Tente novamente.'
  } finally {
    sending.value = false
  }
}
const copyProtocol = async () => {
  await navigator.clipboard.writeText(props.requestId)
  copyFeedback.value = 'Protocolo copiado'
  window.setTimeout(() => { copyFeedback.value = '' }, 1800)
}
</script>

<template>
  <div v-if="requestId" class="audit-chat" :class="{ 'audit-chat--open': open }">
    <button class="audit-chat__toggle" type="button" @click="open = !open">
      <span class="audit-chat__toggle-mark" aria-hidden="true">?</span>
      {{ open ? 'Minimizar conversa' : 'Ajuda e suporte' }}
    </button>
    <section v-if="open" class="audit-chat__panel">
      <header class="audit-chat__header">
        <div><strong>Conversa do atendimento</strong><small>Conversa segura e registrada no protocolo.</small></div>
        <span class="audit-chat__status" :class="{ 'audit-chat__status--closed': !canWrite }">{{ statusLabel }}</span>
      </header>
      <div class="audit-chat__protocol">
        <span>Protocolo <strong>{{ requestId }}</strong></span>
        <button type="button" class="audit-chat__copy" @click="copyProtocol">{{ copyFeedback || 'Copiar' }}</button>
      </div>
      <div ref="messagesElement" class="audit-chat__messages" aria-live="polite">
        <p v-if="loading && !messages.length" class="empty-message">Carregando conversa...</p>
        <article v-for="message in messages" :key="message.id" class="chat-message" :class="`chat-message--${message.senderType}`">
          <div class="chat-message__avatar" aria-hidden="true">{{ message.senderType === 'support' ? 'ST' : 'VO' }}</div>
          <div class="chat-message__content">
            <b>{{ senderLabel(message.senderType) }}</b>
            <p>{{ message.body }}</p>
            <small>{{ messageTime(message.createdAt) }}</small>
          </div>
        </article>
        <p v-if="!messages.length && !loading" class="empty-message">Aguardando o início do atendimento.</p>
      </div>
      <form v-if="canWrite" class="audit-chat__composer" @submit.prevent="send">
        <textarea v-model="draft" maxlength="1000" placeholder="Escreva sua mensagem" aria-label="Escreva sua mensagem" @keydown.enter.exact.prevent="send" />
        <div><small>{{ draft.length }}/1000</small><button class="btn btn--primary" :disabled="!draft.trim() || sending">{{ sending ? 'Enviando...' : 'Enviar' }}</button></div>
        <p v-if="sendError" class="audit-chat__error" role="alert">{{ sendError }}</p>
      </form>
      <p v-else class="info-note">Conversa encerrada pela equipe de suporte.</p>
    </section>
  </div>
</template>

<style scoped>
.audit-chat{position:fixed;right:22px;bottom:22px;z-index:30;font-size:13px}.audit-chat__toggle{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;background:linear-gradient(135deg,var(--blue),var(--blue-dark));color:#fff;padding:12px 17px;box-shadow:0 12px 30px rgba(23,104,242,.28);font:inherit;font-weight:800;cursor:pointer}.audit-chat__toggle-mark{display:grid;width:20px;height:20px;place-items:center;border-radius:50%;background:#ffffff2b;font-size:14px}.audit-chat__panel{width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 94px);margin-top:9px;border:1px solid var(--line);border-radius:18px;background:#fff;box-shadow:0 24px 60px rgba(25,44,84,.23);overflow:hidden}.audit-chat__header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:15px 16px 11px}.audit-chat__header strong{display:block;color:#14213d;font-size:15px}.audit-chat__header small{display:block;color:var(--muted);margin-top:4px;font-size:10px;line-height:1.4}.audit-chat__status{flex:0 0 auto;border-radius:999px;color:#087a4d;background:#e9f9f1;padding:5px 8px;font-size:9px;font-weight:800}.audit-chat__status--closed{color:#67748a;background:#eef1f5}.audit-chat__protocol{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid #eef2f7;border-bottom:1px solid #e6edf7;background:#f8faff;padding:8px 16px;color:var(--muted);font-size:10px}.audit-chat__protocol span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.audit-chat__protocol strong{color:#43516a;font-weight:700}.audit-chat__copy{flex:0 0 auto;border:0;border-radius:7px;color:var(--blue);background:#eaf2ff;padding:5px 7px;font:inherit;font-size:10px;font-weight:800;cursor:pointer}.audit-chat__messages{display:flex;max-height:min(400px,calc(100dvh - 310px));min-height:190px;flex-direction:column;gap:11px;overflow:auto;background:linear-gradient(145deg,#f6f9fd,#eef4fb);padding:14px}.chat-message{display:flex;max-width:88%;align-items:flex-end;gap:7px}.chat-message--support{align-self:flex-end;flex-direction:row-reverse}.chat-message__avatar{display:grid;width:27px;height:27px;flex:0 0 auto;place-items:center;border:1px solid #dbe6f6;border-radius:50%;color:#44617f;background:#fff;font-size:8px;font-weight:850}.chat-message--support .chat-message__avatar{border-color:#1f65dc;color:#fff;background:var(--blue)}.chat-message__content{min-width:0;border:1px solid #dfe7f1;border-radius:14px 14px 14px 4px;background:#fff;padding:8px 10px;box-shadow:0 2px 8px rgba(25,44,84,.06)}.chat-message--support .chat-message__content{border-color:transparent;border-radius:14px 14px 4px 14px;color:#fff;background:linear-gradient(135deg,var(--blue),var(--blue-dark));box-shadow:0 5px 15px rgba(23,104,242,.2)}.chat-message__content b{display:block;font-size:10px;letter-spacing:.01em}.chat-message__content p{margin:3px 0 5px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.42}.chat-message__content small{display:block;color:#8491a5;font-size:9px}.chat-message--support .chat-message__content small{color:#dceaff}.empty-message{margin:auto;color:var(--muted);background:transparent;text-align:center;font-size:11px}.audit-chat__composer{border-top:1px solid var(--line);background:#fff;padding:11px 12px}.audit-chat__composer textarea{display:block;width:100%;min-height:58px;resize:vertical;border:1px solid #cad5e4;border-radius:10px;outline:0;padding:9px 10px;color:#1a2943;font:inherit;line-height:1.4}.audit-chat__composer textarea:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(23,104,242,.1)}.audit-chat__composer>div{display:flex;align-items:center;justify-content:space-between;margin-top:7px}.audit-chat__composer small{color:var(--muted);font-size:9px}.audit-chat__composer .btn{min-height:32px;padding:7px 12px;font-size:11px}.audit-chat__error{margin:7px 0 0;color:#b42318;font-size:10px}.info-note{margin:0;border-top:1px solid var(--line);border-radius:0;background:#f8faff;padding:12px;color:var(--muted);font-size:11px}@media (max-width:560px){.audit-chat{right:12px;bottom:12px;left:12px}.audit-chat__toggle{float:right}.audit-chat__panel{width:100%;margin-top:7px}.audit-chat__messages{max-height:calc(100dvh - 320px);min-height:170px}.chat-message{max-width:93%}.audit-chat__header{padding:13px}.audit-chat__protocol{padding-right:13px;padding-left:13px}.audit-chat__messages{padding:11px}}
/* Cada pessoa ve as proprias mensagens a direita, como em apps de conversa. */
.chat-message--requester{align-self:flex-end;flex-direction:row-reverse}
.chat-message--requester .chat-message__avatar{border-color:#1f65dc;color:#fff;background:var(--blue)}
.chat-message--requester .chat-message__content{border-color:transparent;border-radius:14px 14px 4px 14px;color:#fff;background:linear-gradient(135deg,var(--blue),var(--blue-dark));box-shadow:0 5px 15px rgba(23,104,242,.2)}
.chat-message--requester .chat-message__content small{color:#dceaff}
.chat-message--support{align-self:flex-start;flex-direction:row}
.chat-message--support .chat-message__avatar{border-color:#dbe6f6;color:#44617f;background:#fff}
.chat-message--support .chat-message__content{border-color:#dfe7f1;border-radius:14px 14px 14px 4px;color:inherit;background:#fff;box-shadow:0 2px 8px rgba(25,44,84,.06)}
.chat-message--support .chat-message__content small{color:#8491a5}
</style>
