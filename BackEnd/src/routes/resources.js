import { db } from '../data.js'
import { hasDatabase } from '../db/pool.js'
import { getTenantId } from '../config/tenant.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import {
  listClients,
  listExpenses,
  listFilaments,
  listGoals,
  listMarketplaces,
  listOrders,
  listPrinters,
  readAppData
} from '../repositories/appDataRepository.js'
import { createProduct, listProducts } from '../repositories/productsRepository.js'

export const readRoutes = {
  '/api/products': async (req) => hasDatabase ? listProducts(getTenantId(req)) : db.products,
  '/api/orders': async (req) => hasDatabase ? listOrders(getTenantId(req)) : db.orders,
  '/api/expenses': async (req) => hasDatabase ? listExpenses(getTenantId(req)) : db.expenses,
  '/api/filaments': async (req) => hasDatabase ? listFilaments(getTenantId(req)) : db.filaments,
  '/api/printers': async (req) => hasDatabase ? listPrinters(getTenantId(req)) : db.printers,
  '/api/marketplaces': async (req) => hasDatabase ? listMarketplaces(getTenantId(req)) : db.marketplaces,
  '/api/clients': async (req) => hasDatabase ? listClients(getTenantId(req)) : db.clients,
  '/api/goals': async (req) => hasDatabase ? listGoals(getTenantId(req)) : [],
  '/api/expense-segments': () => db.expenseSegments,
  '/api/app-data': async (req) => hasDatabase ? readAppData(getTenantId(req)) : { ...db, goals: [] }
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

    db.products.unshift({ ...product, thumb: product.thumb || 'vase' })
    return sendJson(res, 201, db.products[0])
  } catch (error) {
    return sendJson(res, 400, { error: error.message || 'JSON invalido' })
  }
}
