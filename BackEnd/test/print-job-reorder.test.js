import assert from 'node:assert/strict'
import test from 'node:test'
import { reorderQueueIds } from '../src/routes/printJobs.js'

test('reordena fila por direcao e por destino de arrastar', () => {
  assert.deepEqual(reorderQueueIds(['1', '2', '3'], '2', { direction: 'up' }), ['2', '1', '3'])
  assert.deepEqual(reorderQueueIds(['1', '2', '3', '4'], '4', { targetId: '2' }), ['1', '4', '2', '3'])
  assert.deepEqual(reorderQueueIds(['1', '2', '3', '4'], '1', { targetId: '4' }), ['2', '3', '1', '4'])
  assert.deepEqual(reorderQueueIds(['1', '2'], '1', { targetId: 'missing' }), ['1', '2'])
})
