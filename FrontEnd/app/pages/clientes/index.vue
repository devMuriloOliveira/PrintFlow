<script setup lang="ts">
const { clients, loadClientOrders, updateItem } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()
const router = useRouter()
const subscription = useSubscriptionAccess()

const search = ref('')
const clientOrder = ref('name')
const statusFilter = ref('Todos')
const originFilter = ref('Todos')
const selectedClientId = ref('')
const selectedClientOrders = ref<any[]>([])
const selectedClientOrdersLoading = ref(false)
let clientOrdersRequest = 0

const normalizeSearch = (value: unknown) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const isMissingContact = (value: unknown) => !String(value || '').trim() || /^(?:-|nao-informado|não informado|sem-email@printflow\.local)$/i.test(String(value).trim())
const contactLabel = (value: unknown) => isMissingContact(value) ? 'Não informado' : String(value)
const initials = (name: unknown) => String(name || 'Cliente').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()
const parseBrazilianDate = (value: unknown) => {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return match ? new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00`).getTime() : 0
}

const activeClients = computed(() => clients.value.filter(client => (client.status || 'active') === 'active'))
const clientsWithOrders = computed(() => clients.value.filter(client => Number(client.orders || 0) > 0))
const totalClientRevenue = computed(() => clients.value.reduce((total, client) => total + Number(client.revenue || 0), 0))
const bestClient = computed(() => Number(metrics.bestClient.value?.revenue || 0) > 0 ? metrics.bestClient.value : null)
const originOptions = computed(() => [...new Set(clients.value.map(client => client.origin || 'Outro'))].sort((a, b) => a.localeCompare(b, 'pt-BR')))
onMounted(() => { void subscription.load() })

const filtered = computed(() => {
  const term = normalizeSearch(search.value)
  const result = clients.value.filter(client => {
    const matchesStatus = statusFilter.value === 'Todos' || (client.status || 'active') === statusFilter.value
    const matchesOrigin = originFilter.value === 'Todos' || (client.origin || 'Outro') === originFilter.value
    const matchesSearch = !term || normalizeSearch([client.name, client.email, client.phone, client.document, client.tags].join(' ')).includes(term)
    return matchesStatus && matchesOrigin && matchesSearch
  })

  return [...result].sort((a, b) => {
    if (clientOrder.value === 'revenue') return Number(b.revenue || 0) - Number(a.revenue || 0)
    if (clientOrder.value === 'orders') return Number(b.orders || 0) - Number(a.orders || 0)
    if (clientOrder.value === 'recent') return parseBrazilianDate(b.last) - parseBrazilianDate(a.last)
    return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')
  })
})

const clientOrderPoints = computed(() => clients.value.map(client => Number(client.orders || 0)))
const selectedClient = computed(() => clients.value.find(client => String(client.id || '') === selectedClientId.value) || null)
const selectedTags = computed(() => String(selectedClient.value?.tags || '').split(',').map(tag => tag.trim()).filter(Boolean))
const selectedAddress = computed(() => {
  if (!selectedClient.value) return ''
  const street = [selectedClient.value.address, selectedClient.value.number].filter(value => !isMissingContact(value)).join(', ')
  const place = [selectedClient.value.district, selectedClient.value.city, selectedClient.value.state].filter(value => !isMissingContact(value)).join(' · ')
  return [street, place].filter(Boolean).join(' — ')
})

const clearFilters = () => {
  search.value = ''
  clientOrder.value = 'name'
  statusFilter.value = 'Todos'
  originFilter.value = 'Todos'
}

const editClient = (client: any) => {
  if (client.id) router.push(`/clientes/novo?id=${client.id}`)
}

const selectClient = async (client: any) => {
  const nextId = selectedClientId.value === String(client.id || '') ? '' : String(client.id || '')
  selectedClientId.value = nextId
  selectedClientOrders.value = []
  const requestId = ++clientOrdersRequest
  if (!nextId) return

  selectedClientOrdersLoading.value = true
  try {
    const result = await loadClientOrders(nextId)
    if (requestId === clientOrdersRequest && selectedClientId.value === nextId) selectedClientOrders.value = result.items
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Não foi possível carregar o histórico do cliente.', 'info')
  } finally {
    if (requestId === clientOrdersRequest) selectedClientOrdersLoading.value = false
  }
}

const setClientStatus = async (client: any, status: 'active' | 'inactive') => {
  if (!client.id) return
  if (status === 'inactive' && !window.confirm(`Inativar cliente?\n\n${client.name}\n\nO histórico será preservado e o cadastro poderá ser reativado depois.`)) return

  try {
    await updateItem('clients', { ...client, status })
    notify(status === 'active' ? 'Cliente reativado com sucesso.' : 'Cliente inativado com sucesso.')
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Não foi possível alterar o status do cliente.', 'info')
  }
}

const statusClass = (status: unknown) => {
  const value = normalizeSearch(status)
  if (value.includes('entreg')) return 'badge--green'
  if (value.includes('cancel')) return 'badge--red'
  if (value.includes('produc') || value.includes('enviado')) return 'badge--orange'
  return 'badge--blue'
}
</script>

<template>
  <main class="clients-page">
    <PageHeader title="Clientes" subtitle="Relacionamento, histórico e valor gerado pelas vendas diretas.">
      <NuxtLink class="btn btn--primary" :to="subscription.isLimitReached('clients') ? subscription.upgradePath : '/clientes/novo'"><UiIcon :name="subscription.isLimitReached('clients') ? 'lock' : 'plus'" :size="16" />{{ subscription.isLimitReached('clients') ? 'Limite atingido · Upgrade' : 'Novo cliente' }}</NuxtLink>
    </PageHeader>
    <PlanLimitNotice resource="clients" label="clientes" remaining-text="Seus clientes atuais, histórico e vendas continuam disponíveis para consulta e edição." />

    <div class="metrics-grid metrics-grid--4 clients-metrics">
      <MetricCard label="Clientes ativos" :value="formatNumber(activeClients.length)" icon="users" :note="`${clients.length - activeClients.length} inativo(s)`" :points="clientOrderPoints" />
      <MetricCard label="Com histórico de compra" :value="formatNumber(clientsWithOrders.length)" icon="receipt" :note="`${clients.length ? Math.round(clientsWithOrders.length / clients.length * 100) : 0}% da base cadastrada`" color="green" :points="clientOrderPoints" />
      <MetricCard label="Cliente de maior valor" :value="bestClient?.name || '-'" icon="trend" :change="bestClient ? formatCurrency(bestClient.revenue) : 'Sem vendas vinculadas'" color="purple" :points="clients.map(client => Number(client.revenue || 0))" />
      <MetricCard label="Receita da base" :value="formatCurrency(totalClientRevenue)" icon="money" :note="`Ticket médio ${formatCurrency(metrics.clientTicket.value)}`" color="orange" :points="clients.map(client => Number(client.revenue || 0))" />
    </div>

    <section class="clients-toolbar">
      <div class="clients-toolbar__heading"><div><span>CARTEIRA DE CLIENTES</span><strong>{{ filtered.length }} de {{ clients.length }} cadastro(s)</strong></div><button class="btn btn--compact" type="button" @click="clearFilters"><UiIcon name="close" :size="14" />Limpar</button></div>
      <div class="filters clients-filters">
        <div class="field field--search"><label>Buscar cliente</label><div class="search-field"><UiIcon name="search" :size="16" /><input v-model="search" placeholder="Nome, contato, documento ou tag"></div></div>
        <div class="field"><label>Ordenar por</label><select v-model="clientOrder"><option value="name">Nome</option><option value="revenue">Maior faturamento</option><option value="orders">Mais pedidos</option><option value="recent">Compra mais recente</option></select></div>
        <div class="field"><label>Status</label><select v-model="statusFilter"><option>Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option></select></div>
        <div class="field"><label>Origem</label><select v-model="originFilter"><option>Todos</option><option v-for="origin in originOptions" :key="origin">{{ origin }}</option></select></div>
      </div>
    </section>

    <section v-if="selectedClient" class="client-insight">
      <header class="client-insight__header">
        <span class="avatar client-insight__avatar">{{ initials(selectedClient.name) }}</span>
        <div><span class="client-insight__eyebrow">CLIENTE SELECIONADO</span><h2>{{ selectedClient.name }}</h2><p>{{ contactLabel(selectedClient.email) }} · {{ contactLabel(selectedClient.phone) }}</p></div>
        <span class="badge" :class="selectedClient.status === 'inactive' ? 'badge--gray' : 'badge--green'">{{ selectedClient.status === 'inactive' ? 'Inativo' : 'Ativo' }}</span>
        <button class="btn" type="button" @click="editClient(selectedClient)"><UiIcon name="edit" :size="15" />Editar cadastro</button>
        <button class="row-action" type="button" title="Fechar resumo" @click="selectedClientId = ''"><UiIcon name="close" :size="16" /></button>
      </header>

      <div class="client-insight__stats">
        <article><span>Pedidos diretos</span><strong>{{ formatNumber(selectedClient.orders || 0) }}</strong></article>
        <article><span>Faturamento</span><strong>{{ formatCurrency(selectedClient.revenue) }}</strong></article>
        <article><span>Ticket médio</span><strong>{{ formatCurrency(selectedClient.ticket) }}</strong></article>
        <article><span>Última compra</span><strong>{{ selectedClient.last || 'Sem compras' }}</strong></article>
      </div>

      <div class="client-insight__details">
        <div><span>Origem</span><strong>{{ selectedClient.origin || 'Outro' }}</strong></div>
        <div><span>Endereço</span><strong>{{ selectedAddress || 'Não informado' }}</strong></div>
        <div><span>Tags</span><span v-if="selectedTags.length" class="client-tags"><em v-for="tag in selectedTags" :key="tag">{{ tag }}</em></span><strong v-else>Sem tags</strong></div>
        <div><span>Observações</span><strong>{{ selectedClient.notes || 'Nenhuma observação' }}</strong></div>
      </div>

      <div class="client-history">
        <div class="client-history__heading"><div><span>HISTÓRICO COMERCIAL</span><h3>Vendas diretas vinculadas</h3></div><small>Pedidos cancelados permanecem no histórico operacional.</small></div>
        <div v-if="selectedClientOrdersLoading" class="client-history__loading"><UiIcon name="refresh" :size="18" />Carregando histórico...</div>
        <div v-else-if="selectedClientOrders.length" class="table-scroll"><table class="data-table"><thead><tr><th>Pedido</th><th>Data</th><th>Produto</th><th>Qtd.</th><th>Valor</th><th>Status</th></tr></thead><tbody><tr v-for="order in selectedClientOrders" :key="order.dbId || order.id"><td><strong>{{ order.id }}</strong></td><td>{{ order.date }}</td><td>{{ order.product }}</td><td>{{ order.qty }}</td><td>{{ formatCurrency(order.gross) }}</td><td><span class="badge" :class="statusClass(order.status)">{{ order.status }}</span></td></tr></tbody></table></div>
        <div v-else class="client-history__empty"><span><UiIcon name="receipt" /></span><div><strong>Ainda não há vendas vinculadas</strong><p>Selecione este cliente ao registrar uma venda direta para formar o histórico.</p></div><NuxtLink class="btn btn--compact" to="/vendas/novo">Registrar venda</NuxtLink></div>
      </div>
    </section>

    <PanelCard title="Lista de clientes" :subtitle="'Clique em um cliente para abrir o histórico e os dados comerciais.'">
      <div class="table-scroll">
        <table class="data-table clients-table">
          <thead><tr><th>Cliente</th><th>Contato</th><th>Origem</th><th>Pedidos</th><th>Faturamento</th><th>Ticket médio</th><th>Última compra</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr v-if="!filtered.length"><td colspan="9"><div class="empty-state"><div><div class="empty-state__icon"><UiIcon name="users" /></div><h3>Nenhum cliente encontrado</h3><p>{{ clients.length ? 'Ajuste ou limpe os filtros para ver outros cadastros.' : 'Cadastre seu primeiro cliente para começar o histórico de relacionamento.' }}</p><button v-if="clients.length" class="btn" type="button" @click="clearFilters">Limpar filtros</button><NuxtLink v-else class="btn btn--primary" to="/clientes/novo">Cadastrar cliente</NuxtLink></div></div></td></tr>
            <tr v-for="client in filtered" :key="client.id" :class="{ 'clients-table__row--selected': selectedClientId === String(client.id || '') }" tabindex="0" @click="selectClient(client)" @keydown.enter.self="selectClient(client)" @keydown.space.self.prevent="selectClient(client)">
              <td><div class="table-product"><span class="avatar">{{ initials(client.name) }}</span><div><strong>{{ client.name }}</strong><small>{{ client.type || 'Pessoa Física' }}</small></div></div></td>
              <td><div class="client-contact"><strong>{{ contactLabel(client.email) }}</strong><small>{{ contactLabel(client.phone) }}</small></div></td>
              <td><span class="badge badge--blue">{{ client.origin || 'Outro' }}</span></td>
              <td>{{ formatNumber(client.orders || 0) }}</td>
              <td class="money-positive">{{ formatCurrency(client.revenue) }}</td>
              <td>{{ formatCurrency(client.ticket) }}</td>
              <td>{{ client.last || 'Sem compras' }}</td>
              <td><span class="badge" :class="client.status === 'inactive' ? 'badge--gray' : 'badge--green'">{{ client.status === 'inactive' ? 'Inativo' : 'Ativo' }}</span></td>
              <td><div class="clients-table__actions"><button class="row-action row-action--edit" type="button" title="Editar cliente" @click.stop="editClient(client)"><UiIcon name="edit" :size="15" /></button><button v-if="client.status !== 'inactive'" class="row-action" type="button" title="Inativar cliente" @click.stop="setClientStatus(client, 'inactive')"><UiIcon name="close" :size="16" /></button><button v-else class="row-action row-action--restore" type="button" title="Reativar cliente" @click.stop="setClientStatus(client, 'active')"><UiIcon name="check" :size="16" /></button></div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </PanelCard>
  </main>
</template>

<style scoped>
.clients-table tbody tr:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}
.clients-page{width:100%}.clients-metrics{margin-bottom:14px}.clients-toolbar{margin-bottom:14px;border:1px solid var(--line);border-radius:12px;background:#fff;box-shadow:var(--shadow)}.clients-toolbar__heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px 0}.clients-toolbar__heading span,.client-insight__eyebrow,.client-history__heading span{display:block;color:var(--blue);font-size:8px;font-weight:800;letter-spacing:.09em}.clients-toolbar__heading strong{display:block;margin-top:3px;color:#253247;font-size:11px}.clients-filters{margin:0;border:0;box-shadow:none}.client-insight{overflow:hidden;margin-bottom:14px;border:1px solid #d7e2f3;border-radius:13px;background:#fff;box-shadow:var(--shadow)}.client-insight__header{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto auto;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid #e8edf4;background:linear-gradient(135deg,#fbfdff,#f2f7ff)}.client-insight__avatar{width:46px;height:46px;font-size:14px}.client-insight__header h2{margin:2px 0 3px;color:#172033;font-size:16px}.client-insight__header p{margin:0;color:var(--muted);font-size:9px}.client-insight__stats{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--line)}.client-insight__stats article{display:grid;gap:4px;padding:14px 18px;border-right:1px solid var(--line)}.client-insight__stats article:last-child{border-right:0}.client-insight__stats span,.client-insight__details>div>span{color:var(--muted);font-size:9px}.client-insight__stats strong{font-size:14px}.client-insight__details{display:grid;grid-template-columns:.7fr 1.5fr 1fr 1.4fr;gap:14px;padding:14px 18px;background:#fbfcfe}.client-insight__details>div{min-width:0}.client-insight__details strong{display:block;overflow-wrap:anywhere;margin-top:4px;color:#2c3a50;font-size:9.5px;line-height:1.45}.client-tags{display:flex!important;flex-wrap:wrap;gap:4px;margin-top:5px}.client-tags em{border-radius:999px;color:#36577d;background:#eaf2fc;padding:3px 7px;font-size:8px;font-style:normal;font-weight:700}.client-history{padding:16px 18px}.client-history__heading{display:flex;align-items:end;justify-content:space-between;gap:14px;margin-bottom:10px}.client-history__heading h3{margin:2px 0 0;font-size:12px}.client-history__heading small{color:var(--muted);font-size:8px}.client-history__loading,.client-history__empty{display:flex;align-items:center;gap:11px;min-height:64px;border:1px dashed #d7e0ec;border-radius:10px;color:var(--muted);background:#fafcff;padding:12px;font-size:9px}.client-history__empty>span{display:grid;width:36px;height:36px;flex:0 0 auto;place-items:center;border-radius:10px;color:var(--blue);background:var(--blue-soft)}.client-history__empty>div{flex:1}.client-history__empty strong{color:#26354a;font-size:10px}.client-history__empty p{margin:3px 0 0}.clients-table tbody tr{cursor:pointer}.clients-table__row--selected td{background:#f2f7ff}.table-product>div strong,.table-product>div small,.client-contact strong,.client-contact small{display:block}.table-product>div small,.client-contact small{color:var(--muted);margin-top:3px;font-size:8px}.client-contact strong{max-width:210px;overflow:hidden;color:#34415c;font-size:9px;text-overflow:ellipsis}.clients-table__actions{display:flex;justify-content:flex-end;gap:5px}.row-action--restore{color:#087b54;background:#e8f8f0}
@media(max-width:1050px){.client-insight__details{grid-template-columns:1fr 1fr}.client-insight__header{grid-template-columns:auto minmax(0,1fr) auto}.client-insight__header>.btn{grid-column:2}.client-insight__header>.row-action{grid-column:3;grid-row:1}}
@media(max-width:720px){.clients-filters{display:grid;grid-template-columns:1fr 1fr}.clients-filters .field--search{grid-column:1/-1}.client-insight__header{grid-template-columns:auto 1fr auto;padding:14px}.client-insight__header>.badge{grid-column:2}.client-insight__header>.btn{grid-column:1/-1}.client-insight__stats{grid-template-columns:1fr 1fr}.client-insight__stats article:nth-child(2){border-right:0}.client-insight__stats article:nth-child(-n+2){border-bottom:1px solid var(--line)}.client-insight__details{grid-template-columns:1fr}.client-history__heading{align-items:start;flex-direction:column}.client-history__empty{align-items:flex-start;flex-wrap:wrap}.client-history__empty .btn{width:100%}}
@media(max-width:480px){.clients-filters,.client-insight__stats{grid-template-columns:1fr}.clients-filters .field--search{grid-column:auto}.client-insight__stats article{border-right:0;border-bottom:1px solid var(--line)}.client-insight__stats article:last-child{border-bottom:0}}
</style>
