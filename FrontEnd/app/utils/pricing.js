const nonNegative = (value) => Math.max(0, Number(value || 0))
const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100

export const calculatePricing = (input = {}) => {
  const durationMinutes = nonNegative(input.hours) * 60 + nonNegative(input.minutes)
  const effectiveWeight = nonNegative(input.weight) * (1 + nonNegative(input.wastePercent) / 100)
  const materialCost = round2(nonNegative(input.pricePerKg) / 1000 * effectiveWeight)
  const energyCost = input.energyEnabled === false ? 0 : round2(nonNegative(input.watts) / 1000 * durationMinutes / 60 * nonNegative(input.energyRate))
  const fixedCostPerUnit = nonNegative(input.fixedCostPerUnit)
  const additionalCost = round2(fixedCostPerUnit + nonNegative(input.packaging) + nonNegative(input.materials) + nonNegative(input.labor) + nonNegative(input.otherCosts))
  const baseCost = round2(materialCost + energyCost + additionalCost)
  const feeRate = (nonNegative(input.marketplaceFee) + nonNegative(input.taxPercent)) / 100
  const marketplaceFixedFee = nonNegative(input.marketplaceFixedFee)
  const desiredMargin = nonNegative(input.desiredMargin)
  const denominator = 1 - feeRate - desiredMargin / 100
  const suggestedPrice = denominator > 0 ? round2((baseCost + marketplaceFixedFee) / denominator) : 0
  const salePrice = Number(input.salePrice || 0) > 0 ? round2(input.salePrice) : suggestedPrice
  const feeCost = round2(salePrice * feeRate + marketplaceFixedFee)
  const totalCost = round2(baseCost + feeCost)
  const profit = round2(salePrice - totalCost)
  const margin = salePrice ? profit / salePrice * 100 : 0
  return { durationMinutes, effectiveWeight, materialCost, energyCost, additionalCost, baseCost, feeRate, marketplaceFixedFee, denominator, suggestedPrice, salePrice, feeCost, totalCost, profit, margin }
}
