import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLOUD_REQUEST_TIMEOUT_MS,
  CLOUD_TRANSFER_TIMEOUT_MS,
  withCloudTimeout
} from '../src/cloud/httpClient.js'

test('cliente Cloud possui timeout finito para nao travar o Agent', () => {
  assert.ok(CLOUD_REQUEST_TIMEOUT_MS >= 5_000)
  assert.ok(CLOUD_REQUEST_TIMEOUT_MS <= 120_000)
  assert.equal(withCloudTimeout().timeout, CLOUD_REQUEST_TIMEOUT_MS)
  assert.equal(withCloudTimeout({ timeout: 321 }).timeout, 321)
  assert.equal(withCloudTimeout().maxContentLength, 20 * 1024 * 1024)
  assert.ok(CLOUD_TRANSFER_TIMEOUT_MS >= CLOUD_REQUEST_TIMEOUT_MS)
})
