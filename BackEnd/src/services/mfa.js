import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const base32 = (value) => String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '')

export const generateMfaSecret = () => {
  let bits = ''
  for (const byte of randomBytes(20)) bits += byte.toString(2).padStart(8, '0')
  let output = ''
  for (let index = 0; index < bits.length; index += 5) output += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)]
  return output
}

const decodeSecret = (secret) => {
  const bits = [...base32(secret)].map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('')
  const bytes = []
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  return Buffer.from(bytes)
}

export const createTotpCode = (secret, timestamp = Date.now()) => {
  const counter = Math.floor(timestamp / 1000 / 30)
  const buffer = Buffer.alloc(8); buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0); buffer.writeUInt32BE(counter >>> 0, 4)
  const digest = createHmac('sha1', decodeSecret(secret)).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]
  return String(code % 1000000).padStart(6, '0')
}

export const verifyTotpCode = (secret, code, timestamp = Date.now()) => {
  const supplied = String(code || '').trim()
  if (!/^\d{6}$/.test(supplied)) return false
  for (const drift of [-30_000, 0, 30_000]) {
    const expected = createTotpCode(secret, timestamp + drift)
    const left = Buffer.from(supplied); const right = Buffer.from(expected)
    if (left.length === right.length && timingSafeEqual(left, right)) return true
  }
  return false
}

export const otpauthUri = (secret, email, issuer = 'PrintFlow') => `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
