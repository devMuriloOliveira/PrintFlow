import test from 'node:test'
import assert from 'node:assert/strict'

import { canQueueAmazonMarketplaceSale, normalizeMarketplaceOrder } from '../src/services/marketplaceQueue.js'

test('normaliza pedido Shopee com SKU e quantidade para fila', () => {
  const sale = normalizeMarketplaceOrder('shopee', {
    data: {
      ordersn: 'MOCK-SHOPEE-ORDER-1',
      total_amount: 120,
      shipping_fee: 10,
      escrow_amount_after_adjustment: 95,
      status: 'READY_TO_SHIP',
      item: {
        item_sku: 'SKU-PRINT-001',
        item_name: 'Suporte mock',
        model_quantity_purchased: 2
      }
    }
  })

  assert.equal(
    sale.externalOrderId,
    'MOCK-SHOPEE-ORDER-1'
  )

  assert.equal(
    sale.sku,
    'SKU-PRINT-001'
  )

  assert.equal(
    sale.productName,
    'Suporte mock'
  )

  assert.equal(
    sale.quantity,
    2
  )

  assert.equal(
    sale.marketplaceFee,
    25
  )
})

test('normaliza o formato oficial de pedido Shopee e prioriza o SKU da variação', () => {
  const sale = normalizeMarketplaceOrder('shopee', {
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
  })

  assert.equal(sale.externalOrderId, '250101SHOPEE1')
  assert.equal(sale.status, 'paid')
  assert.equal(sale.gross, 60)
  assert.equal(sale.sku, 'VARIANT-SKU')
  assert.equal(sale.items[0].lineKey, '123-456')
  assert.equal(sale.items[0].quantity, 2)
  assert.equal(sale.items[0].gross, 50)
})

test('normaliza pedido Amazon v2026 sem dados pessoais e preserva canal e status', () => {
  const sale = normalizeMarketplaceOrder('amazon', {
    orderId: 'AMZ-ORDER-2',
    createdTime: '2026-10-07T12:00:00Z',
    fulfillment: { fulfillmentStatus: 'UNSHIPPED', fulfilledBy: 'MERCHANT' },
    orderItems: [{
      orderItemId: 'line-1',
      quantityOrdered: 2,
      product: {
        sellerSku: 'FIL-001',
        title: 'Produto de teste',
        price: { unitPrice: { amount: '25.50', currencyCode: 'BRL' } }
      }
    }]
  })

  assert.equal(sale.externalOrderId, 'AMZ-ORDER-2')
  assert.equal(sale.status, 'paid')
  assert.equal(sale.fulfilledBy, 'MERCHANT')
  assert.equal(sale.sku, 'FIL-001')
  assert.equal(sale.quantity, 2)
  assert.equal(sale.gross, 51)
  assert.equal(sale.items[0].lineKey, 'line-1')
  assert.equal('buyer' in sale, false)
  assert.equal('recipient' in sale, false)

  const pendingSale = normalizeMarketplaceOrder('amazon', {
    orderId: 'AMZ-ORDER-3',
    fulfillment: { fulfillmentStatus: 'PENDING', fulfilledBy: 'MERCHANT' },
    orderItems: []
  })
  assert.equal(pendingSale.status, 'pending')
  assert.equal(canQueueAmazonMarketplaceSale(sale), true)
  assert.equal(canQueueAmazonMarketplaceSale({ ...sale, fulfilledBy: 'AMAZON' }), false)
  assert.equal(canQueueAmazonMarketplaceSale({ ...sale, status: 'partially_shipped' }), false)
  assert.equal(canQueueAmazonMarketplaceSale(pendingSale), false)
})

test('normaliza pedido Mercado Livre com SKU do item', () => {
  const sale = normalizeMarketplaceOrder('mercado_livre', {
    topic: 'orders',
    resource: '/orders/MOCK-ML-ORDER-1',
    total_amount: 80,
    marketplace_fee: 12,
    order_items: [
      {
        quantity: 3,
        item: {
          seller_sku: 'SKU-ML-003',
          title: 'Organizador mock'
        }
      }
    ]
  })

  assert.equal(
    sale.externalOrderId,
    'MOCK-ML-ORDER-1'
  )

  assert.equal(
    sale.sku,
    'SKU-ML-003'
  )

  assert.equal(
    sale.productName,
    'Organizador mock'
  )

  assert.equal(
    sale.quantity,
    3
  )
})

test('normaliza taxas detalhadas do pedido Mercado Livre', () => {
  const sale = normalizeMarketplaceOrder('mercado_livre', {
    id: 'order-fees-1',
    total_amount: 149.9,
    marketplace_fee: 23.48,
    shipping: { id: 'shipment-1', cost: 8.5 },
    order_items: [{
      quantity: 2,
      unit_price: 74.95,
      gross_price: 149.9,
      sale_fee: 11.74,
      item: { id: 'MLB-1', seller_sku: 'SKU-FEES', title: 'Produto com taxas' }
    }]
  })

  assert.equal(sale.marketplaceFee, 23.48)
  assert.equal(sale.feeBreakdown.commission, 23.48)
  assert.equal(sale.feeBreakdown.commissionSource, 'mercadolivre.orders.order_items')
  assert.equal(sale.shipping, 8.5)
  assert.equal(sale.feeBreakdown.source, 'mercadolivre.orders')
  assert.equal(sale.feeBreakdown.shippingId, 'shipment-1')
  assert.deepEqual(sale.feeBreakdown.itemSaleFees, [{
    itemId: 'MLB-1',
    sku: 'SKU-FEES',
    quantity: 2,
    unitPrice: 74.95,
    grossPrice: 149.9,
    saleFee: 11.74
  }])
})

test('usa a comissao real por item quando o pedido nao traz taxa totalizada', () => {
  const sale = normalizeMarketplaceOrder('mercado_livre', {
    id: 'order-item-fee-1',
    total_amount: 100,
    order_items: [{ quantity: 2, sale_fee: 7.5, item: { seller_sku: 'SKU-ITEM-FEE' } }]
  })

  assert.equal(sale.marketplaceFee, 15)
  assert.equal(sale.feeBreakdown.commission, 15)
})

test('preserva componentes de tarifa informados pelo Mercado Livre', () => {
  const sale = normalizeMarketplaceOrder('mercado_livre', {
    id: 'order-component-fees-1',
    total_amount: 200,
    sale_fee_details: [{ fixed_fee: 5, financing_add_on_fee: 3 }],
    ads_fee: 2,
    other_fee: 1,
    order_items: [{ quantity: 1, sale_fee: 20, item: { seller_sku: 'SKU-COMPONENTS' } }]
  })

  assert.equal(sale.marketplaceFee, 31)
  assert.equal(sale.feeBreakdown.commission, 20)
  assert.equal(sale.feeBreakdown.fixed, 5)
  assert.equal(sale.feeBreakdown.financial, 3)
  assert.equal(sale.feeBreakdown.ads, 2)
  assert.equal(sale.feeBreakdown.others, 1)
  assert.equal(sale.feeBreakdown.detailSource, 'mercadolivre.orders.sale_fee_details')
})

test('normaliza pedido com multiplos itens como linhas independentes', () => {
  const sale = normalizeMarketplaceOrder('mercado_livre', {
    id: 'order-multi-item-1',
    total_amount: 140,
    order_items: [
      { quantity: 1, item: { seller_sku: 'SKU-A', title: 'Peca A' } },
      { quantity: 2, item: { seller_sku: 'SKU-B', title: 'Peca B' } }
    ]
  })

  assert.equal(sale.requiresReview, false)
  assert.equal(sale.items.length, 2)
  assert.equal(sale.items[1].sku, 'SKU-B')
  assert.equal(sale.sku, 'SKU-A')
  assert.equal(sale.quantity, 1)
})
