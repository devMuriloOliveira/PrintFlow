import { getTenantData } from '../data.js'
import { hasDatabase } from '../db/pool.js'
import { getTenantId } from '../config/tenant.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { createProduct, listProducts } from '../repositories/productsRepository.js'
import { listResource, loadAppData } from '../repositories/appDataRepository.js'
import { assertResourceBelongsToTenant, createResource, deleteResource, updateResource } from '../repositories/crudRepository.js'
import {
  resolvePrintFilePath,
  savePrintFileStream
} from '../services/printFileStorage.js'
import {
  applyPrintFileMetadataToProduct,
  extractPrintFileMetadata
} from '../services/printFileMetadata.js'

const readResource = (resource) => async (req) => {
  const tenantId = await getTenantId(req)
  return hasDatabase ? listResource(tenantId, resource) : getTenantData(tenantId)[resource]
}

export const readRoutes = {
  '/api/products': async (req) => {
    const tenantId = await getTenantId(req)
    return hasDatabase ? listProducts(tenantId) : getTenantData(tenantId).products
  },
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
    const tenantId = await getTenantId(req)
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
      const created = await createProduct(await getTenantId(req), product)
      return sendJson(res, 201, created)
    }

    const tenantData = getTenantData(await getTenantId(req))
    tenantData.products.unshift({ ...product, thumb: product.thumb || 'vase' })
    return sendJson(res, 201, tenantData.products[0])
  } catch (error) {
    return sendJson(res, 400, { error: error.message || 'JSON invalido' })
  }
}

const validResources = new Set(['products', 'orders', 'printJobs', 'expenses', 'filaments', 'printers', 'marketplaces', 'clients', 'goals'])
const localId = () => String(Date.now() + Math.floor(Math.random() * 1000))
const itemMatchesId = (item, id) => String(item.dbId || item.id) === String(id)

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

export const handleProductPrintFileUpload = async (req, res, productId, url) => {
  try {
    const tenantId = await getTenantId(req)
    const rawFileName = String(req.headers['x-printflow-file-name'] || url.searchParams.get('fileName') || '').trim()
    const fileName = decodeURIComponent(rawFileName)
    const format = String(req.headers['x-printflow-file-format'] || url.searchParams.get('format') || '').trim()

    if (!fileName) {
      return sendJson(res, 400, { error: 'Nome do arquivo obrigatorio' })
    }

    if (hasDatabase) {
      try {
        await assertResourceBelongsToTenant(tenantId, 'products', productId)
      } catch {
        return sendJson(res, 404, { error: 'Registro nao encontrado' })
      }

      const stored = await savePrintFileStream({
        tenantId,
        productId,
        fileName,
        format,
        stream: req
      })

      const current = await listProducts(tenantId)
      const product = current.find((item) => String(item.id) === String(productId))
      if (!product) return sendJson(res, 404, { error: 'Registro nao encontrado' })

      const metadataFilePath = resolvePrintFilePath(stored.storageKey)
      const metadata = await extractPrintFileMetadata({
        filePath: metadataFilePath,
        format: stored.format
      })

      const productWithFile = {
        ...product,
        printFileName: stored.fileName,
        printFileFormat: stored.format,
        printFileHash: stored.hash,
        printFileSizeBytes: stored.sizeBytes,
        printFileStorageKey: stored.storageKey,
        validationStatus: 'needs_validation',
        validationMessage: metadata.message || 'Arquivo enviado. Confira dimensoes, material e perfil antes de validar.'
      }

      const updated = await updateResource(tenantId, 'products', productId, applyPrintFileMetadataToProduct(productWithFile, metadata))

      const savedProduct = Array.isArray(updated)
        ? updated.find((item) => String(item.id) === String(productId))
        : null

      return sendJson(res, 200, {
        file: stored,
        product: savedProduct || null
      })
    }

    const tenantData = getTenantData(tenantId)
    const product = tenantData.products.find((item) => String(item.id) === String(productId))
    if (!product) return sendJson(res, 404, { error: 'Registro nao encontrado' })

    const stored = await savePrintFileStream({
      tenantId,
      productId,
      fileName,
      format,
      stream: req
    })

    const metadataFilePath = resolvePrintFilePath(stored.storageKey)
    const metadata = await extractPrintFileMetadata({
      filePath: metadataFilePath,
      format: stored.format
    })

    Object.assign(product, applyPrintFileMetadataToProduct({
      ...product,
      printFileName: stored.fileName,
      printFileFormat: stored.format,
      printFileHash: stored.hash,
      printFileSizeBytes: stored.sizeBytes,
      printFileStorageKey: stored.storageKey,
      validationStatus: 'needs_validation',
      validationMessage: metadata.message || 'Arquivo enviado. Confira dimensoes, material e perfil antes de validar.'
    }, metadata))

    return sendJson(res, 200, {
      file: stored,
      product
    })
  } catch (error) {
    return sendJson(res, 400, { error: error.message || 'Nao foi possivel enviar o arquivo' })
  }
}

export const handleResourceRead = async (req, res, resource, id) => {
  if (!validResources.has(resource)) return sendJson(res, 404, { error: 'Recurso nao encontrado' })

  const tenantId = await getTenantId(req)
  if (hasDatabase) {
    try {
      await assertResourceBelongsToTenant(tenantId, resource, id)
    } catch {
      return sendJson(res, 404, { error: 'Registro nao encontrado' })
    }
  }

  const list = hasDatabase ? await listResource(tenantId, resource) : getTenantData(tenantId)[resource]
  const item = Array.isArray(list) ? list.find((entry) => itemMatchesId(entry, id)) : null

  if (!item) return sendJson(res, 404, { error: 'Registro nao encontrado' })

  return sendJson(res, 200, item)
}

export const handleResourceCreate = async (req, res, resource) => {
  if (!validResources.has(resource)) return sendJson(res, 404, { error: 'Recurso nao encontrado' })
  const payload = await readJsonBody(req)
  const tenantId = await getTenantId(req)
  const list = hasDatabase ? await createResource(tenantId, resource, payload) : createLocalResource(tenantId, resource, payload)
  return sendJson(res, 201, list)
}

export const handleResourceUpdate = async (req, res, resource, id) => {
  if (!validResources.has(resource)) return sendJson(res, 404, { error: 'Recurso nao encontrado' })
  const payload = await readJsonBody(req)
  const tenantId = await getTenantId(req)
  const list = hasDatabase ? await updateResource(tenantId, resource, id, payload) : updateLocalResource(tenantId, resource, id, payload)
  return sendJson(res, 200, list)
}

export const handleResourceDelete = async (req, res, resource, id) => {
  if (!validResources.has(resource)) return sendJson(res, 404, { error: 'Recurso nao encontrado' })
  const tenantId = await getTenantId(req)
  const list = hasDatabase ? await deleteResource(tenantId, resource, id) : deleteLocalResource(tenantId, resource, id)
  return sendJson(res, 200, list)
}
