import { sendJson } from '../http/response.js'
import { enterRequest } from '../http/rateLimit.js'
import { handleLogin, handleLogout, handleMe, handleRefresh, handleRegister, getAuthUser } from './auth.js'
import { env } from '../config/env.js'
import { handleProductCreate, handleResourceCreate, handleResourceDelete, handleResourceRead, handleResourceUpdate, readRoutes } from './resources.js'
import {
  handleAmazonWebhook,
  handleIntegrationCreate,
  handleIntegrationsList,
  handleMercadoLivreWebhook,
  handleShopeeWebhook
} from './integrations.js'

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

    const isProtectedApi = url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')
    if (isProtectedApi && !env.allowDemoTenant && !(await getAuthUser(req))) {
      return sendJson(res, 401, { error: 'Login necessario' })
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
