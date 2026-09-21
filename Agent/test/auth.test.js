import test from 'node:test'
import assert from 'node:assert/strict'

import { isInvalidAgentCredentialError } from '../src/cloud/auth.js'

test('identifica credencial revogada do Agent para permitir novo pareamento', () => {
  assert.equal(
    isInvalidAgentCredentialError({
      response: {
        status: 401,
        data: { error: 'Agent invalido' }
      }
    }),
    true
  )

  assert.equal(
    isInvalidAgentCredentialError({
      response: {
        status: 404,
        data: { error: 'not found' }
      }
    }),
    true
  )

  assert.equal(
    isInvalidAgentCredentialError({
      response: {
        status: 500,
        data: { error: 'database unavailable' }
      }
    }),
    false
  )
})
