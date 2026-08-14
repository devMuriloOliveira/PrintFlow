<script setup lang="ts">
const { clients } = useAppData()
const search = ref('')
const filtered = computed(() => clients.value.filter(c => Object.values(c).join(' ').toLowerCase().includes(search.value.toLowerCase())))
const goToNewClient = () => navigateTo('/clientes/novo')
</script>

<template>
  <div>
    <PageHeader title="Clientes" subtitle="Conheca seus clientes e acompanhe o historico de compras.">
      <button class="btn btn--primary" type="button" @click="goToNewClient"><UiIcon name="plus" />Novo Cliente</button>
    </PageHeader>
    <div class="metrics-grid metrics-grid--4">
      <MetricCard label="Clientes Ativos" value="186" icon="users" change="8,4%" note="vs. mes anterior" />
      <MetricCard label="Novos no Mes" value="24" icon="plus" change="14,3%" note="vs. mes anterior" color="green" />
      <MetricCard label="Cliente mais Rentavel" value="Cliente 001" icon="trend" change="R$ 1.890,40" color="purple" />
      <MetricCard label="Ticket Medio" value="R$ 128,40" icon="tag" change="6,2%" note="vs. mes anterior" color="orange" />
    </div>
    <div class="filters">
      <div class="field field--search">
        <label>Buscar cliente</label>
        <div class="search-field"><UiIcon name="search" /><input v-model="search" placeholder="Nome, e-mail ou telefone"></div>
      </div>
      <div class="field"><label>Periodo da ultima compra</label><select><option>Todos</option><option>Ultimos 30 dias</option></select></div>
    </div>
    <PanelCard title="Lista de Clientes">
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Cliente</th><th>E-mail</th><th>Telefone</th><th>Pedidos</th><th>Faturamento Total</th><th>Ticket Medio</th><th>Ultima Compra</th><th></th></tr></thead>
          <tbody>
            <tr v-for="c in filtered" :key="c.email">
              <td><div class="table-product"><span class="avatar">{{c.name.split(' ').map(x=>x[0]).join('')}}</span><strong>{{c.name}}</strong></div></td>
              <td>{{c.email}}</td>
              <td>{{c.phone}}</td>
              <td>{{c.orders}}</td>
              <td class="money-positive">{{formatCurrency(c.revenue)}}</td>
              <td>{{formatCurrency(c.ticket)}}</td>
              <td>{{c.last}}</td>
              <td><button class="row-action"><UiIcon name="more" /></button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </PanelCard>
  </div>
</template>
