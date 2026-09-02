const PROFILES = {
  bambu: {
    protocol: 'bambu',
    label: 'Bambu Lab',
    connectionType: 'network',
    defaultPort: 8883,
    requiredPrinterFields: ['ip', 'serial'],
    requiredOptionFields: ['accessCode'],
    credentialOptionFields: ['serial'],
    secretOptionFields: ['accessCode'],
    capabilities: {
      status: true,
      pause: true,
      resume: true,
      cancel: true,
      disconnect: true,
      upload: false,
      startPrint: false
    }
  },

  marlin: {
    protocol: 'marlin',
    label: 'USB / Marlin',
    connectionType: 'usb',
    defaultBaudRate: 115200,
    requiredPrinterFields: ['port'],
    requiredOptionFields: [],
    credentialOptionFields: [],
    secretOptionFields: [],
    capabilities: {
      status: true,
      pause: true,
      resume: true,
      cancel: true,
      disconnect: true,
      upload: false,
      startPrint: false
    }
  },

  octoprint: {
    protocol: 'octoprint',
    label: 'OctoPrint',
    connectionType: 'network',
    defaultPort: 80,
    requiredPrinterFields: ['ip'],
    requiredOptionFields: ['apiKey'],
    credentialOptionFields: ['apiKey'],
    secretOptionFields: ['apiKey'],
    capabilities: {
      status: true,
      pause: true,
      resume: true,
      cancel: true,
      disconnect: true,
      upload: true,
      startPrint: true
    }
  },

  moonraker: {
    protocol: 'moonraker',
    label: 'Moonraker / Klipper',
    connectionType: 'network',
    defaultPort: 7125,
    requiredPrinterFields: ['ip'],
    requiredOptionFields: [],
    credentialOptionFields: ['apiKey'],
    secretOptionFields: ['apiKey'],
    capabilities: {
      status: true,
      pause: true,
      resume: true,
      cancel: true,
      disconnect: true,
      upload: true,
      startPrint: true
    }
  },

  prusalink: {
    protocol: 'prusalink',
    label: 'PrusaLink',
    connectionType: 'network',
    defaultPort: 80,
    requiredPrinterFields: ['ip'],
    requiredOptionFields: ['username', 'password'],
    credentialOptionFields: ['username', 'password'],
    secretOptionFields: ['password'],
    capabilities: {
      status: true,
      pause: true,
      resume: true,
      cancel: true,
      disconnect: true,
      upload: true,
      startPrint: true
    }
  }
}

const normalizeText = (
  value
) =>
  String(value || '')
    .trim()

const normalizeProtocol = (
  protocol
) =>
  normalizeText(protocol)
    .toLowerCase()

const normalizePort = (
  value,
  fallback
) => {
  const port =
    Number(value || fallback)

  return Number.isFinite(port) &&
    port > 0
    ? port
    : fallback
}

const normalizeBaudRate = (
  value,
  fallback
) => {
  const baudRate =
    Number(value || fallback)

  return Number.isFinite(baudRate) &&
    baudRate > 0
    ? baudRate
    : fallback
}

const assertRequired = (
  target,
  fields,
  profile,
  scope
) => {
  for (const field of fields) {
    const value =
      normalizeText(
        target?.[field]
      )

    if (!value) {
      throw new Error(
        `${profile.label}: ${scope} obrigatorio ausente (${field}).`
      )
    }
  }
}

export const getPrinterProfiles = () =>
  Object.values(PROFILES)

export const getPrinterProfile = (
  protocol
) => {
  const normalized =
    normalizeProtocol(
      protocol
    )

  const profile =
    PROFILES[normalized]

  if (!profile) {
    throw new Error(
      `Protocolo nao suportado: ${normalized || 'nao informado'}`
    )
  }

  return profile
}

export const normalizePrinterConfig = (
  printer,
  options = {}
) => {
  const profile =
    getPrinterProfile(
      printer?.protocol
    )

  const normalizedPrinter = {
    ...printer,
    protocol:
      profile.protocol,
    connectionType:
      printer?.connectionType ||
      profile.connectionType
  }

  if (
    profile.connectionType ===
    'network'
  ) {
    normalizedPrinter.ip =
      normalizeText(
        printer?.ip
      )

    normalizedPrinter.port =
      normalizePort(
        printer?.port,
        profile.defaultPort
      )
  }

  if (
    profile.protocol ===
    'bambu'
  ) {
    normalizedPrinter.serial =
      normalizeText(
        printer?.serial ||
          options.serial
      )
  }

  if (
    profile.protocol ===
    'marlin'
  ) {
    normalizedPrinter.port =
      normalizeText(
        printer?.port
      )

    normalizedPrinter.baudRate =
      normalizeBaudRate(
        printer?.baudRate ||
          options.baudRate,
        profile.defaultBaudRate
      )
  }

  const normalizedOptions = {
    ...options
  }

  if (
    profile.protocol ===
    'octoprint'
  ) {
    normalizedOptions.apiKey =
      normalizeText(
        options.apiKey ||
          options.token
      )
  }

  if (
    profile.protocol ===
    'moonraker'
  ) {
    normalizedOptions.apiKey =
      normalizeText(
        options.apiKey ||
          options.token
      )
  }

  if (
    profile.protocol ===
    'prusalink'
  ) {
    normalizedOptions.username =
      normalizeText(
        options.username ||
          'maker'
      )

    normalizedOptions.password =
      normalizeText(
        options.password ||
          options.apiKey
      )
  }

  assertRequired(
    normalizedPrinter,
    profile.requiredPrinterFields,
    profile,
    'campo da impressora'
  )

  if (
    normalizedPrinter.mock !==
    true
  ) {
    assertRequired(
      normalizedOptions,
      profile.requiredOptionFields,
      profile,
      'credencial'
    )
  }

  return {
    profile,
    printer:
      normalizedPrinter,
    options:
      normalizedOptions
  }
}

export const sanitizePrinterOptions = (
  protocol,
  options = {}
) => {
  const profile =
    getPrinterProfile(
      protocol
    )

  const sanitized = {
    ...options
  }

  for (
    const field
    of profile.secretOptionFields
  ) {
    if (
      field in sanitized
    ) {
      sanitized[field] =
        '[secret]'
    }
  }

  return sanitized
}
