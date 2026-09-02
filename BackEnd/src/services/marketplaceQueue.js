import { hasDatabase, withTenant } from '../db/pool.js'
import { blindIndex } from '../security/crypto.js'

const text = (value) =>
  String(value || '')
    .trim()

const number = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const quantity = (value) => {
  const parsed = Math.floor(number(value, 1))
  return parsed > 0 ? parsed : 1
}

const firstText = (...values) => {
  for (const value of values) {
    const clean = text(value)
    if (clean) return clean
  }

  return ''
}

export const normalizeMarketplaceOrder = (platform, payload = {}) => {
  const data = payload.data || payload.order || payload
  const item = Array.isArray(data.items)
    ? data.items[0]
    : Array.isArray(data.order_items)
      ? data.order_items[0]
      : Array.isArray(data.products)
        ? data.products[0]
        : data.item || {}

  if (platform === 'mercado_livre') {
    return {
      externalOrderId:
        firstText(payload.order_id, data.id, payload.resource?.split('/').filter(Boolean).pop()),
      sku:
        firstText(item.seller_sku, item.sku, item.item?.seller_sku, data.seller_sku, payload.sku),
      productName:
        firstText(item.title, item.item?.title, data.product_name, payload.product_name),
      quantity:
        quantity(item.quantity || data.quantity || payload.quantity),
      gross:
        number(data.total_amount ?? payload.total_amount),
      marketplaceFee:
        number(data.marketplace_fee ?? payload.marketplace_fee),
      shipping:
        number(data.shipping ?? payload.shipping),
      net:
        data.net_amount === undefined && payload.net_amount === undefined
          ? undefined
          : number(data.net_amount ?? payload.net_amount),
      status:
        firstText(data.status, payload.status, 'received'),
      soldAt:
        firstText(data.date_created, data.created_at, payload.date_created, payload.created_at) || null
    }
  }

  if (platform === 'shopee') {
    return {
      externalOrderId:
        firstText(data.ordersn, data.order_sn, payload.ordersn),
      sku:
        firstText(item.item_sku, item.model_sku, item.sku, data.item_sku, payload.sku),
      productName:
        firstText(item.item_name, item.name, data.product_name, payload.product_name),
      quantity:
        quantity(item.model_quantity_purchased || item.quantity || data.quantity),
      gross:
        number(data.total_amount),
      marketplaceFee:
        number(data.escrow_amount_after_adjustment ? data.total_amount - data.escrow_amount_after_adjustment : data.marketplace_fee),
      shipping:
        number(data.shipping_fee),
      net:
        data.escrow_amount_after_adjustment === undefined
          ? undefined
          : number(data.escrow_amount_after_adjustment),
      status:
        firstText(data.status, 'received'),
      soldAt:
        data.create_time ? new Date(Number(data.create_time) * 1000).toISOString() : null
    }
  }

  return {
    externalOrderId:
      firstText(payload.amazonOrderId, payload.orderId, payload.order_id, data.id),
    sku:
      firstText(item.sellerSKU, item.seller_sku, item.sku, data.sku, payload.sku),
    productName:
      firstText(item.title, item.name, data.product_name, payload.productName),
    quantity:
      quantity(item.quantityOrdered || item.quantity || data.quantity || payload.quantity),
    gross:
      number(payload.totalAmount || payload.orderTotal || data.total_amount),
    marketplaceFee:
      number(payload.marketplaceFee || data.marketplace_fee),
    shipping:
      number(payload.shipping || data.shipping),
    net:
      payload.netAmount === undefined && data.net_amount === undefined
        ? undefined
        : number(payload.netAmount ?? data.net_amount),
    status:
      firstText(payload.status, data.status, 'received'),
    soldAt:
      firstText(payload.purchaseDate, payload.createdAt, data.purchaseDate, data.createdAt) || null
  }
}

export const enqueueMarketplaceSaleForPrinting = async (integration, sale) => {
  if (!hasDatabase || !integration?.tenant_id || !sale?.id) {
    return null
  }

  const tenantId = integration.tenant_id
  const sku = text(sale.sku)
  const productName = text(sale.productName)

  if (!sku && !productName) {
    return null
  }

  return withTenant(tenantId, async (client) => {
    const linkedProductResult = sku
      ? await client.query(
        `
          select
            p.id,
            p.name,
            p.printer_id
          from marketplace_product_links l
          inner join products p on p.id = l.product_id and p.tenant_id = l.tenant_id
          where l.tenant_id = $1
            and l.platform = $2
            and l.external_sku_hash = $3
          order by l.updated_at desc
          limit 1
        `,
        [
          tenantId,
          text(integration.platform),
          blindIndex(sku)
        ]
      )
      : { rows: [] }

    const productResult = linkedProductResult.rows[0]
      ? linkedProductResult
      : await client.query(
      `
        select
          id,
          name,
          printer_id
        from products
        where tenant_id = $1
          and (
            ($2 <> '' and lower(sku) = lower($2))
            or ($3 <> '' and lower(name) = lower($3))
          )
        order by
          case
            when $2 <> '' and lower(sku) = lower($2) then 0
            else 1
          end,
          created_at desc
        limit 1
      `,
      [
        tenantId,
        sku,
        productName
      ]
    )

    const product = productResult.rows[0]
    if (!product?.printer_id) {
      return null
    }

    const printerResult = await client.query(
      `
        select
          id,
          agent_printer_id
        from printers
        where tenant_id = $1
          and id = $2
        limit 1
      `,
      [
        tenantId,
        product.printer_id
      ]
    )

    const printer = printerResult.rows[0]
    if (!printer) {
      return null
    }

    const priorityResult = await client.query(
      `
        select coalesce(max(priority), 0) + 1 as next_priority
        from print_jobs
        where tenant_id = $1
          and printer_id is not distinct from $2::bigint
            and status = 'queued'
      `,
      [
        tenantId,
        printer.id
      ]
    )

    const result = await client.query(
      `
        insert into print_jobs (
          tenant_id,
          tracked_sale_id,
          product_id,
          printer_id,
          agent_printer_id,
          source,
          title,
          quantity,
          priority,
          status,
          notes
        )
        values (
          $1,
          $2,
          $3,
          $4,
          $5,
          'marketplace',
          $6,
          $7,
          $8,
          'awaiting_confirmation',
          $9
        )
        on conflict (tenant_id, tracked_sale_id)
        where tracked_sale_id is not null
        do nothing
        returning id
      `,
      [
        tenantId,
        sale.id,
        product.id,
        printer.id,
        printer.agent_printer_id || null,
        product.name,
        quantity(sale.quantity),
        Number(priorityResult.rows[0]?.next_priority || 1),
        `Pedido ${text(sale.externalOrderId) || String(sale.id)} recebido via marketplace. Confirme antes de liberar para impressao.`
      ]
    )

    return result.rows[0] || null
  })
}
