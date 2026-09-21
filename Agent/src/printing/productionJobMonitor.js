import { getPrinterStatus } from '../printers/printerManager.js'
import { reportPrintJobMetrics } from '../cloud/productionJobMetrics.js'

const terminalStates = new Map([
  ['finish', 'completed'], ['finished', 'completed'], ['completed', 'completed'], ['complete', 'completed'], ['success', 'completed'],
  ['cancelled', 'cancelled'], ['canceled', 'cancelled'], ['failed', 'failed'], ['error', 'failed'], ['fault', 'failed']
])
const numberOrNull = (value) => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null }
const findMetric = (status, keys) => {
  const sources = [status, status?.raw, status?.raw?.print, status?.raw?.job, status?.raw?.print_stats]
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    for (const key of keys) { const value = numberOrNull(source[key]); if (value != null) return value }
  }
  return null
}

export const normalizeCompletionState = (status) => terminalStates.get(String(status?.state || status?.status || '').trim().toLowerCase()) || null

export const measuredMetricsFromStatus = ({ status, startedAt }) => ({
  actualPrintSeconds: findMetric(status, ['actualPrintSeconds', 'elapsedSeconds', 'printSeconds', 'print_time', 'print_duration']) ?? (startedAt ? numberOrNull((Date.now() - new Date(startedAt).getTime()) / 1000) : null),
  actualFilamentGrams: findMetric(status, ['actualFilamentGrams', 'filamentUsedGrams', 'filament_used_g', 'filament_used']),
  actualFilamentMillimeters: findMetric(status, ['actualFilamentMillimeters', 'filamentUsedMillimeters', 'filament_used_mm'])
})

export const monitorPrintJobCompletion = async ({ command, context, getStatus = getPrinterStatus, report = reportPrintJobMetrics, wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds)), maxPolls = 720, pollMs = Math.max(1000, Number(process.env.PRINTFLOW_PRINT_COMPLETION_POLL_MS) || 5000) }) => {
  const printJobId = command?.payload?.printJobId
  const printer = command?.payload?.printer
  if (!printJobId || !printer || !context?.apiUrl || !context?.credentials) return { skipped: true }
  const startedAt = command.payload.startedAt || new Date().toISOString()
  for (let poll = 0; poll < maxPolls; poll += 1) {
    const status = await getStatus(printer)
    const state = normalizeCompletionState(status)
    if (state) return report(context.apiUrl, context.credentials, printJobId, { status: state, idempotencyKey: `agent-${command.id}-completion`, attemptNo: 1, ...measuredMetricsFromStatus({ status, startedAt }) })
    await wait(pollMs)
  }
  throw new Error(`Monitoramento do Production Job ${printJobId} excedeu o limite de polling.`)
}
