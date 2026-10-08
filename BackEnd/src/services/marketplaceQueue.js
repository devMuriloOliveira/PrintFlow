import { hasDatabase, withTenant } from '../db/pool.js'
import { blindIndex } from '../security/crypto.js'
import { createSalesFulfillmentPlan, fulfillSalesFulfillmentPlan, reduceSalesFulfillmentPlan, releaseSalesFulfillmentPlan } from './salesFulfillment.js'
import { writeOperationalNotification } from './operationalEvents.js'

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
    : Array.isArray(data.item_list)
      ? data.item_list
    : Array.isArray(data.order_items)
      ? data.order_items
      : Array.isArray(data.products)
        ? data.products
        : []
  const requiresReview = false
  const reviewReason = ''
  const item = Array.isArray(data.items)
    ? data.items[0]
    : Array.isArray(data.item_list)
      ? data.item_list[0]
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
      items: orderItems.map((orderItem, index) => ({
        lineKey: firstText(orderItem.item?.id, orderItem.item_id, `line-${index}`),
        sku: firstText(orderItem.item?.seller_sku, orderItem.seller_sku, orderItem.item?.id),
        productName: firstText(orderItem.item?.title, orderItem.title),
        quantity: quantity(orderItem.quantity),
        gross: number(orderItem.gross_price || orderItem.unit_price * quantity(orderItem.quantity)),
        marketplaceFee: number(orderItem.sale_fee) * quantity(orderItem.quantity)
      })),
      net:
        data.net_amount === undefined && payload.net_amount === undefined
          ? undefined
        : number(data.net_amount ?? payload.net_amount),
      status:
        firstText(data.status, payload.status, 'received'),
      soldAt:
        firstText(data.date_created, data.created_at, payload.date_created, payload.created_at) || null,
      requiresReview,
      reviewReason,
      ...(data.refunded_quantity !== undefined || payload.refunded_quantity !== undefined
        ? {
            refundedQuantity: number(data.refunded_quantity ?? payload.refunded_quantity),
            remainingQuantity: Math.max(0, quantity(item.quantity || data.quantity || payload.quantity) - number(data.refunded_quantity ?? payload.refunded_quantity))
          }
        : {})
    }
  }

  if (platform === 'shopee') {
    const orderStatus = firstText(data.order_status, data.status, 'received').toUpperCase()
    const normalizedStatus = ({
      UNPAID: 'unpaid',
      PENDING: 'pending',
      READY_TO_SHIP: 'paid',
      PROCESSED: 'processing',
      SHIPPED: 'shipped',
      TO_CONFIRM_RECEIVE: 'shipped',
      COMPLETED: 'delivered',
      IN_CANCEL: 'cancel_pending',
      CANCELLED: 'cancelled',
      TO_RETURN: 'return_requested'
    })[orderStatus] || orderStatus.toLowerCase()
    return {
      externalOrderId:
        firstText(data.ordersn, data.order_sn, payload.ordersn, payload.order_sn),
      sku:
        firstText(item.model_sku, item.item_sku, item.sku, data.model_sku, data.item_sku, payload.sku),
      productName:
        firstText(item.item_name, item.model_name, item.name, data.product_name, payload.product_name),
      quantity:
        quantity(item.model_quantity_purchased || item.quantity || data.quantity),
      gross:
        number(data.total_amount),
      marketplaceFee:
        number(data.marketplace_fee ?? (data.escrow_amount_after_adjustment ? data.total_amount - data.escrow_amount_after_adjustment : 0)),
      shipping:
        number(data.seller_shipping_cost ?? data.shipping_fee),
      items: itemCollection.map((rawItem, index) => ({
        lineKey: firstText(
          rawItem.line_item_id,
          rawItem.item_id && rawItem.model_id ? `${rawItem.item_id}-${rawItem.model_id}` : '',
          rawItem.model_sku,
          rawItem.item_sku,
          `line-${index}`
        ),
        sku: firstText(rawItem.model_sku, rawItem.item_sku, rawItem.sku),
        productName: firstText(rawItem.item_name, rawItem.model_name, rawItem.name),
        quantity: quantity(rawItem.model_quantity_purchased || rawItem.quantity),
        gross: rawItem.gross !== undefined
          ? number(rawItem.gross)
          : rawItem.discounted_price !== undefined
            ? number(rawItem.discounted_price)
            : rawItem.model_discounted_price !== undefined
              ? number(rawItem.model_discounted_price) * quantity(rawItem.model_quantity_purchased || rawItem.quantity)
              : number(rawItem.item_price ?? rawItem.model_price ?? rawItem.price),
        marketplaceFee: number(rawItem.marketplace_fee),
        requiresReview: Boolean(rawItem.requiresReview),
        reviewReason: text(rawItem.reviewReason)
      })),
      net:
        data.escrow_amount_after_adjustment === undefined
          ? undefined
          : number(data.escrow_amount_after_adjustment),
      status:
        normalizedStatus,
      soldAt: data.create_time ? new Date(Number(data.create_time) * 1000).toISOString() : null,
      requiresReview,
      reviewReason,
      ...(data.refunded_quantity !== undefined || payload.refunded_quantity !== undefined
        ? {
            refundedQuantity: number(data.refunded_quantity ?? payload.refunded_quantity),
            remainingQuantity: Math.max(0, quantity(item.model_quantity_purchased || item.quantity || data.quantity) - number(data.refunded_quantity ?? payload.refunded_quantity))
          }
        : {})
    }
  }

  if (platform === 'amazon') {
    const orderItems = Array.isArray(data.orderItems) ? data.orderItems : []
    const items = orderItems.map((rawItem, index) => {
      const orderedQuantity = quantity(rawItem.quantityOrdered || rawItem.quantity)
      const price = number(rawItem.product?.price?.unitPrice?.amount ?? rawItem.itemPrice?.amount ?? rawItem.itemPrice)
      return {
        lineKey: firstText(rawItem.orderItemId, rawItem.order_item_id, `line-${index}`),
        sku: firstText(rawItem.product?.sellerSku, rawItem.sellerSku),
        productName: firstText(rawItem.product?.title, rawItem.title),
        quantity: orderedQuantity,
        gross: price * orderedQuantity,
        marketplaceFee: 0
      }
    })
    const status = firstText(data.fulfillment?.fulfillmentStatus, data.fulfillmentStatus, 'PENDING').toUpperCase()
    const normalizedStatus = ({
      UNSHIPPED: 'paid',
      PARTIALLY_SHIPPED: 'partially_shipped',
      SHIPPED: 'shipped',
      CANCELLED: 'cancelled',
      PENDING: 'pending',
      UNFULFILLABLE: 'unfulfillable',
      PENDING_AVAILABILITY: 'pending_availability',
      INVOICE_UNCONFIRMED: 'invoice_unconfirmed'
    })[status] || status.toLowerCase()
    return {
      externalOrderId: firstText(data.orderId, data.amazonOrderId),
      sku: items[0]?.sku || '',
      productName: items[0]?.productName || '',
      quantity: items.reduce((total, orderItem) => total + orderItem.quantity, 0),
      gross: items.reduce((total, orderItem) => total + orderItem.gross, 0),
      marketplaceFee: 0,
      shipping: 0,
      items,
      status: normalizedStatus,
      soldAt: firstText(data.createdTime) || null,
      fulfilledBy: firstText(data.fulfillment?.fulfilledBy)
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
    items: itemCollection.map((rawItem, index) => ({
      lineKey: firstText(rawItem.orderItemId, rawItem.order_item_id, rawItem.sellerSKU, `line-${index}`),
      sku: firstText(rawItem.sellerSKU, rawItem.seller_sku, rawItem.sku),
      productName: firstText(rawItem.title, rawItem.name),
      quantity: quantity(rawItem.quantityOrdered || rawItem.quantity),
      gross: number(rawItem.itemPrice || rawItem.price),
      marketplaceFee: number(rawItem.marketplaceFee)
    })),
    net:
      payload.netAmount === undefined && data.net_amount === undefined
        ? undefined
        : number(payload.netAmount ?? data.net_amount),
    status:
      firstText(payload.status, data.status, 'received'),
    soldAt:
      firstText(payload.purchaseDate, payload.createdAt, data.purchaseDate, data.createdAt) || null,
    requiresReview,
    reviewReason,
    ...(data.refunded_quantity !== undefined || payload.refunded_quantity !== undefined
      ? {
          refundedQuantity: number(data.refunded_quantity ?? payload.refunded_quantity),
          remainingQuantity: Math.max(0, quantity(item.quantityOrdered || item.quantity || data.quantity || payload.quantity) - number(data.refunded_quantity ?? payload.refunded_quantity))
        }
      : {})
  }
}

export const canQueueAmazonMarketplaceSale = (sale) =>
  sale?.fulfilledBy === 'MERCHANT' &&
  !['pending', 'pending_availability', 'invoice_unconfirmed', 'unfulfillable', 'partially_shipped']
    .includes(String(sale?.status || '').toLowerCase())

export const enqueueMarketplaceSaleForPrinting = async (integration, sale) => {
  if (!hasDatabase || !integration?.tenant_id || !sale?.id) {
    return null
  }

  const tenantId = integration.tenant_id
  const sku = text(sale.sku)
  const productName = text(sale.productName)
  const orderStatus = String(sale.status || '').toLowerCase()

  if (sale.requiresReview || !sku && !productName) {
    return null
  }

  if (integration.platform === 'shopee' && ['unpaid', 'pending', 'cancel_pending', 'return_requested'].includes(orderStatus)) {
    return null
  }
  if (integration.platform === 'amazon' && !canQueueAmazonMarketplaceSale(sale)) {
    return null
  }

  return withTenant(tenantId, async (client) => {
    if (['cancelled', 'canceled', 'refunded'].includes(orderStatus)) {
      if (orderStatus === 'refunded' && sale.refundedQuantity !== undefined) {
        await reduceSalesFulfillmentPlan({
          client, tenantId, sourceType: 'tracked_sale', sourceId: sale.id,
          requestedQuantity: Math.max(0, Number(sale.remainingQuantity ?? sale.quantity ?? 0))
        })
        return null
      }
      await releaseSalesFulfillmentPlan({ client, tenantId, sourceType: 'tracked_sale', sourceId: sale.id })
      return null
    }
    if (['shipped', 'delivered'].includes(orderStatus)) {
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
    if (!product) {
      await writeOperationalNotification(tenantId, {
        type: 'marketplace.product_link_missing', severity: 'warning', title: 'Venda sem produto vinculado',
        message: `O SKU da venda ${text(sale.externalOrderId) || String(sale.id)} precisa ser vinculado a um produto antes da producao.`,
        entityType: 'tracked_sale', entityId: String(sale.id), dedupeKey: `marketplace-product-link-missing:${sale.id}`
      }, client)
      return null
    }
    if (!product.printer_id) {
      await writeOperationalNotification(tenantId, {
        type: 'production.printer_missing', severity: 'warning', title: 'Venda aguardando impressora',
        message: `O produto ${product.name || `#${product.id}`} esta vinculado a venda, mas nao possui impressora configurada.`,
        entityType: 'tracked_sale', entityId: String(sale.id), dedupeKey: `production-printer-missing-sale:${sale.id}`
      }, client)
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
