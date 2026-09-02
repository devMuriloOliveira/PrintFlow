import { hasDatabase, query, withTenant } from '../db/pool.js'
import { blindIndex, decryptField, encryptField } from '../security/crypto.js'

const number = (value) => Number(value || 0)
const text = (value) => String(value || '').trim()
const platformName = (platform) => text(platform).toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'custom'
const maskSensitiveIdentifier = (value) => {
  const decrypted = decryptField(value)
  if (!decrypted) return ''
  if (decrypted.length <= 4) return '****'
  return `${decrypted.slice(0, 2)}***${decrypted.slice(-2)}`
}

const publicIntegration = (row) => ({
  id: String(row.id),
  marketplaceId: row.marketplace_id ? String(row.marketplace_id) : '',
  platform: row.platform,
  connectionName: row.connection_name,
  accountExternalId: maskSensitiveIdentifier(row.account_external_id),
  status: row.status,
  scopes: row.scopes || '',
  hasAccessToken: Boolean(row.access_token),
  hasRefreshToken: Boolean(row.refresh_token),
  tokenExpiresAt: row.token_expires_at || null,
  lastSyncAt: row.last_sync_at || null
})

export const listMarketplaceIntegrations = async (tenantId) => {
  if (!hasDatabase) return []
  const result = await withTenant(tenantId, (client) => client.query(`
    select id, marketplace_id, platform, connection_name, account_external_id, status, scopes,
      access_token, refresh_token, token_expires_at, last_sync_at
    from marketplace_integrations
    where tenant_id = $1
    order by created_at desc
  `, [tenantId]))
  return result.rows.map(publicIntegration)
}

export const createMarketplaceIntegration = async (tenantId, payload) => {
  if (!hasDatabase) return publicIntegration({ id: Date.now(), marketplace_id: payload.marketplaceId, ...payload })

  const platform = platformName(payload.platform)
  const accountExternalId = text(payload.accountExternalId)
  const accountHash = blindIndex(accountExternalId)
  if (!platform || !accountExternalId) throw new Error('Informe a plataforma e o ID externo da conta.')
  if (platform !== 'custom' && !text(payload.accessToken)) throw new Error('Informe o access token da integracao.')

  const result = await withTenant(tenantId, async (client) => {
    let marketplaceId = payload.marketplaceId ? Number(payload.marketplaceId) : null
    if (!marketplaceId && payload.marketplaceName) {
      const marketplace = await client.query(
        'select id from marketplaces where tenant_id = $1 and lower(name) = lower($2) order by created_at desc limit 1',
        [tenantId, text(payload.marketplaceName)]
      )
      marketplaceId = marketplace.rows[0]?.id || null
    }
    const status = payload.accessToken || payload.refreshToken ? 'connected' : 'pending'

    return client.query(`
      insert into marketplace_integrations (
        tenant_id, marketplace_id, platform, connection_name, account_external_id, account_external_id_hash,
        access_token, refresh_token, token_expires_at, status, scopes
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, nullif($9, '')::timestamptz, $10, $11)
      on conflict (tenant_id, platform, account_external_id_hash) do update set
        marketplace_id = excluded.marketplace_id,
        connection_name = excluded.connection_name,
        account_external_id = excluded.account_external_id,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_expires_at = excluded.token_expires_at,
        status = excluded.status,
        scopes = excluded.scopes,
        updated_at = now()
      returning id, marketplace_id, platform, connection_name, account_external_id, status, scopes,
        access_token, refresh_token, token_expires_at, last_sync_at
    `, [
      tenantId,
      marketplaceId,
      platform,
      text(payload.connectionName || payload.name || platform),
      encryptField(accountExternalId),
      accountHash,
      encryptField(payload.accessToken || ''),
      encryptField(payload.refreshToken || ''),
      text(payload.tokenExpiresAt),
      status,
      text(payload.scopes)
    ])
  })

  return publicIntegration(result.rows[0])
}

export const findIntegrationByExternalAccount = async (platform, accountExternalId) => {
  if (!hasDatabase) return null
  const result = await query(`
    select id, tenant_id, marketplace_id, platform, connection_name, account_external_id,
      access_token, refresh_token, token_expires_at, status
    from marketplace_integrations
    where platform = $1 and account_external_id_hash = $2
    limit 1
  `, [platformName(platform), blindIndex(accountExternalId)])
  return result.rows[0] || null
}

export const findIntegrationById = async (tenantId, integrationId) => {
  if (!hasDatabase) return null
  const result = await withTenant(tenantId, (client) => client.query(`
    select id, tenant_id, marketplace_id, platform, connection_name, account_external_id,
      access_token, refresh_token, token_expires_at, status
    from marketplace_integrations
    where tenant_id = $1
      and id = $2
    limit 1
  `, [tenantId, integrationId]))
  return result.rows[0] || null
}

export const recordTrackedSale = async (integration, sale) => {
  const tenantId = integration.tenant_id
  const platform = platformName(sale.platform || integration.platform)
  const externalOrderId = text(sale.externalOrderId)
  if (!tenantId || !externalOrderId) return null

  const gross = number(sale.gross)
  const marketplaceFee = number(sale.marketplaceFee)
  const shipping = number(sale.shipping)
  const cost = number(sale.cost)
  const net = sale.net === undefined ? gross - marketplaceFee - shipping : number(sale.net)
  const profit = sale.profit === undefined ? net - cost : number(sale.profit)
  const sku = text(sale.sku)
  const productName = text(sale.productName)
  const quantity = Math.max(1, Math.floor(Number(sale.quantity || 1)))

  const result = await withTenant(tenantId, (client) => client.query(`
    insert into tracked_sales (
      tenant_id, integration_id, marketplace_id, platform, external_order_id, external_order_hash,
      external_sku, external_sku_hash, product_name, quantity, gross, marketplace_fee, shipping, net, cost, profit, status, sold_at
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, coalesce($18::timestamptz, now()))
    on conflict (tenant_id, platform, external_order_hash) do update set
      external_sku = excluded.external_sku,
      external_sku_hash = excluded.external_sku_hash,
      product_name = excluded.product_name,
      quantity = excluded.quantity,
      gross = excluded.gross,
      marketplace_fee = excluded.marketplace_fee,
      shipping = excluded.shipping,
      net = excluded.net,
      cost = excluded.cost,
      profit = excluded.profit,
      status = excluded.status,
      sold_at = excluded.sold_at,
      updated_at = now()
    returning id
  `, [
    tenantId,
    integration.id,
    integration.marketplace_id,
    platform,
    encryptField(externalOrderId),
    blindIndex(externalOrderId),
    sku,
    blindIndex(sku),
    productName,
    quantity,
    gross,
    marketplaceFee,
    shipping,
    net,
    cost,
    profit,
    text(sale.status || 'received'),
    sale.soldAt || null
  ]))

  return result.rows[0]
}

export const recordWebhookEvent = async (integration, event) => {
  const tenantId = integration.tenant_id
  if (!tenantId) return null
  const payload = JSON.stringify(event.payload || {})

  return withTenant(tenantId, (client) => client.query(`
    insert into marketplace_webhook_events (
      tenant_id, integration_id, platform, event_type, external_order_id, payload, status
    )
    values ($1, $2, $3, $4, $5, $6, $7)
  `, [
    tenantId,
    integration.id,
    platformName(event.platform || integration.platform),
    text(event.eventType),
    encryptField(event.externalOrderId || ''),
    encryptField(payload),
    text(event.status || 'received')
  ]))
}
