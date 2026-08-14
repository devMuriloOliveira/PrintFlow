import { db } from '../data.js'
import { hasDatabase } from '../db/pool.js'
import { getTenantId } from '../config/tenant.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { createProduct, listProducts } from '../repositories/productsRepository.js'

export const readRoutes = {
  '/api/products': async (req) => hasDatabase ? listProducts(getTenantId(req)) : db.products,
  '/api/orders': () => db.orders,
  '/api/expenses': () => db.expenses,
  '/api/filaments': () => db.filaments,
  '/api/printers': () => db.printers,
  '/api/marketplaces': () => db.marketplaces,
  '/api/clients': () => db.clients,
  '/api/expense-segments': () => db.expenseSegments,
  '/api/app-data': async (req) => ({
    ...db,
    products: hasDatabase ? await listProducts(getTenantId(req)) : db.products
  })
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
