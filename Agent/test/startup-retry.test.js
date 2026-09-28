import assert from 'node:assert/strict'
import test from 'node:test'

import { retryUntilStarted } from '../src/cloud/startupRetry.js'

test('inicializacao volta a tentar com backoff ate o backend responder', async () => {
  let attempts = 0
  const waits = []
  const retries = []
  const result = await retryUntilStarted({
    start: async () => {
      attempts += 1
      return attempts >= 4
    },
    wait: async delay => { waits.push(delay) },
    initialDelay: 100,
    maximumDelay: 250,
    onRetry: delay => retries.push(delay)
  })

  assert.equal(result, true)
  assert.equal(attempts, 4)
  assert.deepEqual(waits, [100, 200, 250])
  assert.deepEqual(retries, waits)
})
