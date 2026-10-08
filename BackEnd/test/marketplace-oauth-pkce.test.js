import assert from 'node:assert/strict'
import test from 'node:test'
import { createHmac } from 'node:crypto'

process.env.AUTH_SECRET = 'marketplace-pkce-test-secret-32-characters'
process.env.DATABASE_URL = ''
process.env.MERCADO_LIVRE_CLIENT_ID = 'test-client-id'
process.env.MERCADO_LIVRE_CLIENT_SECRET = 'test-client-secret'
process.env.MERCADO_LIVRE_REDIRECT_URI = 'https://example.test/oauth-callback'
process.env.SHOPEE_PARTNER_ID = '100001'
process.env.SHOPEE_PARTNER_KEY = 'shopee-test-partner-key'
process.env.SHOPEE_REDIRECT_URI = 'https://example.test/oauth-callback'
process.env.SHOPEE_API_BASE_URL = 'https://partner.shopee.test'
process.env.SHOPEE_WEBHOOK_URL = 'https://api.example.test/webhooks/shopee'
process.env.AMAZON_SP_API_APPLICATION_ID = 'amzn1.sellerapps.app.test-application'
process.env.AMAZON_LWA_CLIENT_ID = 'amzn1.application-oa2-client.test-client'
process.env.AMAZON_LWA_CLIENT_SECRET = 'amazon-test-client-secret'
process.env.AMAZON_REDIRECT_URI = 'https://example.test/oauth-callback'
process.env.AMAZON_SP_API_ENDPOINT = 'https://sellingpartnerapi-na.amazon.test'

const {
  fetchMarketplaceOrderDetails,
  exchangeMarketplaceOAuthCode,
  marketplaceAuthorizationUrl,
  readMarketplaceOAuthState,
  verifyShopeePushSignature
} = await import('../src/services/marketplaceOfficial.js')
const { handleMarketplaceOAuthCallback } = await import('../src/routes/integrations.js')
const {
  consumeMarketplaceOAuthAttempt
} = await import('../src/repositories/integrationsRepository.js')

test('OAuth Mercado Livre cria PKCE e aceita a tentativa uma unica vez', async () => {
  const url = new URL(await marketplaceAuthorizationUrl({
    tenantId: 'tenant-pkce-test',
    platform: 'mercado_livre'
  }))
  const state = readMarketplaceOAuthState(url.searchParams.get('state'))

  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.ok(url.searchParams.get('code_challenge'))
  assert.ok(state.attemptId)

  const attempt = await consumeMarketplaceOAuthAttempt(
    'tenant-pkce-test',
    'mercado_livre',
    state.attemptId
  )

  assert.ok(attempt.codeVerifier)
  await assert.rejects(
    () => consumeMarketplaceOAuthAttempt('tenant-pkce-test', 'mercado_livre', state.attemptId),
    /Tentativa OAuth invalida ou expirada/
  )
})

test('pedido Mercado Livre renova token expirado antes da consulta', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    const body = String(url).includes('/oauth/token')
      ? { access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_in: 21600 }
      : { id: 'order-123', status: 'paid', total_amount: 10, order_items: [{ quantity: 1, unit_price: 10, item: { seller_sku: 'SKU-1', title: 'Produto de teste' } }] }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) }
  }

  try {
    const sale = await fetchMarketplaceOrderDetails({
      id: '1',
      tenant_id: 'tenant-pkce-test',
      platform: 'mercado_livre',
      access_token: 'expired-access-token',
      refresh_token: 'refresh-token',
      token_expires_at: new Date(Date.now() - 60_000).toISOString()
    }, 'order-123')

    assert.equal(sale.externalOrderId, 'order-123')
    assert.equal(calls.filter((call) => call.url.includes('/oauth/token')).length, 1)
    assert.equal(calls.filter((call) => call.url.endsWith('/orders/order-123')).length, 1)
    assert.equal(calls.filter((call) => call.url.includes('/discounts')).length, 1)
    assert.match(calls[1].options.headers.Authorization, /new-access-token/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Amazon monta autorizacao com Application ID e troca codigo pelo token ligado ao vendedor', async () => {
  const url = new URL(await marketplaceAuthorizationUrl({
    tenantId: 'tenant-amazon-oauth-test',
    platform: 'amazon'
  }))
  const state = readMarketplaceOAuthState(url.searchParams.get('state'))
  assert.equal(url.origin, 'https://sellercentral.amazon.com.br')
  assert.equal(url.pathname, '/apps/authorize/consent')
  assert.equal(url.searchParams.get('application_id'), process.env.AMAZON_SP_API_APPLICATION_ID)
  assert.equal(url.searchParams.has('redirect_uri'), false)
  assert.ok(state.attemptId)

  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (requestUrl, options = {}) => {
    request = { url: String(requestUrl), options }
    return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'amazon-access', refresh_token: 'amazon-refresh', expires_in: 3600 }) }
  }

  try {
    const token = await exchangeMarketplaceOAuthCode({
      platform: 'amazon',
      code: 'single-use-amazon-code',
      sellerId: 'A3AMAZONSELLER'
    })
    const form = new URLSearchParams(request.options.body)
    assert.equal(request.url, 'https://api.amazon.com/auth/o2/token')
    assert.equal(form.get('grant_type'), 'authorization_code')
    assert.equal(form.get('code'), 'single-use-amazon-code')
    assert.equal(form.get('redirect_uri'), process.env.AMAZON_REDIRECT_URI)
    assert.equal(token.accountExternalId, 'A3AMAZONSELLER')
    assert.equal(token.accessToken, 'amazon-access')
    assert.equal(token.refreshToken, 'amazon-refresh')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('callback Amazon aceita spapi_oauth_code e selling_partner_id', async () => {
  const authorizationUrl = new URL(await marketplaceAuthorizationUrl({
    tenantId: 'tenant-amazon-callback-test',
    platform: 'amazon'
  }))
  const callbackUrl = new URL('https://example.test/api/marketplace-integrations/oauth-callback')
  callbackUrl.searchParams.set('state', authorizationUrl.searchParams.get('state'))
  callbackUrl.searchParams.set('spapi_oauth_code', 'amazon-callback-code')
  callbackUrl.searchParams.set('selling_partner_id', 'A3CALLBACKSELLER')

  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'callback-access', refresh_token: 'callback-refresh', expires_in: 3600 }) }
  }

  try {
    let statusCode = 0
    let responseBody
    const response = {
      writeHead: (status) => { statusCode = status },
      end: (body) => { responseBody = body }
    }
    await handleMarketplaceOAuthCallback({}, response, callbackUrl)
    const body = JSON.parse(responseBody.toString('utf8'))
    const form = new URLSearchParams(calls[0].options.body)
    assert.equal(statusCode, 200)
    assert.equal(body.platform, 'amazon')
    assert.equal(form.get('code'), 'amazon-callback-code')
    assert.equal(calls.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('pedido Amazon renova o LWA e consulta Orders v2026 sem assinatura SigV4', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    if (String(url) === 'https://api.amazon.com/auth/o2/token') {
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'refreshed-amazon-access', expires_in: 3600 }) }
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        orderId: 'AMZ-ORDER-1',
        createdTime: '2026-10-07T12:00:00Z',
        fulfillment: { fulfillmentStatus: 'UNSHIPPED', fulfilledBy: 'MERCHANT' },
        orderItems: [
          { orderItemId: 'line-1', quantityOrdered: 2, product: { sellerSku: 'FIL-001', title: 'Suporte Amazon', price: { unitPrice: { amount: '25.50', currencyCode: 'BRL' } } } },
          { orderItemId: 'line-2', quantityOrdered: 1, product: { sellerSku: 'FIL-002', title: 'Gancho Amazon', price: { unitPrice: { amount: '15.00', currencyCode: 'BRL' } } } }
        ]
      })
    }
  }

  try {
    const sale = await fetchMarketplaceOrderDetails({
      id: 'amazon-integration-test',
      tenant_id: 'tenant-amazon-order-test',
      platform: 'amazon',
      account_external_id: 'A3AMAZONSELLER',
      access_token: 'expired-amazon-access',
      refresh_token: 'amazon-refresh-token',
      token_expires_at: new Date(Date.now() - 60_000).toISOString()
    }, 'AMZ-ORDER-1')

    const apiCall = calls.find((call) => call.url.includes('/orders/2026-01-01/orders/'))
    const headers = apiCall.options.headers
    assert.equal(apiCall.url, 'https://sellingpartnerapi-na.amazon.test/orders/2026-01-01/orders/AMZ-ORDER-1?includedData=FULFILLMENT%2CPROCEEDS')
    assert.equal(headers['x-amz-access-token'], 'refreshed-amazon-access')
    assert.match(headers['x-amz-date'], /^\d{8}T\d{6}Z$/)
    assert.match(headers['user-agent'], /^Filamind\/\S+ \(Language=Node\.js\)$/)
    assert.equal('authorization' in headers, false)
    assert.equal(sale.externalOrderId, 'AMZ-ORDER-1')
    assert.equal(sale.status, 'paid')
    assert.equal(sale.fulfilledBy, 'MERCHANT')
    assert.equal(sale.quantity, 3)
    assert.equal(sale.gross, 66)
    assert.deepEqual(sale.items.map((item) => item.sku), ['FIL-001', 'FIL-002'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Shopee usa OAuth oficial e cria tokens para as lojas autorizadas pela conta principal', async () => {
  const url = new URL(await marketplaceAuthorizationUrl({
    tenantId: 'tenant-shopee-oauth-test',
    platform: 'shopee'
  }))
  const state = readMarketplaceOAuthState(url.searchParams.get('state'))

  assert.equal(url.origin, 'https://open.shopee.com.br')
  assert.equal(url.pathname, '/auth')
  assert.equal(url.searchParams.get('partner_id'), '100001')
  assert.equal(url.searchParams.get('auth_type'), 'seller')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.test/oauth-callback')
  assert.ok(state.attemptId)

  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (requestUrl, options = {}) => {
    calls.push({ url: String(requestUrl), options })
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        access_token: 'initial-shop-access-token',
        refresh_token: 'initial-shop-refresh-token',
        expire_in: 14400,
        shop_id_list: [12345, 67890],
        error: ''
      })
    }
  }

  try {
    const token = await exchangeMarketplaceOAuthCode({
      platform: 'shopee',
      code: 'single-use-code',
      mainAccountId: '90001'
    })
    const request = calls[0]
    const requestUrl = new URL(request.url)
    const body = JSON.parse(request.options.body)
    const expectedSign = createHmac('sha256', process.env.SHOPEE_PARTNER_KEY)
      .update(`100001/api/v2/auth/token/get${requestUrl.searchParams.get('timestamp')}`)
      .digest('hex')

    assert.equal(requestUrl.pathname, '/api/v2/auth/token/get')
    assert.equal(requestUrl.searchParams.get('sign'), expectedSign)
    assert.deepEqual(body, { code: 'single-use-code', partner_id: 100001, main_account_id: 90001 })
    assert.deepEqual(token.shopIds, ['12345', '67890'])
    assert.equal(token.accountExternalId, '12345')
    assert.equal(token.accessToken, 'initial-shop-access-token')
    assert.equal(token.refreshToken, 'initial-shop-refresh-token')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Shopee renova o refresh token de uso único e consulta os detalhes oficiais do pedido', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (requestUrl, options = {}) => {
    calls.push({ url: String(requestUrl), options })
    const data = String(requestUrl).includes('/api/v2/auth/access_token/get')
      ? {
          access_token: 'renewed-shop-access-token',
          refresh_token: 'rotated-shop-refresh-token',
          expire_in: 14400,
          error: ''
        }
      : {
          error: '',
          response: {
            order_list: [{
              order_sn: '250101SHOPEE1',
              order_status: 'READY_TO_SHIP',
              total_amount: 60,
              create_time: 1735689600,
              item_list: [{
                item_id: 123,
                model_id: 456,
                item_sku: 'PARENT-SKU',
                model_sku: 'VARIANT-SKU',
                item_name: 'Produto de teste',
                model_name: 'Azul',
                model_quantity_purchased: 2,
                model_discounted_price: 25
              }]
            }]
          }
        }
    return { ok: true, status: 200, text: async () => JSON.stringify(data) }
  }

  try {
    const integration = {
      id: 'shopee-integration-test',
      tenant_id: 'tenant-shopee-oauth-test',
      platform: 'shopee',
      account_external_id: '12345',
      access_token: 'expired-shop-access-token',
      refresh_token: 'single-use-shop-refresh-token',
      token_expires_at: new Date(Date.now() - 60_000).toISOString()
    }
    const sale = await fetchMarketplaceOrderDetails(integration, '250101SHOPEE1')

    assert.equal(sale.externalOrderId, '250101SHOPEE1')
    assert.equal(sale.status, 'paid')
    assert.equal(sale.gross, 60)
    assert.equal(sale.sku, 'VARIANT-SKU')
    assert.equal(sale.items[0].quantity, 2)
    assert.equal(sale.items[0].gross, 50)
    assert.equal(calls.length, 2)

    const refreshCall = calls.find((call) => call.url.includes('/api/v2/auth/access_token/get'))
    const refreshUrl = new URL(refreshCall.url)
    const refreshBody = JSON.parse(refreshCall.options.body)
    const expectedSign = createHmac('sha256', process.env.SHOPEE_PARTNER_KEY)
      .update(`100001/api/v2/auth/access_token/get${refreshUrl.searchParams.get('timestamp')}`)
      .digest('hex')
    assert.equal(refreshUrl.searchParams.get('sign'), expectedSign)
    assert.deepEqual(refreshBody, {
      partner_id: 100001,
      shop_id: 12345,
      refresh_token: 'single-use-shop-refresh-token'
    })

    const orderCall = calls.find((call) => call.url.includes('/api/v2/order/get_order_detail'))
    const orderUrl = new URL(orderCall.url)
    const expectedOrderSign = createHmac('sha256', process.env.SHOPEE_PARTNER_KEY)
      .update(`100001/api/v2/order/get_order_detail${orderUrl.searchParams.get('timestamp')}renewed-shop-access-token12345`)
      .digest('hex')
    assert.equal(orderUrl.searchParams.get('sign'), expectedOrderSign)
    assert.equal(orderUrl.searchParams.get('order_sn_list'), '250101SHOPEE1')
    assert.equal(orderUrl.searchParams.get('request_order_status_pending'), 'true')
    assert.equal(orderUrl.searchParams.get('response_optional_fields'), 'item_list,total_amount,actual_shipping_fee,estimated_shipping_fee')
    assert.equal(orderUrl.searchParams.get('access_token'), 'renewed-shop-access-token')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Shopee sinaliza para revisao itens de bundle sem preco final', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      error: '',
      response: {
        order_list: [{
          order_sn: '250101SHOPEEBUNDLE',
          order_status: 'READY_TO_SHIP',
          total_amount: 80,
          item_list: [{
            item_id: 123,
            model_id: 456,
            line_item_id: 789,
            model_sku: 'BUNDLE-SKU',
            model_quantity_purchased: 1,
            model_discounted_price: 0,
            model_original_price: 80
          }]
        }]
      }
    })
  })

  try {
    const sale = await fetchMarketplaceOrderDetails({
      id: 'shopee-bundle-test',
      tenant_id: 'tenant-shopee-oauth-test',
      platform: 'shopee',
      account_external_id: '12345',
      access_token: 'valid-shop-access-token',
      refresh_token: 'valid-shop-refresh-token',
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    }, '250101SHOPEEBUNDLE')

    assert.equal(sale.items[0].gross, 80)
    assert.equal(sale.items[0].requiresReview, true)
    assert.match(sale.items[0].reviewReason, /valor final/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Shopee concilia valores de escrow pelo identificador de cada linha do pedido', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (requestUrl, options = {}) => {
    calls.push({ url: String(requestUrl), options })
    const data = String(requestUrl).includes('/api/v2/payment/get_escrow_detail')
      ? {
          error: '',
          response: {
            order_income: {
              escrow_amount_after_adjustment: 80,
              actual_shipping_fee: 12,
              buyer_paid_shipping_fee: 5,
              shopee_shipping_rebate: 2,
              shipping_fee_discount_from_3pl: 1,
              items: [
                { item_id: 123, model_id: 456, line_item_id: 789, discounted_price: 40 },
                { item_id: 123, model_id: 456, line_item_id: 790, discounted_price: 60 }
              ]
            }
          }
        }
      : {
          error: '',
          response: {
            order_list: [{
              order_sn: '250101SHOPEECOMPLETED',
              order_status: 'COMPLETED',
              total_amount: 110,
              item_list: [
                { item_id: 123, model_id: 456, line_item_id: 789, model_sku: 'SKU-A', model_quantity_purchased: 1, model_discounted_price: 0 },
                { item_id: 123, model_id: 456, line_item_id: 790, model_sku: 'SKU-A', model_quantity_purchased: 1, model_discounted_price: 0 }
              ]
            }]
          }
        }
    return { ok: true, status: 200, text: async () => JSON.stringify(data) }
  }

  try {
    const sale = await fetchMarketplaceOrderDetails({
      id: 'shopee-escrow-test',
      tenant_id: 'tenant-shopee-oauth-test',
      platform: 'shopee',
      account_external_id: '12345',
      access_token: 'valid-shop-access-token',
      refresh_token: 'valid-shop-refresh-token',
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    }, '250101SHOPEECOMPLETED')

    assert.equal(calls.length, 2)
    assert.equal(sale.items[0].gross, 40)
    assert.equal(sale.items[1].gross, 60)
    assert.equal(sale.shipping, 4)
    assert.equal(sale.marketplaceFee, 26)
    assert.equal(sale.net, 80)
    assert.equal(sale.feeBreakdown.escrowAvailable, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Shopee valida a assinatura do push sobre a URL pública e o corpo original', () => {
  const body = Buffer.from('{"shop_id":12345,"code":3,"data":{"ordersn":"250101SHOPEE1"}}')
  const callbackUrl = process.env.SHOPEE_WEBHOOK_URL
  const authorization = createHmac('sha256', process.env.SHOPEE_PARTNER_KEY)
    .update(`${callbackUrl}|${body.toString('utf8')}`)
    .digest('hex')

  assert.equal(verifyShopeePushSignature({ headers: { authorization } }, body), true)
  assert.equal(verifyShopeePushSignature({ headers: { authorization: `${authorization}00` } }, body), false)
  assert.equal(verifyShopeePushSignature({ headers: { authorization } }, Buffer.from(`${body.toString('utf8')} `)), false)
})
