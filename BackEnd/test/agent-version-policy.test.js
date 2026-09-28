import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareAgentVersions,
  isAgentVersionSupported,
  MINIMUM_SUPPORTED_AGENT_VERSION
} from '../src/services/agentVersionPolicy.js'

test('versao minima do Agent e aplicada a partir de 0.1.10', () => {
  assert.equal(MINIMUM_SUPPORTED_AGENT_VERSION, '0.1.10')
  assert.equal(isAgentVersionSupported('0.1.9'), false)
  assert.equal(isAgentVersionSupported('0.1.10'), true)
  assert.equal(isAgentVersionSupported('0.1.19'), true)
  assert.equal(isAgentVersionSupported('1.0.0'), true)
  assert.equal(isAgentVersionSupported(''), false)
  assert.equal(isAgentVersionSupported('versao-invalida'), false)
})

test('comparacao de versao nao usa ordem lexicografica', () => {
  assert.equal(compareAgentVersions('0.1.9', '0.1.10'), -1)
  assert.equal(compareAgentVersions('0.10.0', '0.2.0'), 1)
  assert.equal(compareAgentVersions('0.1.10', '0.1.10'), 0)
})
