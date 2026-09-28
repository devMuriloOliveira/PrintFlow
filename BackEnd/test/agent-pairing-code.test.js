import assert from 'node:assert/strict'
import test from 'node:test'

import { claimAgentPairingCode } from '../src/services/agentPairingCode.js'

test('codigo de pareamento e reivindicado uma unica vez de forma atomica', async () => {
  let available = true
  const calls = []
  const executeQuery = async (sql, params) => {
    calls.push({ sql, params })
    if (!available) return { rows: [] }
    available = false
    return { rows: [{ id: params[0] }] }
  }

  assert.equal(await claimAgentPairingCode(executeQuery, 42), true)
  assert.equal(await claimAgentPairingCode(executeQuery, 42), false)
  assert.match(calls[0].sql, /used_at is null/)
  assert.match(calls[0].sql, /expires_at > now\(\)/)
  assert.match(calls[0].sql, /returning id/)
  assert.deepEqual(calls[0].params, [42])
})
