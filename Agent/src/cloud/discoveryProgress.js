const text = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : ''

const normalizePrinter = printer => {
  const normalized = {}
  for (const field of ['connectionType', 'protocol', 'software', 'manufacturer', 'name', 'ip', 'serial', 'model', 'firmware']) {
    const value = text(printer?.[field])
    if (value) normalized[field] = value
  }
  const port = Number(printer?.port)
  if (Number.isInteger(port) && port >= 1 && port <= 65535) normalized.port = port
  normalized.requiresCredentials = printer?.requiresCredentials === true
  const allowedCredentialFields = new Set(['serial', 'accessCode', 'apiKey', 'password', 'username'])
  normalized.requiredCredentials = Array.isArray(printer?.requiredCredentials)
    ? [...new Set(printer.requiredCredentials.filter(field => allowedCredentialFields.has(field)))].slice(0, 5)
    : []
  if (printer?.mock === true) normalized.mock = true
  return normalized
}

const printerKey = printer => [printer.protocol, printer.serial || printer.ip || printer.port].join(':').toLowerCase()

export const createDiscoveryProgressReporter = ({ publish, debounceMs = 1000, onError = () => {} } = {}) => {
  const printers = new Map()
  let timer = null
  let inFlight = Promise.resolve()
  let dirty = false

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!dirty || typeof publish !== 'function') return inFlight
    dirty = false
    const progress = {
      type: 'discovery',
      discoveredCount: printers.size,
      printers: [...printers.values()].slice(0, 50),
      updatedAt: new Date().toISOString()
    }
    inFlight = inFlight.then(() => publish(progress)).catch(error => {
      onError(error)
    })
    return inFlight
  }

  return {
    add: printer => {
      const normalized = normalizePrinter(printer)
      if (!normalized.protocol || (!normalized.ip && !normalized.serial && !normalized.port)) return
      const key = printerKey(normalized)
      if (printers.has(key)) return
      if (printers.size >= 50) return
      printers.set(key, normalized)
      dirty = true
      if (!timer) {
        timer = setTimeout(() => { flush() }, Math.max(250, debounceMs))
        timer.unref?.()
      }
    },
    flush,
    stop: () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}
