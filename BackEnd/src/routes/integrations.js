import { getTenantId } from '../config/tenant.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { verifyWebhookSecret } from '../security/webhook.js'
import {
  createMarketplaceIntegration,
  findIntegrationByExternalAccount,
  listMarketplaceIntegrations,
  recordTrackedSale,
  recordWebhookEvent
} from '../repositories/integrationsRepository.js'

const number = (value) => Number(value || 0)

const ignored = (res) => sendJson(res, 200, { message: 'Conta ignorada ou nao integrada.' })

export const handleIntegrationsList = async (req, res) =>
  sendJson(res, 200, await listMarketplaceIntegrations(await getTenantId(req)))

export const handleIntegrationCreate = async (req, res) => {
  const payload = await readJsonBody(req)
  const integration = await createMarketplaceIntegration(await getTenantId(req), payload)
  return sendJson(res, 201, integration)
}

export const handleMercadoLivreWebhook = async (req, res) => {
  if (!verifyWebhookSecret(req)) return sendJson(res, 401, { error: 'Webhook nao autorizado.' })

  const payload = await readJsonBody(req)
  const externalAccountId = String(payload.user_id || '')
  if (!externalAccountId) return sendJson(res, 400, { error: 'ID externo do vendedor nao informado.' })

  const integration = await findIntegrationByExternalAccount('mercado_livre', externalAccountId)
  if (!integration) return ignored(res)

  const resource = String(payload.resource || '')
  const externalOrderId = resource.split('/').filter(Boolean).pop() || String(payload.order_id || '')
  await recordWebhookEvent(integration, {
    platform: 'mercado_livre',
    eventType: payload.topic || 'webhook',
    externalOrderId,
    payload
  })

  if (externalOrderId && ['orders', 'merchant_orders'].includes(String(payload.topic))) {
    await recordTrackedSale(integration, {
      platform: 'mercado_livre',
      externalOrderId,
      gross: number(payload.total_amount),
      marketplaceFee: number(payload.marketplace_fee),
      shipping: number(payload.shipping),
      net: payload.net_amount === undefined ? undefined : number(payload.net_amount),
      status: payload.status || 'received',
      soldAt: payload.date_created || payload.created_at || null
    })
  }

  return sendJson(res, 200, { status: 'success' })
}

export const handleShopeeWebhook = async (req, res) => {
  if (!verifyWebhookSecret(req)) return sendJson(res, 401, { error: 'Webhook nao autorizado.' })

  const payload = await readJsonBody(req)
  const externalAccountId = String(payload.shop_id || '')
  if (!externalAccountId) return sendJson(res, 400, { error: 'Shop ID nao informado.' })

  const integration = await findIntegrationByExternalAccount('shopee', externalAccountId)
  if (!integration) return ignored(res)

  const data = payload.data || {}
  const externalOrderId = String(data.ordersn || data.order_sn || payload.ordersn || '')
  await recordWebhookEvent(integration, {
    platform: 'shopee',
    eventType: String(payload.code || 'webhook'),
    externalOrderId,
    payload
  })

  if (externalOrderId) {
    await recordTrackedSale(integration, {
      platform: 'shopee',
      externalOrderId,
      gross: number(data.total_amount),
      marketplaceFee: number(data.escrow_amount_after_adjustment ? data.total_amount - data.escrow_amount_after_adjustment : data.marketplace_fee),
      shipping: number(data.shipping_fee),
      net: data.escrow_amount_after_adjustment === undefined ? undefined : number(data.escrow_amount_after_adjustment),
      status: data.status || 'received',
      soldAt: data.create_time ? new Date(Number(data.create_time) * 1000).toISOString() : null
    })
  }

  return sendJson(res, 200, { message: 'success' })
}

export const handleAmazonWebhook = async (req, res) => {
  if (!verifyWebhookSecret(req)) return sendJson(res, 401, { error: 'Webhook nao autorizado.' })

  const payload = await readJsonBody(req)
  const externalAccountId = String(payload.sellerId || payload.seller_id || payload.merchantId || '')
  if (!externalAccountId) return sendJson(res, 400, { error: 'Seller ID nao informado.' })

  const integration = await findIntegrationByExternalAccount('amazon', externalAccountId)
  if (!integration) return ignored(res)

  const externalOrderId = String(payload.amazonOrderId || payload.orderId || payload.order_id || '')
  await recordWebhookEvent(integration, {
    platform: 'amazon',
    eventType: payload.notificationType || 'webhook',
    externalOrderId,
    payload
  })

  if (externalOrderId) {
    await recordTrackedSale(integration, {
      platform: 'amazon',
      externalOrderId,
      gross: number(payload.totalAmount || payload.orderTotal),
      marketplaceFee: number(payload.marketplaceFee),
      shipping: number(payload.shipping),
      net: payload.netAmount === undefined ? undefined : number(payload.netAmount),
      status: payload.status || 'received',
      soldAt: payload.purchaseDate || payload.createdAt || null
    })
  }

  return sendJson(res, 200, { message: 'success' })
}
