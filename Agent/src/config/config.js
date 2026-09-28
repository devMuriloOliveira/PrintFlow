import dotenv from 'dotenv';

import {
  AGENT_VERSION
} from './agentVersion.js'

dotenv.config();

export const RUNTIME_ENVIRONMENTS = Object.freeze([
  'DEVELOPMENT',
  'PRODUCTION'
])

const DEVELOPMENT_API_URL =
  'http://localhost:3333'

const PRODUCTION_API_URL =
  'https://printflow-api-4y5l.onrender.com'

const PRODUCTION_APP_ORIGINS = [
  'https://print-flow-d5si.vercel.app'
]

const isLocalHost = hostname =>
  [
    'localhost',
    '127.0.0.1',
    '::1',
    '[::1]'
  ].includes(
    String(hostname || '').toLowerCase()
  )

const assertProductionEndpoint = (
  name,
  value,
  protocols
) => {
  let parsed

  try {
    parsed = new URL(value)
  } catch {
    throw new Error(
      `${name} invalido para PRODUCTION.`
    )
  }

  if (
    !protocols.includes(parsed.protocol) ||
    isLocalHost(parsed.hostname)
  ) {
    throw new Error(
      `${name} inseguro para PRODUCTION.`
    )
  }
}

export const resolveRuntimeConfig = (
  environment = process.env
) => {
  const runtimeEnvironment = String(
    environment.PRINTFLOW_ENVIRONMENT ||
      'DEVELOPMENT'
  ).trim().toUpperCase()

  if (
    !RUNTIME_ENVIRONMENTS.includes(
      runtimeEnvironment
    )
  ) {
    throw new Error(
      'PRINTFLOW_ENVIRONMENT deve ser DEVELOPMENT ou PRODUCTION.'
    )
  }

  const apiUrl =
    environment.PRINTFLOW_API_URL ||
    (runtimeEnvironment === 'PRODUCTION'
      ? PRODUCTION_API_URL
      : DEVELOPMENT_API_URL)

  const wsUrl =
    environment.PRINTFLOW_WS_URL ||
    (runtimeEnvironment === 'PRODUCTION'
      ? apiUrl.replace(/^https:/i, 'wss:')
      : 'ws://localhost:3333')

  const configuredAppOrigins = String(
    environment.PRINTFLOW_APP_ORIGINS || ''
  )
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

  const appOrigins = configuredAppOrigins.length
    ? configuredAppOrigins
    : runtimeEnvironment === 'PRODUCTION'
      ? PRODUCTION_APP_ORIGINS
      : [
          'http://localhost:3000',
          'http://127.0.0.1:3000'
        ]

  if (
    runtimeEnvironment === 'PRODUCTION'
  ) {
    assertProductionEndpoint(
      'PRINTFLOW_API_URL',
      apiUrl,
      ['https:']
    )
    assertProductionEndpoint(
      'PRINTFLOW_WS_URL',
      wsUrl,
      ['wss:']
    )
    for (const origin of appOrigins) {
      assertProductionEndpoint(
        'PRINTFLOW_APP_ORIGINS',
        origin,
        ['https:']
      )
    }

    if (
      String(
        environment.PRINTFLOW_DEV_MOCK_BAMBU ||
          ''
      ).toLowerCase() === 'true'
    ) {
      throw new Error(
        'PRINTFLOW_DEV_MOCK_BAMBU nao pode ser usado em PRODUCTION.'
      )
    }
  }

  return Object.freeze({
    environment: runtimeEnvironment,
    apiUrl,
    wsUrl,
    appOrigins: Object.freeze([...appOrigins])
  })
}

const runtimeConfig =
  resolveRuntimeConfig()

export const config = {
  ...runtimeConfig,

  agentVersion: AGENT_VERSION
};
