const configuredMs = (name, fallback) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 1_000 ? value : fallback
}

const timeoutByOperation = Object.freeze({
  connect: configuredMs('PRINTFLOW_AGENT_CONNECT_TIMEOUT_MS', 30_000),
  disconnect: configuredMs('PRINTFLOW_AGENT_DISCONNECT_TIMEOUT_MS', 15_000),
  status: configuredMs('PRINTFLOW_AGENT_STATUS_TIMEOUT_MS', 30_000),
  control: configuredMs('PRINTFLOW_AGENT_CONTROL_TIMEOUT_MS', 15_000),
  startPrint: configuredMs('PRINTFLOW_AGENT_START_PRINT_TIMEOUT_MS', 180_000)
})

export class PrinterOperationTimeoutError extends Error {
  constructor(printerKey, operation, timeoutMs) {
    super(`Tempo limite de ${timeoutMs}ms excedido em ${operation} para ${printerKey}.`)
    this.name = 'PrinterOperationTimeoutError'
    this.code = 'printer_operation_timeout'
  }
}

export const createPrinterOperationRunner = ({ now = () => Date.now(), random = Math.random, setTimer = setTimeout, clearTimer = clearTimeout } = {}) => {
  const locks = new Map()
  const health = new Map()

  const getHealth = key => ({
    state: 'healthy', consecutiveFailures: 0, totalFailures: 0, nextRetryAt: null,
    ...(health.get(key) || {})
  })

  const succeed = key => health.set(key, {
    ...getHealth(key), state: 'healthy', consecutiveFailures: 0, nextRetryAt: null,
    lastSuccessAt: new Date(now()).toISOString(), lastError: null
  })

  const fail = (key, error) => {
    const previous = getHealth(key)
    const failures = previous.consecutiveFailures + 1
    const backoff = Math.min(60_000, 5_000 * (2 ** Math.max(0, failures - 1)))
    const backoffMs = Math.round(backoff * (0.8 + random() * 0.4))
    const state = failures >= 3 ? 'offline' : 'degraded'
    const nextRetryAt = now() + backoffMs
    const next = { ...previous, state, consecutiveFailures: failures, totalFailures: previous.totalFailures + 1, nextRetryAt, lastError: String(sanitizeLogValue(error?.message || error || 'Falha')).slice(0, 500), lastErrorAt: new Date(now()).toISOString() }
    health.set(key, next)
    return next
  }

  const run = ({ printerKey, operation, timeoutMs = timeoutByOperation[operation] || timeoutByOperation.control, execute }) => {
    if (!printerKey || typeof execute !== 'function') throw new Error('Operacao de impressora invalida.')
    const previous = locks.get(printerKey) || Promise.resolve()
    const before = getHealth(printerKey)
    if (before.state === 'offline' && before.nextRetryAt > now() && operation === 'connect') {
      const error = new Error(`Impressora temporariamente offline; nova tentativa apos ${new Date(before.nextRetryAt).toISOString()}.`)
      error.code = 'printer_circuit_open'
      return Promise.reject(error)
    }

    const controller = new AbortController()
    let timedOut = false
    let started = false
    const physical = previous.catch(() => {}).then(async () => {
      if (timedOut) throw new PrinterOperationTimeoutError(printerKey, operation, timeoutMs)
      const currentHealth = getHealth(printerKey)
      if (currentHealth.state === 'offline' && currentHealth.nextRetryAt > now() && operation === 'connect') {
        const error = new Error(`Circuit aberto para ${printerKey}; nova tentativa apos ${new Date(currentHealth.nextRetryAt).toISOString()}.`)
        error.code = 'printer_circuit_open'
        throw error
      }
      if (getHealth(printerKey).state === 'offline' && operation === 'connect') {
        health.set(printerKey, { ...getHealth(printerKey), state: 'recovering' })
      }
      started = true
      try {
        const value = await execute(controller.signal)
        if (timedOut) throw new PrinterOperationTimeoutError(printerKey, operation, timeoutMs)
        succeed(printerKey)
        return value
      } catch (error) {
        if (!timedOut && error?.code !== 'printer_circuit_open') fail(printerKey, error)
        throw error
      }
    })

    const tail = physical.catch(() => {}).finally(() => {
      if (locks.get(printerKey) === tail) locks.delete(printerKey)
    })
    locks.set(printerKey, tail)

    return new Promise((resolve, reject) => {
      const timer = setTimer(() => {
        timedOut = true
        const error = new PrinterOperationTimeoutError(printerKey, operation, timeoutMs)
        controller.abort(error)
        if (started) fail(printerKey, error)
        reject(error)
      }, timeoutMs)
      physical.then(value => { clearTimer(timer); if (!timedOut) resolve(value) }, error => { clearTimer(timer); if (!timedOut) reject(error) })
    })
  }

  return { run, getHealth: key => ({ ...getHealth(key) }), listHealth: () => Array.from(health.entries(), ([key, value]) => ({ key, ...getHealth(key), ...value })) }
}

export const printerOperationTimeouts = timeoutByOperation
import { sanitizeLogValue } from '../logging/fileLogger.js'
