<script setup lang="ts">
const { clients, deleteItem } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()
const router = useRouter()
const search = ref('')
const filtered = computed(() => clients.value.filter(c => Object.values(c).join(' ').toLowerCase().includes(search.value.toLowerCase())))
const goToNewClient = () => navigateTo('/clientes/novo')
const editClient = (client: any) => {
  if (!client.id) return
  router.push(`/clientes/novo?id=${client.id}`)
}
const removeClient = async (client: any) => {
  if (!client.id || !window.confirm(`Excluir cliente?\n\n${client.name}\n\nEsta ação não poderá ser desfeita.`)) return
  await deleteItem('clients', client.id)
  notify('Cliente excluído com sucesso.')
}
</script>

<template>
  <div>
    <PageHeader title="Clientes" subtitle="Conheça seus clientes e acompanhe o histórico de compras.">
      <button class="btn btn--primary" type="button" @click="goToNewClient"><UiIcon name="plus" />Novo Cliente</button>
    </PageHeader>
    <div class="metrics-grid metrics-grid--4">
      <MetricCard label="Clientes Ativos" :value="formatNumber(clients.length)" icon="users" note="Dados do banco" />
      <MetricCard label="Novos no Mês" :value="formatNumber(clients.length)" icon="plus" note="Cadastros carregados" color="green" />
      <MetricCard label="Cliente mais Rentável" :value="metrics.bestClient.value?.name || '-'" icon="trend" :change="formatCurrency(metrics.bestClient.value?.revenue || 0)" color="purple" />
      <MetricCard label="Ticket Médio" :value="formatCurrency(metrics.clientTicket.value)" icon="tag" note="Faturamento / Pedidos" color="orange" />
    </div>
    <div class="filters">
      <div class="field field--search">
        <label>Buscar cliente</label>
        <div class="search-field"><UiIcon name="search" /><input v-model="search" placeholder="Nome, e-mail ou telefone"></div>
      </div>
      <div class="field"><label>Período da última compra</label><select><option>Todos</option><option>Últimos 30 dias</option></select></div>
    </div>
    <PanelCard title="Lista de Clientes">
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Cliente</th><th>E-mail</th><th>Telefone</th><th>Pedidos</th><th>Faturamento Total</th><th>Ticket Médio</th><th>Última Compra</th><th></th></tr></thead>
          <tbody>
            <tr v-for="c in filtered" :key="c.email">
              <td><div class="table-product table-product--editable"><span class="avatar">{{c.name.split(' ').map(x=>x[0]).join('')}}</span><strong>{{c.name}}</strong><button class="row-action row-action--edit" title="Editar cliente" @click.stop="editClient(c)"><UiIcon name="edit" :size="15"/></button></div></td>
              <td>{{c.email}}</td>
              <td>{{c.phone}}</td>
              <td>{{c.orders}}</td>
              <td class="money-positive">{{formatCurrency(c.revenue)}}</td>
              <td>{{formatCurrency(c.ticket)}}</td>
              <td>{{c.last}}</td>
              <td><button class="row-action" title="Excluir cliente" @click.stop="removeClient(c)"><UiIcon name="close" :size="16" /></button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </PanelCard>
  </div>
</template>
