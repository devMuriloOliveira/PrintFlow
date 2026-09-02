import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeMarketplaceOrder } from '../src/services/marketplaceQueue.js'

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
