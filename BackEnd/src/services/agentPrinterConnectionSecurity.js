import crypto from 'node:crypto'
import net from 'node:net'

const SECRET_FIELDS = new Set(['accessCode', 'apiKey', 'password', 'username'])
const PORTS_BY_PROTOCOL = Object.freeze({
  bambu: [8883],
  moonraker: [7125],
  octoprint: [80, 5000, 7125],
  prusalink: [80, 5000, 7125]
})

const SECRET_FIELDS_BY_PROTOCOL = Object.freeze({
  bambu: ['accessCode'],
  octoprint: ['apiKey'],
  moonraker: ['apiKey'],
  prusalink: ['username', 'password']
})

const fail = message => {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

const isLanIpv4 = value => {
  if (!net.isIPv4(value)) return false
  const octets = value.split('.').map(Number)
  if (value === '169.254.169.254') return false
  const [first, second] = octets
  return first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127)
}

const boundedText = (value, field, maxLength = 120) => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length > maxLength) throw fail(`Campo ${field} invalido.`)
  const text = value.trim()
  return text || undefined
}

const secretText = (value, field, required = false) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw fail(`${field} obrigatoria.`)
    return undefined
  }
  if (typeof value !== 'string' || value.length > 2048 || !value.trim()) throw fail(`${field} invalida.`)
  return value
}

export const validatePrinterConnectionRequest = ({ printer, options }) => {
  if (!printer || typeof printer !== 'object' || Array.isArray(printer)) throw fail('Dados da impressora obrigatorios.')
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw fail('Opcoes da impressora invalidas.')

  const protocol = typeof printer.protocol === 'string' ? printer.protocol.trim().toLowerCase() : ''
  const connectionType = typeof printer.connectionType === 'string' ? printer.connectionType.trim().toLowerCase() : ''
  if (!protocol) throw fail('Protocolo da impressora obrigatorio.')

  if (protocol === 'marlin') {
    const portName = boundedText(printer.port, 'porta USB', 16)
    if (connectionType !== 'usb' || !/^COM[1-9]\d{0,5}$/i.test(portName || '')) throw fail('Porta USB Marlin invalida.')
    return {
      printer: {
        protocol,
        connectionType,
        port: portName.toUpperCase(),
        name: boundedText(printer.name, 'nome'),
        manufacturer: boundedText(printer.manufacturer, 'fabricante'),
        firmware: boundedText(printer.firmware, 'firmware')
      },
      options: {}
    }
  }

  const ports = PORTS_BY_PROTOCOL[protocol]
  if (!ports) throw fail('Protocolo de impressora nao suportado.')
  if (connectionType !== 'network') throw fail('Tipo de conexao de rede invalido.')

  const ip = typeof printer.ip === 'string' ? printer.ip.trim() : ''
  if (!isLanIpv4(ip)) throw fail('Use um endereco IPv4 privado ou link-local da impressora.')

  const defaultPort = protocol === 'bambu' ? 8883 : protocol === 'moonraker' ? 7125 : 80
  const port = printer.port === undefined || printer.port === null || printer.port === ''
    ? defaultPort
    : printer.port
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !ports.includes(port)) {
    throw fail(`Porta nao permitida para ${protocol}.`)
  }

  const normalizedPrinter = {
    protocol,
    connectionType,
    ip,
    port,
    name: boundedText(printer.name, 'nome'),
    manufacturer: boundedText(printer.manufacturer, 'fabricante'),
    software: boundedText(printer.software, 'software'),
    model: boundedText(printer.model, 'modelo'),
    serial: boundedText(printer.serial, 'serial', 80),
    mock: printer.mock === true
  }
  const normalizedOptions = {}

  if (protocol === 'bambu' && !normalizedPrinter.mock && !normalizedPrinter.serial) throw fail('Serial da Bambu obrigatorio.')
  if (protocol === 'bambu') {
    const accessCode = secretText(options.accessCode, 'LAN Access Code', !normalizedPrinter.mock)
    if (accessCode) normalizedOptions.accessCode = accessCode
  } else if (protocol === 'octoprint') {
    normalizedOptions.apiKey = secretText(options.apiKey, 'API Key', true)
  } else if (protocol === 'moonraker') {
    const apiKey = secretText(options.apiKey, 'API Key')
    if (apiKey) normalizedOptions.apiKey = apiKey
  } else if (protocol === 'prusalink') {
    normalizedOptions.username = secretText(options.username, 'Usuario', true)
    normalizedOptions.password = secretText(options.password, 'Senha/API Key', true)
  }

  return { printer: normalizedPrinter, options: normalizedOptions }
}

const getEncryptionKey = key => {
  const raw = String(key ?? process.env.DATA_ENCRYPTION_KEY ?? '').trim()
  if (!raw) throw new Error('DATA_ENCRYPTION_KEY nao configurada')
  return crypto.createHash('sha256').update(raw).digest()
}

const secretContext = (tenantId, agentId, protocol, field) => {
  const type = protocol === 'bambu' && field === 'accessCode'
    ? 'bambu-access-code'
    : `${protocol}-${field.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)}`
  return ['printflow', 'agent-command', String(tenantId), String(agentId), type, 'v1'].join(':')
}

const encryptSecret = (value, context, key) => {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(key), iv)
  cipher.setAAD(Buffer.from(context, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return {
    protected: true,
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
}

const decryptSecret = (envelope, context, key) => {
  if (!envelope || envelope.protected !== true || envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') {
    throw new Error('Formato de segredo protegido invalido')
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(key), Buffer.from(envelope.iv, 'base64'))
  decipher.setAAD(Buffer.from(context, 'utf8'))
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8')
}

export const encryptPrinterConnectionOptions = ({ tenantId, agentId, protocol, options, key }) => {
  const fields = SECRET_FIELDS_BY_PROTOCOL[protocol] || []
  const encrypted = {}
  for (const field of fields) {
    if (hasOwn(options, field)) encrypted[field] = encryptSecret(options[field], secretContext(tenantId, agentId, protocol, field), key)
  }
  return encrypted
}

export const decryptPrinterConnectionOptions = ({ tenantId, agentId, protocol, options, key }) => {
  const fields = SECRET_FIELDS_BY_PROTOCOL[protocol] || []
  const optionsForAgent = {}
  const optionsForStorage = {}
  for (const field of fields) {
    if (!hasOwn(options || {}, field)) continue
    const context = secretContext(tenantId, agentId, protocol, field)
    const envelope = options[field]
    const cleartext = envelope && typeof envelope === 'object' && envelope.protected === true
      ? decryptSecret(envelope, context, key)
      : secretText(envelope, field, true)
    optionsForAgent[field] = cleartext
    optionsForStorage[field] = envelope && typeof envelope === 'object' && envelope.protected === true
      ? envelope
      : encryptSecret(cleartext, context, key)
  }
  return { optionsForAgent, optionsForStorage }
}

export const redactCommandSecrets = value => {
  if (Array.isArray(value)) return value.map(redactCommandSecrets)
  if (!value || typeof value !== 'object') return value
  const output = {}
  for (const [key, item] of Object.entries(value)) {
    output[key] = SECRET_FIELDS.has(key) || ['token', 'agentSecret', 'authorization'].includes(key)
      ? '[PROTECTED]'
      : redactCommandSecrets(item)
  }
  return output
}

export const stripPrinterConnectionSecrets = payload => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const output = structuredClone(payload)
  if (output.options && typeof output.options === 'object' && !Array.isArray(output.options)) {
    for (const field of SECRET_FIELDS) delete output.options[field]
  }
  return output
}
