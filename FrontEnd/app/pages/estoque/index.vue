<script setup lang="ts">
const { filaments, loadInventoryOverview, listPendingProductionMaterial, reconcilePendingProductionMaterial, createFilamentMovement, createProductInventoryMovement, refreshAppData } = useAppData()
const { notify } = useUi()
const route = useRoute()
type MovementType = 'in' | 'out' | 'adjustment'

const loading = ref(true)
const savingProduct = ref(false)
const savingFilament = ref(false)
const reconcilingPrintJobId = ref('')
const inventory = ref<any>({ products: [], movements: [] })
const pendingProductionMaterial = ref<any[]>([])
const selectedProductId = ref('')
const selectedFilamentId = ref('')
const filamentSearch = ref('')
const filamentStatus = ref('Todos')
const productMovement = reactive({ type: 'in' as MovementType, quantity: 0, reason: 'Produção concluída', notes: '' })
const filamentMovement = reactive({ type: 'in' as MovementType, quantity: 0, reason: 'Compra ou reposição', notes: '' })

const validSections = new Set(['visao', 'filamentos', 'produtos'])
const section = computed(() => validSections.has(String(route.query.secao || 'visao')) ? String(route.query.secao || 'visao') : 'visao')
const sectionTitle = computed(() => ({ visao: 'Visão geral', filamentos: 'Filamentos', produtos: 'Produtos fabricados' }[section.value] || 'Visão geral'))
const filteredFilaments = computed(() => {
  const term = filamentSearch.value.trim().toLowerCase()
  return filaments.value.filter((item: any) => {
    const matchesTerm = !term || [item.name, item.material, item.maker, item.color].some(value => String(value || '').toLowerCase().includes(term))
    return matchesTerm && (filamentStatus.value === 'Todos' || item.status === filamentStatus.value)
  })
})
const selectedProduct = computed(() => inventory.value.products.find((item: any) => String(item.id) === selectedProductId.value) || inventory.value.products[0])
const selectedFilament = computed(() => filaments.value.find((item: any) => String(item.id) === selectedFilamentId.value) || filteredFilaments.value[0] || filaments.value[0])
const totalFilamentWeight = computed(() => filaments.value.reduce((sum, item: any) => sum + Number(item.remaining || 0), 0))
const totalProductUnits = computed(() => inventory.value.products.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0))
const reservedProductUnits = computed(() => inventory.value.products.reduce((sum: number, item: any) => sum + Number(item.reservedQuantity || 0), 0))
const availableProductUnits = computed(() => Math.max(0, totalProductUnits.value - reservedProductUnits.value))
const lowFilaments = computed(() => filaments.value.filter((item: any) => Number(item.remaining || 0) <= Number(item.minStock ?? 300)))
const filamentStatuses = computed(() => ['Todos', ...new Set(filaments.value.map((item: any) => String(item.status || '')).filter(Boolean))])

const productReasons: Record<MovementType, string[]> = {
  in: ['Produção concluída', 'Produção excedente', 'Retorno de venda cancelada', 'Devolução de cliente'],
  out: ['Venda ou expedição', 'Perda ou descarte', 'Amostra ou uso interno', 'Produto avariado'],
  adjustment: ['Conferência física de estoque', 'Correção de cadastro']
}
const filamentReasons: Record<MovementType, string[]> = {
  in: ['Compra ou reposição', 'Devolução de material', 'Correção de recebimento'],
  out: ['Consumo manual', 'Perda ou descarte', 'Teste de impressão', 'Material avariado'],
  adjustment: ['Pesagem e conferência física', 'Correção de cadastro']
}

const refresh = async () => {
  loading.value = true
  try {
    await refreshAppData(true)
    inventory.value = await loadInventoryOverview()
    pendingProductionMaterial.value = await listPendingProductionMaterial().catch(() => [])
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Não foi possível carregar o estoque.', 'info')
  } finally { loading.value = false }
}
const reconcilePendingMaterial = async (item: any) => {
  if (!item?.printJobId || reconcilingPrintJobId.value) return
  reconcilingPrintJobId.value = String(item.printJobId)
  try {
    await reconcilePendingProductionMaterial(String(item.printJobId))
    await refresh()
    notify('Consumo pendente conciliado e estoque atualizado.')
  } catch (error: any) { notify(error?.data?.error || error?.message || 'Nao foi possivel conciliar o consumo.', 'info') }
  finally { reconcilingPrintJobId.value = '' }
}
const reasonText = (reason: string, notes: string) => notes.trim() ? `${reason}: ${notes.trim()}`.slice(0, 240) : reason
const saveProductMovement = async () => {
  const product = selectedProduct.value
  const invalidQuantity = !Number.isInteger(productMovement.quantity) || productMovement.quantity < 0 || (productMovement.type !== 'adjustment' && productMovement.quantity === 0)
  if (!product?.id || savingProduct.value || invalidQuantity) return notify('Selecione o produto e informe uma quantidade inteira válida.', 'info')
  savingProduct.value = true
  try {
    await createProductInventoryMovement(String(product.id), { type: productMovement.type, quantity: productMovement.quantity, reason: reasonText(productMovement.reason, productMovement.notes) })
    productMovement.quantity = 0
    productMovement.notes = ''
    await refresh()
    notify('Movimentação do produto registrada e saldo atualizado.')
  } catch (error: any) { notify(error?.data?.error || error?.message || 'Não foi possível registrar a movimentação.', 'info') }
  finally { savingProduct.value = false }
}
const saveFilamentMovement = async () => {
  const filament = selectedFilament.value
  const invalidQuantity = filamentMovement.quantity < 0 || (filamentMovement.type !== 'adjustment' && filamentMovement.quantity === 0)
  if (!filament?.id || savingFilament.value || invalidQuantity) return notify('Selecione o filamento e informe uma quantidade válida.', 'info')
  savingFilament.value = true
  try {
    await createFilamentMovement(String(filament.id), { type: filamentMovement.type, quantity: filamentMovement.quantity, reason: reasonText(filamentMovement.reason, filamentMovement.notes) })
    filamentMovement.quantity = 0
    filamentMovement.notes = ''
    await refresh()
    notify('Movimentação do filamento registrada e saldo atualizado.')
  } catch (error: any) { notify(error?.data?.error || error?.message || 'Não foi possível registrar a movimentação.', 'info') }
  finally { savingFilament.value = false }
}
const selectProduct = (item: any) => { selectedProductId.value = String(item.id) }
const selectFilament = (item: any) => { selectedFilamentId.value = String(item.id) }

watch(() => productMovement.type, type => { productMovement.reason = productReasons[type][0]; productMovement.notes = '' })
watch(() => filamentMovement.type, type => { filamentMovement.reason = filamentReasons[type][0]; filamentMovement.notes = '' })
watch(() => inventory.value.products, list => { if (!list.some((item: any) => String(item.id) === selectedProductId.value)) selectedProductId.value = list[0] ? String(list[0].id) : '' }, { immediate: true })
watch(filteredFilaments, list => { if (!list.some((item: any) => String(item.id) === selectedFilamentId.value)) selectedFilamentId.value = list[0] ? String(list[0].id) : '' }, { immediate: true })
onMounted(async () => {
  if (String(route.query.secao || '') === 'movimentacoes') {
    await navigateTo('/relatorios?secao=estoque', { replace: true })
    return
  }
  await refresh()
})
</script>

<template>
  <div class="stock-page">
    <PageHeader title="Estoque" subtitle="Controle materiais, produtos prontos e o histórico de cada alteração de saldo.">
      <div v-if="section === 'visao'" class="stock-header-actions"><NuxtLink class="btn" to="/produtos/novo"><UiIcon name="box" :size="16" />Novo produto</NuxtLink><NuxtLink class="btn btn--primary" to="/filamentos/novo"><UiIcon name="plus" :size="16" />Novo filamento</NuxtLink></div>
    </PageHeader>

    <nav class="stock-tabs" aria-label="Seções do estoque">
      <NuxtLink to="/estoque?secao=visao" :class="{ active: section === 'visao' }"><UiIcon name="home" :size="15" />Visão geral</NuxtLink>
      <NuxtLink to="/estoque?secao=filamentos" :class="{ active: section === 'filamentos' }"><UiIcon name="spool" :size="15" />Filamentos</NuxtLink>
      <NuxtLink to="/estoque?secao=produtos" :class="{ active: section === 'produtos' }"><UiIcon name="box" :size="15" />Produtos fabricados</NuxtLink>
    </nav>
    <div class="stock-context"><span>Estoque</span><UiIcon name="chevron" :size="12" /><strong>{{ sectionTitle }}</strong></div>
    <div v-if="loading" class="empty-state stock-loading">Carregando estoque...</div>

    <template v-else>
      <section v-if="section === 'visao'" class="stock-overview">
        <div class="metrics-grid metrics-grid--4">
          <MetricCard label="Filamento disponível" :value="`${formatNumber(totalFilamentWeight / 1000)} kg`" icon="spool" note="Saldo físico atual" color="purple" />
          <MetricCard label="Produtos disponíveis" :value="formatNumber(availableProductUnits)" icon="box" note="Prontos e não reservados" color="green" />
          <MetricCard label="Produtos reservados" :value="formatNumber(reservedProductUnits)" icon="target" note="Separados para pedidos" color="blue" />
          <MetricCard label="Reposições pendentes" :value="formatNumber(lowFilaments.length)" icon="alert" note="Abaixo do mínimo" color="orange" />
        </div>
        <div class="dashboard-grid stock-overview__grid">
          <PanelCard title="Operação do estoque" subtitle="Escolha o que você precisa atualizar agora."><div class="stock-quick-grid">
            <NuxtLink to="/estoque?secao=filamentos" class="stock-quick-card"><span class="stock-icon stock-icon--purple"><UiIcon name="spool" /></span><span><strong>Controlar filamentos</strong><small>{{ filaments.length }} rolo(s) · {{ formatNumber(totalFilamentWeight) }} g disponíveis</small></span><UiIcon name="chevron" :size="16" /></NuxtLink>
            <NuxtLink to="/estoque/registrar-producao" class="stock-quick-card"><span class="stock-icon stock-icon--green"><UiIcon name="box" /></span><span><strong>Registrar produção</strong><small>Inclua peças prontas sem criar outro produto</small></span><UiIcon name="chevron" :size="16" /></NuxtLink>
            <NuxtLink to="/relatorios?secao=estoque" class="stock-quick-card"><span class="stock-icon stock-icon--blue"><UiIcon name="history" /></span><span><strong>Consultar movimentações</strong><small>{{ inventory.movements.length }} alteração(ões) auditáveis no histórico</small></span><UiIcon name="chevron" :size="16" /></NuxtLink>
          </div></PanelCard>
          <PanelCard title="Alertas de reposição" subtitle="Filamentos que chegaram ao estoque mínimo."><div v-if="!lowFilaments.length" class="empty-state stock-empty"><div><span class="stock-empty__icon"><UiIcon name="check" /></span><h3>Estoque em dia</h3><p>Nenhum filamento precisa de reposição.</p></div></div><div v-else class="alerts-list"><div v-for="item in lowFilaments.slice(0, 5)" :key="item.id" class="alert-row"><span class="alert-row__icon"><UiIcon name="alert" /></span><div><strong>{{ item.name }}</strong><small>{{ formatNumber(item.remaining) }} g restantes · mínimo {{ formatNumber(item.minStock ?? 300) }} g</small></div><button class="btn" type="button" @click="selectFilament(item); navigateTo('/estoque?secao=filamentos')">Repor</button></div></div></PanelCard>
        </div>
        <PanelCard v-if="pendingProductionMaterial.length" title="Consumos de produção pendentes" subtitle="A impressão terminou, mas a baixa aguardou saldo ou conferência.">
          <div class="alerts-list"><div v-for="item in pendingProductionMaterial" :key="item.printJobId" class="alert-row"><span class="alert-row__icon"><UiIcon name="alert" /></span><div><strong>{{ item.title || `Impressão #${item.printJobId}` }}</strong><small>{{ item.filamentName }} · {{ formatNumber(item.consumptionGrams) }} g · {{ item.lastError || 'Aguardando reconciliação' }}</small></div><button class="btn btn--primary" type="button" :disabled="reconcilingPrintJobId === item.printJobId" @click="reconcilePendingMaterial(item)">{{ reconcilingPrintJobId === item.printJobId ? 'Conciliando...' : 'Conciliar' }}</button></div></div>
        </PanelCard>
      </section>

      <section v-else-if="section === 'filamentos'">
        <div class="stock-section-head"><div><h2>Filamentos</h2><p>Cadastre cada rolo uma vez e use movimentações para manter o peso restante correto.</p></div><NuxtLink class="btn btn--primary" to="/filamentos/novo"><UiIcon name="plus" :size="16" />Cadastrar filamento</NuxtLink></div>
        <div class="filters stock-filters"><div class="field field--search"><label>Buscar filamento</label><div class="search-field"><UiIcon name="search" :size="16" /><input v-model="filamentSearch" placeholder="Nome, material, fabricante ou cor"></div></div><div class="field"><label>Status</label><select v-model="filamentStatus"><option v-for="status in filamentStatuses" :key="status">{{ status }}</option></select></div></div>
        <div class="stock-workspace">
          <PanelCard title="Rolos cadastrados" :subtitle="`${filteredFilaments.length} de ${filaments.length} filamento(s)`"><div v-if="!filteredFilaments.length" class="empty-state stock-empty"><div><span class="stock-empty__icon"><UiIcon name="spool" /></span><h3>Nenhum filamento encontrado</h3><p>Limpe os filtros ou cadastre um novo rolo.</p></div></div><div v-else class="stock-items">
            <button v-for="item in filteredFilaments" :key="item.id" type="button" class="stock-item" :class="{ selected: String(item.id) === String(selectedFilament?.id) }" @click="selectFilament(item)"><span class="filament-color" :style="{ background: item.colorHex || '#d8dee9' }" /><span class="stock-item__body"><strong>{{ item.name }}</strong><small>{{ item.material }} · {{ item.maker || 'Fabricante não informado' }} · {{ item.color || 'Cor não informada' }}</small></span><span class="stock-item__balance" :class="Number(item.remaining) <= Number(item.minStock ?? 300) ? 'money-negative' : 'money-positive'"><strong>{{ formatNumber(item.remaining) }} g</strong><small>mín. {{ formatNumber(item.minStock ?? 300) }} g</small></span><span class="badge" :class="item.status === 'Em estoque' ? 'badge--green' : item.status === 'Baixo estoque' ? 'badge--orange' : 'badge--red'">{{ item.status }}</span></button>
          </div></PanelCard>
          <aside class="stock-operation"><PanelCard title="Movimentar filamento" :subtitle="selectedFilament ? selectedFilament.name : 'Selecione um filamento.'"><div v-if="selectedFilament" class="form-grid">
            <div class="stock-current col-12"><span>Saldo atual</span><strong>{{ formatNumber(selectedFilament.remaining) }} g</strong><NuxtLink class="stock-edit-link" :to="`/filamentos/novo?id=${selectedFilament.id}`"><UiIcon name="edit" :size="14" />Editar cadastro</NuxtLink></div>
            <div class="field col-12"><label>Operação</label><select v-model="filamentMovement.type"><option value="in">Entrada de material</option><option value="out">Saída ou consumo manual</option><option value="adjustment">Ajuste para saldo contado</option></select></div>
            <div class="field col-12"><label>Motivo</label><select v-model="filamentMovement.reason"><option v-for="reason in filamentReasons[filamentMovement.type]" :key="reason">{{ reason }}</option></select></div>
            <div class="field col-12"><label>{{ filamentMovement.type === 'adjustment' ? 'Novo saldo contado' : 'Quantidade' }} (g)</label><input v-model.number="filamentMovement.quantity" type="number" :min="filamentMovement.type === 'adjustment' ? 0 : 0.01" step="0.01"></div>
            <div class="field col-12"><label>Observação <small>(opcional)</small></label><input v-model="filamentMovement.notes" maxlength="180" placeholder="Ex.: nota fiscal, lote ou detalhe da perda"></div>
            <div v-if="filamentMovement.type === 'adjustment'" class="operation-note col-12"><UiIcon name="info" :size="16" /><span>Use ajuste apenas após pesar o rolo. Para compras e consumos, escolha entrada ou saída.</span></div>
            <div class="col-12"><button class="btn btn--primary btn--wide" :disabled="savingFilament" @click="saveFilamentMovement">{{ savingFilament ? 'Registrando...' : 'Registrar movimentação' }}</button></div>
          </div><div v-else class="empty-state"><p>Cadastre ou selecione um filamento para movimentar o saldo.</p></div></PanelCard></aside>
        </div>
      </section>

      <section v-else-if="section === 'produtos'">
        <div class="stock-section-head"><div><h2>Produtos fabricados</h2><p>Controle somente itens prontos para venda. O cadastro do produto e o saldo são etapas diferentes.</p></div><NuxtLink class="btn btn--primary" to="/estoque/registrar-producao"><UiIcon name="plus" :size="16" />Registrar produção</NuxtLink></div>
        <div class="stock-guidance"><span class="stock-guidance__icon"><UiIcon name="info" /></span><div><strong>Como registrar sobras e cancelamentos?</strong><p>Selecione o produto e registre uma <b>entrada</b>: use “Produção excedente” para peças feitas a mais ou “Retorno de venda cancelada” quando o item voltou fisicamente ao estoque. Não crie outro produto para o mesmo item.</p></div></div>
        <div class="stock-workspace">
          <PanelCard title="Produtos e saldos" :subtitle="`${inventory.products.length} produto(s) cadastrado(s)`"><div class="table-scroll"><table class="data-table"><thead><tr><th>Produto</th><th>SKU</th><th>Em estoque</th><th>Reservado</th><th>Disponível</th><th>Status</th></tr></thead><tbody><tr v-for="item in inventory.products" :key="item.id" :class="{ selected: String(item.id) === String(selectedProduct?.id) }" tabindex="0" @click="selectProduct(item)" @keydown.enter="selectProduct(item)"><td><strong>{{ item.name }}</strong></td><td>{{ item.sku || '—' }}</td><td>{{ formatNumber(item.quantity) }} un.</td><td>{{ formatNumber(item.reservedQuantity) }} un.</td><td><strong>{{ formatNumber(Math.max(0, item.quantity - item.reservedQuantity)) }} un.</strong></td><td><span class="badge" :class="item.status === 'Disponivel' ? 'badge--green' : item.status === 'Reservado' ? 'badge--orange' : 'badge--red'">{{ item.status }}</span></td></tr></tbody></table></div><div v-if="!inventory.products.length" class="empty-state stock-empty"><div><span class="stock-empty__icon"><UiIcon name="box" /></span><h3>Nenhum produto cadastrado</h3><p>Crie primeiro o modelo; depois registre as unidades fabricadas.</p><NuxtLink class="btn btn--primary" to="/produtos/novo">Cadastrar novo modelo de produto</NuxtLink></div></div></PanelCard>
          <aside class="stock-operation"><PanelCard title="Atualizar saldo" :subtitle="selectedProduct ? selectedProduct.name : 'Selecione um produto.'"><div v-if="selectedProduct" class="form-grid">
            <div class="stock-current col-12"><span>Saldo físico</span><strong>{{ formatNumber(selectedProduct.quantity) }} un.</strong><small>{{ formatNumber(selectedProduct.reservedQuantity) }} reservada(s)</small></div>
            <div class="field col-12"><label>Operação</label><select v-model="productMovement.type"><option value="in">Entrada no estoque</option><option value="out">Saída do estoque</option><option value="adjustment">Ajuste para saldo contado</option></select></div>
            <div class="field col-12"><label>Motivo</label><select v-model="productMovement.reason"><option v-for="reason in productReasons[productMovement.type]" :key="reason">{{ reason }}</option></select></div>
            <div class="field col-12"><label>{{ productMovement.type === 'adjustment' ? 'Novo saldo contado' : 'Quantidade' }} (un.)</label><input v-model.number="productMovement.quantity" type="number" :min="productMovement.type === 'adjustment' ? 0 : 1" step="1"></div>
            <div class="field col-12"><label>Observação <small>(opcional)</small></label><input v-model="productMovement.notes" maxlength="180" placeholder="Ex.: pedido, lote ou motivo do descarte"></div>
            <div class="operation-note col-12"><UiIcon name="info" :size="16" /><span v-if="productMovement.type === 'in'">A entrada soma unidades ao saldo físico.</span><span v-else-if="productMovement.type === 'out'">A saída não pode reduzir o saldo abaixo das unidades reservadas.</span><span v-else>O valor informado substituirá o saldo atual. Use somente após contagem física.</span></div>
            <div class="col-12"><button class="btn btn--primary btn--wide" :disabled="savingProduct" @click="saveProductMovement">{{ savingProduct ? 'Registrando...' : 'Registrar movimentação' }}</button></div>
          </div><div v-else class="empty-state"><p>Cadastre ou selecione um produto para atualizar o saldo.</p></div></PanelCard></aside>
        </div>
      </section>

    </template>
  </div>
</template>

<style scoped>
.stock-page{padding-bottom:28px}.stock-header-actions{display:flex;gap:8px;flex-wrap:wrap}.stock-tabs{display:flex;gap:5px;overflow-x:auto;margin:0 0 10px;padding:5px;border:1px solid var(--line);border-radius:12px;background:#f5f7fa}.stock-tabs a{display:flex;align-items:center;justify-content:center;gap:7px;min-height:38px;padding:8px 15px;border-radius:8px;color:var(--muted);font-size:12px;font-weight:700;white-space:nowrap}.stock-tabs a:hover{color:var(--text);background:#fff}.stock-tabs a.active{color:var(--blue);background:#fff;box-shadow:0 1px 4px rgba(20,45,85,.11)}.stock-context{display:flex;align-items:center;gap:6px;margin:0 2px 15px;color:var(--muted);font-size:11px}.stock-context strong{color:var(--text)}.stock-loading{min-height:220px}.stock-overview__grid{grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr);margin-top:14px}.stock-quick-grid{display:grid;gap:9px}.stock-quick-card{display:flex;align-items:center;gap:12px;padding:14px;border:1px solid var(--line);border-radius:11px;color:inherit;transition:border-color .15s,background .15s,transform .15s}.stock-quick-card:hover{border-color:#a9c8ff;background:#fbfdff;transform:translateY(-1px)}.stock-quick-card>span:nth-child(2){flex:1}.stock-quick-card strong,.stock-quick-card small{display:block}.stock-quick-card small{margin-top:4px;color:var(--muted);font-size:10px}.stock-icon{display:grid;place-items:center;width:36px;height:36px;flex:0 0 auto;border-radius:10px;background:#edf2f8;color:#52657d}.stock-icon--purple{background:#f0eaff;color:#7c3aed}.stock-icon--green{background:#e6f8ef;color:#0a9b5f}.stock-icon--blue{background:#e8f1ff;color:#1768f2}.stock-empty{min-height:210px}.stock-empty__icon{display:grid;place-items:center;width:46px;height:46px;margin:0 auto 10px;border-radius:14px;background:#eef4ff;color:var(--blue)}.stock-section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:13px}.stock-section-head h2{margin:0;font-size:20px}.stock-section-head p{margin:5px 0 0;color:var(--muted);font-size:12px}.stock-filters{grid-template-columns:minmax(260px,1fr) minmax(180px,.28fr);margin-bottom:12px}.stock-workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(315px,370px);gap:14px;align-items:start}.stock-operation{position:sticky;top:82px}.stock-items{display:grid;gap:7px}.stock-item{display:flex;width:100%;align-items:center;gap:11px;padding:12px;border:1px solid transparent;border-radius:10px;background:#fff;color:inherit;text-align:left;cursor:pointer}.stock-item:hover{background:#f8fafc;border-color:#dbe5f2}.stock-item.selected{background:#f2f7ff;border-color:#a9c8ff;box-shadow:inset 3px 0 0 var(--blue)}.filament-color{width:17px;height:34px;flex:0 0 auto;border:1px solid rgba(15,36,64,.14);border-radius:6px}.stock-item__body{min-width:0;flex:1}.stock-item__body strong,.stock-item__body small,.stock-item__balance strong,.stock-item__balance small{display:block}.stock-item__body small,.stock-item__balance small{margin-top:3px;color:var(--muted);font-size:10px}.stock-item__balance{min-width:88px;text-align:right}.stock-current{display:grid;grid-template-columns:1fr auto;align-items:center;gap:3px 10px;padding:12px;border:1px solid var(--line);border-radius:10px;background:#f8fafc}.stock-current span,.stock-current small{color:var(--muted);font-size:10px}.stock-current strong{font-size:20px}.stock-current small{grid-column:1/-1}.stock-edit-link{display:flex;align-items:center;gap:4px;grid-column:1/-1;margin-top:5px;color:var(--blue);font-size:11px;font-weight:700}.operation-note{display:flex;align-items:flex-start;gap:8px;padding:10px;border:1px solid #d9e6f8;border-radius:9px;background:#f5f9ff;color:#52657d;font-size:10px;line-height:1.45}.operation-note .ui-icon{flex:0 0 auto;color:var(--blue)}.stock-guidance{display:flex;gap:11px;margin-bottom:13px;padding:13px 15px;border:1px solid #cfe0f7;border-radius:11px;background:#f7faff}.stock-guidance__icon{display:grid;place-items:center;width:34px;height:34px;flex:0 0 auto;border-radius:9px;background:#e5efff;color:var(--blue)}.stock-guidance strong{display:block;font-size:12px}.stock-guidance p{margin:4px 0 0;color:#52657d;font-size:11px;line-height:1.55}.data-table tbody tr{cursor:pointer}.data-table tbody tr.selected{background:#f2f7ff}
@media(max-width:980px){.stock-overview__grid,.stock-workspace{grid-template-columns:1fr}.stock-operation{position:static}.stock-filters{grid-template-columns:1fr 1fr}.stock-filters .field--search{grid-column:1/-1}}
@media(max-width:650px){.stock-header-actions{width:100%}.stock-header-actions .btn{flex:1}.stock-section-head{align-items:stretch;flex-direction:column}.stock-filters{grid-template-columns:1fr}.stock-filters .field--search{grid-column:auto}.stock-item{align-items:flex-start;flex-wrap:wrap}.stock-item__body{min-width:calc(100% - 40px)}.stock-item__balance{text-align:left}.stock-tabs a{flex:1}.stock-guidance{align-items:flex-start}}
</style>
