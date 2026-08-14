import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(currentDir, '../../.env')

if (existsSync(envPath)) {
  const envFile = readFileSync(envPath, 'utf8')

  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) continue

    const [, key, rawValue] = match
    const value = rawValue.replace(/^["']|["']$/g, '')
    process.env[key] ??= value
  }
}

const databaseUrl = process.env.DATABASE_URL || ''
const isProduction = process.env.NODE_ENV === 'production'
const productionLike = isProduction || Boolean(databaseUrl)
const authSecret = process.env.AUTH_SECRET || ''
const dataEncryptionKey = process.env.DATA_ENCRYPTION_KEY || ''
const webhookSharedSecret = process.env.WEBHOOK_SHARED_SECRET || ''
const legacyDataEncryptionKeys = String(process.env.LEGACY_DATA_ENCRYPTION_KEYS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const requireProductionSecret = (name, value) => {
  if (productionLike && !value) {
    throw new Error(`${name} obrigatorio quando o backend usa banco real.`)
  }
}

requireProductionSecret('AUTH_SECRET', authSecret)
requireProductionSecret('DATA_ENCRYPTION_KEY', dataEncryptionKey)
requireProductionSecret('WEBHOOK_SHARED_SECRET', webhookSharedSecret)

export const env = {
  port: Number(process.env.PORT || 3333),
  databaseUrl,
  isProduction,
  allowDemoTenant: process.env.ALLOW_DEMO_TENANT === 'true' && !productionLike,
  authSecret: authSecret || 'printflow-dev-secret',
  dataEncryptionKey,
  legacyDataEncryptionKeys,
  webhookSharedSecret,
  authTokenTtlSeconds: Number(process.env.AUTH_TOKEN_TTL_SECONDS || 600),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 120),
  rateLimitAuthMaxRequests: Number(process.env.RATE_LIMIT_AUTH_MAX_REQUESTS || 12),
  maxConcurrentRequestsPerIp: Number(process.env.MAX_CONCURRENT_REQUESTS_PER_IP || 25)
}
