const count = value => Math.max(0, Math.floor(Number(value) || 0))

const safeMetric = row => {
  const metric = row?.state || {}
  const category = String(metric.category || '').replace(/[^a-z0-9_.:-]/gi, '').slice(0, 40)
  const key = String(metric.key || '').replace(/[^a-z0-9_.:-]/gi, '').slice(0, 40)
  const total = count(metric.count)
  if (!category || !key || !total) return null
  return {
    category,
    key,
    count: total,
    failures: Math.min(total, count(metric.failures)),
    avgMs: Math.round(count(metric.totalDurationMs) / total),
    maxMs: count(metric.maxDurationMs),
    histogramCount: count(metric.histogramCount),
    durationBuckets: Array.from({ length: 8 }, (_, index) => count(metric.durationBuckets?.[index]))
  }
}

export const createAgentHealthSnapshot = ({
  uptimeSeconds = 0,
  backend = {},
  realtimeMode = 'offline',
  sqlite = {},
  outbox = {},
  cache = {},
  printerHealth = [],
  connections = [],
  metrics = []
} = {}) => {
  const printers = {
    connected: connections.filter(connection => connection.connected).length,
    degraded: 0,
    offline: 0
  }
  for (const printer of printerHealth) {
    if (printer.state === 'offline') printers.offline += 1
    else if (printer.state === 'degraded' || printer.state === 'recovering') printers.degraded += 1
  }

  const snapshot = {
    status: backend.connected !== true
      ? 'offline'
      : sqlite.status !== 'open' || printers.degraded > 0 || printers.offline > 0 || count(outbox.deadLetter) > 0
        ? 'degraded'
        : 'healthy',
    uptimeSeconds: count(uptimeSeconds),
    realtimeMode: ['websocket', 'sse', 'offline'].includes(realtimeMode) ? realtimeMode : 'offline',
    backend: {
      connected: backend.connected === true,
      latencyMs: backend.lastLatencyMs == null ? null : count(backend.lastLatencyMs)
    },
    sqlite: {
      status: sqlite.status === 'open' ? 'open' : 'unavailable',
      schemaVersion: sqlite.schemaVersion == null ? null : count(sqlite.schemaVersion)
    },
    outbox: {
      pending: count(outbox.pending),
      deadLetter: count(outbox.deadLetter)
    },
    cache: {
      files: count(cache.files),
      bytes: count(cache.bytes),
      pinnedFiles: count(cache.pinnedFiles),
      temporaryFiles: count(cache.temporaryFiles)
    },
    printers,
    metrics: metrics.map(safeMetric).filter(Boolean).slice(0, 20)
  }
  return snapshot
}
