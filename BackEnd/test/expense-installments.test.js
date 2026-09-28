import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExpenseInstallments } from '../src/repositories/expensesRepository.js'

const expense = {
  description: 'Compra de material',
  category: 'Filamento',
  supplier: 'Fornecedor',
  value: 100,
  date: '2026-01-31',
  payment: 'Cartao de credito',
  recurrence: 'Parcelado',
  nextDueDate: '',
  status: 'Pago',
  notes: ''
}

test('parcelas de cartão são finitas, mensais e preservam exatamente o total', () => {
  const installments = buildExpenseInstallments(expense, 3)

  assert.equal(installments.length, 3)
  assert.deepEqual(installments.map((item) => item.date), ['2026-01-31', '2026-02-28', '2026-03-31'])
  assert.deepEqual(installments.map((item) => item.value), [33.34, 33.33, 33.33])
  assert.equal(installments.reduce((sum, item) => sum + item.value, 0), 100)
  assert.deepEqual(installments.map((item) => item.description), [
    'Compra de material (1/3)', 'Compra de material (2/3)', 'Compra de material (3/3)'
  ])
  assert.ok(installments.every((item) => item.recurrence === 'Nao recorrente' && item.nextDueDate === ''))
  assert.deepEqual(installments.map((item) => item.status), ['Pago', 'Pendente', 'Pendente'])
})

test('parcelamento rejeita forma de pagamento ou quantidade inválida', () => {
  assert.throws(() => buildExpenseInstallments({ ...expense, payment: 'PIX' }, 3), /apenas para cartão de crédito/i)
  assert.throws(() => buildExpenseInstallments(expense, 1), /entre 2 e 48 parcelas/i)
})
