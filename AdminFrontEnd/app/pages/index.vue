<script setup lang="ts">
import type { SupportSlaRule } from '~/types/platform-admin'

const {
  overview, tenants, requests, loading, error, activeRequests,
  supportMetrics, supportSlaRules, tenantFor, formatDate, load, loadSupportMetrics, loadSupportSlaRules, updateSupportSlaRule
} = usePlatformAdminWorkspace()
const search = ref('')
const refreshing = ref(false)
const partialError = ref('')
const slaSaving = ref('')
const slaError = ref('')
const slaFeedback = ref('')

const recentRequests = computed(() => {
  const term = search.value.trim().toLowerCase()
  return requests.value.filter(request => !term || `${request.id} ${request.subject || ''} ${request.reason} ${tenantFor(request.tenantId)?.name || ''}`.toLowerCase().includes(term)).slice(0, 5)
})
const operatingRates = computed(() => {
  if (!overview.value) return []
  return [
    { label: 'Empresas ativas', value: overview.value.activeTenants, total: overview.value.tenants },
    { label: 'Agents online', value: overview.value.onlineAgents, total: overview.value.agents },
    { label: 'Impressoras conectadas', value: overview.value.connectedPrinters, total: overview.value.printers }
  ].map(item => ({ ...item, percentage: item.total ? Math.min(100, Math.round(item.value / item.total * 100)) : 0 }))
})
const attentionItems = computed(() => [
  { label: 'Atendimentos em aberto', value: supportMetrics.value?.open ?? activeRequests.value.length, to: '/solicitacoes', tone: 'blue' },
  { label: 'Atendimentos em atraso', value: supportMetrics.value?.overdue ?? 0, to: '/solicitacoes', tone: 'orange' },
  { label: 'Empresas com cobrança pendente', value: overview.value?.paymentAttention ?? 0, to: '/empresas', tone: 'orange' },
  { label: 'LGPD fora do prazo', value: supportMetrics.value?.lgpd.overdue ?? 0, to: '/solicitacoes', tone: 'red' }
])
const primaryMetrics = computed(() => [
  { label: 'Empresas na plataforma', value: overview.value?.tenants ?? 0, note: `${overview.value?.activeTenants ?? 0} ativas`, icon: 'companies', to: '/empresas' },
  { label: 'Atendimentos abertos', value: supportMetrics.value?.open ?? activeRequests.value.length, note: `${supportMetrics.value?.waitingInternal ?? 0} aguardando equipe`, icon: 'support', to: '/solicitacoes' },
  { label: 'Usuários ativos', value: tenants.value.reduce((sum, tenant) => sum + tenant.activeUsers, 0), note: 'Nas empresas desta página', icon: 'overview', to: '/empresas' },
  { label: 'Agents online', value: overview.value?.onlineAgents ?? 0, note: `De ${overview.value?.agents ?? 0} pareados`, icon: 'reports', to: '/empresas' }
])
const operationalHealthItems = computed(() => {
  const health = overview.value?.health
  if (!health) return []
  return [
    { label: 'Agents fora de operação', value: health.agentsNotOnline, detail: 'Sem status online agora', alert: health.agentsNotOnline > 0 },
    { label: 'Impressões sem resposta', value: health.stalePrintStarts, detail: 'Em início há mais de 10 min', alert: health.stalePrintStarts > 0 },
    { label: 'Fila aguardando', value: health.longWaitingPrintJobs, detail: 'Itens em fila há mais de 1 h', alert: health.longWaitingPrintJobs > 0 },
    { label: 'Webhooks Stripe atrasados', value: health.delayedStripeWebhooks, detail: 'Sem processamento após 5 min', alert: health.delayedStripeWebhooks > 0 },
    { label: 'Integrações com erro', value: health.marketplaceSyncErrors, detail: 'Contas com falha de sincronização', alert: health.marketplaceSyncErrors > 0 },
    { label: 'Backup mais recente', value: health.latestBackupStatus === 'success' || health.latestBackupStatus === 'completed' ? 'Concluído' : health.latestBackupStatus, detail: health.lastSuccessfulBackupAt ? `Último sucesso: ${formatDate(health.lastSuccessfulBackupAt)}` : 'Nenhum backup concluído', alert: health.backupStale || health.latestBackupStatus === 'failed' }
  ]
})

const refresh = async () => {
  refreshing.value = true
  slaError.value = ''
  partialError.value = ''
  try {
    if (!await load({ overview: true, tenants: true, requests: true }, true)) return
    const [metrics, rules] = await Promise.allSettled([loadSupportMetrics(true), loadSupportSlaRules(true)])
    if (metrics.status === 'rejected') partialError.value = 'Não foi possível atualizar as métricas de suporte.'
    if (rules.status === 'rejected') partialError.value = 'Não foi possível atualizar as regras de SLA.'
  } finally { refreshing.value = false }
}
const saveSlaRule = async (rule: SupportSlaRule) => {
  slaSaving.value = rule.id
  slaError.value = ''
  slaFeedback.value = ''
  try {
    if (!Number.isFinite(Number(rule.firstResponseMinutes)) || !Number.isFinite(Number(rule.resolutionMinutes)) || Number(rule.firstResponseMinutes) < 1 || Number(rule.resolutionMinutes) < 1) {
      throw new Error('Informe prazos válidos em minutos.')
    }
    await updateSupportSlaRule(rule.id, {
      category: rule.category, priority: rule.priority,
      firstResponseMinutes: Number(rule.firstResponseMinutes),
      resolutionMinutes: Number(rule.resolutionMinutes), active: rule.active
    })
    slaFeedback.value = `Regra de ${rule.category} / ${rule.priority} atualizada.`
  } catch (cause: any) { slaError.value = cause?.data?.error || cause?.message || 'Não foi possível salvar a regra de SLA.' }
  finally { slaSaving.value = '' }
}
onMounted(() => void refresh())
</script>

<template>
  <AdminShell v-model:search="search" searchable title="Central da plataforma" subtitle="Acompanhe a operação e priorize o que precisa de atenção." :request-count="activeRequests.length">
    <template #actions><button class="button button--quiet" type="button" :disabled="refreshing" @click="refresh"><AdminIcon name="refresh" :size="16" />{{ refreshing ? 'Atualizando...' : 'Atualizar dados' }}</button></template>
    <p v-if="error" class="feedback feedback--error" role="alert">{{ error }}</p>
    <p v-if="partialError" class="feedback feedback--error" role="alert">{{ partialError }}</p>
    <section v-if="loading && !overview" class="panel dashboard-loading" aria-live="polite">Carregando visão geral da plataforma...</section>
    <template v-else-if="overview">
      <section class="dashboard-intro">
        <div><span class="section-kicker">VISÃO OPERACIONAL</span><h2>O que precisa da sua atenção</h2><p>Indicadores da plataforma e da fila de suporte nesta consulta.</p></div>
        <NuxtLink class="dashboard-intro__link" to="/solicitacoes">Abrir fila de suporte <AdminIcon name="arrow" :size="17" /></NuxtLink>
      </section>

      <section class="dashboard-priority" aria-label="Prioridades">
        <NuxtLink v-for="item in attentionItems" :key="item.label" :to="item.to" class="priority-card" :class="`priority-card--${item.tone}`">
          <span>{{ item.label }}</span><strong>{{ item.value }}</strong><small>Ver detalhes <AdminIcon name="arrow" :size="14" /></small>
        </NuxtLink>
      </section>

      <div class="dashboard-section-heading"><div><span class="section-kicker">PLATAFORMA</span><h2>Panorama geral</h2></div></div>
      <section class="metrics-grid dashboard-metrics" aria-label="Indicadores gerais">
        <NuxtLink v-for="item in primaryMetrics" :key="item.label" :to="item.to" class="metric-link">
          <span class="metric-link__icon"><AdminIcon :name="item.icon" :size="20" /></span>
          <span class="metric-link__label">{{ item.label }}</span><strong>{{ item.value }}</strong><small>{{ item.note }}</small>
        </NuxtLink>
      </section>

      <section class="dashboard-columns">
        <article class="panel"><div class="panel-head"><div><span class="section-kicker">INFRAESTRUTURA</span><h2>Disponibilidade operacional</h2><p>Proporção de recursos ativos na plataforma.</p></div></div>
          <div class="live-summary"><div v-for="item in operatingRates" :key="item.label" class="live-summary__row"><div><span>{{ item.label }}</span><strong>{{ item.value }} de {{ item.total }}</strong></div><div class="live-summary__track" role="meter" :aria-label="item.label" :aria-valuenow="item.percentage" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${item.percentage}%` }"></span></div><small>{{ item.percentage }}%</small></div></div>
        </article>
        <article class="panel"><div class="panel-head"><div><span class="section-kicker">FILA RECENTE</span><h2>Solicitações recentes</h2><p>Os cinco protocolos mais recentes nesta consulta.</p></div><NuxtLink class="table-action" to="/solicitacoes">Ver todas</NuxtLink></div>
          <NuxtLink v-for="request in recentRequests" :key="request.id" class="activity-row" :to="{ path: '/solicitacoes', query: { protocolo: request.id } }"><span class="activity-icon"><AdminIcon name="support" :size="17" /></span><div><strong>{{ tenantFor(request.tenantId)?.name || 'Empresa indisponível' }}</strong><small>{{ request.subject || request.id }}</small></div><time>{{ formatDate(request.createdAt) }}</time></NuxtLink>
          <p v-if="!recentRequests.length" class="empty-state">{{ search ? 'Nenhum protocolo corresponde à busca.' : 'Nenhuma solicitação registrada.' }}</p>
        </article>
      </section>

      <section class="panel operational-health" aria-labelledby="operational-health-title" aria-live="polite">
        <div class="panel-head"><div><span class="section-kicker">OBSERVABILIDADE</span><h2 id="operational-health-title">Saúde operacional</h2><p>Contagens agregadas da plataforma; sem payloads ou dados de clientes.</p></div><small>Verificado {{ formatDate(overview.health.checkedAt) }}</small></div>
        <div class="operational-health__grid">
          <article v-for="item in operationalHealthItems" :key="item.label" class="operational-health__item" :class="{ 'operational-health__item--alert': item.alert }">
            <span>{{ item.label }}</span><strong>{{ item.value }}</strong><small>{{ item.detail }}</small>
          </article>
        </div>
      </section>

      <section v-if="supportMetrics" class="dashboard-columns dashboard-columns--balanced">
        <article class="panel"><div class="panel-head"><div><span class="section-kicker">SUPORTE</span><h2>Desempenho da equipe</h2><p>Tempos médios dos atendimentos comerciais.</p></div></div>
          <div class="dashboard-stat-list"><div><span>Primeira resposta</span><strong>{{ Math.round(supportMetrics.averageFirstResponseMinutes) }} min</strong></div><div><span>Resolução</span><strong>{{ Math.round(supportMetrics.averageResolutionMinutes) }} min</strong></div><div><span>Reabertos</span><strong>{{ supportMetrics.reopened }}</strong></div></div>
        </article>
        <article class="panel"><div class="panel-head"><div><span class="section-kicker">CONFORMIDADE</span><h2>Fila e LGPD</h2><p>Prazos legais acompanhados separadamente.</p></div></div>
          <div class="dashboard-stat-list"><div><span>Aguardando cliente</span><strong>{{ supportMetrics.waitingCustomer }}</strong></div><div><span>Aguardando equipe</span><strong>{{ supportMetrics.waitingInternal }}</strong></div><div><span>LGPD dentro do prazo</span><strong>{{ supportMetrics.lgpd.withinDeadline }}</strong></div><div><span>LGPD em atraso</span><strong>{{ supportMetrics.lgpd.overdue }}</strong></div></div>
        </article>
      </section>

      <details class="panel dashboard-sla"><summary><span><span class="section-kicker">CONFIGURAÇÕES</span><strong>Regras de SLA do suporte</strong><small>Editar prazos comerciais. Alterações são salvas individualmente.</small></span><span class="dashboard-sla__expand">Gerenciar</span></summary>
        <p v-if="slaError" class="feedback feedback--error" role="alert">{{ slaError }}</p><p v-if="slaFeedback" class="feedback feedback--success" role="status">{{ slaFeedback }}</p>
        <div class="table-wrap"><table><thead><tr><th>Categoria</th><th>Prioridade</th><th>1ª resposta (min)</th><th>Resolução (min)</th><th>Ativa</th><th>Ação</th></tr></thead><tbody>
          <tr v-for="rule in supportSlaRules" :key="rule.id"><td>{{ rule.category }}</td><td>{{ rule.priority }}</td><td><input v-model.number="rule.firstResponseMinutes" type="number" min="1" max="43200" :aria-label="`Primeira resposta de ${rule.category} / ${rule.priority}`"></td><td><input v-model.number="rule.resolutionMinutes" type="number" min="1" max="43200" :aria-label="`Resolução de ${rule.category} / ${rule.priority}`"></td><td><input v-model="rule.active" type="checkbox" :aria-label="`Regra ativa para ${rule.category} / ${rule.priority}`"></td><td><button class="button button--quiet" type="button" :disabled="slaSaving === rule.id" @click="saveSlaRule(rule)">{{ slaSaving === rule.id ? 'Salvando...' : 'Salvar' }}</button></td></tr>
          <tr v-if="!supportSlaRules.length"><td colspan="6" class="empty-state">Nenhuma regra configurada.</td></tr>
        </tbody></table></div>
      </details>
    </template>
  </AdminShell>
</template>

<style scoped>
.operational-health{margin:18px 0}.operational-health .panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.operational-health .panel-head>small{color:#66758b;font-size:11px}.operational-health__grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.operational-health__item{display:grid;min-width:0;gap:5px;border:1px solid #dce5f0;border-radius:10px;background:#f8fafc;padding:12px}.operational-health__item>span{color:#52627a;font-size:11px;font-weight:700}.operational-health__item>strong{color:#172033;font-size:22px;overflow-wrap:anywhere}.operational-health__item>small{color:#66758b;font-size:10px;line-height:1.4}.operational-health__item--alert{border-color:#f2c4a5;background:#fff8f2}.operational-health__item--alert>strong{color:#a94416}@media(max-width:760px){.operational-health__grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:500px){.operational-health__grid{grid-template-columns:1fr}.operational-health .panel-head{flex-direction:column}}
</style>
