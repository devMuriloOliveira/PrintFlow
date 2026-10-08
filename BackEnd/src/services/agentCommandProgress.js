const MAX_PRINTERS = 50
const MAX_PROGRESS_BYTES = 30_000
const credentialFields = new Set(['serial', 'accessCode', 'apiKey', 'password', 'username'])

const boundedText = (value, max = 120) => typeof value === 'string'
  ? value.trim().slice(0, max)
  : ''

const normalizePrinter = printer => {
  if (!printer || typeof printer !== 'object' || Array.isArray(printer)) return null
  const result = {}
  for (const field of ['connectionType', 'protocol', 'software', 'manufacturer', 'name', 'ip', 'serial', 'model', 'firmware']) {
    const value = boundedText(printer[field])
    if (value) result[field] = value
  }
  const port = Number(printer.port)
  if (Number.isInteger(port) && port >= 1 && port <= 65535) result.port = port
  result.requiresCredentials = printer.requiresCredentials === true
  result.requiredCredentials = Array.isArray(printer.requiredCredentials)
    ? [...new Set(printer.requiredCredentials.filter(field => credentialFields.has(field)))].slice(0, 5)
    : []
  if (printer.mock === true) result.mock = true
  if (!result.protocol || (!result.ip && !result.serial && !result.port)) return null
  return result
}

export const normalizeAgentCommandProgress = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const printers = Array.isArray(value.printers)
    ? value.printers.slice(0, MAX_PRINTERS).map(normalizePrinter).filter(Boolean)
    : []
  const progress = {
    type: 'discovery',
    discoveredCount: Math.max(printers.length, Math.min(10_000, Math.floor(Number(value.discoveredCount) || 0))),
    printers,
    updatedAt: boundedText(value.updatedAt, 40) || new Date().toISOString()
  }
  return Buffer.byteLength(JSON.stringify(progress), 'utf8') <= MAX_PROGRESS_BYTES ? progress : null
}
