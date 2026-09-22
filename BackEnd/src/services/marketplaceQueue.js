import { hasDatabase, withTenant } from '../db/pool.js'
import { blindIndex } from '../security/crypto.js'
import { createSalesFulfillmentPlan, fulfillSalesFulfillmentPlan, releaseSalesFulfillmentPlan } from './salesFulfillment.js'

const text = (value) =>
  String(value || '')
    .trim()

const number = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const optionalNumber = (...values) => {
  const value = values.find((item) => item !== undefined && item !== null && item !== '')
  return value === undefined ? null : number(value)
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
  const itemCollection = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.order_items)
      ? data.order_items
      : Array.isArray(data.products)
        ? data.products
        : []
  const requiresReview = itemCollection.length > 1
  const reviewReason = requiresReview ? 'Pedido com mais de um item/SKU; revise os itens antes de liberar.' : ''
  const item = Array.isArray(data.items)
    ? data.items[0]
    : Array.isArray(data.order_items)
      ? data.order_items[0]
      : Array.isArray(data.products)
        ? data.products[0]
        : data.item || {}

  if (platform === 'mercado_livre') {
    const orderItems = Array.isArray(data.order_items) ? data.order_items : []
    const itemFeeBreakdown = orderItems.map((orderItem) => ({
      itemId: firstText(orderItem.item?.id, orderItem.item_id),
      sku: firstText(orderItem.item?.seller_sku, orderItem.seller_sku, orderItem.item?.id),
      quantity: quantity(orderItem.quantity),
      unitPrice: number(orderItem.unit_price),
      grossPrice: number(orderItem.gross_price),
      saleFee: number(orderItem.sale_fee)
    }))
    const rawFeeDetails = data.sale_fee_details ?? payload.sale_fee_details ?? data.fee_details ?? payload.fee_details
    const feeDetails = Array.isArray(rawFeeDetails) ? Object.assign({}, ...rawFeeDetails) : (rawFeeDetails || {})
    const itemCommission = itemFeeBreakdown.reduce((total, item) => total + item.saleFee * item.quantity, 0)
    const commissionFromDetails = optionalNumber(feeDetails.gross_amount, data.commission, payload.commission)
    const commission = itemCommission > 0 ? itemCommission : (commissionFromDetails ?? 0)
    const fixed = optionalNumber(feeDetails.fixed_fee, data.fixed_fee, payload.fixed_fee)
    const financial = optionalNumber(feeDetails.financing_add_on_fee, feeDetails.payment_fee, data.financial_fee, payload.financial_fee)
    const ads = optionalNumber(feeDetails.ads_fee, feeDetails.advertising_fee, data.ads_fee, payload.ads_fee)
    const others = optionalNumber(feeDetails.other_fee, feeDetails.other_fees, data.other_fee, payload.other_fee)
    const rawMarketplaceFee = data.marketplace_fee ?? payload.marketplace_fee
    const actualComponents = [commission, fixed, financial, ads, others].filter((value) => value !== null)
    const marketplaceFee = rawMarketplaceFee === undefined ? actualComponents.reduce((total, value) => total + value, 0) : number(rawMarketplaceFee)
    const shippingValue = data.shipping?.cost ?? payload.shipping?.cost ?? data.shipping ?? payload.shipping
    const shipping = number(shippingValue)
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
      marketplaceFee,
      shipping,
      feeBreakdown: {
        source: 'mercadolivre.orders',
        marketplaceFee,
        commission,
        commissionSource: itemCommission > 0 ? 'mercadolivre.orders.order_items' : commissionFromDetails !== null ? 'mercadolivre.orders.sale_fee_details' : 'unavailable',
        fixed,
        financial,
        ads,
        others,
        detailSource: [fixed, financial, ads, others].some((value) => value !== null) ? 'mercadolivre.orders.sale_fee_details' : 'unavailable',
        itemSaleFees: itemFeeBreakdown,
        shipping,
        shippingId: firstText(data.shipping?.id, payload.shipping_id),
        discounts: data.discounts || payload.discounts || null
      },
      net:
        data.net_amount === undefined && payload.net_amount === undefined
          ? undefined
          : number(data.net_amount ?? payload.net_amount),
      status:
        firstText(data.status, payload.status, 'received'),
      soldAt:
        firstText(data.date_created, data.created_at, payload.date_created, payload.created_at) || null,
      requiresReview,
      reviewReason
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
      soldAt: data.create_time ? new Date(Number(data.create_time) * 1000).toISOString() : null,
      requiresReview,
      reviewReason
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
      firstText(payload.purchaseDate, payload.createdAt, data.purchaseDate, data.createdAt) || null,
    requiresReview,
    reviewReason
  }
}

export const enqueueMarketplaceSaleForPrinting = async (integration, sale) => {
  if (!hasDatabase || !integration?.tenant_id || !sale?.id) {
    return null
  }

  const tenantId = integration.tenant_id
  const sku = text(sale.sku)
  const productName = text(sale.productName)

  if (sale.requiresReview || !sku && !productName) {
    return null
  }

  return withTenant(tenantId, async (client) => {
    if (['cancelled', 'canceled', 'refunded'].includes(String(sale.status || '').toLowerCase())) {
      await releaseSalesFulfillmentPlan({ client, tenantId, sourceType: 'tracked_sale', sourceId: sale.id })
      return null
    }
    if (['shipped', 'delivered'].includes(String(sale.status || '').toLowerCase())) {
      await fulfillSalesFulfillmentPlan({ client, tenantId, sourceType: 'tracked_sale', sourceId: sale.id })
      return null
    }
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
            and l.integration_id = $2
            and l.platform = $3
            and l.external_sku_hash = $4
          order by l.updated_at desc
          limit 1
        `,
        [
          tenantId,
          integration.id,
          text(integration.platform),
          blindIndex(sku)
        ]
      )
      : { rows: [] }

    // A marketplace item is never matched by name. Only an explicit, hashed
    // SKU link can authorize inventory reservation or production.
    const product = linkedProductResult.rows[0]
    if (!product?.printer_id) {
      return null
    }

    const fulfillment = await createSalesFulfillmentPlan({
      client, tenantId, sourceType: 'tracked_sale', sourceId: sale.id,
      productId: product.id, requestedQuantity: quantity(sale.quantity), title: product.name,
      notes: `Pedido ${text(sale.externalOrderId) || String(sale.id)} recebido via marketplace.`,
      awaitingConfirmation: true
    })
    return fulfillment.productionJobId ? { id: fulfillment.productionJobId } : null
  })
}
