<script setup lang="ts">
const { products } = useAppData()
const search = ref('')
const category = ref('Todas')
const selectedIndex = ref(0)
const selected = computed(() => products.value[selectedIndex.value])
const filtered = computed(() => products.value.filter(p => (category.value === 'Todas' || p.category === category.value) && `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(search.value.toLowerCase())))
</script>
<template>
  <div>
    <PageHeader title="Produtos" subtitle="Gerencie seu catalogo de produtos e acompanhe a performance">
      <NuxtLink class="btn btn--primary" to="/produtos/novo"><UiIcon name="plus" :size="17"/><span>Novo Produto</span></NuxtLink>
    </PageHeader>
    <div class="metrics-grid metrics-grid--4">
      <MetricCard label="Produtos Ativos" value="76" icon="box" change="12,5%" note="vs. mes anterior" />
      <MetricCard label="Preco Medio" value="R$ 98,60" icon="tag" change="8,3%" note="vs. mes anterior" color="green" />
      <MetricCard label="Custo Medio" value="R$ 53,21" icon="money" change="6,1%" note="vs. mes anterior" color="purple" />
      <MetricCard label="Margem Media" value="45,9%" icon="percent" change="2,2 p.p." note="vs. mes anterior" color="orange" />
    </div>
    <div class="filters">
      <div class="field field--search"><label>Produto</label><div class="search-field"><UiIcon name="search" :size="16"/><input v-model="search" placeholder="Buscar produtos..."></div></div>
      <div class="field"><label>Categoria</label><select v-model="category"><option>Todas</option><option>Decoracao</option><option>Acessorios</option><option>Brinquedos</option><option>Organizadores</option></select></div>
      <div class="field"><label>Impressora</label><select><option>Todas</option></select></div>
      <div class="field"><label>Material</label><select><option>Todos</option></select></div>
      <div class="field"><label>Status</label><select><option>Todos</option><option>Ativo</option></select></div>
      <button class="btn" @click="search='';category='Todas'"><UiIcon name="close" :size="15"/> Limpar</button>
    </div>
    <div class="split-layout">
      <PanelCard>
        <div class="table-scroll"><table class="data-table">
          <thead><tr><th></th><th>Produto</th><th>SKU</th><th>Categoria</th><th>Preco de Venda</th><th>Peso</th><th>Tempo de Impressao</th><th>Filamento</th><th>Custo Total</th><th>Lucro</th><th>Margem</th><th>Status</th><th></th></tr></thead>
          <tbody><tr v-for="p in filtered" :key="p.sku" :class="{selected: selected?.sku === p.sku}" @click="selectedIndex = products.findIndex(x => x.sku === p.sku)"><td><input type="radio" :checked="selected?.sku === p.sku"></td><td><div class="table-product"><ProductThumb :type="p.thumb"/><div><strong>{{p.name}}</strong><small>{{p.subtitle}}</small></div></div></td><td>{{p.sku}}</td><td>{{p.category}}</td><td><strong>{{formatCurrency(p.price)}}</strong></td><td>{{p.weight}} g</td><td>{{p.time}}</td><td><span style="display:flex;align-items:center;gap:6px"><i class="dot" :style="{background:p.filamentColor}"/>{{p.filament}}</span></td><td>{{formatCurrency(p.cost)}}</td><td class="money-positive">{{formatCurrency(p.profit)}}</td><td class="money-positive">{{p.margin}}%</td><td><span class="badge badge--green">{{p.status}}</span></td><td><button class="row-action"><UiIcon name="more" :size="16"/></button></td></tr></tbody>
        </table></div>
        <div class="table-footer"><span>Mostrando 1 a {{filtered.length}} de 76 produtos</span><div class="pagination"><button class="page-btn active">1</button><button class="page-btn">2</button><button class="page-btn">3</button><button class="page-btn">…</button><button class="page-btn">16</button></div><select class="select-compact"><option>5 por pagina</option></select></div>
      </PanelCard>
      <aside v-if="selected" class="detail-card">
        <div class="detail-card__head"><ProductThumb :type="selected.thumb" :size="75"/><div><h3>{{selected.name}} <span class="badge badge--green">Ativo</span></h3><p>SKU: {{selected.sku}}</p><p>{{selected.category}}</p><p>Material: {{selected.filament}}</p></div></div>
        <div class="tabs"><button class="tab active">Ficha Financeira</button><button class="tab">Detalhes</button><button class="tab">Historico</button></div>
        <div class="detail-card__body"><div class="detail-list"><div class="detail-list__row"><span><i style="background:#2a8ca1"/>Filamento ({{selected.weight}} g)</span><strong>{{formatCurrency(6.78)}}</strong></div><div class="detail-list__row"><span><i style="background:#f6c344"/>Energia ({{selected.time}})</span><strong>{{formatCurrency(1.48)}}</strong></div><div class="detail-list__row"><span><i style="background:#f47b3b"/>Embalagem</span><strong>R$ 1,50</strong></div><div class="detail-list__row"><span><i style="background:#c43dcc"/>Materiais adicionais</span><strong>R$ 0,80</strong></div><div class="detail-list__row"><span><i style="background:#697386"/>Taxa Marketplace</span><strong>R$ 6,99</strong></div></div><div class="summary-box"><div class="detail-list__row"><span>Custo Total</span><strong>{{formatCurrency(selected.cost)}}</strong></div><div class="detail-list__row"><span>Preco de Venda</span><strong>{{formatCurrency(selected.price)}}</strong></div><div class="detail-list__row"><span>Lucro Liquido</span><strong class="money-positive">{{formatCurrency(selected.profit)}}</strong></div><div class="detail-list__row"><span>Margem Liquida</span><strong class="money-positive">{{selected.margin}}%</strong></div></div></div>
      </aside>
    </div>
  </div>
</template>
