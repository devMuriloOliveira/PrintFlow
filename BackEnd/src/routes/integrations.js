import { readJsonBody, readRawBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { verifyWebhookSecret } from '../security/webhook.js'
import { getTenantId } from '../config/tenant.js'
import { env } from '../config/env.js'
import { getAuthUser } from './auth.js'
import { tenantQuery } from '../db/pool.js'
import {
  createMarketplaceIntegration,
  claimMarketplaceWebhookEvent,
  consumeMarketplaceOAuthAttempt,
  disconnectMarketplaceIntegration,
  findIntegrationById,
  findIntegrationByExternalAccount,
  listMarketplaceIntegrations,
  markMarketplaceIntegrationSync,
  markMarketplaceWebhookEventStatus,
  recordTrackedSales,
  recordWebhookEvent
} from '../repositories/integrationsRepository.js'
import {
  enqueueMarketplaceSaleForPrinting,
  normalizeMarketplaceOrder
} from '../services/marketplaceQueue.js'
import {
  exchangeMarketplaceOAuthCode,
  fetchMarketplaceOrderDetails,
  marketplaceAuthorizationUrl,
  readMarketplaceOAuthState,
  verifyShopeePushSignature
} from '../services/marketplaceOfficial.js'

const safeNormalizeOrFetch = async (integration, platform, externalOrderId, payload) => {
  try {
    if (externalOrderId) {
      return await fetchMarketplaceOrderDetails(integration, externalOrderId)
    }
  } catch {}

  return normalizeMarketplaceOrder(platform, payload)
}

const recordAndQueueMarketplaceSale = async (integration, sale, externalOrderId) => {
  const trackedSales = await recordTrackedSales(integration, { ...sale, externalOrderId })
  const items = Array.isArray(sale.items) && sale.items.length ? sale.items : [sale]
  for (const [index, trackedSale] of trackedSales.entries()) {
    await enqueueMarketplaceSaleForPrinting(integration, {
      ...sale,
      ...(items[index] || {}),
      id: trackedSale?.id,
      externalOrderId,
      requiresReview: Boolean(items[index]?.requiresReview || sale.requiresReview),
      reviewReason: items[index]?.reviewReason || sale.reviewReason || ''
    })
  }
  return trackedSales
}

const ignored = (res) => sendJson(res, 200, { message: 'Conta ignorada ou nao integrada.' })
const syncErrorMessage = (error) => ['Token do Mercado Livre', 'Token do Shopee', 'Token da Amazon'].some((prefix) => String(error?.message || '').includes(prefix))
  ? error.message
  : 'Falha ao consultar a API do marketplace. Reconecte a conta se o erro persistir.'

export const handleIntegrationsList = async (req, res) =>
  sendJson(res, 200, await listMarketplaceIntegrations(await getTenantId(req)))

export const handleIntegrationsOverview = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })

  const [marketplaces, agents] = await Promise.all([
    listMarketplaceIntegrations(user.tenantId),
    tenantQuery(user.tenantId, `
      select id, name, machine_name, platform, status, last_seen_at, runtime_health
        from agents
       where tenant_id = $1
       order by created_at desc
    `, [user.tenantId])
  ])

  return sendJson(res, 200, {
    marketplaces,
    agents: agents.rows.map((agent) => ({
      id: String(agent.id), name: agent.name || agent.machine_name,
      machineName: agent.machine_name, platform: agent.platform,
      status: agent.status, lastSeenAt: agent.last_seen_at,
      runtimeHealth: agent.runtime_health || null
    })),
    email: {
      provider: 'Resend',
      status: env.resendApiKey && env.emailFrom && env.appPublicUrl ? 'connected' : 'not_configured'
    }
  })
}

export const handleIntegrationCreate = async (req, res) => {
  const payload = await readJsonBody(req)
  const integration = await createMarketplaceIntegration(await getTenantId(req), payload)
  return sendJson(res, 201, integration)
}

export const handleMarketplaceOAuthStart = async (req, res, platform) => {
  const tenantId = await getTenantId(req)
  return sendJson(res, 200, {
    url: await marketplaceAuthorizationUrl({
      tenantId,
      platform
    })
  })
}

export const handleMarketplaceIntegrationDisconnect = async (req, res, integrationId) => {
  const disconnected = await disconnectMarketplaceIntegration(await getTenantId(req), integrationId)
  if (!disconnected) return sendJson(res, 404, { error: 'Integracao nao encontrada.' })
  return sendJson(res, 200, { status: 'disconnected' })
}

export const handleMarketplaceOAuthCallback = async (req, res, url) => {
  const code = String(url.searchParams.get('code') || url.searchParams.get('spapi_oauth_code') || '')
  const state = readMarketplaceOAuthState(url.searchParams.get('state') || '')
  if (!code) return sendJson(res, 400, { error: 'Codigo OAuth nao informado.' })

  const attempt = await consumeMarketplaceOAuthAttempt(state.tenantId, state.platform, state.attemptId)

  const token = await exchangeMarketplaceOAuthCode({
    platform: state.platform,
    code,
    codeVerifier: attempt.codeVerifier,
    shopId: url.searchParams.get('shop_id') || '',
    mainAccountId: url.searchParams.get('main_account_id') || '',
    sellerId: url.searchParams.get('selling_partner_id') || ''
  })

  const marketplaceName = state.platform === 'mercado_livre' ? 'Mercado Livre' : state.platform === 'shopee' ? 'Shopee' : state.platform === 'amazon' ? 'Amazon' : state.platform
  const accountIds = token.shopIds?.length ? token.shopIds : [token.accountExternalId || `${state.platform}-${state.tenantId}`]
  for (const accountExternalId of accountIds) {
    await createMarketplaceIntegration(state.tenantId, {
      platform: state.platform,
      marketplaceName,
      connectionName: marketplaceName,
      accountExternalId,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      tokenExpiresAt: token.tokenExpiresAt,
      scopes: token.scopes
    })
  }

  if (env.appPublicUrl) {
    const redirect = new URL('/marketplaces', env.appPublicUrl)
    redirect.searchParams.set('oauth', 'connected')
    redirect.searchParams.set('platform', state.platform)
    res.writeHead(302, { Location: redirect.toString() })
    return res.end()
  }

  return sendJson(res, 200, { status: 'connected', platform: state.platform })
}

export const handleMarketplaceOrderSync = async (req, res, integrationId) => {
  const tenantId = await getTenantId(req)
  const payload = await readJsonBody(req)
  const externalOrderId = String(payload.externalOrderId || '').trim()
  if (!externalOrderId) return sendJson(res, 400, { error: 'ID externo do pedido nao informado.' })

  const integration = await findIntegrationById(tenantId, integrationId)
  if (!integration) return sendJson(res, 404, { error: 'Integracao nao encontrada.' })

  let sale
  try {
    sale = await fetchMarketplaceOrderDetails(integration, externalOrderId)
  } catch (error) {
    await markMarketplaceIntegrationSync(tenantId, integration.id, { status: 'error', lastError: syncErrorMessage(error) })
    return sendJson(res, 502, { error: 'Nao foi possivel consultar o pedido no marketplace. Verifique a conexao da conta.' })
  }
  const trackedSales = await recordAndQueueMarketplaceSale(integration, {
    platform: integration.platform,
    externalOrderId,
    ...sale
  })
  await markMarketplaceIntegrationSync(tenantId, integration.id)

  return sendJson(res, 200, { status: 'synced', trackedSaleIds: trackedSales.map((row) => String(row.id)) })
}

export const handleMercadoLivreWebhook = async (req, res) => {
  const payload = await readJsonBody(req)
  const externalAccountId = String(payload.user_id || '')
  if (!externalAccountId) return sendJson(res, 400, { error: 'ID externo do vendedor nao informado.' })

  const integration = await findIntegrationByExternalAccount('mercado_livre', externalAccountId)
  if (!integration) return ignored(res)

  const resource = String(payload.resource || '')
  const externalOrderId = resource.split('/').filter(Boolean).pop() || String(payload.order_id || '')
  const webhookReceipt = await recordWebhookEvent(integration, {
    platform: 'mercado_livre',
    eventType: payload.topic || 'webhook',
    externalOrderId,
    payload
  })
  if (!webhookReceipt.inserted) return sendJson(res, 200, { status: 'duplicate' })

  if (externalOrderId && ['orders', 'orders_v2', 'merchant_orders'].includes(String(payload.topic))) {
    let sale
    try {
      // A notificacao e apenas um gatilho. Dados de pedido sempre vem da API oficial.
      sale = await fetchMarketplaceOrderDetails(integration, externalOrderId)
    } catch (error) {
      await markMarketplaceIntegrationSync(integration.tenant_id, integration.id, { status: 'error', lastError: syncErrorMessage(error) })
      return sendJson(res, 200, { status: 'received', sync: 'pending' })
    }
    await recordAndQueueMarketplaceSale(integration, {
      platform: 'mercado_livre',
      externalOrderId,
      ...sale
    })
    await markMarketplaceIntegrationSync(integration.tenant_id, integration.id)
  }

  return sendJson(res, 200, { status: 'success' })
}

export const handleShopeeWebhook = async (req, res) => {
  const rawBody = await readRawBody(req)
  if (!verifyShopeePushSignature(req, rawBody)) {
    res.writeHead(401)
    return res.end()
  }

  let payload
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch {
    res.writeHead(400)
    return res.end()
  }
  const externalAccountId = String(payload.shop_id || '')
  if (!externalAccountId) {
    res.writeHead(204)
    return res.end()
  }

  const integration = await findIntegrationByExternalAccount('shopee', externalAccountId)
  if (!integration) {
    res.writeHead(204)
    return res.end()
  }

  const data = payload.data || {}
  const eventType = String(payload.code || 'webhook')
  const externalOrderId = String(data.ordersn || data.order_sn || payload.ordersn || payload.order_sn || '')
  const webhookReceipt = await claimMarketplaceWebhookEvent(integration, {
    platform: 'shopee',
    eventType,
    externalOrderId,
    payload
  })
  if (!webhookReceipt.claimed) {
    if (webhookReceipt.status === 'processing') {
      res.writeHead(503)
      return res.end()
    }
    res.writeHead(204)
    return res.end()
  }

  try {
    if (eventType === '2') {
      await disconnectMarketplaceIntegration(integration.tenant_id, integration.id)
    } else if (eventType === '3' && externalOrderId) {
      const sale = await fetchMarketplaceOrderDetails(integration, externalOrderId)
      await recordAndQueueMarketplaceSale(integration, {
        platform: 'shopee',
        externalOrderId,
        ...sale
      })
      await markMarketplaceIntegrationSync(integration.tenant_id, integration.id)
    }
    await markMarketplaceWebhookEventStatus(integration, webhookReceipt.id, 'processed')
    res.writeHead(204)
    return res.end()
  } catch (error) {
    await markMarketplaceWebhookEventStatus(integration, webhookReceipt.id, 'error')
    await markMarketplaceIntegrationSync(integration.tenant_id, integration.id, {
      status: 'error',
      lastError: syncErrorMessage(error)
    })
    res.writeHead(503)
    return res.end()
  }
}

export const handleAmazonWebhook = async (req, res) => {
  if (!verifyWebhookSecret(req)) return sendJson(res, 401, { error: 'Webhook nao autorizado.' })

  const payload = await readJsonBody(req)
  const externalAccountId = String(payload.sellerId || payload.seller_id || payload.merchantId || '')
  if (!externalAccountId) return sendJson(res, 400, { error: 'Seller ID nao informado.' })

  const integration = await findIntegrationByExternalAccount('amazon', externalAccountId)
  if (!integration) return ignored(res)

  const externalOrderId = String(payload.amazonOrderId || payload.orderId || payload.order_id || '')
  const webhookReceipt = await recordWebhookEvent(integration, {
    platform: 'amazon',
    eventType: payload.notificationType || 'webhook',
    externalOrderId,
    payload
  })
  if (!webhookReceipt.inserted) return sendJson(res, 200, { message: 'duplicate' })

  if (externalOrderId) {
    const sale = await safeNormalizeOrFetch(integration, 'amazon', externalOrderId, payload)
    await recordAndQueueMarketplaceSale(integration, {
      platform: 'amazon',
      externalOrderId,
      ...sale
    })
  }

  return sendJson(res, 200, { message: 'success' })
}
