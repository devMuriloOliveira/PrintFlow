const metricId = (category, key) => `${String(category || 'unknown')}:${String(key || 'unknown')}`
const durationUpperBoundsMs = [50, 100, 250, 500, 1000, 2500, 5000]

export const recordOperationalMetric = ({ operations, category, key, durationMs = 0, failed = false }) => {
  if (typeof operations?.getLocalState !== 'function' || typeof operations?.upsertLocalState !== 'function') return null
  try {
    const entityId = metricId(category, key)
    const previous = operations.getLocalState('operational_metric', entityId)?.state || {}
    const duration = Math.max(0, Math.round(Number(durationMs) || 0))
    const previousBuckets = Array.isArray(previous.durationBuckets) ? previous.durationBuckets : []
    const durationBuckets = Array.from({ length: durationUpperBoundsMs.length + 1 }, (_, index) => Math.max(0, Number(previousBuckets[index]) || 0))
    const bucketIndex = durationUpperBoundsMs.findIndex(bound => duration <= bound)
    durationBuckets[bucketIndex < 0 ? durationBuckets.length - 1 : bucketIndex] += 1
    const count = Math.max(0, Number(previous.count) || 0) + 1
    const failures = Math.max(0, Number(previous.failures) || 0) + (failed ? 1 : 0)
    const consecutiveFailures = failed
      ? Math.max(0, Number(previous.consecutiveFailures) || 0) + 1
      : 0
    const state = {
      category: String(category || 'unknown'),
      key: String(key || 'unknown'),
      count,
      failures,
      consecutiveFailures,
      totalDurationMs: Math.max(0, Number(previous.totalDurationMs) || 0) + duration,
      maxDurationMs: Math.max(0, Number(previous.maxDurationMs) || 0, duration),
      histogramCount: Math.max(0, Number(previous.histogramCount) || previousBuckets.reduce((sum, value) => sum + (Number(value) || 0), 0)) + 1,
      durationBuckets,
      lastDurationMs: duration,
      updatedAt: new Date().toISOString()
    }
    operations.upsertLocalState('operational_metric', entityId, state)
    return state
  } catch {
    return null
  }
}
