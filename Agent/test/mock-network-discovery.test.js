import assert from 'node:assert/strict'
import test from 'node:test'

process.env.PRINTFLOW_DEV_MOCK_BAMBU =
  'true'

const {
  scanNetwork
} = await import(
  '../src/discovery/networkScanner.js'
)

test('modo mock Bambu retorna descoberta sem scan de rede real', async () => {
  const startedAt =
    Date.now()

  const printers =
    await scanNetwork()

  const elapsedMs =
    Date.now() -
    startedAt

  assert.equal(
    printers.length,
    1
  )

  assert.equal(
    printers[0].protocol,
    'bambu'
  )

  assert.equal(
    printers[0].mock,
    true
  )

  assert.ok(
    elapsedMs < 1000,
    `descoberta mock demorou ${elapsedMs}ms`
  )
})
