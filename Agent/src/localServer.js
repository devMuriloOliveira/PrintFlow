import http from 'node:http'
import os from 'node:os'
import { timingSafeEqual } from 'node:crypto'
import { URL } from 'node:url'

import { AGENT_VERSION } from './agentInfo.js'
import {
  loadCredentials,
  savePendingPairingCode
} from './storage/credentials.js'

const DEFAULT_LOCAL_PORT = 17873

const json = (response, statusCode, payload, origin = '') => {
  if (
    response.destroyed ||
    response.writableEnded
  ) {
    return
  }

  const headers = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '600',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }

  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers.Vary = 'Origin'
  }

  response.writeHead(statusCode, headers)

  response.end(JSON.stringify(payload))
}

const readJsonBody = request =>
  new Promise((resolve, reject) => {
    let raw = ''

    request.on('data', chunk => {
      raw += chunk

      if (raw.length > 2048) {
        reject(new Error('Payload muito grande.'))
        request.destroy()
      }
    })

    request.on('end', () => {
      if (!raw) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('JSON invalido.'))
      }
    })

    request.on('error', reject)
  })

const getLocalStatus = async (
  getRuntimeStatus
) => {
  const credentials = await loadCredentials()
  const runtimeStatus =
    typeof getRuntimeStatus === 'function'
      ? await getRuntimeStatus()
      : {}

  return {
    ok: true,
    app: 'printflow-agent',
    version: AGENT_VERSION,
    paired: Boolean(credentials?.agentId),
    updateBlocked:
      Boolean(runtimeStatus?.updateBlocked),
    updateBlockedReason:
      runtimeStatus?.updateBlockedReason || null,
    cloudConnected: Boolean(runtimeStatus?.cloudConnected),
    activePrintJobs:
      Math.max(
        0,
        Number(runtimeStatus?.activePrintJobs) || 0
      )
  }
}

const redactAddress = value => {
  const address = String(value || '')
  if (address.includes('.')) {
    const parts = address.split('.')
    if (parts.length === 4) {
      parts[3] = 'x'
      return parts.join('.')
    }
  }
  if (address.includes(':')) return '[ipv6-redacted]'
  return address
}

const sanitizeDiagnostics = value => {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeDiagnostics(item))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const sanitized = {}
  for (const [key, item] of Object.entries(value)) {
    if (/(?:secret|token|password|access.?code|authorization|credential|api.?key)/i.test(key)) {
      continue
    }
    if (/^(?:ip|address|host|hostname)$/i.test(key) && typeof item === 'string') {
      sanitized[key] = redactAddress(item)
      continue
    }
    if (/serial/i.test(key) && typeof item === 'string') {
      sanitized[key] = item.length > 4 ? `***${item.slice(-4)}` : '[redacted]'
      continue
    }
    sanitized[key] = sanitizeDiagnostics(item)
  }
  return sanitized
}

const hasValidDiagnosticsToken = (provided, expected) => {
  if (!provided || !expected) return false
  const providedBytes = Buffer.from(String(provided), 'utf8')
  const expectedBytes = Buffer.from(String(expected), 'utf8')
  return providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
}

const getLocalDiagnostics = async ({
  getRuntimeStatus,
  getDiagnostics
}) => {
  const status = await getLocalStatus(getRuntimeStatus)
  const interfaces = []

  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses || []) {
      interfaces.push({
        name,
        family: address.family,
        internal: Boolean(address.internal),
        address: redactAddress(address.address)
      })
    }
  }

  const extra = typeof getDiagnostics === 'function'
    ? await getDiagnostics()
    : {}

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    agent: {
      version: status.version,
      paired: status.paired,
      uptimeSeconds: Math.floor(process.uptime()),
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    runtime: {
      updateBlocked: status.updateBlocked,
      updateBlockedReason: status.updateBlockedReason,
      activePrintJobs: status.activePrintJobs
    },
    network: {
      interfaces
    },
    ...sanitizeDiagnostics(extra)
  }
}

export const startLocalServer = ({
  port = process.env.FILA_AGENT_LOCAL_PORT ||
    process.env.PRINTFLOW_AGENT_LOCAL_PORT ||
    DEFAULT_LOCAL_PORT,
  allowedOrigins = [],
  canAcceptPairing,
  diagnosticsToken = '',
  getRuntimeStatus,
  getDiagnostics
} = {}) => {
  const parsedPort = Number(port)
  const localPort =
    Number.isInteger(parsedPort) &&
    parsedPort >= 0 &&
    parsedPort <= 65535
      ? parsedPort
      : DEFAULT_LOCAL_PORT
  const allowedOriginSet = new Set(
    allowedOrigins.map(value => String(value || '').trim()).filter(Boolean)
  )

  const server = http.createServer(async (request, response) => {
    try {
      const origin = String(request.headers.origin || '').trim()
      const originAllowed = !origin || allowedOriginSet.has(origin)

      if (!originAllowed) {
        json(response, 403, {
          ok: false,
          error: 'Origem nao autorizada para o Agent local.'
        })
        return
      }

      if (request.method === 'OPTIONS') {
        json(response, 204, {}, origin)
        return
      }

      const requestUrl = new URL(
        request.url || '/',
        `http://${request.headers.host || '127.0.0.1'}`
      )

      if (
        request.method === 'GET' &&
        requestUrl.pathname === '/healthz'
      ) {
        json(
          response,
          200,
          await getLocalStatus(
            getRuntimeStatus
          ),
          origin
        )
        return
      }

      if (
        request.method === 'GET' &&
        requestUrl.pathname === '/diagnostics'
      ) {
        if (origin) {
          json(response, 403, {
            ok: false,
            error: 'Diagnostico disponivel somente para acesso local direto.'
          }, origin)
          return
        }

        if (!diagnosticsToken) {
          json(response, 503, {
            ok: false,
            error: 'Diagnostico local nao configurado.'
          })
          return
        }

        if (!hasValidDiagnosticsToken(
          request.headers['x-fila-agent-diagnostics-token'] ||
            request.headers['x-printflow-diagnostics-token'],
          diagnosticsToken
        )) {
          json(response, 401, {
            ok: false,
            error: 'Token local de diagnostico invalido.'
          })
          return
        }

        json(
          response,
          200,
          await getLocalDiagnostics({
            getRuntimeStatus,
            getDiagnostics
          })
        )
        return
      }

      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/pair'
      ) {
        const pairingAllowed = typeof canAcceptPairing === 'function'
          ? await canAcceptPairing()
          : !(await loadCredentials())?.agentId

        if (!pairingAllowed) {
          json(response, 409, {
            ok: false,
            error: 'Agent ja pareado. Revogue o vinculo atual antes de conectar outra empresa.'
          }, origin)
          return
        }

        const body = await readJsonBody(request)
        const code = String(body?.code || '')
          .trim()
          .toUpperCase()

        if (!/^[A-Z0-9-]{6,64}$/.test(code)) {
          json(response, 400, {
            ok: false,
            error: 'Codigo de pareamento invalido.'
          }, origin)
          return
        }

        await savePendingPairingCode(code)

        json(response, 202, {
          ok: true,
          status: 'pairing_queued'
        }, origin)
        return
      }

      json(response, 404, {
        ok: false,
        error: 'Rota local nao encontrada.'
      }, origin)
    } catch (error) {
      json(response, 500, {
        ok: false,
        error: error.message || 'Erro local do Agent.'
      })
    }
  })

  server.on('clientError', (error, socket) => {
    console.log(
      '[Local] Requisicao local invalida:',
      error.message
    )

    try {
      socket.end(
        'HTTP/1.1 400 Bad Request\r\n\r\n'
      )
    } catch {
    }
  })

  server.on('error', error => {
    console.log(
      '[Local] Nao foi possivel iniciar servidor local:',
      error.message
    )
  })

  const ready = new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })

  server.listen(localPort, '127.0.0.1', () => {
    console.log(`[Local] Agent local ouvindo em http://127.0.0.1:${localPort}`)
  })

  server.ready = ready

  return server
}
