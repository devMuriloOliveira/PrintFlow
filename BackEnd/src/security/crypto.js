import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'

const PREFIX = 'enc:v1'
const ALGORITHM = 'aes-256-gcm'

const keyMaterial = env.dataEncryptionKey || env.authSecret
const encryptionKey = createHash('sha256').update(String(keyMaterial)).digest()
const indexKey = createHash('sha256').update(`${keyMaterial}:blind-index`).digest()

export const normalizeForIndex = (value) => String(value || '').trim().toLowerCase()

export const blindIndex = (value) => {
  const normalized = normalizeForIndex(value)
  if (!normalized) return ''
  return createHmac('sha256', indexKey).update(normalized).digest('base64url')
}

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

  try {
    const [, , iv, tag, encrypted] = text.split(':')
    const decipher = createDecipheriv(ALGORITHM, encryptionKey, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    return ''
  }
}
