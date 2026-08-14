import { sendJson } from '../http/response.js'
import { handleProductCreate, readRoutes } from './resources.js'

export const handleRequest = async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    if (req.method === 'OPTIONS') {
      return sendJson(res, 204, null)
    }

    if (req.method === 'GET' && url.pathname === '/') {
      return sendJson(res, 200, {
        name: 'PrintFlow API',
        status: 'ok',
        endpoints: Object.keys(readRoutes)
      })
    }

    if (req.method === 'GET' && readRoutes[url.pathname]) {
      return sendJson(res, 200, await readRoutes[url.pathname](req))
    }

    if (req.method === 'POST' && url.pathname === '/api/products') {
      return handleProductCreate(req, res)
    }

    return sendJson(res, 404, { error: 'Endpoint nao encontrado' })
  } catch (error) {
    return sendJson(res, 400, { error: error.message || 'Requisicao invalida' })
  }
}
