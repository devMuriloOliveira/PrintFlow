import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'

const PREFIX = 'enc:v1'
const ALGORITHM = 'aes-256-gcm'

const keyMaterial = env.dataEncryptionKey || env.authSecret
const deriveEncryptionKey = (material) => createHash('sha256').update(String(material)).digest()
const deriveIndexKey = (material) => createHash('sha256').update(`${material}:blind-index`).digest()
const encryptionKey = deriveEncryptionKey(keyMaterial)
const indexKey = deriveIndexKey(keyMaterial)
const legacyKeyMaterials = env.legacyDataEncryptionKeys.filter((value) => value && value !== keyMaterial)

export const normalizeForIndex = (value) => String(value || '').trim().toLowerCase()

const blindIndexWithKey = (value, key) => {
  const normalized = normalizeForIndex(value)
  if (!normalized) return ''
  return createHmac('sha256', key).update(normalized).digest('base64url')
}

export const blindIndex = (value) => blindIndexWithKey(value, indexKey)

export const blindIndexesForLookup = (value) =>
  [...new Set([blindIndex(value), ...legacyKeyMaterials.map((material) => blindIndexWithKey(value, deriveIndexKey(material)))]).values()]
    .filter(Boolean)

export const isEncrypted = (value) => String(value || '').startsWith(`${PREFIX}:`)

export const encryptField = (value) => {
  const text = String(value || '')
  if (!text || isEncrypted(text)) return text

  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':')
}

export const decryptField = (value) => {
  const text = String(value || '')
  if (!text || !isEncrypted(text)) return text

  const decryptWithKey = (key) => {
    const [, , iv, tag, encrypted] = text.split(':')
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final()
    ]).toString('utf8')
  }

  for (const key of [encryptionKey, ...legacyKeyMaterials.map(deriveEncryptionKey)]) {
    try {
      const decrypted = decryptWithKey(key)
      if (decrypted) return decrypted
    } catch {}
  }

  return ''
}
