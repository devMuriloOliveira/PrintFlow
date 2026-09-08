<script setup lang="ts">
const { clients, orders, updateItem } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()
const router = useRouter()
const search = ref('')
const clientOrder = ref('name')
const statusFilter = ref('Todos')
const originFilter = ref('Todos')
const selectedClientId = ref('')
const filtered = computed(() => {
  const result = clients.value.filter(c => (statusFilter.value === 'Todos' || (c.status || 'active') === statusFilter.value) && (originFilter.value === 'Todos' || (c.origin || 'Outro') === originFilter.value) && Object.values(c).join(' ').toLowerCase().includes(search.value.toLowerCase()))
  return [...result].sort((a, b) => clientOrder.value === 'revenue'
    ? Number(b.revenue || 0) - Number(a.revenue || 0)
    : clientOrder.value === 'orders'
      ? Number(b.orders || 0) - Number(a.orders || 0)
      : String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'))
})
const clientOrderPoints = computed(() => clients.value.map(client => Number(client.orders || 0)))
const selectedClient = computed(() => clients.value.find(client => client.id === selectedClientId.value) || null)
const selectedClientOrders = computed(() => orders.value.filter(order => order.salesChannel === 'direct' && order.clientId === selectedClientId.value))
const goToNewClient = () => navigateTo('/clientes/novo')
const editClient = (client: any) => {
  if (!client.id) return
  router.push(`/clientes/novo?id=${client.id}`)
}
const selectClient = (client: any) => { selectedClientId.value = selectedClientId.value === client.id ? '' : String(client.id || '') }
const deactivateClient = async (client: any) => {
  if (!client.id || !window.confirm(`Excluir cliente?\n\n${client.name}\n\nEsta ação não poderá ser desfeita.`)) return
  await updateItem('clients', { ...client, status: 'inactive' })
  notify('Cliente excluído com sucesso.')
}
</script>

<template>
  <div>
    <PageHeader title="Clientes" subtitle="Conheça seus clientes e acompanhe o histórico de compras.">
      <button class="btn btn--primary" type="button" @click="goToNewClient"><UiIcon name="plus" />Novo Cliente</button>
    </PageHeader>
    <div class="metrics-grid metrics-grid--4">
      <MetricCard label="Clientes Ativos" :value="formatNumber(clients.filter(c => (c.status || 'active') === 'active').length)" icon="users" note="Relacionamento P2P" :points="clientOrderPoints" />
      <MetricCard label="Clientes Cadastrados" :value="formatNumber(clients.length)" icon="users" note="Data de cadastro indisponível" color="green" :points="clientOrderPoints" />
      <MetricCard label="Cliente mais Rentável" :value="metrics.bestClient.value?.name || '-'" icon="trend" :change="formatCurrency(metrics.bestClient.value?.revenue || 0)" color="purple" :points="clients.map(client => Number(client.revenue || 0))" />
      <MetricCard label="Ticket Médio" :value="formatCurrency(metrics.clientTicket.value)" icon="tag" note="Faturamento / Pedidos" color="orange" :points="clients.map(client => Number(client.ticket || 0))" />
    </div>
    <div class="filters">
      <div class="field field--search">
        <label>Buscar cliente</label>
        <div class="search-field"><UiIcon name="search" /><input v-model="search" placeholder="Nome, e-mail ou telefone"></div>
      </div>
      <div class="field"><label>Ordenar por</label><select v-model="clientOrder"><option value="name">Nome</option><option value="revenue">Maior faturamento</option><option value="orders">Mais pedidos</option></select></div>
      <div class="field"><label>Status</label><select v-model="statusFilter"><option>Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option></select></div>
      <div class="field"><label>Origem</label><select v-model="originFilter"><option>Todos</option><option v-for="origin in [...new Set(clients.map(c => c.origin || 'Outro'))]" :key="origin">{{origin}}</option></select></div>
    </div>
    <PanelCard v-if="selectedClient" title="Resumo do cliente" :subtitle="`Histórico de vendas diretas de ${selectedClient.name}`" style="margin-bottom:16px">
      <div class="summary-box" style="margin-bottom:12px"><div class="detail-list__row"><span>Contato</span><strong>{{ selectedClient.phone || 'Não informado' }}</strong></div><div class="detail-list__row"><span>Origem</span><strong>{{ selectedClient.origin || 'Outro' }}</strong></div><div class="detail-list__row"><span>Faturamento P2P</span><strong>{{ formatCurrency(selectedClient.revenue) }}</strong></div><div class="detail-list__row"><span>Ticket médio</span><strong>{{ formatCurrency(selectedClient.ticket) }}</strong></div></div>
      <div v-if="selectedClientOrders.length" class="table-scroll"><table class="data-table"><thead><tr><th>Pedido</th><th>Data</th><th>Produto</th><th>Qtd.</th><th>Valor</th><th>Status</th></tr></thead><tbody><tr v-for="order in selectedClientOrders" :key="order.dbId || order.id"><td>{{order.id}}</td><td>{{order.date}}</td><td>{{order.product}}</td><td>{{order.qty}}</td><td>{{formatCurrency(order.gross)}}</td><td>{{order.status}}</td></tr></tbody></table></div><p v-else class="info-note">Ainda não há vendas P2P vinculadas a este cliente.</p>
    </PanelCard>
    <PanelCard title="Lista de Clientes">
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Cliente</th><th>E-mail</th><th>Telefone</th><th>Pedidos</th><th>Faturamento Total</th><th>Ticket Médio</th><th>Última Compra</th><th></th></tr></thead>
          <tbody>
            <tr v-for="c in filtered" :key="c.id">
              <td><div class="table-product table-product--editable" @click="selectClient(c)"><span class="avatar">{{c.name.split(' ').map(x=>x[0]).join('')}}</span><strong>{{c.name}}</strong><button class="row-action row-action--edit" title="Editar cliente" @click.stop="editClient(c)"><UiIcon name="edit" :size="15"/></button></div></td>
              <td>{{c.email}}</td>
              <td>{{c.phone}}</td>
              <td>{{c.orders}}</td>
              <td class="money-positive">{{formatCurrency(c.revenue)}}</td>
              <td>{{formatCurrency(c.ticket)}}</td>
              <td>{{c.last}}</td>
              <td><button v-if="c.status !== 'inactive'" class="row-action" title="Inativar cliente" @click.stop="deactivateClient(c)"><UiIcon name="close" :size="16" /></button><span v-else class="badge badge--gray">Inativo</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </PanelCard>
  </div>
</template>
