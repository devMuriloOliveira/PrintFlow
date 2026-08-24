import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  getPrinterProfile
} from '../printers/printerProfiles.js'

import {
  getAgentDataDirectory
} from './credentials.js'

const credentialsFile =
  path.join(
    getAgentDataDirectory(),
    'printer-credentials.json'
  )

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

export const getPrinterCredentialKey = (
  printer,
  options = {}
) => {
  if (!printer?.protocol) {
    return null
  }

  const profile =
    getPrinterProfile(
      printer.protocol
    )

  if (
    profile.protocol ===
      'bambu'
  ) {
    const serial =
      normalizeText(
        printer.serial ||
          options.serial
      )

    return serial
      ? `bambu:${serial}`
      : null
  }

  if (
    profile.connectionType ===
      'network'
  ) {
    const ip =
      normalizeText(
        printer.ip
      )

    if (!ip) {
      return null
    }

    const port =
      normalizePort(
        printer.port,
        profile.defaultPort
      )

    return (
      `${profile.protocol}:${ip}:${port}`
    )
  }

  if (
    profile.connectionType ===
      'usb'
  ) {
    const port =
      normalizeText(
        printer.port
      )

    return port
      ? `${profile.protocol}:${port}`
      : null
  }

  return null
}

const createSalt = () =>
  crypto
    .randomBytes(16)
    .toString('base64')

const getUserKeyMaterial = () => {
  let username = ''

  try {
    username =
      os.userInfo().username
  } catch {
    username = ''
  }

  return [
    os.hostname(),
    username,
    process.env.USERPROFILE ||
      process.env.HOME ||
      '',
    'printflow-agent-printer-credentials'
  ].join('|')
}

const deriveKey = (
  salt
) =>
  crypto.scryptSync(
    getUserKeyMaterial(),
    salt,
    32
  )

const encrypt = (
  value,
  salt
) => {
  const iv =
    crypto.randomBytes(12)

  const cipher =
    crypto.createCipheriv(
      'aes-256-gcm',
      deriveKey(salt),
      iv
    )

  const encrypted =
    Buffer.concat([
      cipher.update(
        JSON.stringify(value),
        'utf8'
      ),
      cipher.final()
    ])

  return {
    iv:
      iv.toString('base64'),
    tag:
      cipher
        .getAuthTag()
        .toString('base64'),
    value:
      encrypted.toString('base64')
  }
}

const decrypt = (
  encrypted,
  salt
) => {
  const decipher =
    crypto.createDecipheriv(
      'aes-256-gcm',
      deriveKey(salt),
      Buffer.from(
        encrypted.iv,
        'base64'
      )
    )

  decipher.setAuthTag(
    Buffer.from(
      encrypted.tag,
      'base64'
    )
  )

  const content =
    Buffer.concat([
      decipher.update(
        Buffer.from(
          encrypted.value,
          'base64'
        )
      ),
      decipher.final()
    ]).toString('utf8')

  return JSON.parse(content)
}

const readStore = async () => {
  try {
    const content =
      await fs.readFile(
        credentialsFile,
        'utf8'
      )

    const parsed =
      JSON.parse(content)

    return {
      version:
        1,
      salt:
        parsed.salt ||
        createSalt(),
      printers:
        parsed.printers ||
        {}
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        version:
          1,
        salt:
          createSalt(),
        printers:
          {}
      }
    }

    throw error
  }
}

const writeStore = async (
  store
) => {
  await fs.mkdir(
    path.dirname(credentialsFile),
    {
      recursive:
        true
    }
  )

  await fs.writeFile(
    credentialsFile,
    JSON.stringify(store, null, 2),
    'utf8'
  )
}

const pickCredentialOptions = (
  protocol,
  options = {}
) => {
  const profile =
    getPrinterProfile(
      protocol
    )

  const fields =
    new Set([
      ...profile.requiredOptionFields,
      ...profile.secretOptionFields,
      ...(profile.credentialOptionFields || [])
    ])

  const selected = {}

  for (const field of fields) {
    const value =
      options[field]

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
    ) {
      selected[field] =
        value
    }
  }

  return selected
}

export const loadPrinterCredentials =
  async (
    printer
  ) => {
    const key =
      getPrinterCredentialKey(
        printer
      )

    if (!key) {
      return {}
    }

    const store =
      await readStore()

    const entry =
      store.printers[key]

    if (!entry?.encrypted) {
      return {}
    }

    return decrypt(
      entry.encrypted,
      store.salt
    )
}

export const savePrinterCredentials =
  async (
    printer,
    options = {}
  ) => {
    const key =
      getPrinterCredentialKey(
        printer,
        options
      )

    if (!key) {
      return false
    }

    const protocol =
      normalizeProtocol(
        printer.protocol
      )

    const credentials =
      pickCredentialOptions(
        protocol,
        options
      )

    if (
      Object.keys(credentials)
        .length === 0
    ) {
      return false
    }

    const store =
      await readStore()

    store.printers[key] = {
      protocol,
      updatedAt:
        new Date()
          .toISOString(),
      encrypted:
        encrypt(
          credentials,
          store.salt
        )
    }

    await writeStore(
      store
    )

    return true
  }

export const clearPrinterCredentials =
  async (
    printer
  ) => {
    const key =
      getPrinterCredentialKey(
        printer
      )

    if (!key) {
      return false
    }

    const store =
      await readStore()

    if (
      !store.printers[key]
    ) {
      return false
    }

    delete store.printers[key]

    await writeStore(
      store
    )

    return true
  }
