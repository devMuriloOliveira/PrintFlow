import { pbkdf2Sync, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const ITERATIONS = 120000
const KEY_LENGTH = 32
const DIGEST = 'sha256'
const SCRYPT_COST = 16384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1

export const validatePasswordPolicy = (password) => {
  const value = String(password || '')
  if (value.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.'
  if (!/[a-z]/.test(value)) return 'A senha precisa conter letra minuscula.'
  if (!/[A-Z]/.test(value)) return 'A senha precisa conter letra maiuscula.'
  if (!/[0-9]/.test(value)) return 'A senha precisa conter numero.'
  if (!/[^A-Za-z0-9]/.test(value)) return 'A senha precisa conter caractere especial.'
  return ''
}

export const hashPassword = (password) => {
  const salt = randomBytes(16).toString('base64url')
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION
  }).toString('base64url')

  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt}$${hash}`
}

export const verifyPassword = (password, storedHash) => {
  const [algorithm, iterations, salt, hash] = String(storedHash || '').split('$')

  if (algorithm === 'scrypt') {
    const [, cost, blockSize, parallelization, scryptSalt, scryptHash] = String(storedHash || '').split('$')
    if (!cost || !blockSize || !parallelization || !scryptSalt || !scryptHash) return false

    const current = scryptSync(password, scryptSalt, KEY_LENGTH, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelization)
    })
    const expected = Buffer.from(scryptHash, 'base64url')
    return current.length === expected.length && timingSafeEqual(current, expected)
  }

  if (algorithm !== 'pbkdf2' || !iterations || !salt || !hash) return false

  const current = pbkdf2Sync(password, salt, Number(iterations), KEY_LENGTH, DIGEST)
  const expected = Buffer.from(hash, 'base64url')
  return current.length === expected.length && timingSafeEqual(current, expected)
}
