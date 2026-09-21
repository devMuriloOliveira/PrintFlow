import { env } from '../config/env.js'
import { hasDatabase, query } from '../db/pool.js'
import { generateDueRecurringExpenses } from '../repositories/expensesRepository.js'

export const runExpenseRecurringGenerator = async () => {
  if (!hasDatabase) return { generated: 0 }
  const tenants = await query('select id from tenants')
  let generated = 0
  for (const tenant of tenants.rows) generated += (await generateDueRecurringExpenses(tenant.id)).length
  return { generated }
}

export const startExpenseRecurringGenerator = () => {
  if (!hasDatabase || env.expenseRecurringIntervalMs <= 0) return null
  const run = () => runExpenseRecurringGenerator()
    .then(({ generated }) => { if (generated) console.log(`[Expenses] ${generated} recorrencia(s) gerada(s).`) })
    .catch((error) => console.error('[Expenses] Falha ao gerar recorrencias:', error))
  void run()
  const timer = setInterval(run, env.expenseRecurringIntervalMs)
  timer.unref?.()
  return timer
}
