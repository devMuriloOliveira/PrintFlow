import http from 'node:http'
import { URL } from 'node:url'

import { AGENT_VERSION } from './agentInfo.js'
import {
  loadCredentials,
  savePendingPairingCode
} from './storage/credentials.js'

const DEFAULT_LOCAL_PORT = 17873

const json = (response, statusCode, payload) => {
  response.writeHead(
    statusCode,
    {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  )

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

const getLocalStatus = async () => {
  const credentials = await loadCredentials()

  return {
    ok: true,
    app: 'printflow-agent',
    version: AGENT_VERSION,
    paired: Boolean(credentials?.agentId)
  }
}

export const startLocalServer = ({
  port = process.env.PRINTFLOW_AGENT_LOCAL_PORT ||
    DEFAULT_LOCAL_PORT
} = {}) => {
  const localPort = Number(port) || DEFAULT_LOCAL_PORT

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === 'OPTIONS') {
        json(response, 204, {})
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
        json(response, 200, await getLocalStatus())
        return
      }

      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/pair'
      ) {
        const body = await readJsonBody(request)
        const code = String(body?.code || '')
          .trim()
          .toUpperCase()

        if (!/^[A-Z0-9-]{6,64}$/.test(code)) {
          json(response, 400, {
            ok: false,
            error: 'Codigo de pareamento invalido.'
          })
          return
        }

        await savePendingPairingCode(code)

        json(response, 202, {
          ok: true,
          status: 'pairing_queued'
        })
        return
      }

      json(response, 404, {
        ok: false,
        error: 'Rota local nao encontrada.'
      })
    } catch (error) {
      json(response, 500, {
        ok: false,
        error: error.message || 'Erro local do Agent.'
      })
    }
  })

  server.on('error', error => {
    console.log(
      '[Local] Nao foi possivel iniciar servidor local:',
      error.message
    )
  })

  server.listen(
    localPort,
    '127.0.0.1',
    () => {
      console.log(
        `[Local] Agent local ouvindo em http://127.0.0.1:${localPort}`
      )
    }
  )

  return server
}
