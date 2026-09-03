import assert from 'node:assert/strict'
import test from 'node:test'

process.env.AUTH_SECRET = 'marketplace-pkce-test-secret-32-characters'
process.env.DATABASE_URL = ''
process.env.MERCADO_LIVRE_CLIENT_ID = 'test-client-id'
process.env.MERCADO_LIVRE_CLIENT_SECRET = 'test-client-secret'
process.env.MERCADO_LIVRE_REDIRECT_URI = 'https://example.test/oauth-callback'

const {
  fetchMarketplaceOrderDetails,
  marketplaceAuthorizationUrl,
  readMarketplaceOAuthState
} = await import('../src/services/marketplaceOfficial.js')
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
    assert.equal(calls.length, 2)
    assert.match(calls[1].options.headers.Authorization, /new-access-token/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
