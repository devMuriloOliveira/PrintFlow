import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getBambuTlsOptions
} from '../src/printers/adapters/bambuAdapter.js'

test('Bambu exige validacao TLS por padrao', () => {
  assert.deepEqual(
    getBambuTlsOptions({}),
    { rejectUnauthorized: true }
  )
})

test('TLS inseguro so e aceito explicitamente fora de producao', () => {
  assert.deepEqual(
    getBambuTlsOptions({
      NODE_ENV: 'development',
      PRINTFLOW_BAMBU_ALLOW_INSECURE_TLS: 'true'
    }),
    { rejectUnauthorized: false }
  )

  assert.deepEqual(
    getBambuTlsOptions({
      NODE_ENV: 'production',
      PRINTFLOW_BAMBU_ALLOW_INSECURE_TLS: 'true'
    }),
    { rejectUnauthorized: true }
  )
})
