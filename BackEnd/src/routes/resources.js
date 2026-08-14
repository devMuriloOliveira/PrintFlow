import { getTenantData } from '../data.js'
import { hasDatabase } from '../db/pool.js'
import { getTenantId } from '../config/tenant.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { createProduct, listProducts } from '../repositories/productsRepository.js'
import { listResource, loadAppData } from '../repositories/appDataRepository.js'

const readResource = (resource) => async (req) => {
  const tenantId = getTenantId(req)
  return hasDatabase ? listResource(tenantId, resource) : getTenantData(tenantId)[resource]
}

export const readRoutes = {
  '/api/products': async (req) => hasDatabase ? listProducts(getTenantId(req)) : getTenantData(getTenantId(req)).products,
  '/api/orders': readResource('orders'),
  '/api/expenses': readResource('expenses'),
  '/api/filaments': readResource('filaments'),
  '/api/printers': readResource('printers'),
  '/api/marketplaces': readResource('marketplaces'),
  '/api/clients': readResource('clients'),
  '/api/expense-segments': readResource('expenseSegments'),
  '/api/goals': readResource('goals'),
  '/api/settings': readResource('settings'),
  '/api/app-data': async (req) => {
    const tenantId = getTenantId(req)
    return hasDatabase ? loadAppData(tenantId) : getTenantData(tenantId)
  }
}

export const handleProductCreate = async (req, res) => {
  try {
    const product = await readJsonBody(req)

    if (!product.name || !product.sku) {
      return sendJson(res, 400, { error: 'Nome e SKU sao obrigatorios' })
    }

    if (hasDatabase) {
      const created = await createProduct(getTenantId(req), product)
      return sendJson(res, 201, created)
    }

    const tenantData = getTenantData(getTenantId(req))
    tenantData.products.unshift({ ...product, thumb: product.thumb || 'vase' })
    return sendJson(res, 201, tenantData.products[0])
  } catch (error) {
    return sendJson(res, 400, { error: error.message || 'JSON invalido' })
  }
}
