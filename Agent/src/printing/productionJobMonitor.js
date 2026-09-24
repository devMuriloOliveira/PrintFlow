import { connectPrinter, getPrinterStatus, hasActiveConnection } from '../printers/printerManager.js'
import { reportPrintJobMetrics } from '../cloud/productionJobMetrics.js'
import { loadPrinterCredentials } from '../storage/printerCredentials.js'

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

export const ensurePrinterConnectionForMonitor = async (printer) => {
  if (hasActiveConnection(printer)) return { connected: true, reused: true }
  const options = await loadPrinterCredentials(printer)
  await connectPrinter(printer, options)
  return { connected: true, reused: false }
}

export const monitorPrintJobCompletion = async ({ command, context, getStatus = getPrinterStatus, ensureConnection = getStatus === getPrinterStatus ? ensurePrinterConnectionForMonitor : async () => ({ connected: true, reused: true }), report = reportPrintJobMetrics, wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds)), pollMs = Math.max(1000, Number(process.env.PRINTFLOW_PRINT_COMPLETION_POLL_MS) || 5000), maxPolls = Math.max(1, Number(process.env.PRINTFLOW_PRINT_COMPLETION_MAX_POLLS) || Math.ceil(30 * 24 * 60 * 60 * 1000 / pollMs)) }) => {
  const printJobId = command?.payload?.printJobId
  const printer = command?.payload?.printer
  if (!printJobId || !printer || !context?.apiUrl || !context?.credentials) return { skipped: true }
  const startedAt = command.payload.startedAt || new Date().toISOString()
  let lastError = null
  for (let poll = 0; poll < maxPolls; poll += 1) {
    try {
      await ensureConnection(printer)
      const status = await getStatus(printer)
      const state = normalizeCompletionState(status)
      if (state) return report(context.apiUrl, context.credentials, printJobId, { status: state, idempotencyKey: `agent-${command.id}-completion`, attemptNo: 1, ...measuredMetricsFromStatus({ status, startedAt }) })
      lastError = null
    } catch (error) {
      lastError = error
    }
    await wait(pollMs)
  }
  throw new Error(`Monitoramento do Production Job ${printJobId} excedeu o limite de polling.${lastError?.message ? ` Ultimo erro: ${lastError.message}` : ''}`)
}
