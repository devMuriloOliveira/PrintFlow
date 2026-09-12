import { getTenantId } from '../config/tenant.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import {
  linkMarketplaceOrderProduct,
  listMarketplaceOrders
} from '../repositories/marketplaceOrdersRepository.js'

export const handleMarketplaceOrdersList = async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const paged = url.searchParams.has('limit') || url.searchParams.has('offset')
  return sendJson(res, 200, await listMarketplaceOrders(await getTenantId(req), paged ? {
    limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset')
  } : {}))
}

export const handleMarketplaceOrderLinkProduct = async (req, res, saleId) => {
  const payload = await readJsonBody(req)
  await linkMarketplaceOrderProduct(await getTenantId(req), saleId, payload)
  return sendJson(res, 200, await listMarketplaceOrders(await getTenantId(req)))
}

