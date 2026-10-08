import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'
import { decryptField } from '../security/crypto.js'
import { normalizeMarketplaceOrder } from './marketplaceQueue.js'
import {
  createMarketplaceOAuthAttempt,
  findIntegrationById,
  updateMarketplaceIntegrationTokens
} from '../repositories/integrationsRepository.js'

const text = (value) => String(value || '').trim()
const number = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const optionalNumber = (...values) => {
  const value = values.find((item) => item !== undefined && item !== null && item !== '')
  return value === undefined ? null : number(value)
}
const shopeeId = (value, label = 'Shop ID') => {
  const clean = text(value)
  const numeric = Number(clean)
  if (!/^\d+$/.test(clean) || !Number.isSafeInteger(numeric)) {
    throw new Error(`${label} Shopee invalido.`)
  }
  return numeric
}
const jsonFetch = async (url, options = {}) => {
  const response = await fetch(url, options)
  const body = await response.text()
  const data = body ? JSON.parse(body) : {}
  if (!response.ok) {
    const error = new Error(data.message || data.error_description || data.error || `Marketplace retornou HTTP ${response.status}`)
    error.status = response.status
    error.code = data.error || ''
    throw error
  }
  return data
}

const shopeeJsonFetch = async (url, options = {}) => {
  const data = await jsonFetch(url, options)
  if (text(data.error)) {
    const error = new Error(data.message || `Shopee retornou erro ${data.error}.`)
    error.code = data.error
    throw error
  }
  return data
}

const amazonJsonFetch = async ({ path, accessToken, query = {} }) => {
  const url = new URL(path, `${env.amazonRegionEndpoint}/`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
  }
  return jsonFetch(url.toString(), {
    headers: {
      'x-amz-access-token': accessToken,
      'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
      'user-agent': 'Filamind/1.0.0 (Language=Node.js)'
    }
  })
}

const shopeeApiRequest = async ({ path, method = 'POST', accessToken = '', shopId = '', body, query = {} }) => {
  if (!env.shopeePartnerId || !env.shopeePartnerKey) {
    throw new Error('OAuth Shopee nao configurado no servidor.')
  }
  const timestamp = Math.floor(Date.now() / 1000)
  const base = `${env.shopeePartnerId}${path}${timestamp}${accessToken}${shopId}`
  const sign = createHmac('sha256', env.shopeePartnerKey).update(base).digest('hex')
  const url = new URL(path, `${env.shopeeApiBaseUrl}/`)
  url.searchParams.set('partner_id', env.shopeePartnerId)
  url.searchParams.set('timestamp', String(timestamp))
  url.searchParams.set('sign', sign)
  if (accessToken) url.searchParams.set('access_token', accessToken)
  if (shopId) url.searchParams.set('shop_id', shopId)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
  }
  return shopeeJsonFetch(url.toString(), {
    method,
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  })
}

const shopeeCallbackUrl = (req) => {
  if (text(env.shopeeWebhookUrl)) return text(env.shopeeWebhookUrl)
  const forwardedHost = text(req?.headers?.['x-forwarded-host']).split(',')[0]
  const host = forwardedHost || text(req?.headers?.host)
  const forwardedProtocol = text(req?.headers?.['x-forwarded-proto']).split(',')[0]
  const protocol = forwardedProtocol || (req?.socket?.encrypted ? 'https' : 'http')
  return host ? `${protocol}://${host}/webhooks/shopee` : ''
}

export const verifyShopeePushSignature = (req, rawBody) => {
  if (!env.shopeePartnerKey || !Buffer.isBuffer(rawBody)) return false
  const callbackUrl = shopeeCallbackUrl(req)
  const receivedHeader = req?.headers?.authorization
  const received = Buffer.from(Array.isArray(receivedHeader) ? receivedHeader[0] || '' : receivedHeader || '')
  if (!callbackUrl || !received.length) return false
  const expected = createHmac('sha256', env.shopeePartnerKey)
    .update(`${callbackUrl}|${rawBody.toString('utf8')}`)
    .digest('hex')
  const expectedBytes = Buffer.from(expected)
  return received.length === expectedBytes.length && timingSafeEqual(received, expectedBytes)
}

const optionalJsonFetch = async (url, options = {}) => {
  try {
    return await jsonFetch(url, options)
  } catch {
    return null
  }
}

const shipmentSellerCost = (shipment) => {
  const candidates = [
    shipment?.senders?.[0]?.cost,
    shipment?.seller?.cost,
    shipment?.costs?.seller?.cost,
    shipment?.costs?.senders?.[0]?.cost,
    shipment?.shipping_option?.cost
  ]
  return candidates.find((value) => Number.isFinite(Number(value)))
}

export const createMarketplaceOAuthState = (tenantId, platform, attemptId = '') =>
  {
    const payload = Buffer.from(JSON.stringify({
    tenantId,
    platform,
    attemptId,
    nonce: randomBytes(16).toString('base64url'),
    createdAt: Date.now()
    })).toString('base64url')
    const signature = createHmac('sha256', env.authSecret).update(payload).digest('base64url')
    return `${payload}.${signature}`
  }

export const readMarketplaceOAuthState = (state) => {
  try {
    const [payload, signature] = String(state || '').split('.')
    const expected = createHmac('sha256', env.authSecret).update(payload).digest('base64url')
    const received = Buffer.from(signature || '')
    const wanted = Buffer.from(expected)
    if (!signature || received.length !== wanted.length || !timingSafeEqual(received, wanted)) {
      throw new Error('Assinatura OAuth invalida.')
    }

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (Date.now() - Number(data.createdAt || 0) > 15 * 60 * 1000) {
      throw new Error('Estado OAuth expirado.')
    }
    return data
  } catch {
    throw new Error('Estado OAuth invalido.')
  }
}

const redirectUriFor = (platform) => {
  if (platform === 'mercado_livre') return env.mercadoLivreRedirectUri
  if (platform === 'shopee') return env.shopeeRedirectUri
  if (platform === 'amazon') return env.amazonRedirectUri
  return ''
}

const pkceChallenge = (verifier) =>
  createHash('sha256').update(verifier).digest('base64url')

export const marketplaceAuthorizationUrl = async ({ tenantId, platform }) => {

  if (platform === 'mercado_livre') {
    if (!env.mercadoLivreClientId || !redirectUriFor(platform)) {
      throw new Error('OAuth Mercado Livre nao configurado no servidor.')
    }

    const codeVerifier = randomBytes(48).toString('base64url')
    const attempt = await createMarketplaceOAuthAttempt(tenantId, platform, codeVerifier)
    const state = createMarketplaceOAuthState(tenantId, platform, attempt.id)

    const url = new URL('https://auth.mercadolivre.com.br/authorization')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', env.mercadoLivreClientId)
    url.searchParams.set('redirect_uri', redirectUriFor(platform))
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', pkceChallenge(codeVerifier))
    url.searchParams.set('code_challenge_method', 'S256')
    return url.toString()
  }

  if (platform === 'shopee') {
    if (!env.shopeePartnerId || !env.shopeePartnerKey || !redirectUriFor(platform)) {
      throw new Error('OAuth Shopee nao configurado no servidor.')
    }

    const attempt = await createMarketplaceOAuthAttempt(tenantId, platform)
    const state = createMarketplaceOAuthState(tenantId, platform, attempt.id)

    const url = new URL('https://open.shopee.com.br/auth')
    url.searchParams.set('partner_id', env.shopeePartnerId)
    url.searchParams.set('auth_type', 'seller')
    url.searchParams.set('redirect_uri', redirectUriFor(platform))
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', state)
    return url.toString()
  }

  if (platform === 'amazon') {
    if (!env.amazonSpApiApplicationId || !redirectUriFor(platform)) {
      throw new Error('OAuth Amazon nao configurado no servidor.')
    }

    const attempt = await createMarketplaceOAuthAttempt(tenantId, platform)
    const state = createMarketplaceOAuthState(tenantId, platform, attempt.id)

    const url = new URL('https://sellercentral.amazon.com.br/apps/authorize/consent')
    url.searchParams.set('application_id', env.amazonSpApiApplicationId)
    url.searchParams.set('state', state)
    return url.toString()
  }

  throw new Error('Marketplace nao suportado para OAuth.')
}

export const exchangeMarketplaceOAuthCode = async ({ platform, code, codeVerifier = '', shopId = '', mainAccountId = '', sellerId = '' }) => {
  if (platform === 'mercado_livre') {
    if (!env.mercadoLivreClientId || !env.mercadoLivreClientSecret || !redirectUriFor(platform)) {
      throw new Error('OAuth Mercado Livre nao configurado no servidor.')
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.mercadoLivreClientId,
      client_secret: env.mercadoLivreClientSecret,
      code,
      redirect_uri: redirectUriFor(platform)
    })
    if (codeVerifier) body.set('code_verifier', codeVerifier)

    const token = await jsonFetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })

    return {
      platform,
      accountExternalId: String(token.user_id || ''),
      accessToken: token.access_token || '',
      refreshToken: token.refresh_token || '',
      tokenExpiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : '',
      scopes: token.scope || ''
    }
  }

  if (platform === 'shopee') {
    if (!env.shopeePartnerId || !env.shopeePartnerKey) {
      throw new Error('OAuth Shopee nao configurado no servidor.')
    }

    const path = '/api/v2/auth/token/get'
    const authorizedShopId = text(shopId)
    const authorizedMainAccountId = text(mainAccountId)
    if (Boolean(authorizedShopId) === Boolean(authorizedMainAccountId)) {
      throw new Error('A Shopee nao retornou um shop_id ou main_account_id valido.')
    }
    const account = authorizedShopId
      ? { shop_id: shopeeId(authorizedShopId) }
      : { main_account_id: shopeeId(authorizedMainAccountId, 'Main account ID') }
    const token = await shopeeApiRequest({
      path,
      body: { code, partner_id: shopeeId(env.shopeePartnerId, 'Partner ID'), ...account }
    })
    const shopIds = authorizedShopId
      ? [authorizedShopId]
      : Array.isArray(token.shop_id_list) ? token.shop_id_list.map(String) : []
    if (!token.access_token || !token.refresh_token || !shopIds.length) {
      throw new Error('A Shopee nao retornou tokens e lojas autorizadas.')
    }

    return {
      platform,
      accountExternalId: shopIds[0],
      shopIds,
      accessToken: token.access_token || '',
      refreshToken: token.refresh_token || '',
      tokenExpiresAt: token.expire_in ? new Date(Date.now() + Number(token.expire_in) * 1000).toISOString() : '',
      scopes: ''
    }
  }

  if (platform === 'amazon') {
    if (!env.amazonLwaClientId || !env.amazonLwaClientSecret || !redirectUriFor(platform)) {
      throw new Error('OAuth Amazon nao configurado no servidor.')
    }
    if (!text(sellerId)) throw new Error('A Amazon nao retornou um selling_partner_id valido.')

    const token = await jsonFetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: env.amazonLwaClientId,
        client_secret: env.amazonLwaClientSecret,
        redirect_uri: redirectUriFor(platform)
      })
    })

    return {
      platform,
      accountExternalId: text(sellerId),
      accessToken: token.access_token || '',
      refreshToken: token.refresh_token || '',
      tokenExpiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : '',
      scopes: ''
    }
  }

  throw new Error('Marketplace nao suportado para OAuth.')
}

const tokenExpiresSoon = (value) => {
  const expiresAt = new Date(value || '').getTime()
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000
}

const refreshMercadoLivreToken = async (integration) => {
  const refreshToken = decryptField(integration?.refresh_token)
  if (!refreshToken) throw new Error('Integracao Mercado Livre sem refresh token. Conecte a conta novamente.')
  if (!env.mercadoLivreClientId || !env.mercadoLivreClientSecret) {
    throw new Error('OAuth Mercado Livre nao configurado no servidor.')
  }
  let token
  try {
    token = await jsonFetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: env.mercadoLivreClientId,
        client_secret: env.mercadoLivreClientSecret,
        refresh_token: refreshToken
      })
    })
  } catch (error) {
    throw new Error('Token do Mercado Livre expirado ou revogado. Reconecte esta conta.')
  }
  const refreshed = {
    accessToken: token.access_token || '',
    refreshToken: token.refresh_token || refreshToken,
    tokenExpiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : ''
  }
  if (!refreshed.accessToken) throw new Error('Mercado Livre nao retornou um access token renovado.')
  await updateMarketplaceIntegrationTokens(integration.tenant_id, integration.id, refreshed)
  return refreshed.accessToken
}

const shopeeRefreshes = new Map()
const amazonRefreshes = new Map()

const refreshShopeeToken = async (integration) => {
  const integrationId = String(integration?.id || '')
  if (!integrationId) throw new Error('Integracao Shopee sem identificador. Reconecte esta conta.')
  const pending = shopeeRefreshes.get(integrationId)
  if (pending) return pending

  const refresh = (async () => {
    const latest = integration.tenant_id
      ? await findIntegrationById(integration.tenant_id, integration.id)
      : null
    const current = latest || integration
    if (current.status === 'disconnected') throw new Error('Integracao Shopee desconectada. Reconecte esta conta.')
    if (!tokenExpiresSoon(current.token_expires_at)) {
      const currentAccessToken = decryptField(current.access_token)
      if (currentAccessToken) return currentAccessToken
    }

    const refreshToken = decryptField(current.refresh_token)
    const shopId = decryptField(current.account_external_id)
    if (!refreshToken || !shopId) throw new Error('Integracao Shopee sem refresh token ou shop_id. Reconecte esta conta.')
    let token
    try {
      token = await shopeeApiRequest({
        path: '/api/v2/auth/access_token/get',
        body: {
          partner_id: shopeeId(env.shopeePartnerId, 'Partner ID'),
          shop_id: shopeeId(shopId),
          refresh_token: refreshToken
        }
      })
    } catch {
      const rotated = await findIntegrationById(current.tenant_id, current.id)
      if (rotated && !tokenExpiresSoon(rotated.token_expires_at)) {
        const rotatedAccessToken = decryptField(rotated.access_token)
        if (rotatedAccessToken) return rotatedAccessToken
      }
      throw new Error('Token do Shopee expirado ou revogado. Reconecte esta conta.')
    }

    const refreshed = {
      accessToken: token.access_token || '',
      refreshToken: token.refresh_token || '',
      tokenExpiresAt: token.expire_in ? new Date(Date.now() + Number(token.expire_in) * 1000).toISOString() : ''
    }
    if (!refreshed.accessToken || !refreshed.refreshToken || !refreshed.tokenExpiresAt) {
      throw new Error('Shopee nao retornou os novos tokens necessarios. Reconecte esta conta.')
    }
    await updateMarketplaceIntegrationTokens(current.tenant_id, current.id, refreshed)
    return refreshed.accessToken
  })()

  shopeeRefreshes.set(integrationId, refresh)
  try {
    return await refresh
  } finally {
    if (shopeeRefreshes.get(integrationId) === refresh) shopeeRefreshes.delete(integrationId)
  }
}

const refreshAmazonToken = async (integration) => {
  const integrationId = String(integration?.id || '')
  if (!integrationId) throw new Error('Integracao Amazon sem identificador. Reconecte esta conta.')
  const pending = amazonRefreshes.get(integrationId)
  if (pending) return pending

  const refresh = (async () => {
    const latest = integration.tenant_id
      ? await findIntegrationById(integration.tenant_id, integration.id)
      : null
    const current = latest || integration
    if (current.status === 'disconnected') throw new Error('Integracao Amazon desconectada. Reconecte esta conta.')
    if (!tokenExpiresSoon(current.token_expires_at)) {
      const currentAccessToken = decryptField(current.access_token)
      if (currentAccessToken) return currentAccessToken
    }

    const refreshToken = decryptField(current.refresh_token)
    if (!refreshToken) throw new Error('Integracao Amazon sem refresh token. Reconecte esta conta.')
    if (!env.amazonLwaClientId || !env.amazonLwaClientSecret) {
      throw new Error('OAuth Amazon nao configurado no servidor.')
    }

    let token
    try {
      token = await jsonFetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: env.amazonLwaClientId,
          client_secret: env.amazonLwaClientSecret
        })
      })
    } catch {
      const rotated = await findIntegrationById(current.tenant_id, current.id)
      if (rotated && !tokenExpiresSoon(rotated.token_expires_at)) {
        const rotatedAccessToken = decryptField(rotated.access_token)
        if (rotatedAccessToken) return rotatedAccessToken
      }
      throw new Error('Token da Amazon expirado ou revogado. Reconecte esta conta.')
    }

    const refreshed = {
      accessToken: token.access_token || '',
      refreshToken: token.refresh_token || refreshToken,
      tokenExpiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : ''
    }
    if (!refreshed.accessToken || !refreshed.tokenExpiresAt) {
      throw new Error('Amazon nao retornou um novo access token valido. Reconecte esta conta.')
    }
    await updateMarketplaceIntegrationTokens(current.tenant_id, current.id, refreshed)
    return refreshed.accessToken
  })()

  amazonRefreshes.set(integrationId, refresh)
  try {
    return await refresh
  } finally {
    if (amazonRefreshes.get(integrationId) === refresh) amazonRefreshes.delete(integrationId)
  }
}

const marketplaceAccessToken = async (integration) => {
  const accessToken = decryptField(integration?.access_token)
  if (integration?.platform === 'mercado_livre' && tokenExpiresSoon(integration?.token_expires_at)) {
    return refreshMercadoLivreToken(integration)
  }
  if (integration?.platform === 'shopee' && tokenExpiresSoon(integration?.token_expires_at)) {
    return refreshShopeeToken(integration)
  }
  if (integration?.platform === 'amazon' && tokenExpiresSoon(integration?.token_expires_at)) {
    return refreshAmazonToken(integration)
  }
  if (!accessToken) throw new Error('Integracao sem access token valido.')
  return accessToken
}

export const fetchMarketplaceOrderDetails = async (integration, externalOrderId) => {
  const platform = text(integration?.platform)
  const accessToken = await marketplaceAccessToken(integration)

  if (platform === 'mercado_livre') {
    let order
    try {
      order = await jsonFetch(`https://api.mercadolibre.com/orders/${encodeURIComponent(externalOrderId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
    } catch (error) {
      if (error?.status === 401) {
        throw new Error('Token do Mercado Livre expirado ou revogado. Reconecte esta conta.')
      }
      throw error
    }
    const sale = normalizeMarketplaceOrder('mercado_livre', order)
    const shippingId = sale.feeBreakdown?.shippingId
    const [shipment, shipmentCosts, discounts] = await Promise.all([
      shippingId
        ? optionalJsonFetch(`https://api.mercadolibre.com/shipments/${encodeURIComponent(shippingId)}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        })
        : null,
      shippingId
        ? optionalJsonFetch(`https://api.mercadolibre.com/shipments/${encodeURIComponent(shippingId)}/costs`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        })
        : null,
      optionalJsonFetch(`https://api.mercadolibre.com/orders/${encodeURIComponent(externalOrderId)}/discounts`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
    ])
    const sellerShipping = shipmentSellerCost(shipmentCosts) ?? shipmentSellerCost(shipment)
    const shipping = sellerShipping === undefined ? sale.shipping : Number(sellerShipping)
    return {
      ...sale,
      shipping,
      feeBreakdown: {
        ...sale.feeBreakdown,
        shipping,
        shippingSource: sellerShipping === undefined ? 'order' : shipmentCosts ? 'mercadolivre.shipments.costs' : 'mercadolivre.shipments',
        discounts: discounts || sale.feeBreakdown?.discounts || null
      }
    }
  }

  if (platform === 'shopee') {
    const shopId = decryptField(integration?.account_external_id)
    if (!shopId) throw new Error('Integracao Shopee sem shop_id. Reconecte esta conta.')
    const response = await shopeeApiRequest({
      path: '/api/v2/order/get_order_detail',
      method: 'GET',
      accessToken,
      shopId,
      query: {
        order_sn_list: externalOrderId,
        request_order_status_pending: true,
        response_optional_fields: 'item_list,total_amount,actual_shipping_fee,estimated_shipping_fee'
      }
    })
    const order = Array.isArray(response.response?.order_list)
      ? response.response.order_list.find((item) => String(item.order_sn) === String(externalOrderId))
      : null
    if (!order) throw new Error('Pedido nao encontrado na conta Shopee conectada.')

    let escrow = null
    if (String(order.order_status || '').toUpperCase() === 'COMPLETED') {
      try {
        const escrowResponse = await shopeeApiRequest({
          path: '/api/v2/payment/get_escrow_detail',
          accessToken,
          shopId,
          body: { order_sn: String(externalOrderId) }
        })
        escrow = escrowResponse.response?.order_income || null
      } catch {
        // The order status remains useful even when this app has no finance permission.
      }
    }

    const escrowItems = Array.isArray(escrow?.items) ? escrow.items : []
    const itemList = (Array.isArray(order.item_list) ? order.item_list : []).map((item) => {
      const escrowItem = (item.line_item_id
        ? escrowItems.find((candidate) => String(candidate.line_item_id || '') === String(item.line_item_id))
        : null) || escrowItems.find((candidate) =>
        (item.item_id && candidate.item_id && String(item.item_id) === String(candidate.item_id)) &&
        (!item.model_id || !candidate.model_id || String(item.model_id) === String(candidate.model_id))
      )
      const itemQuantity = Math.max(1, Number(item.model_quantity_purchased || 1))
      const escrowGross = optionalNumber(escrowItem?.discounted_price, escrowItem?.selling_price)
      const modelPrice = optionalNumber(item.model_discounted_price)
      const originalModelPrice = optionalNumber(item.model_original_price)
      const missingBundlePrice = escrowGross === null && (modelPrice === null || modelPrice <= 0)
      const gross = escrowGross !== null
        ? escrowGross
        : modelPrice !== null && modelPrice > 0
          ? modelPrice * itemQuantity
          : originalModelPrice === null ? 0 : originalModelPrice * itemQuantity
      return {
        ...item,
        ...(escrowItem ? { line_item_id: escrowItem.line_item_id, gross } : {}),
        gross,
        ...(missingBundlePrice ? {
          requiresReview: true,
          reviewReason: 'A Shopee nao informou o valor final deste item. Revise o pedido antes de produzir.'
        } : {})
      }
    })
    const sale = normalizeMarketplaceOrder('shopee', { ...order, item_list: itemList })
    const gross = number(order.total_amount, sale.gross)
    const sellerNet = escrow
      ? optionalNumber(escrow.escrow_amount_after_adjustment, escrow.escrow_amount)
      : null
    const actualShipping = escrow ? number(escrow.actual_shipping_fee) : 0
    const buyerShipping = escrow ? number(escrow.buyer_paid_shipping_fee) : 0
    const shippingRebate = escrow
      ? number(escrow.shopee_shipping_rebate) + number(escrow.shipping_fee_discount_from_3pl)
      : 0
    const shipping = Math.max(0, actualShipping - buyerShipping - shippingRebate)
    const marketplaceFee = sellerNet === null ? sale.marketplaceFee : Math.max(0, gross - sellerNet - shipping)
    return {
      ...sale,
      gross,
      shipping,
      marketplaceFee,
      net: sellerNet === null ? sale.net : sellerNet,
      feeBreakdown: {
        ...sale.feeBreakdown,
        source: 'shopee.order_detail',
        marketplaceFee,
        marketplaceFeeSource: sellerNet === null ? 'configured_estimate' : 'shopee.payment.get_escrow_detail',
        commission: escrow?.commission_fee ?? null,
        serviceFee: escrow?.service_fee ?? null,
        sellerTransactionFee: escrow?.seller_transaction_fee ?? null,
        shipping,
        shippingSource: escrow ? 'shopee.payment.get_escrow_detail' : 'unavailable',
        escrowAvailable: Boolean(escrow)
      }
    }
  }

  if (platform === 'amazon') {
    const sellerId = decryptField(integration?.account_external_id)
    if (!sellerId) throw new Error('Integracao Amazon sem selling_partner_id. Reconecte esta conta.')
    const order = await amazonJsonFetch({
      path: `/orders/2026-01-01/orders/${encodeURIComponent(externalOrderId)}`,
      accessToken,
      query: { includedData: 'FULFILLMENT,PROCEEDS' }
    })
    if (String(order.orderId || '') !== String(externalOrderId)) {
      throw new Error('Pedido nao encontrado na conta Amazon conectada.')
    }
    return normalizeMarketplaceOrder('amazon', order)
  }

  throw new Error('Marketplace nao suportado para busca oficial.')
}
