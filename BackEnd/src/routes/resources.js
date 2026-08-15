import { getTenantData } from '../data.js'
import { hasDatabase } from '../db/pool.js'
import { getTenantId } from '../config/tenant.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { createProduct, listProducts } from '../repositories/productsRepository.js'
import { listResource, loadAppData } from '../repositories/appDataRepository.js'
import { createResource, deleteResource, updateResource } from '../repositories/crudRepository.js'

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

const validResources = new Set(['products', 'orders', 'expenses', 'filaments', 'printers', 'marketplaces', 'clients', 'goals'])
const localId = () => String(Date.now() + Math.floor(Math.random() * 1000))

const createLocalResource = (tenantId, resource, payload) => {
  const tenantData = getTenantData(tenantId)
  const list = tenantData[resource]
  if (!Array.isArray(list)) return []

  const id = payload.dbId || payload.id || localId()
  const existingIndex = list.findIndex((item) => item.dbId === id || item.id === id)
  const item = { ...payload, dbId: id, id: payload.id || id }
  if (existingIndex >= 0) list.splice(existingIndex, 1, { ...list[existingIndex], ...item })
  else list.unshift(item)
  return list
}

const updateLocalResource = (tenantId, resource, id, payload) => {
  const tenantData = getTenantData(tenantId)
  const list = tenantData[resource]
  if (!Array.isArray(list)) return []

  const index = list.findIndex((item) => item.dbId === id || item.id === id)
  if (index < 0) throw new Error('Registro nao encontrado')
  list.splice(index, 1, { ...list[index], ...payload, dbId: list[index].dbId || id })
  return list
}

const deleteLocalResource = (tenantId, resource, id) => {
  const tenantData = getTenantData(tenantId)
  const list = tenantData[resource]
  if (!Array.isArray(list)) return []

  const index = list.findIndex((item) => item.dbId === id || item.id === id)
  if (index < 0) throw new Error('Registro nao encontrado')
  list.splice(index, 1)
  return list
}

export const handleResourceCreate = async (req, res, resource) => {
  if (!validResources.has(resource)) return sendJson(res, 404, { error: 'Recurso nao encontrado' })
  const payload = await readJsonBody(req)
  const list = hasDatabase ? await createResource(getTenantId(req), resource, payload) : createLocalResource(getTenantId(req), resource, payload)
  return sendJson(res, 201, list)
}

export const handleResourceUpdate = async (req, res, resource, id) => {
  if (!validResources.has(resource)) return sendJson(res, 404, { error: 'Recurso nao encontrado' })
  const payload = await readJsonBody(req)
  const list = hasDatabase ? await updateResource(getTenantId(req), resource, id, payload) : updateLocalResource(getTenantId(req), resource, id, payload)
  return sendJson(res, 200, list)
}

export const handleResourceDelete = async (req, res, resource, id) => {
  if (!validResources.has(resource)) return sendJson(res, 404, { error: 'Recurso nao encontrado' })
  const list = hasDatabase ? await deleteResource(getTenantId(req), resource, id) : deleteLocalResource(getTenantId(req), resource, id)
  return sendJson(res, 200, list)
}
