import { getTenantData } from '../data.js'
import { hasDatabase, withTenant } from '../db/pool.js'
import { getTenantId } from '../config/tenant.js'
import { getAuthUser } from './auth.js'
import { readJsonBody } from '../http/body.js'
import { sendBuffer, sendJson } from '../http/response.js'
import { createProduct, listProducts } from '../repositories/productsRepository.js'
import { listResource, loadAppData } from '../repositories/appDataRepository.js'
import { listFinancialHistory } from '../repositories/financialHistoryRepository.js'
import { createFilamentMovement, listFilamentMovements } from '../repositories/inventoryRepository.js'
import { assertResourceBelongsToTenant, createResource, deleteResource, updateResource } from '../repositories/crudRepository.js'
import {
  resolvePrintFilePath,
  savePrintFileStream
} from '../services/printFileStorage.js'
import {
  applyPrintFileMetadataToProduct,
  extractPrintFileMetadata
} from '../services/printFileMetadata.js'
import { generateDueRecurringExpenses } from '../repositories/expensesRepository.js'
import { writeAuditEvent, writeOperationalNotification } from '../services/operationalEvents.js'

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
    if (!hasDatabase) return getTenantData(tenantId)
    const url = new URL(req.url, 'http://localhost')
    const requested = new Set(String(url.searchParams.get('resources') || '').split(',').map((resource) => resource.trim()).filter(Boolean))
    return loadAppData(tenantId, requested)
  },
  '/api/financial-history': async (req) => {
    if (!hasDatabase) return []
    const tenantId = await getTenantId(req)
    const url = new URL(req.url, 'http://localhost')
    return listFinancialHistory(tenantId, url.searchParams.get('resource'), url.searchParams.get('resourceId'))
  }
}

export const handleProductCreate = async (req, res) => {
  try {
    const product = await readJsonBody(req)

    if (!product.name || !product.sku) {
      return sendJson(res, 400, { error: 'Nome e SKU sao obrigatorios' })
    }

    if (hasDatabase) {
      const created = await createProduct(await getTenantId(req), product, await auditActor(req))
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
const auditActor = async (req) => {
  const user = await getAuthUser(req)
  return user ? { actorId: user.id, actorType: 'user' } : null
}

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

      const updated = await updateResource(tenantId, 'products', productId, applyPrintFileMetadataToProduct(productWithFile, metadata), {
        ...(await auditActor(req)),
        action: 'products.print_file_uploaded',
        details: { format: stored.format, sizeBytes: stored.size }
      })

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
  if (resource === 'orders') {
    const status = String(payload.status || 'Novo')
    const isManualHistoricalSale = payload.salesChannel === 'direct' && /^MANUAL-/.test(String(payload.id || ''))
    if (status !== 'Novo' && !(isManualHistoricalSale && status === 'Entregue')) {
      return sendJson(res, 400, { error: 'Novos pedidos operacionais devem iniciar em Novo.' })
    }
  }
  const tenantId = await getTenantId(req)
  const list = hasDatabase ? await createResource(tenantId, resource, payload, await auditActor(req)) : createLocalResource(tenantId, resource, payload)
  return sendJson(res, 201, list)
}

export const handleResourceUpdate = async (req, res, resource, id) => {
  if (!validResources.has(resource)) return sendJson(res, 404, { error: 'Recurso nao encontrado' })
  const payload = await readJsonBody(req)
  const tenantId = await getTenantId(req)
  if (resource === 'orders' && Object.prototype.hasOwnProperty.call(payload, 'status')) {
    const orders = hasDatabase ? await listResource(tenantId, 'orders') : getTenantData(tenantId).orders
    const current = orders.find((item) => itemMatchesId(item, id))
    if (!current) return sendJson(res, 404, { error: 'Registro nao encontrado' })
    if (String(payload.status || 'Novo') !== String(current.status || 'Novo')) {
      return sendJson(res, 400, { error: 'Altere a etapa do pedido pelo acompanhamento operacional.' })
    }
  }
  const list = hasDatabase ? await updateResource(tenantId, resource, id, payload, await auditActor(req)) : updateLocalResource(tenantId, resource, id, payload)
  return sendJson(res, 200, list)
}

export const handleResourceDelete = async (req, res, resource, id) => {
  if (!validResources.has(resource)) return sendJson(res, 404, { error: 'Recurso nao encontrado' })
  const tenantId = await getTenantId(req)
  const list = hasDatabase ? await deleteResource(tenantId, resource, id, await auditActor(req)) : deleteLocalResource(tenantId, resource, id)
  return sendJson(res, 200, list)
}

export const handleRecurringExpensesGenerate = async (req, res) => {
  if (!hasDatabase) return sendJson(res, 501, { error: 'Recorrencias exigem banco de dados.' })
  const tenantId = await getTenantId(req)
  const generated = await generateDueRecurringExpenses(tenantId)
  return sendJson(res, 200, { generated: generated.length, expenses: await listResource(tenantId, 'expenses') })
}

export const handleFilamentMovements = async (req, res, filamentId) => {
  const tenantId = await getTenantId(req)
  if (req.method === 'GET') return sendJson(res, 200, await listFilamentMovements(tenantId, filamentId))
  if (req.method === 'POST') return sendJson(res, 201, await createFilamentMovement(tenantId, filamentId, await readJsonBody(req), await auditActor(req)))
  return sendJson(res, 405, { error: 'Metodo nao permitido' })
}

const orderStages = ['Novo', 'Producao', 'Impresso', 'Embalando', 'Enviado', 'Entregue']

const orderStageError = (currentStatus, nextStatus, trackingCode) => {
  const currentIndex = orderStages.indexOf(String(currentStatus || 'Novo'))
  const nextIndex = orderStages.indexOf(String(nextStatus || ''))
  if (currentIndex < 0 || nextIndex < 0 || nextIndex !== currentIndex + 1) {
    return 'O pedido deve avancar uma etapa por vez.'
  }
  if (nextStatus === 'Enviado' && !trackingCode) return 'Informe o codigo de rastreio antes de enviar.'
  return ''
}

const stageOrder = async (tenantId, orderId, payload, audit) => {
  const nextStatus = String(payload?.status || '').trim()
  const trackingCode = String(payload?.trackingCode || '').trim().slice(0, 180)

  return withTenant(tenantId, async (client) => {
    const current = await client.query(
      `select id, status, delivery_tracking_code, product_name
         from orders where tenant_id = $1 and id = $2 for update`,
      [tenantId, orderId]
    )
    if (!current.rowCount) return { error: 'Registro nao encontrado', status: 404 }

    const order = current.rows[0]
    const error = orderStageError(order.status, nextStatus, trackingCode || order.delivery_tracking_code)
    if (error) return { error, status: 400 }

    const updated = await client.query(
      `update orders
          set status = $3,
              delivery_tracking_code = case when $3 = 'Enviado' then $4 else delivery_tracking_code end,
              packed_at = case when $3 = 'Embalando' then coalesce(packed_at, now()) else packed_at end,
              shipped_at = case when $3 = 'Enviado' then coalesce(shipped_at, now()) else shipped_at end,
              delivered_at = case when $3 = 'Entregue' then coalesce(delivered_at, now()) else delivered_at end
        where tenant_id = $1 and id = $2
        returning id, status, delivery_tracking_code, packed_at, shipped_at, delivered_at`,
      [tenantId, orderId, nextStatus, trackingCode]
    )
    const saved = updated.rows[0]

    await writeAuditEvent(tenantId, {
      action: 'orders.stage_advanced', actorType: audit.actorType, actorId: audit.actorId,
      entityType: 'orders', entityId: String(orderId),
      details: { fromStatus: order.status, toStatus: nextStatus }
    }, client)

    if (nextStatus === 'Embalando' || nextStatus === 'Entregue') {
      await writeOperationalNotification(tenantId, {
        type: `order.${nextStatus.toLowerCase()}`,
        severity: 'success',
        title: nextStatus === 'Embalando' ? 'Pedido pronto para envio' : 'Pedido entregue',
        message: order.product_name ? `Pedido de ${order.product_name} atualizado para ${nextStatus}.` : `Pedido atualizado para ${nextStatus}.`,
        entityType: 'orders', entityId: String(orderId),
        dedupeKey: `order-stage:${orderId}:${nextStatus}`
      }, client)
    }

    return { order: { id: String(saved.id), status: saved.status, trackingCode: saved.delivery_tracking_code, packedAt: saved.packed_at, shippedAt: saved.shipped_at, deliveredAt: saved.delivered_at } }
  })
}

export const handleOrderStageAdvance = async (req, res, orderId) => {
  const tenantId = await getTenantId(req)
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })
  const payload = await readJsonBody(req)

  if (!hasDatabase) {
    const order = getTenantData(tenantId).orders.find((item) => itemMatchesId(item, orderId))
    if (!order) return sendJson(res, 404, { error: 'Registro nao encontrado' })
    const nextStatus = String(payload?.status || '').trim()
    const trackingCode = String(payload?.trackingCode || '').trim().slice(0, 180)
    const error = orderStageError(order.status, nextStatus, trackingCode || order.trackingCode)
    if (error) return sendJson(res, 400, { error })
    const now = new Date().toISOString()
    order.status = nextStatus
    if (nextStatus === 'Enviado') { order.trackingCode = trackingCode; order.shippedAt ||= now }
    if (nextStatus === 'Embalando') order.packedAt ||= now
    if (nextStatus === 'Entregue') order.deliveredAt ||= now
    return sendJson(res, 200, { order })
  }

  const result = await stageOrder(tenantId, orderId, payload, { actorType: 'user', actorId: user.id })
  if (result.error) return sendJson(res, result.status, { error: result.error })
  return sendJson(res, 200, result)
}
