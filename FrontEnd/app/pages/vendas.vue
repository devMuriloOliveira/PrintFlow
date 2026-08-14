<script setup lang="ts">
const { orders } = useAppData()
const search = ref('')
const status = ref('Todos')
const filtered = computed(() => orders.value.filter(o => (status.value === 'Todos' || o.status === status.value) && Object.values(o).join(' ').toLowerCase().includes(search.value.toLowerCase())))
const badgeClass = (s: string) => ({ Novo: '', Producao: 'badge--orange', Impresso: 'badge--purple', Embalando: 'badge--orange', Enviado: '', Entregue: 'badge--green', Cancelado: 'badge--red' }[s] || '')
const statusSegments = [
  { label: 'Novo', value: 13.4, color: '#1768f2' }, { label: 'Producao', value: 14.8, color: '#f6b917' }, { label: 'Impresso', value: 12.7, color: '#b23bc1' },
  { label: 'Embalando', value: 10.9, color: '#f57c1f' }, { label: 'Enviado', value: 15.8, color: '#2f77d5' }, { label: 'Entregue', value: 28.9, color: '#21aa91' }, { label: 'Cancelado', value: 3.5, color: '#ef4444' }
]
</script>
<template>
  <div>
    <PageHeader title="Vendas" subtitle="Gerencie seus pedidos e acompanhe o desempenho das suas vendas." />
    <div class="metrics-grid metrics-grid--5">
      <MetricCard label="Receita Bruta" value="R$ 18.450,00" icon="money" change="12,8%" note="vs. mes anterior" color="green" />
      <MetricCard label="Receita Liquida" value="R$ 15.980,00" icon="wallet" change="10,6%" note="vs. mes anterior" color="blue" />
      <MetricCard label="Lucro Total" value="R$ 9.130,00" icon="money" change="10,9%" note="vs. mes anterior" color="green" />
      <MetricCard label="Pedidos no Mes" value="284" icon="bag" change="15,3%" note="vs. mes anterior" color="purple" />
      <MetricCard label="Frete" value="R$ 1.840,00" icon="cart" change="4,5%" note="vs. mes anterior" color="orange" negative />
    </div>
    <div class="filters">
      <div class="field field--search"><label>Buscar</label><div class="search-field"><UiIcon name="search" :size="16"/><input v-model="search" placeholder="Pedido, cliente ou produto"></div></div>
      <div class="field"><label>Marketplace</label><select><option>Todos Marketplaces</option><option>Shopee</option><option>Mercado Livre</option></select></div>
      <div class="field"><label>Status</label><select v-model="status"><option>Todos</option><option>Novo</option><option>Producao</option><option>Entregue</option><option>Cancelado</option></select></div>
      <div class="field"><label>Produto</label><select><option>Todos Produtos</option></select></div>
      <button class="btn"><UiIcon name="filter" :size="16"/> Filtros</button>
    </div>
    <div class="split-layout">
      <PanelCard title="Pedidos">
        <div class="table-scroll"><table class="data-table">
          <thead><tr><th>Nº Pedido</th><th>Data</th><th>Cliente</th><th>Marketplace</th><th>Produto</th><th>Qtd.</th><th>Valor Bruto</th><th>Taxa</th><th>Frete</th><th>Receita Liquida</th><th>Lucro</th><th>Status</th><th></th></tr></thead>
          <tbody><tr v-for="o in filtered" :key="o.id"><td><strong>{{ o.id }}</strong></td><td>{{ o.date }}</td><td>{{ o.client }}</td><td>{{ o.marketplace }}</td><td>{{ o.product }}</td><td>{{ o.qty }}</td><td>{{ formatCurrency(o.gross) }}</td><td>{{ formatCurrency(o.fee) }}</td><td>{{ formatCurrency(o.shipping) }}</td><td>{{ formatCurrency(o.net) }}</td><td>{{ formatCurrency(o.profit) }}</td><td><span class="badge" :class="badgeClass(o.status)">{{ o.status }}</span></td><td><button class="row-action"><UiIcon name="more" :size="16"/></button></td></tr></tbody>
        </table></div>
        <div class="table-footer"><span>Mostrando 1 a {{ filtered.length }} de 284 pedidos</span><div class="pagination"><button class="page-btn active">1</button><button class="page-btn">2</button><button class="page-btn">3</button><button class="page-btn">…</button><button class="page-btn">29</button></div><select class="select-compact"><option>10 por pagina</option></select></div>
      </PanelCard>
      <aside>
        <PanelCard title="Vendas por Status"><DonutChart :segments="statusSegments" total="284" caption="Pedidos" /></PanelCard>
        <PanelCard title="Vendas por Marketplace" style="margin-top:12px">
          <div class="bar-list"><div v-for="(m, i) in ['Shopee','Mercado Livre','Elo7','Amazon','Instagram']" :key="m" class="bar-row"><span>{{m}}</span><div class="bar-row__track"><div class="bar-row__fill" :style="{width:`${[100,72,34,25,15][i]}%`,background:['#ee4d2d','#f5c900','#f57c1f','#111827','#c83bb7'][i]}"/></div><strong>{{ [6420,4600,2100,1620,940][i].toLocaleString('pt-BR') }}</strong></div></div>
        </PanelCard>
      </aside>
    </div>
  </div>
</template>
