import test from 'node:test'
import assert from 'node:assert/strict'
import { calculatePricing } from '../../FrontEnd/app/utils/pricing.js'

test('precificacao calcula margem real considerando taxas', () => {
  const result = calculatePricing({ pricePerKg: 100, weight: 150, hours: 6, energyRate: 0.68, watts: 110, marketplaceFee: 10, desiredMargin: 40 })
  assert.equal(result.materialCost, 15)
  assert.equal(result.suggestedPrice, 30.9)
  assert.ok(Math.abs(result.margin - 40) < 0.1)
})

test('precificacao inclui perdas, custos adicionais e custo fixo', () => {
  const result = calculatePricing({ pricePerKg: 100, weight: 100, wastePercent: 10, fixedCostPerUnit: 2, packaging: 1.5, labor: 4, desiredMargin: 30 })
  assert.equal(result.materialCost, 11)
  assert.equal(result.baseCost, 18.5)
  assert.equal(result.suggestedPrice, 26.43)
})

test('margem inviavel nao gera preco sugerido', () => {
  const result = calculatePricing({ pricePerKg: 100, weight: 100, marketplaceFee: 30, taxPercent: 20, desiredMargin: 60 })
  assert.ok(Math.abs(result.denominator + 0.1) < 0.000001)
  assert.equal(result.suggestedPrice, 0)
})

test('preco informado calcula lucro e margem sobre o preco', () => {
  const result = calculatePricing({ pricePerKg: 100, weight: 100, salePrice: 25, marketplaceFee: 10, desiredMargin: 40 })
  assert.equal(result.totalCost, 12.5)
  assert.equal(result.profit, 12.5)
  assert.equal(result.margin, 50)
})
