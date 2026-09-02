import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'

const base64url = (value) => Buffer.from(value).toString('base64url')

const sign = (payload) =>
  createHmac('sha256', env.authSecret).update(payload).digest('base64url')

export const createToken = (user, session = {}) => {
  const expiresAt = Math.floor(Date.now() / 1000) + env.authTokenTtlSeconds
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({
    sub: String(user.id),
    tenantId: user.tenantId,
    name: user.name,
    email: user.email,
    role: user.role,
    tokenVersion: Number(user.tokenVersion || 0),
    sid: session.sessionId || '',
    exp: expiresAt
  }))
  const unsigned = `${header}.${payload}`
  return `${unsigned}.${sign(unsigned)}`
}

export const verifyToken = (token) => {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [header, payload, signature] = parts
  const expected = sign(`${header}.${payload}`)
  const receivedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)

  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) return null

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null
    return parsed
  } catch {
    return null
  }
}

export const createOpaqueId = (prefix) => `${prefix}_${randomBytes(8).toString('hex')}`
