import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('mantem package, configuracao e host Windows na mesma versao', async () => {
  const packageJson = JSON.parse(await readFile(
    new URL('../package.json', import.meta.url),
    'utf8'
  ))

  assert.equal(packageJson.version, AGENT_VERSION)
})

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
  assert.deepEqual(production.appOrigins, [
    'https://print-flow-d5si.vercel.app',
    'https://filamind.com.br',
    'https://www.filamind.com.br'
  ])

  const customOrigin = resolveRuntimeConfig({
    PRINTFLOW_ENVIRONMENT: 'PRODUCTION',
    PRINTFLOW_API_URL: 'https://api.example.test',
    PRINTFLOW_WS_URL: 'wss://api.example.test',
    PRINTFLOW_APP_ORIGINS: 'https://app.example.test'
  })
  assert.deepEqual(customOrigin.appOrigins, ['https://app.example.test'])

  const filaEnvironment = resolveRuntimeConfig({
    FILA_AGENT_ENVIRONMENT: 'PRODUCTION',
    PRINTFLOW_ENVIRONMENT: 'DEVELOPMENT',
    FILA_AGENT_API_URL: 'https://fila-api.example.test',
    PRINTFLOW_API_URL: 'https://legacy-api.example.test',
    FILA_AGENT_WS_URL: 'wss://fila-api.example.test',
    PRINTFLOW_WS_URL: 'wss://legacy-api.example.test',
    FILA_AGENT_APP_ORIGINS: 'https://fila.example.test',
    PRINTFLOW_APP_ORIGINS: 'https://legacy.example.test'
  })
  assert.equal(filaEnvironment.environment, 'PRODUCTION')
  assert.equal(filaEnvironment.apiUrl, 'https://fila-api.example.test')
  assert.equal(filaEnvironment.wsUrl, 'wss://fila-api.example.test')
  assert.deepEqual(filaEnvironment.appOrigins, ['https://fila.example.test'])

  const legacyEnvironment = resolveRuntimeConfig({
    PRINTFLOW_ENVIRONMENT: 'PRODUCTION',
    PRINTFLOW_API_URL: 'https://legacy-api.example.test',
    PRINTFLOW_WS_URL: 'wss://legacy-api.example.test',
    PRINTFLOW_APP_ORIGINS: 'https://legacy.example.test'
  })
  assert.equal(legacyEnvironment.apiUrl, 'https://legacy-api.example.test')
  assert.equal(legacyEnvironment.wsUrl, 'wss://legacy-api.example.test')
  assert.deepEqual(legacyEnvironment.appOrigins, ['https://legacy.example.test'])

  assert.throws(() => resolveRuntimeConfig({
    PRINTFLOW_ENVIRONMENT: 'PRODUCTION',
    PRINTFLOW_API_URL: 'http://localhost:3333'
  }), /inseguro/)

  assert.throws(() => resolveRuntimeConfig({
    PRINTFLOW_ENVIRONMENT: 'PRODUCTION',
    PRINTFLOW_API_URL: 'https://api.example.test',
    PRINTFLOW_DEV_MOCK_BAMBU: 'true'
  }), /mock/i)

  assert.throws(() => resolveRuntimeConfig({
    FILA_AGENT_ENVIRONMENT: 'PRODUCTION',
    FILA_AGENT_API_URL: 'https://api.example.test',
    FILA_AGENT_DEV_MOCK_BAMBU: 'true',
    PRINTFLOW_DEV_MOCK_BAMBU: 'false'
  }), /mock/i)

  assert.throws(() => resolveRuntimeConfig({
    PRINTFLOW_ENVIRONMENT: 'PRODUCTION',
    PRINTFLOW_API_URL: 'https://api.example.test',
    PRINTFLOW_APP_ORIGINS: 'http://app.example.test'
  }), /inseguro/)
})
