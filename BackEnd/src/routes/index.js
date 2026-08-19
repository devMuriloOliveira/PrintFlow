import { sendJson } from '../http/response.js'
import { enterRequest } from '../http/rateLimit.js'
import { 
  handleLogin, 
  handleLogout, 
  handleMe, 
  handleRefresh, 
  handleRegister, 
  getAuthUser 
} from './auth.js'
import { env } from '../config/env.js'
import { 
  handleProductCreate,
  handleResourceCreate, 
  handleResourceDelete, 
  handleResourceRead, 
  handleResourceUpdate, 
  readRoutes
 } from './resources.js'
import {
  handleAmazonWebhook,
  handleIntegrationCreate,
  handleIntegrationsList,
  handleMercadoLivreWebhook,
  handleShopeeWebhook
} from './integrations.js'
import { 
  handleAgentPair, 
  handleAgentPairingCodeCreate,
  handleAgentVerify,
  handleAgentHeartbeat, 
  handleAgentsList,
  handleAgentDiscoverCreate,
  handleAgentCommandsPending,
  handleAgentCommandComplete,
  handleAgentCommandGet,
  handleAgentConnectPrinterCreate
} from './agents.js'

export const handleRequest = async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    if (req.method === 'OPTIONS') {
      return sendJson(res, 204, null)
    }

    const limit = enterRequest(req, url.pathname)
    if (!limit.allowed) {
      return sendJson(res, limit.status, limit.body, limit.headers)
    }

    res.once('finish', limit.release)
    res.once('close', limit.release)

    if (req.method === 'GET' && url.pathname === '/') {
      return sendJson(res, 200, {
        name: 'PrintFlow API',
        status: 'ok',
        endpoints: Object.keys(readRoutes)
      })
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(res, 200, { status: 'ok' })
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      return await handleRegister(req, res)
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      return await handleLogin(req, res)
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/refresh') {
      return await handleRefresh(req, res)
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      return await handleLogout(req, res)
    }

    if (req.method === 'POST' && url.pathname === '/webhooks/mercadolivre') {
      return await handleMercadoLivreWebhook(req, res)
    }

    if (req.method === 'POST' && url.pathname === '/webhooks/shopee') {
      return await handleShopeeWebhook(req, res)
    }

    if (req.method === 'POST' && url.pathname === '/webhooks/amazon') {
      return await handleAmazonWebhook(req, res)
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      return await handleMe(req, res)
    }
    
    if (req.method === 'POST' && url.pathname === '/api/agents/pair') {
     return await handleAgentPair(req, res)
    }

    if (req.method === 'POST' && url.pathname === '/api/agents/verify') {
      return await handleAgentVerify(req, res)
    }
    
    if (req.method === 'POST' && url.pathname === '/api/agents/heartbeat') {
      return await handleAgentHeartbeat(req, res)
    }

    if (req.method === 'GET' && url.pathname === '/api/agents/commands/pending') {
      return await handleAgentCommandsPending(req, res)
    }   

      const agentCommandCompleteMatch =
        url.pathname.match(
          /^\/api\/agents\/commands\/([^/]+)\/complete$/
        )

          if (
            req.method === 'POST' &&
            agentCommandCompleteMatch
            ) {
            const commandId =
              agentCommandCompleteMatch[1]

        return await handleAgentCommandComplete(
          req,
          res,
          commandId
        )
      }    
                const isPublicAgentRoute =
          (
            req.method === 'POST' &&
            (
              url.pathname === '/api/agents/pair' ||
              url.pathname === '/api/agents/verify' ||
              url.pathname === '/api/agents/heartbeat' ||
              /^\/api\/agents\/commands\/[^/]+\/complete$/.test(
                url.pathname
              )
            )
          ) ||
          (
            req.method === 'GET' &&
            url.pathname === '/api/agents/commands/pending'
          )
    const isProtectedApi =
      url.pathname.startsWith('/api/') &&
        !url.pathname.startsWith('/api/auth/') &&
          !isPublicAgentRoute

     if (isProtectedApi && !env.allowDemoTenant && !(await getAuthUser(req))) {
      return sendJson(res, 401, { error: 'Login necessario' })
    }

     const agentCommandGetMatch =
        url.pathname.match(
          /^\/api\/agent-commands\/([^/]+)$/
        )

      if (
        req.method === 'GET' &&
        agentCommandGetMatch
      ) {
        const commandId =
          agentCommandGetMatch[1]

        return await handleAgentCommandGet(
          req,
          res,
          commandId
        )
      } 

    const agentDiscoverMatch =
      url.pathname.match(/^\/api\/agents\/([^/]+)\/discover$/)

    if (req.method === 'POST' && agentDiscoverMatch) {
      const agentId = agentDiscoverMatch[1]

      return await handleAgentDiscoverCreate(
        req,
        res,
        agentId
      )
    }

    if (req.method === 'GET' && url.pathname === '/api/agents') {
      return await handleAgentsList(req, res)
    } 

    if (req.method === 'POST' && url.pathname === '/api/agents/pairing-code') {
      return await handleAgentPairingCodeCreate(req, res)
    }

    if (req.method === 'GET' && readRoutes[url.pathname]) {
      return sendJson(res, 200, await readRoutes[url.pathname](req))
    }

    if (req.method === 'GET' && url.pathname === '/api/marketplace-integrations') {
      return await handleIntegrationsList(req, res)
    }

    if (req.method === 'POST' && url.pathname === '/api/marketplace-integrations') {
      return await handleIntegrationCreate(req, res)
    }

    if (req.method === 'POST' && url.pathname === '/api/products') {
      return await handleProductCreate(req, res)
    }

    const agentConnectPrinterMatch =
  url.pathname.match(
    /^\/api\/agents\/([^/]+)\/connect-printer$/
  )

if (
  req.method === 'POST' &&
  agentConnectPrinterMatch
) {
  const agentId =
    agentConnectPrinterMatch[1]

  return await handleAgentConnectPrinterCreate(
    req,
    res,
    agentId
  )
}

    const resourceMatch = url.pathname.match(/^\/api\/([a-z-]+)(?:\/([^/]+))?$/)
    if (resourceMatch) {
      const [, resource, id] = resourceMatch
      if (req.method === 'GET' && id) return await handleResourceRead(req, res, resource, id)
      if (req.method === 'POST' && !id) return await handleResourceCreate(req, res, resource)
      if (req.method === 'PUT' && id) return await handleResourceUpdate(req, res, resource, id)
      if (req.method === 'DELETE' && id) return await handleResourceDelete(req, res, resource, id)
    }

    return sendJson(res, 404, { error: 'Endpoint nao encontrado' })
  } catch (error) {
    const expectedClientErrors = new Set([
      'Registro nao encontrado',
      'E-mail ou senha invalidos.',
      'Refresh token invalido.',
      'Refresh token reutilizado.'
    ])
    const status = error.message === 'Registro nao encontrado' ? 404 : 400
    if (!expectedClientErrors.has(error.message)) {
      console.error('Erro ao processar requisicao', {
        method: req.method,
        url: req.url,
        message: error.message
      })
    }
    return sendJson(res, status, { error: error.message || 'Requisicao invalida' })
  }
}
