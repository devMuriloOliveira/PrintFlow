import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AGENT_VERSION,
  getAgentRuntimeInfo
} from '../src/agentInfo.js'

import {
  config,
  resolveRuntimeConfig
} from '../src/config/config.js'

test(
  'usa uma unica versao em configuracao e heartbeat',
  () => {
    assert.equal(
      config.agentVersion,
      AGENT_VERSION
    )
    assert.equal(
      getAgentRuntimeInfo().version,
      AGENT_VERSION
    )
  }
)

test('separa DEVELOPMENT e rejeita endpoints inseguros em PRODUCTION', () => {
  const development = resolveRuntimeConfig({})
  assert.equal(development.environment, 'DEVELOPMENT')
  assert.equal(development.apiUrl, 'http://localhost:3333')

  const production = resolveRuntimeConfig({
    PRINTFLOW_ENVIRONMENT: 'PRODUCTION',
    PRINTFLOW_API_URL: 'https://api.example.test',
    PRINTFLOW_WS_URL: 'wss://api.example.test'
  })
  assert.equal(production.environment, 'PRODUCTION')

  assert.throws(() => resolveRuntimeConfig({
    PRINTFLOW_ENVIRONMENT: 'PRODUCTION',
    PRINTFLOW_API_URL: 'http://localhost:3333'
  }), /inseguro/)

  assert.throws(() => resolveRuntimeConfig({
    PRINTFLOW_ENVIRONMENT: 'PRODUCTION',
    PRINTFLOW_API_URL: 'https://api.example.test',
    PRINTFLOW_DEV_MOCK_BAMBU: 'true'
  }), /mock/i)
})
