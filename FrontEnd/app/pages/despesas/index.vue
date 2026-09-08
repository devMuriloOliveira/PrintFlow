<script setup lang="ts">
const { expenses, expenseSegments, deleteItem, generateRecurringExpenses } = useAppData()
const metrics = useBusinessMetrics()
const { notify } = useUi()
const router = useRouter()
const search = ref('')
const category = ref('Todas')
const payment = ref('Todas')
const status = ref('Todos')
const dateFrom = ref('')
const dateTo = ref('')
const currentPage = ref(1)
const perPage = ref(10)
const generating = ref(false)

const isRecurring = (expense: any) => !/^(n[aã]o|nao)\b/i.test(String(expense.recurrence || '').trim())
const normalizedDate = (value: string) => {
  const match = String(value || '').match(/(\d{4})-(\d{2})-(\d{2})|(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) return ''
  return match[1] ? `${match[1]}-${match[2]}-${match[3]}` : `${match[6]}-${match[5]}-${match[4]}`
}
const categories = computed(() => [...new Set(expenses.value.map(expense => expense.category).filter(Boolean))].sort())
const payments = computed(() => [...new Set(expenses.value.map(expense => expense.payment).filter(Boolean))].sort())
const statuses = computed(() => [...new Set(expenses.value.map(expense => expense.status).filter(Boolean))].sort())
const filtered = computed(() => expenses.value
  .filter((expense) => {
    const text = Object.values(expense).join(' ').toLowerCase()
    const date = normalizedDate(expense.date)
    return (category.value === 'Todas' || expense.category === category.value)
      && (payment.value === 'Todas' || expense.payment === payment.value)
      && (status.value === 'Todos' || expense.status === status.value)
      && (!dateFrom.value || date >= dateFrom.value)
      && (!dateTo.value || date <= dateTo.value)
      && text.includes(search.value.trim().toLowerCase())
  })
  .sort((a, b) => normalizedDate(b.date).localeCompare(normalizedDate(a.date))))
const totalFiltered = computed(() => filtered.value.reduce((total, expense) => total + Number(expense.value || 0), 0))
const paidTotal = computed(() => filtered.value.filter(expense => expense.status === 'Pago').reduce((total, expense) => total + Number(expense.value || 0), 0))
const pendingTotal = computed(() => filtered.value.filter(expense => ['Pendente', 'Agendado'].includes(expense.status)).reduce((total, expense) => total + Number(expense.value || 0), 0))
const cancelledTotal = computed(() => filtered.value.filter(expense => expense.status === 'Cancelado').reduce((total, expense) => total + Number(expense.value || 0), 0))
const recurring = computed(() => filtered.value.filter(isRecurring).slice(0, 3))
const recurringTotal = computed(() => recurring.value.reduce((total, item) => total + Number(item.value || 0), 0))
const expensePoints = computed(() => filtered.value.map(expense => Number(expense.value || 0)))
const recurringPoints = computed(() => filtered.value.filter(isRecurring).map(expense => Number(expense.value || 0)))
const averageExpense = computed(() => filtered.value.length ? totalFiltered.value / filtered.value.length : 0)
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / perPage.value)))
const paginated = computed(() => filtered.value.slice((currentPage.value - 1) * perPage.value, currentPage.value * perPage.value))
const paginationSummary = computed(() => {
  if (!filtered.value.length) return 'Nenhuma despesa encontrada'
  const start = (currentPage.value - 1) * perPage.value + 1
  const end = Math.min(currentPage.value * perPage.value, filtered.value.length)
  return `Mostrando ${start}–${end} de ${filtered.value.length} despesas`
})
const filteredSegments = computed(() => {
  const totals = new Map<string, number>()
  for (const expense of filtered.value) totals.set(expense.category, (totals.get(expense.category) || 0) + Number(expense.value || 0))
  const colors = new Map(expenseSegments.value.map(segment => [segment.label, segment.color]))
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], index) => ({ label, value, color: colors.get(label) || ['#ef4444', '#f59e0b', '#7c3aed', '#1768f2', '#0da566'][index % 5] }))
})
const clearFilters = () => {
  search.value = ''
  category.value = 'Todas'
  payment.value = 'Todas'
  status.value = 'Todos'
  dateFrom.value = ''
  dateTo.value = ''
  currentPage.value = 1
}
watch([search, category, payment, status, dateFrom, dateTo, perPage], () => { currentPage.value = 1 })
watch(pageCount, () => { if (currentPage.value > pageCount.value) currentPage.value = pageCount.value })

const editExpense = (expense: any) => {
  if (expense.id) router.push(`/despesas/nova?id=${expense.id}`)
}
const duplicateExpense = (expense: any) => {
  if (expense.id) router.push(`/despesas/nova?duplicar=${expense.id}`)
}
const removeExpense = async (expense: any) => {
  if (!expense.id || !window.confirm(`Excluir despesa?\n\n${expense.description}\n\nEsta ação não poderá ser desfeita.`)) return
  try {
    await deleteItem('expenses', expense.id)
    notify('Despesa excluída com sucesso.')
  } catch (error: any) { notify(error?.data?.error || error?.message || 'Não foi possível excluir a despesa.') }
}
const generateDue = async () => {
  if (generating.value) return
  generating.value = true
  try {
    const count = await generateRecurringExpenses()
    notify(count ? `${count} recorrência(s) gerada(s).` : 'Nenhuma recorrência vencida.')
  } catch (error: any) { notify(error?.data?.error || error?.message || 'Não foi possível gerar recorrências.')
  } finally { generating.value = false }
}
</script>

<template>
  <div>
    <PageHeader title="Despesas" subtitle="Acompanhe e gerencie os gastos lançados pela sua empresa."><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" :disabled="generating" @click="generateDue"><UiIcon name="calendar" :size="15" />{{ generating ? 'Gerando...' : 'Gerar recorrências vencidas' }}</button><NuxtLink class="btn btn--primary" to="/despesas/nova"><UiIcon name="plus" :size="16" /> Nova despesa</NuxtLink></div></PageHeader>
    <div class="metrics-grid metrics-grid--4">
      <MetricCard label="Despesas no filtro" :value="formatCurrency(totalFiltered)" icon="receipt" note="Lançamentos manuais" color="red" negative :points="expensePoints" />
      <MetricCard label="Recorrentes" :value="formatCurrency(filtered.filter(isRecurring).reduce((total, item) => total + Number(item.value || 0), 0))" icon="calendar" :change="`${metrics.percent(totalFiltered ? filtered.filter(isRecurring).reduce((total, item) => total + Number(item.value || 0), 0) / totalFiltered * 100 : 0)} do filtro`" color="orange" :points="recurringPoints" />
      <MetricCard label="Maior categoria" :value="filteredSegments[0]?.label || '-'" icon="tag" :change="formatCurrency(filteredSegments[0]?.value || 0)" note="No filtro atual" color="purple" :points="expensePoints" />
      <MetricCard label="Média por lançamento" :value="formatCurrency(averageExpense)" icon="chart" note="Total / lançamentos" color="cyan" :points="expensePoints" />
    </div>
    <PanelCard title="Resumo por status" style="margin-bottom:12px">
      <div class="expense-status-summary">
        <div class="detail-list__row"><span>Pagas</span><strong class="money-negative">{{ formatCurrency(paidTotal) }}</strong></div>
        <div class="detail-list__row"><span>Pendentes/agendadas</span><strong>{{ formatCurrency(pendingTotal) }}</strong></div>
        <div class="detail-list__row"><span>Canceladas (fora do custo)</span><strong>{{ formatCurrency(cancelledTotal) }}</strong></div>
      </div>
    </PanelCard>
    <div class="filters" style="flex-wrap:wrap">
      <div class="field field--search"><label>Buscar</label><div class="search-field"><UiIcon name="search" :size="16" /><input v-model="search" placeholder="Descrição, fornecedor ou categoria"></div></div>
      <div class="field"><label>Categoria</label><select v-model="category"><option>Todas</option><option v-for="item in categories" :key="item">{{ item }}</option></select></div>
      <div class="field"><label>Pagamento</label><select v-model="payment"><option>Todas</option><option v-for="item in payments" :key="item">{{ item }}</option></select></div>
      <div class="field"><label>Status</label><select v-model="status"><option>Todos</option><option v-for="item in statuses" :key="item">{{ item }}</option></select></div>
      <div class="field"><label>De</label><input v-model="dateFrom" type="date"></div>
      <div class="field"><label>Até</label><input v-model="dateTo" type="date"></div>
      <button class="btn" type="button" @click="clearFilters"><UiIcon name="close" :size="15" /> Limpar</button>
    </div>
    <div class="split-layout" style="grid-template-columns:minmax(0,1fr) 350px">
      <PanelCard title="Lista de despesas">
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Descrição</th><th>Categoria</th><th>Fornecedor</th><th>Valor</th><th>Data</th><th>Pagamento</th><th>Recorrência</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr v-if="!paginated.length"><td colspan="9"><div class="empty-state"><div><div class="empty-state__icon"><UiIcon name="receipt" /></div><h3>Nenhuma despesa encontrada</h3><p>Ajuste os filtros ou cadastre uma nova despesa.</p></div></div></td></tr>
              <tr v-for="expense in paginated" :key="expense.id || expense.description">
                <td><div class="table-product table-product--editable"><strong>{{ expense.description }}</strong><button class="row-action row-action--edit" title="Editar despesa" @click.stop="editExpense(expense)"><UiIcon name="edit" :size="15" /></button><button class="row-action" title="Duplicar despesa" @click.stop="duplicateExpense(expense)"><UiIcon name="plus" :size="15" /></button></div></td>
                <td><span class="badge">{{ expense.category }}</span></td>
                <td>{{ expense.supplier || '-' }}</td>
                <td><strong>{{ formatCurrency(expense.value) }}</strong></td>
                <td>{{ expense.date }}</td>
                <td>{{ expense.payment || '-' }}</td>
                <td><span>{{ isRecurring(expense) ? expense.recurrence : 'Não recorrente' }}</span><small v-if="isRecurring(expense) && expense.nextDueDate" style="display:block;color:var(--muted)">Próx.: {{ expense.nextDueDate }}</small></td>
                <td><span class="badge" :class="expense.status === 'Pago' ? 'badge--green' : 'badge--orange'">{{ expense.status || 'Sem status' }}</span></td>
                <td><button class="row-action" title="Excluir despesa" @click.stop="removeExpense(expense)"><UiIcon name="close" :size="16" /></button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="table-footer"><span>{{ paginationSummary }}</span><div class="pagination"><button v-for="page in pageCount" :key="page" class="page-btn" :class="{ active: page === currentPage }" @click="currentPage = page">{{ page }}</button></div><select v-model.number="perPage" class="select-compact"><option :value="10">10 por página</option><option :value="20">20 por página</option><option :value="50">50 por página</option></select></div>
      </PanelCard>
      <aside>
        <PanelCard title="Despesas por categoria"><DonutChart :segments="filteredSegments" :total="formatCurrency(totalFiltered)" /></PanelCard>
        <PanelCard title="Despesas recorrentes" style="margin-top:12px">
          <div class="alerts-list">
            <div v-if="!recurring.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="calendar" /></div><h3>Nenhuma recorrência</h3><p>Despesas recorrentes dentro dos filtros aparecem aqui.</p></div></div>
            <div v-for="(item, index) in recurring" :key="item.id || item.description" class="alert-row"><span class="alert-row__icon"><UiIcon :name="index === 0 ? 'bolt' : 'receipt'" :size="17" /></span><div><strong>{{ item.description }}</strong><small>{{ item.supplier || 'Sem fornecedor' }} · {{ item.recurrence }}</small></div><strong>{{ formatCurrency(item.value) }}</strong></div>
          </div>
          <div class="summary-box"><div class="detail-list__row"><span>Total exibido</span><strong class="money-negative">{{ formatCurrency(recurringTotal) }}</strong></div></div>
        </PanelCard>
      </aside>
    </div>
  </div>
</template>
