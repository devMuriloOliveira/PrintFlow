import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { verifyWebhookSecret } from '../security/webhook.js'
import { getTenantId } from '../config/tenant.js'
import { env } from '../config/env.js'
import { getAuthUser } from './auth.js'
import { tenantQuery } from '../db/pool.js'
import {
  createMarketplaceIntegration,
  consumeMarketplaceOAuthAttempt,
  findIntegrationById,
  findIntegrationByExternalAccount,
  listMarketplaceIntegrations,
  recordTrackedSale,
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
  readMarketplaceOAuthState
} from '../services/marketplaceOfficial.js'

const safeNormalizeOrFetch = async (integration, platform, externalOrderId, payload) => {
  try {
    if (externalOrderId) {
      return await fetchMarketplaceOrderDetails(integration, externalOrderId)
    }
  } catch {}

  return normalizeMarketplaceOrder(platform, payload)
}

const ignored = (res) => sendJson(res, 200, { message: 'Conta ignorada ou nao integrada.' })

export const handleIntegrationsList = async (req, res) =>
  sendJson(res, 200, await listMarketplaceIntegrations(await getTenantId(req)))

export const handleIntegrationsOverview = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })

  const [marketplaces, agents] = await Promise.all([
    listMarketplaceIntegrations(user.tenantId),
    tenantQuery(user.tenantId, `
      select id, name, machine_name, platform, status, last_seen_at
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
      status: agent.status, lastSeenAt: agent.last_seen_at
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

export const handleMarketplaceOAuthCallback = async (req, res, url) => {
  const code = String(url.searchParams.get('code') || '')
  const state = readMarketplaceOAuthState(url.searchParams.get('state') || '')
  if (!code) return sendJson(res, 400, { error: 'Codigo OAuth nao informado.' })

  const attempt = await consumeMarketplaceOAuthAttempt(state.tenantId, state.platform, state.attemptId)

  const token = await exchangeMarketplaceOAuthCode({
    platform: state.platform,
    code,
    codeVerifier: attempt.codeVerifier
  })

  const marketplaceName = state.platform === 'mercado_livre' ? 'Mercado Livre' : state.platform === 'shopee' ? 'Shopee' : state.platform === 'amazon' ? 'Amazon' : state.platform

  await createMarketplaceIntegration(state.tenantId, {
    platform: state.platform,
    marketplaceName,
    connectionName: marketplaceName,
    accountExternalId: token.accountExternalId || `${state.platform}-${state.tenantId}`,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    tokenExpiresAt: token.tokenExpiresAt,
    scopes: token.scopes
  })

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

  const sale = await fetchMarketplaceOrderDetails(integration, externalOrderId)
  const trackedSale = await recordTrackedSale(integration, {
    platform: integration.platform,
    externalOrderId,
    ...sale
  })

  await enqueueMarketplaceSaleForPrinting(integration, {
    ...sale,
    id: trackedSale?.id,
    externalOrderId
  })

  return sendJson(res, 200, { status: 'synced', trackedSaleId: trackedSale?.id ? String(trackedSale.id) : '' })
}

export const handleMercadoLivreWebhook = async (req, res) => {
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
    let sale
    try {
      // A notificacao e apenas um gatilho. Dados de pedido sempre vem da API oficial.
      sale = await fetchMarketplaceOrderDetails(integration, externalOrderId)
    } catch {
      return sendJson(res, 202, { status: 'received' })
    }
    const trackedSale = await recordTrackedSale(integration, {
      platform: 'mercado_livre',
      externalOrderId,
      ...sale
    })

    await enqueueMarketplaceSaleForPrinting(integration, {
      ...sale,
      id: trackedSale?.id,
      externalOrderId
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
    const sale = await safeNormalizeOrFetch(integration, 'shopee', externalOrderId, payload)
    const trackedSale = await recordTrackedSale(integration, {
      platform: 'shopee',
      externalOrderId,
      ...sale
    })

    await enqueueMarketplaceSaleForPrinting(integration, {
      ...sale,
      id: trackedSale?.id,
      externalOrderId
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
    const sale = await safeNormalizeOrFetch(integration, 'amazon', externalOrderId, payload)
    const trackedSale = await recordTrackedSale(integration, {
      platform: 'amazon',
      externalOrderId,
      ...sale
    })

    await enqueueMarketplaceSaleForPrinting(integration, {
      ...sale,
      id: trackedSale?.id,
      externalOrderId
    })
  }

  return sendJson(res, 200, { message: 'success' })
}
