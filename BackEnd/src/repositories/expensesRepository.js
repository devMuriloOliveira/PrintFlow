import { withTenant } from '../db/pool.js'

const frequency = (value) => String(value || '').split(' - ')[0].trim().toLowerCase()
const isRecurring = (value) => !frequency(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').startsWith('nao')
const nextDate = (value, recurrence) => {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  const unit = frequency(recurrence)
  if (unit.startsWith('seman')) date.setUTCDate(date.getUTCDate() + 7)
  else if (unit.startsWith('quinzen')) date.setUTCDate(date.getUTCDate() + 15)
  else if (unit.startsWith('trimes')) date.setUTCMonth(date.getUTCMonth() + 3)
  else if (unit.startsWith('semes')) date.setUTCMonth(date.getUTCMonth() + 6)
  else if (unit.startsWith('anual')) date.setUTCFullYear(date.getUTCFullYear() + 1)
  else date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 10)
}

export const generateDueRecurringExpenses = async (tenantId, today = new Date().toISOString().slice(0, 10)) => withTenant(tenantId, async (client) => {
  const result = await client.query(`
    select id, description, category, supplier, amount, payment, recurrence, status, next_due_date, notes
      from expenses
     where tenant_id = $1
       and next_due_date is not null
       and next_due_date <= $2::date
     order by next_due_date, id
  `, [tenantId, today])
  const generated = []
  for (const expense of result.rows) {
    if (!isRecurring(expense.recurrence)) continue
    const dueDate = String(expense.next_due_date).slice(0, 10)
    const following = nextDate(dueDate, expense.recurrence)
    await client.query(`
      insert into expenses (tenant_id, description, category, supplier, amount, expense_date, payment, recurrence, status, next_due_date, notes, recurrence_parent_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'Pendente', $9, $10, $11)
      on conflict (tenant_id, recurrence_parent_id, expense_date) where recurrence_parent_id is not null do nothing
    `, [tenantId, expense.description, expense.category, expense.supplier, expense.amount, dueDate, expense.payment, expense.recurrence, following, expense.notes, expense.id])
    await client.query('update expenses set next_due_date = $3 where tenant_id = $1 and id = $2', [tenantId, expense.id, following])
    generated.push(String(expense.id))
  }
  return generated
})
