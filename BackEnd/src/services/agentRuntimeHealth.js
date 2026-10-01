const MAX_SNAPSHOT_BYTES = 8_000
const MAX_METRICS = 20
const DURATION_BUCKET_UPPER_BOUNDS_MS = [50, 100, 250, 500, 1000, 2500, 5000]

const boundedInteger = (value, { min = 0, max = 2_147_483_647 } = {}) => {
  const number = Number(value)
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, Math.floor(number)))
    : 0
}

const boundedText = (value, maxLength = 80) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_.:-]/g, '')
  .slice(0, maxLength)

const percentileEstimate = (buckets, sampleCount, percentile) => {
  if (!sampleCount) return null
  const target = Math.ceil(sampleCount * percentile)
  let cumulative = 0
  for (let index = 0; index < buckets.length; index += 1) {
    cumulative += buckets[index]
    if (cumulative >= target) return DURATION_BUCKET_UPPER_BOUNDS_MS[index] ?? null
  }
  return null
}

const boundedCounts = value => ({
  files: boundedInteger(value?.files),
  bytes: boundedInteger(value?.bytes),
  pinnedFiles: boundedInteger(value?.pinnedFiles),
  temporaryFiles: boundedInteger(value?.temporaryFiles)
})

export const normalizeAgentRuntimeHealth = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const metrics = Array.isArray(value.metrics)
    ? value.metrics.slice(0, MAX_METRICS).map(metric => {
        const count = boundedInteger(metric?.count)
        let remaining = count
        const durationBuckets = Array.from({ length: DURATION_BUCKET_UPPER_BOUNDS_MS.length + 1 }, (_, index) => {
          const bounded = Math.min(remaining, boundedInteger(metric?.durationBuckets?.[index]))
          remaining -= bounded
          return bounded
        })
        const histogramCount = durationBuckets.reduce((sum, bucket) => sum + bucket, 0)
        return {
          category: boundedText(metric?.category, 40),
          key: boundedText(metric?.key, 40),
          count,
          failures: Math.min(count, boundedInteger(metric?.failures)),
          avgMs: boundedInteger(metric?.avgMs),
          maxMs: boundedInteger(metric?.maxMs),
          histogramCount,
          durationBuckets,
          p50Ms: percentileEstimate(durationBuckets, histogramCount, 0.50),
          p95Ms: percentileEstimate(durationBuckets, histogramCount, 0.95),
          p99Ms: percentileEstimate(durationBuckets, histogramCount, 0.99)
        }
      }).filter(metric => metric.category && metric.key)
    : []

  const snapshot = {
    status: ['healthy', 'degraded', 'offline'].includes(value.status) ? value.status : 'degraded',
    uptimeSeconds: boundedInteger(value.uptimeSeconds),
    realtimeMode: ['websocket', 'sse', 'offline'].includes(value.realtimeMode) ? value.realtimeMode : 'offline',
    backend: {
      connected: value.backend?.connected === true,
      latencyMs: value.backend?.latencyMs == null ? null : boundedInteger(value.backend.latencyMs, { max: 300_000 })
    },
    sqlite: {
      status: value.sqlite?.status === 'open' ? 'open' : 'unavailable',
      schemaVersion: value.sqlite?.schemaVersion == null ? null : boundedInteger(value.sqlite.schemaVersion, { max: 10_000 })
    },
    outbox: {
      pending: boundedInteger(value.outbox?.pending),
      deadLetter: boundedInteger(value.outbox?.deadLetter)
    },
    cache: boundedCounts(value.cache),
    printers: {
      connected: boundedInteger(value.printers?.connected, { max: 10_000 }),
      degraded: boundedInteger(value.printers?.degraded, { max: 10_000 }),
      offline: boundedInteger(value.printers?.offline, { max: 10_000 })
    },
    metrics
  }

  return JSON.stringify(snapshot).length <= MAX_SNAPSHOT_BYTES ? snapshot : null
}
