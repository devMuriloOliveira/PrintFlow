import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getBambuTlsOptions
} from '../src/printers/adapters/bambuAdapter.js'

test('Bambu aceita certificado autoassinado do MQTT LAN', () => {
  assert.deepEqual(
    getBambuTlsOptions({}),
    { rejectUnauthorized: false }
  )
})

test('a configuracao TLS Bambu e igual em producao', () => {
  assert.deepEqual(
    getBambuTlsOptions({
      NODE_ENV: 'production'
    }),
    { rejectUnauthorized: false }
  )
})
