const nonNegative = (value) => Math.max(0, Number(value || 0))
const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100

export const calculatePricing = (input = {}) => {
  const durationMinutes = nonNegative(input.hours) * 60 + nonNegative(input.minutes)
  const effectiveWeight = nonNegative(input.weight) * (1 + nonNegative(input.wastePercent) / 100)
  const materialCost = round2(nonNegative(input.pricePerKg) / 1000 * effectiveWeight)
  const energyCost = input.energyEnabled === false ? 0 : round2(nonNegative(input.watts) / 1000 * durationMinutes / 60 * nonNegative(input.energyRate))
  const fixedCostPerUnit = nonNegative(input.fixedCostPerUnit)
  const machineLifespanHours = nonNegative(input.printerLifespanHours)
  const machineDepreciationPerHour = machineLifespanHours > 0 ? nonNegative(input.printerPurchasePrice) / machineLifespanHours : 0
  const machineHourlyCost = machineDepreciationPerHour + nonNegative(input.machineMaintenancePerHour)
  const machineCost = round2(machineHourlyCost * durationMinutes / 60)
  const laborMinutes = nonNegative(input.setupMinutes) + nonNegative(input.postProcessingMinutes) + nonNegative(input.packagingMinutes)
  const stagedLaborCost = round2(laborMinutes / 60 * nonNegative(input.laborRatePerHour))
  const laborCost = round2(nonNegative(input.labor) + stagedLaborCost)
  const failureRate = Math.min(95, nonNegative(input.failurePercent)) / 100
  const riskBaseCost = materialCost + energyCost + machineCost + laborCost
  const failureCost = round2(failureRate > 0 ? riskBaseCost * failureRate / (1 - failureRate) : 0)
  const additionalCost = round2(fixedCostPerUnit + nonNegative(input.packaging) + nonNegative(input.materials) + laborCost + machineCost + failureCost + nonNegative(input.otherCosts))
  const baseCost = round2(materialCost + energyCost + additionalCost)
  const feeRate = (nonNegative(input.marketplaceFee) + nonNegative(input.taxPercent)) / 100
  const marketplaceFixedFee = nonNegative(input.marketplaceFixedFee)
  const desiredMargin = nonNegative(input.desiredMargin)
  const quantity = Math.max(1, Math.floor(nonNegative(input.quantity) || 1))
  const minimumPrice = nonNegative(input.minimumPrice)
  const denominator = 1 - feeRate - desiredMargin / 100
  const suggestedPriceBeforeMinimum = denominator > 0 ? round2((baseCost + marketplaceFixedFee / quantity) / denominator) : 0
  const suggestedPrice = suggestedPriceBeforeMinimum > 0 ? Math.max(minimumPrice, suggestedPriceBeforeMinimum) : 0
  const salePrice = Number(input.salePrice || 0) > 0 ? round2(input.salePrice) : suggestedPrice
  const feeCost = round2(salePrice * feeRate + marketplaceFixedFee / quantity)
  const totalCost = round2(baseCost + feeCost)
  const profit = round2(salePrice - totalCost)
  const margin = salePrice ? profit / salePrice * 100 : 0
  const batchTotalCost = round2(totalCost * quantity)
  const batchRevenue = round2(salePrice * quantity)
  const batchProfit = round2(batchRevenue - batchTotalCost)
  return { durationMinutes, effectiveWeight, materialCost, energyCost, additionalCost, baseCost, machineDepreciationPerHour: round2(machineDepreciationPerHour), machineHourlyCost: round2(machineHourlyCost), machineCost, laborMinutes, stagedLaborCost, laborCost, failureRate, failureCost, riskBaseCost: round2(riskBaseCost), feeRate, marketplaceFixedFee, denominator, quantity, minimumPrice, suggestedPriceBeforeMinimum, suggestedPrice, salePrice, feeCost, totalCost, batchTotalCost, batchRevenue, batchProfit, profit, margin }
}
