import fs from 'node:fs/promises'
import path from 'node:path'

const sensitiveKey = /secret|token|password|access.?code|authorization|credential|api.?key|cookie|payload|last.?error/i
const privateIdentifierKey = /^(?:ip|localIp|address|host|hostname|serial|serialNumber|printerId|agentId|eventId|commandId|printJobId|deviceId|key|port|pnpDeviceId)$/i
const MAX_BUNDLE_BYTES = 1024 * 1024

const sanitize = value => {
  if (Array.isArray(value)) return value.map(sanitize)
  if (!value || typeof value !== 'object') return value

  const output = {}
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKey.test(key)) continue
    if (privateIdentifierKey.test(key)) {
      output[key] = '[redacted]'
      continue
    }
    output[key] = sanitize(item)
  }
  return output
}

export const createSupportBundle = diagnostics => {
  if (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) {
    throw new Error('Diagnostico invalido para pacote de suporte.')
  }
  const bundle = {
    format: 'printflow-agent-support-v1',
    generatedAt: new Date().toISOString(),
    diagnostics: sanitize(diagnostics)
  }
  const content = `${JSON.stringify(bundle, null, 2)}\n`
  if (Buffer.byteLength(content, 'utf8') > MAX_BUNDLE_BYTES) {
    throw new Error('Pacote de suporte excede o limite de tamanho.')
  }
  return content
}

export const writeSupportBundle = async (outputPath, diagnostics) => {
  const target = path.resolve(String(outputPath || '').trim())
  if (!outputPath || path.extname(target).toLowerCase() !== '.json') {
    throw new Error('Informe um caminho de saida com extensao .json.')
  }
  const content = createSupportBundle(diagnostics)
  await fs.writeFile(target, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return { path: target, bytes: Buffer.byteLength(content, 'utf8') }
}
