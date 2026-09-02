import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'
import { decryptField } from '../security/crypto.js'
import { normalizeMarketplaceOrder } from './marketplaceQueue.js'

const text = (value) => String(value || '').trim()
const jsonFetch = async (url, options = {}) => {
  const response = await fetch(url, options)
  const body = await response.text()
  const data = body ? JSON.parse(body) : {}
  if (!response.ok) {
    throw new Error(data.message || data.error_description || data.error || `Marketplace retornou HTTP ${response.status}`)
  }
  return data
}

export const createMarketplaceOAuthState = (tenantId, platform) =>
  {
    const payload = Buffer.from(JSON.stringify({
    tenantId,
    platform,
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

export const marketplaceAuthorizationUrl = ({ tenantId, platform }) => {
  const state = createMarketplaceOAuthState(tenantId, platform)

  if (platform === 'mercado_livre') {
    if (!env.mercadoLivreClientId || !redirectUriFor(platform)) {
      throw new Error('OAuth Mercado Livre nao configurado no servidor.')
    }

    const url = new URL('https://auth.mercadolivre.com.br/authorization')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', env.mercadoLivreClientId)
    url.searchParams.set('redirect_uri', redirectUriFor(platform))
    url.searchParams.set('state', state)
    return url.toString()
  }

  if (platform === 'shopee') {
    if (!env.shopeePartnerId || !env.shopeePartnerKey || !redirectUriFor(platform)) {
      throw new Error('OAuth Shopee nao configurado no servidor.')
    }

    const timestamp = Math.floor(Date.now() / 1000)
    const path = '/api/v2/shop/auth_partner'
    const base = `${env.shopeePartnerId}${path}${timestamp}`
    const sign = createHmac('sha256', env.shopeePartnerKey).update(base).digest('hex')
    const url = new URL(`https://partner.shopeemobile.com${path}`)
    url.searchParams.set('partner_id', env.shopeePartnerId)
    url.searchParams.set('timestamp', String(timestamp))
    url.searchParams.set('sign', sign)
    url.searchParams.set('redirect', redirectUriFor(platform))
    url.searchParams.set('state', state)
    return url.toString()
  }

  if (platform === 'amazon') {
    if (!env.amazonLwaClientId || !redirectUriFor(platform)) {
      throw new Error('OAuth Amazon nao configurado no servidor.')
    }

    const url = new URL('https://sellercentral.amazon.com/apps/authorize/consent')
    url.searchParams.set('application_id', env.amazonLwaClientId)
    url.searchParams.set('redirect_uri', redirectUriFor(platform))
    url.searchParams.set('state', state)
    return url.toString()
  }

  throw new Error('Marketplace nao suportado para OAuth.')
}

export const exchangeMarketplaceOAuthCode = async ({ platform, code }) => {
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

    const timestamp = Math.floor(Date.now() / 1000)
    const path = '/api/v2/auth/token/get'
    const base = `${env.shopeePartnerId}${path}${timestamp}`
    const sign = createHmac('sha256', env.shopeePartnerKey).update(base).digest('hex')
    const url = new URL(`https://partner.shopeemobile.com${path}`)
    url.searchParams.set('partner_id', env.shopeePartnerId)
    url.searchParams.set('timestamp', String(timestamp))
    url.searchParams.set('sign', sign)

    const token = await jsonFetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, partner_id: Number(env.shopeePartnerId) })
    })

    return {
      platform,
      accountExternalId: String(token.shop_id || token.merchant_id || ''),
      accessToken: token.access_token || '',
      refreshToken: token.refresh_token || '',
      tokenExpiresAt: token.expire_in ? new Date(Date.now() + Number(token.expire_in) * 1000).toISOString() : '',
      scopes: ''
    }
  }

  if (platform === 'amazon') {
    if (!env.amazonLwaClientId || !env.amazonLwaClientSecret) {
      throw new Error('OAuth Amazon nao configurado no servidor.')
    }

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
      accountExternalId: '',
      accessToken: token.access_token || '',
      refreshToken: token.refresh_token || '',
      tokenExpiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : '',
      scopes: ''
    }
  }

  throw new Error('Marketplace nao suportado para OAuth.')
}

export const fetchMarketplaceOrderDetails = async (integration, externalOrderId) => {
  const platform = text(integration?.platform)
  const accessToken = decryptField(integration?.access_token)
  if (!accessToken) throw new Error('Integracao sem access token valido.')

  if (platform === 'mercado_livre') {
    const order = await jsonFetch(`https://api.mercadolibre.com/orders/${encodeURIComponent(externalOrderId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    return normalizeMarketplaceOrder('mercado_livre', order)
  }

  if (platform === 'shopee') {
    throw new Error('Busca oficial Shopee preparada, mas precisa validar parametros de shop_id e assinatura com conta real.')
  }

  if (platform === 'amazon') {
    throw new Error('Amazon SP-API precisa de assinatura AWS SigV4 alem do LWA antes da busca real de pedidos.')
  }

  throw new Error('Marketplace nao suportado para busca oficial.')
}
