<script setup lang="ts">
const { products, expenseSegments } = useAppData()
const { notify } = useUi()
const revenue = [4, 5, 13, 9, 13, 16, 13, 10, 15, 12, 12.5, 18]
const revenueLabels = ['Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai']
const marketplaceBars = [
  { label: 'Shopee', value: 8250, percent: 82.5, color: '#ee4d2d' },
  { label: 'Mercado Livre', value: 6120, percent: 61.2, color: '#f6c900' },
  { label: 'Site Proprio', value: 2980, percent: 29.8, color: '#1768f2' },
  { label: 'Instagram', value: 1100, percent: 11, color: '#c83bb7' }
]
</script>

<template>
  <div>
    <PageHeader title="Dashboard" subtitle="Resumo geral do seu negocio de impressao 3D" />

    <div class="metrics-grid">
      <MetricCard label="Faturamento Total" value="R$ 18.450,00" icon="trend" change="12,8%" note="vs. 01/04 - 30/04" color="blue" :points="[5,13,9,15,11,17,10,18]" />
      <MetricCard label="Despesas Totais" value="R$ 9.320,00" icon="receipt" change="8,6%" note="vs. 01/04 - 30/04" color="red" negative :points="[4,15,9,16,11,14,8,19]" />
      <MetricCard label="Lucro Liquido" value="R$ 9.130,00" icon="money" change="Margem 49,48%" color="green" selected :points="[4,16,10,18,8,15,10,20]" />
      <MetricCard label="Pedidos" value="284" icon="bag" change="15,3%" note="vs. 01/04 - 30/04" color="purple" :points="[3,12,7,17,10,14,9,20]" />
      <MetricCard label="Ticket Medio" value="R$ 64,97" icon="tag" note="Faturamento / Pedidos" color="orange" :points="[2,5,4,13,7,9,10,15]" />
      <MetricCard label="Taxas de Marketplaces" value="R$ 2.740,00" icon="percent" change="10,2%" note="vs. 01/04 - 30/04" color="cyan" :points="[3,6,5,12,6,10,7,12]" />
    </div>

    <div class="dashboard-grid">
      <PanelCard title="Faturamento Mensal">
        <template #actions><select class="select-compact"><option>Ultimos 12 meses</option></select></template>
        <LineChart :values="revenue" :labels="revenueLabels" />
      </PanelCard>
      <PanelCard title="Receita x Despesas">
        <template #actions><select class="select-compact"><option>Ultimos 6 meses</option></select></template>
        <div class="bar-list" style="padding-top:14px">
          <div v-for="(month, i) in ['Dez/23','Jan/24','Fev/24','Mar/24','Abr/24','Mai/24']" :key="month" class="bar-row" style="grid-template-columns:46px 1fr">
            <span>{{ month }}</span><div style="display:flex;gap:5px;align-items:end;height:24px"><i :style="{width: `${65 + i*5}%`,height:'12px',background:'#1768f2',borderRadius:'3px'}"/><i :style="{width: `${42 + i*3}%`,height:'12px',background:'#ef4444',borderRadius:'3px'}"/></div>
          </div>
        </div>
      </PanelCard>
      <PanelCard title="Despesas por Categoria">
        <template #actions><select class="select-compact"><option>Este mes</option></select></template>
        <DonutChart :segments="expenseSegments" total="R$ 9.320" />
      </PanelCard>
    </div>

    <div class="dashboard-grid dashboard-grid--bottom">
      <PanelCard title="Faturamento por Marketplace">
        <template #actions><select class="select-compact"><option>Este mes</option></select></template>
        <div class="bar-list" style="padding-top:12px">
          <div v-for="bar in marketplaceBars" :key="bar.label" class="bar-row">
            <span>{{ bar.label }}</span><div class="bar-row__track"><div class="bar-row__fill" :style="{ width: `${bar.percent}%`, background: bar.color }"/></div><strong>{{ formatCurrency(bar.value) }}</strong>
          </div>
        </div>
      </PanelCard>
      <PanelCard title="Produtos mais Lucrativos">
        <template #actions><select class="select-compact"><option>Este mes</option></select></template>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Produto</th><th>Vendas</th><th>Lucro</th><th>Margem</th></tr></thead>
            <tbody><tr v-for="(p, i) in products" :key="p.sku"><td><div class="table-product"><ProductThumb :type="p.thumb" :size="28"/><strong>{{ p.name }}</strong></div></td><td>{{ [58,42,36,31,76][i] }}</td><td class="money-positive">{{ formatCurrency([1740,1220,1080,930,567][i]) }}</td><td><span class="badge badge--green">{{ [60,58.1,60,60,57.4][i] }}%</span></td></tr></tbody>
          </table>
        </div>
      </PanelCard>
      <PanelCard title="Alertas e Recomendacoes">
        <template #actions><button class="btn btn--ghost" @click="notify('Central de alertas aberta', 'info')">Ver todos</button></template>
        <div class="alerts-list">
          <div class="alert-row"><span class="alert-row__icon"><UiIcon name="chart" :size="17"/></span><div><strong>Seu gasto com filamentos aumentou 18%</strong><small>Comparado ao mes anterior</small></div><span class="badge badge--orange">Atencao</span><UiIcon name="chevron" :size="15"/></div>
          <div class="alert-row"><span class="alert-row__icon"><UiIcon name="box" :size="17"/></span><div><strong>PLA Preto proximo do fim</strong><small>Restam apenas 350 g em estoque</small></div><span class="badge badge--orange">Estoque baixo</span><UiIcon name="chevron" :size="15"/></div>
          <div class="alert-row"><span class="alert-row__icon" style="color:#1768f2;background:#edf4ff"><UiIcon name="bolt" :size="17"/></span><div><strong>Gasto com energia acima da media</strong><small>Consumo 12% maior que a media</small></div><span class="badge">Informativo</span><UiIcon name="chevron" :size="15"/></div>
          <div class="alert-row"><span class="alert-row__icon" style="color:#0da566;background:#eaf9f1"><UiIcon name="target" :size="17"/></span><div><strong>Meta de faturamento mensal</strong><small>Voce atingiu 61% da sua meta</small></div><span class="badge badge--green">No caminho certo</span><UiIcon name="chevron" :size="15"/></div>
        </div>
      </PanelCard>
    </div>
  </div>
</template>
