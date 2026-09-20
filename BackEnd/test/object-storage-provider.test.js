import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createObjectStorageProvider,
  OBJECT_STORAGE_METHODS
} from '../src/services/objectStorageProvider.js'

test('ObjectStorageProvider exige somente o contrato mínimo', () => {
  const provider = Object.fromEntries(
    OBJECT_STORAGE_METHODS.map(method => [
      method,
      async () => {}
    ])
  )

  assert.equal(
    createObjectStorageProvider(provider),
    provider
  )
  assert.throws(
    () =>
      createObjectStorageProvider({}),
    /sem o metodo put/
  )
})
