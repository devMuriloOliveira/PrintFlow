const finiteNonNegative = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

export const normalizeAgentMetrics = (payload = {}) => {
  const metric = (value, max) => {
    const normalized = finiteNonNegative(value)
    return normalized == null || normalized > max ? null : normalized
  }
  const status = String(payload.status || 'completed').trim().toLowerCase()
  if (!['completed', 'failed', 'cancelled'].includes(status)) throw new Error('Status de Production Job invalido.')
  return {
    status,
    idempotencyKey: String(payload.idempotencyKey || '').trim().slice(0, 160),
    attemptNo: Number.isInteger(Number(payload.attemptNo)) && Number(payload.attemptNo) > 0 ? Number(payload.attemptNo) : 1,
    actualPrintSeconds: metric(payload.actualPrintSeconds, 365 * 24 * 3600),
    actualFilamentGrams: metric(payload.actualFilamentGrams, 100000),
    actualFilamentMillimeters: metric(payload.actualFilamentMillimeters, 10000000)
  }
}

const round = (value, digits = 3) => {
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

export const recipeMaterialGrams = (product, quantity = 1) => {
  const weight = finiteNonNegative(product?.weight ?? product?.cost_breakdown?.materialWeight ?? product?.costBreakdown?.materialWeight)
  if (weight == null || weight <= 0) return null
  const waste = finiteNonNegative(product?.cost_breakdown?.wastePercent ?? product?.costBreakdown?.wastePercent) || 0
  return round(weight * Math.max(1, Math.floor(Number(quantity) || 1)) * (1 + waste / 100))
}

/**
 * Chooses measured Agent metrics when present, otherwise the product recipe.
 * It never mutates stock; callers persist/consume only after an idempotent job
 * transition has been committed.
 */
export const buildProductionMeasurements = ({ job = {}, product = {}, filament = {}, printer = {}, energyPricePerKwh = 0, metrics = {} } = {}) => {
  const recipeGrams = recipeMaterialGrams(product, job.quantity)
  const measuredGrams = finiteNonNegative(metrics.actualFilamentGrams ?? job.actualFilamentGrams)
  const estimatedGrams = finiteNonNegative(metrics.estimatedFilamentGrams ?? job.estimatedFilamentGrams) ?? recipeGrams
  const actualSeconds = finiteNonNegative(metrics.actualPrintSeconds ?? job.actualPrintSeconds)
  const estimatedSeconds = finiteNonNegative(metrics.estimatedPrintSeconds ?? job.estimatedPrintSeconds)
  const grams = measuredGrams != null ? measuredGrams : recipeGrams
  const initialWeight = finiteNonNegative(filament.initial_weight ?? filament.initialWeight)
  const filamentCost = finiteNonNegative(filament.cost)
  const materialCost = grams != null && initialWeight > 0 && filamentCost != null
    ? round((grams / initialWeight) * filamentCost, 2)
    : null
  const seconds = actualSeconds ?? estimatedSeconds
  const powerWatts = finiteNonNegative(printer.power_w ?? printer.power)
  const energyRate = finiteNonNegative(energyPricePerKwh)
  const energyCost = seconds != null && powerWatts != null && energyRate != null
    ? round((seconds / 3600) * (powerWatts / 1000) * energyRate, 2)
    : null

  return {
    source: measuredGrams != null || actualSeconds != null ? 'agent_measured' : 'recipe_estimate',
    estimated: { filamentGrams: estimatedGrams, printSeconds: estimatedSeconds },
    actual: { filamentGrams: measuredGrams, printSeconds: actualSeconds },
    consumptionGrams: grams,
    materialCost,
    energyCost,
    maintenanceHours: seconds == null ? null : round(seconds / 3600, 2)
  }
}
