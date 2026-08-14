import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'

const ITERATIONS = 120000
const KEY_LENGTH = 32
const DIGEST = 'sha256'

export const hashPassword = (password) => {
  const salt = randomBytes(16).toString('base64url')
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('base64url')
  return `pbkdf2$${ITERATIONS}$${salt}$${hash}`
}

export const verifyPassword = (password, storedHash) => {
  const [algorithm, iterations, salt, hash] = String(storedHash || '').split('$')
  if (algorithm !== 'pbkdf2' || !iterations || !salt || !hash) return false

  const current = pbkdf2Sync(password, salt, Number(iterations), KEY_LENGTH, DIGEST)
  const expected = Buffer.from(hash, 'base64url')
  return current.length === expected.length && timingSafeEqual(current, expected)
}
