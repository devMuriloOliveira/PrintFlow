import { EventEmitter } from 'node:events'

const bus = new EventEmitter()
bus.setMaxListeners(500)
const lastStates = new Map()
const knownStates = new Set([
  'idle', 'ready', 'operational', 'connected', 'standby', 'printing', 'running',
  'pause', 'paused', 'pausing', 'resuming', 'prepare', 'preparing', 'completed',
  'complete', 'finish', 'finished', 'success', 'cancelled', 'canceled', 'failed', 'error', 'fault'
])

const normalizeStatus = status => {
  if (!status || typeof status !== 'object') return null
  const output = {}
  for (const key of ['state', 'status', 'progress', 'remainingMinutes', 'currentLayer', 'totalLayers', 'actualPrintSeconds', 'actualFilamentGrams', 'actualFilamentMillimeters']) {
    const value = status[key]
    if (value == null || !['string', 'number', 'boolean'].includes(typeof value)) continue
    output[key] = typeof value === 'string' ? value.slice(0, 80) : value
  }
  const state = String(output.state || output.status || '').trim().toLowerCase()
  if (state && !knownStates.has(state)) output.state = 'unknown'
  return output
}

const eventTypeForStatus = (printerKey, status) => {
  const state = String(status?.state || status?.status || '').toLowerCase()
  const previous = lastStates.get(printerKey)
  lastStates.set(printerKey, state)
  if (['printing', 'running', 'prepare', 'preparing'].includes(state)) {
    if (['paused', 'pause', 'pausing'].includes(previous)) return 'printer.resumed'
    return ['printing', 'running', 'prepare', 'preparing'].includes(previous) ? 'printer.progress' : 'printer.started'
  }
  if (['paused', 'pause'].includes(state)) return 'printer.paused'
  if (['resuming'].includes(state)) return 'printer.resumed'
  if (['completed', 'complete', 'finish', 'finished', 'success'].includes(state)) return 'printer.completed'
  if (['cancelled', 'canceled'].includes(state)) return 'printer.cancelled'
  if (['failed', 'error', 'fault'].includes(state)) return 'printer.failed'
  return 'printer.status.changed'
}

export const publishPrinterEvent = ({ printerKey, protocol, type, status, error } = {}) => {
  if (!printerKey || typeof printerKey !== 'string') return null
  const normalizedStatus = normalizeStatus(status)
  const event = Object.freeze({
    type: normalizedStatus ? eventTypeForStatus(printerKey, normalizedStatus) : type,
    printerKey,
    protocol: String(protocol || '').slice(0, 40) || null,
    status: normalizedStatus,
    error: error ? String(error.message || error).slice(0, 200) : null,
    occurredAt: new Date().toISOString()
  })
  if (!event.type) return null
  bus.emit(`printer:${printerKey}`, event)
  bus.emit('printer', event)
  if (event.type === 'printer.disconnected') lastStates.delete(printerKey)
  if (lastStates.size > 5_000) lastStates.delete(lastStates.keys().next().value)
  return event
}

export const subscribePrinterEvents = (printerKey, listener) => {
  if (!printerKey || typeof listener !== 'function') return () => {}
  const channel = `printer:${printerKey}`
  bus.on(channel, listener)
  return () => bus.removeListener(channel, listener)
}

export const waitForPrinterStatusEvent = (printerKey, timeoutMs = 15_000) => new Promise(resolve => {
  let settled = false
  const finish = event => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    unsubscribe()
    resolve(event?.status || null)
  }
  const unsubscribe = subscribePrinterEvents(printerKey, event => {
    if (event.status) finish(event)
  })
  const timer = setTimeout(() => finish(null), Math.max(0, timeoutMs))
  timer.unref?.()
})
