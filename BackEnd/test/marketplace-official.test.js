import assert from 'node:assert/strict'
import test from 'node:test'

process.env.AUTH_SECRET = 'marketplace-official-test-secret-32-characters'
process.env.DATABASE_URL = ''

const {
  createMarketplaceOAuthState,
  marketplaceAuthorizationUrl,
  readMarketplaceOAuthState
} = await import('../src/services/marketplaceOfficial.js')

test('state OAuth de marketplace e assinado e preserva tenant/plataforma', () => {
  const state = createMarketplaceOAuthState('tenant-marketplace-test', 'mercado_livre')
  const parsed = readMarketplaceOAuthState(state)

  assert.equal(parsed.tenantId, 'tenant-marketplace-test')
  assert.equal(parsed.platform, 'mercado_livre')
  assert.ok(parsed.nonce)
})

test('state OAuth adulterado e rejeitado', () => {
  const state = createMarketplaceOAuthState('tenant-marketplace-test', 'mercado_livre')
  const [payload] = state.split('.')
  const tampered = `${payload}.assinatura-invalida`

  assert.throws(
    () => readMarketplaceOAuthState(tampered),
    /Estado OAuth invalido/
  )
})

test('OAuth oficial informa quando Mercado Livre nao esta configurado', async () => {
  await assert.rejects(
    () => marketplaceAuthorizationUrl({ tenantId: 'tenant-marketplace-test', platform: 'mercado_livre' }),
    /OAuth Mercado Livre nao configurado/
  )
})

