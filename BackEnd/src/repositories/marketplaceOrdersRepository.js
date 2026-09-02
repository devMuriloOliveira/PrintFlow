import { hasDatabase, withTenant } from '../db/pool.js'
import { blindIndex, decryptField } from '../security/crypto.js'
import {
  enqueueMarketplaceSaleForPrinting
} from '../services/marketplaceQueue.js'

const text = (value) => String(value || '').trim()
const intOrNull = (value) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
const number = (value) => Number(value || 0)

const publicOrder = (row) => ({
  id: String(row.id),
  integrationId: row.integration_id ? String(row.integration_id) : '',
  marketplaceId: row.marketplace_id ? String(row.marketplace_id) : '',
  platform: row.platform || '',
  externalOrderId: decryptField(row.external_order_id),
  externalSku: row.external_sku || '',
  productName: row.product_name || '',
  quantity: Number(row.quantity || 1),
  gross: number(row.gross),
  marketplaceFee: number(row.marketplace_fee),
  shipping: number(row.shipping),
  net: number(row.net),
  profit: number(row.profit),
  status: row.status || 'received',
  soldAt: row.sold_at || null,
  printJobId: row.print_job_id ? String(row.print_job_id) : '',
  printJobStatus: row.print_job_status || '',
  mappedProductId: row.mapped_product_id ? String(row.mapped_product_id) : '',
  mappedProductName: row.mapped_product_name || '',
  suggestedProductId: row.suggested_product_id ? String(row.suggested_product_id) : '',
  suggestedProductName: row.suggested_product_name || ''
})

export const listMarketplaceOrders = async (tenantId) => {
  if (!hasDatabase) return []

  const result = await withTenant(tenantId, (client) => client.query(`
    select
      s.id,
      s.integration_id,
      s.marketplace_id,
      s.platform,
      s.external_order_id,
      s.external_sku,
      s.external_sku_hash,
      s.product_name,
      s.quantity,
      s.gross,
      s.marketplace_fee,
      s.shipping,
      s.net,
      s.profit,
      s.status,
      s.sold_at,
      j.id as print_job_id,
      j.status as print_job_status,
      linked.id as mapped_product_id,
      linked.name as mapped_product_name,
      suggested.id as suggested_product_id,
      suggested.name as suggested_product_name
    from tracked_sales s
    left join print_jobs j on j.tracked_sale_id = s.id and j.tenant_id = s.tenant_id
    left join marketplace_product_links l
      on l.tenant_id = s.tenant_id
     and l.platform = s.platform
     and l.external_sku_hash = s.external_sku_hash
    left join products linked on linked.id = l.product_id and linked.tenant_id = s.tenant_id
    left join products suggested
      on suggested.tenant_id = s.tenant_id
     and (
       (s.external_sku <> '' and lower(suggested.sku) = lower(s.external_sku))
       or (s.product_name <> '' and lower(suggested.name) = lower(s.product_name))
     )
    where s.tenant_id = $1
    order by
      case
        when j.status = 'awaiting_confirmation' then 0
        when j.id is null then 1
        when s.status in ('cancelled', 'canceled', 'refunded') then 4
        else 2
      end,
      s.sold_at desc,
      s.id desc
  `, [tenantId]))

  return result.rows.map(publicOrder)
}

export const linkMarketplaceOrderProduct = async (tenantId, saleId, payload) => {
  if (!hasDatabase) return null

  const productId = intOrNull(payload?.productId)
  if (!productId) throw new Error('Produto obrigatorio para vincular pedido.')

  return withTenant(tenantId, async (client) => {
    const saleResult = await client.query(
      `select
          s.id,
          s.tenant_id,
          s.integration_id,
          s.marketplace_id,
          s.platform,
          s.external_order_id,
          s.external_sku,
          s.product_name,
          s.quantity,
          s.status,
          s.gross,
          s.marketplace_fee,
          s.shipping,
          s.net,
          s.profit,
          i.id as integration_id,
          i.tenant_id as integration_tenant_id,
          i.marketplace_id as integration_marketplace_id,
          i.platform as integration_platform
       from tracked_sales s
       left join marketplace_integrations i on i.id = s.integration_id and i.tenant_id = s.tenant_id
       where s.tenant_id = $1
         and s.id = $2
       limit 1
       for update`,
      [tenantId, saleId]
    )

    const sale = saleResult.rows[0]
    if (!sale) throw new Error('Registro nao encontrado')
    if (['cancelled', 'canceled', 'refunded'].includes(String(sale.status || '').toLowerCase())) {
      throw new Error('Pedido cancelado ou estornado nao pode ser liberado para impressao.')
    }

    const productResult = await client.query(
      'select id, name, printer_id from products where tenant_id = $1 and id = $2 limit 1',
      [tenantId, productId]
    )
    const product = productResult.rows[0]
    if (!product) throw new Error('Registro nao encontrado')
    if (!product.printer_id) throw new Error('Produto precisa ter impressora vinculada antes de liberar para fila.')

    if (sale.external_sku) {
      await client.query(
        `insert into marketplace_product_links (
           tenant_id, integration_id, marketplace_id, platform, external_sku,
           external_sku_hash, external_name, product_id
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (tenant_id, platform, external_sku_hash) do update set
           integration_id = excluded.integration_id,
           marketplace_id = excluded.marketplace_id,
           external_sku = excluded.external_sku,
           external_name = excluded.external_name,
           product_id = excluded.product_id,
           updated_at = now()`,
        [
          tenantId,
          sale.integration_id,
          sale.marketplace_id,
          sale.platform,
          sale.external_sku,
          blindIndex(sale.external_sku),
          sale.product_name,
          product.id
        ]
      )
    }

    const integration = {
      id: sale.integration_id,
      tenant_id: tenantId,
      marketplace_id: sale.integration_marketplace_id || sale.marketplace_id,
      platform: sale.integration_platform || sale.platform
    }

    await enqueueMarketplaceSaleForPrinting(integration, {
      id: sale.id,
      externalOrderId: decryptField(sale.external_order_id),
      sku: sale.external_sku,
      productName: product.name || sale.product_name,
      quantity: sale.quantity,
      gross: sale.gross,
      marketplaceFee: sale.marketplace_fee,
      shipping: sale.shipping,
      net: sale.net,
      profit: sale.profit
    })

    return true
  })
}
