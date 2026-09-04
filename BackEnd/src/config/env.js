import { existsSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
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
const defaultAuthTokenTtlSeconds = 15 * 60
const defaultRefreshTokenTtlSeconds = 30 * 24 * 60 * 60
const legacyDataEncryptionKeys = String(process.env.LEGACY_DATA_ENCRYPTION_KEYS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const requireProductionSecret = (name, value, minLength = 32) => {
  if (productionLike && !value) {
    throw new Error(`${name} obrigatorio quando o backend usa banco real.`)
  }
  if (productionLike && String(value).length < minLength) {
    throw new Error(`${name} precisa ter pelo menos ${minLength} caracteres.`)
  }
}

requireProductionSecret('AUTH_SECRET', authSecret)
requireProductionSecret('DATA_ENCRYPTION_KEY', dataEncryptionKey)
requireProductionSecret('WEBHOOK_SHARED_SECRET', webhookSharedSecret)
if (productionLike && !String(process.env.CORS_ALLOWED_ORIGINS || '').trim()) {
  throw new Error('CORS_ALLOWED_ORIGINS obrigatorio quando o backend usa banco real.')
}
const developmentAuthSecret = authSecret || randomBytes(32).toString('base64url')

export const env = {
  port: Number(process.env.PORT || 3333),
  databaseUrl,
  isProduction,
  isProductionLike: productionLike,
  allowDemoTenant: process.env.ALLOW_DEMO_TENANT === 'true' && !productionLike,
  authSecret: developmentAuthSecret,
  dataEncryptionKey,
  legacyDataEncryptionKeys,
  webhookSharedSecret,
  platformSuperAdminEmails: String(process.env.PLATFORM_SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  authTokenTtlSeconds: Number(process.env.AUTH_TOKEN_TTL_SECONDS || defaultAuthTokenTtlSeconds),
  refreshTokenTtlSeconds: Number(process.env.REFRESH_TOKEN_TTL_SECONDS || defaultRefreshTokenTtlSeconds),
  authCookieSameSite: String(process.env.AUTH_COOKIE_SAME_SITE || (productionLike ? 'none' : 'lax')).toLowerCase(),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 120),
  rateLimitAuthMaxRequests: Number(process.env.RATE_LIMIT_AUTH_MAX_REQUESTS || 12),
  rateLimitRefreshMaxRequests: Number(process.env.RATE_LIMIT_REFRESH_MAX_REQUESTS || 30),
  maxConcurrentRequestsPerIp: Number(process.env.MAX_CONCURRENT_REQUESTS_PER_IP || 25),
  tenantDeletionGraceDays: Number(process.env.TENANT_DELETION_GRACE_DAYS || 7),
  tenantDeletionPurgeIntervalMs: Number(process.env.TENANT_DELETION_PURGE_INTERVAL_MS || 60 * 60 * 1000),
  printFileStorageDir: process.env.PRINT_FILE_STORAGE_DIR || resolve(currentDir, '../../storage/print-files'),
  printFileMaxBytes: Number(process.env.PRINT_FILE_MAX_BYTES || 250 * 1024 * 1024),
  printFileStorageMaxBytes: Number(process.env.PRINT_FILE_STORAGE_MAX_BYTES || 10 * 1024 * 1024 * 1024),
  printFileStorageRetentionDays: Number(process.env.PRINT_FILE_STORAGE_RETENTION_DAYS || 30),
  printFileTempMaxAgeMs: Number(process.env.PRINT_FILE_TEMP_MAX_AGE_MS || 60 * 60 * 1000),
  printFileStorageCleanupIntervalMs: Number(process.env.PRINT_FILE_STORAGE_CLEANUP_INTERVAL_MS || 6 * 60 * 60 * 1000),
  printCommandTimeoutMs: Number(process.env.PRINT_COMMAND_TIMEOUT_MS || 5 * 60 * 1000),
  printJobStartTimeoutMs: Number(process.env.PRINT_JOB_START_TIMEOUT_MS || 5 * 60 * 1000),
  printQueueWatchdogIntervalMs: Number(process.env.PRINT_QUEUE_WATCHDOG_INTERVAL_MS || 60 * 1000),
  agentOfflineAfterMs: Number(process.env.AGENT_OFFLINE_AFTER_MS || 90 * 1000),
  agentHealthWatchdogIntervalMs: Number(process.env.AGENT_HEALTH_WATCHDOG_INTERVAL_MS || 30 * 1000),
  appPublicUrl: process.env.APP_PUBLIC_URL || '',
  corsAllowedOrigins: String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',').map((value) => value.trim().replace(/\/$/, '')).filter(Boolean),
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || '',
  apiPublicUrl: process.env.API_PUBLIC_URL || '',
  mercadoLivreClientId: process.env.MERCADO_LIVRE_CLIENT_ID || '',
  mercadoLivreClientSecret: process.env.MERCADO_LIVRE_CLIENT_SECRET || '',
  mercadoLivreRedirectUri: process.env.MERCADO_LIVRE_REDIRECT_URI || '',
  shopeePartnerId: process.env.SHOPEE_PARTNER_ID || '',
  shopeePartnerKey: process.env.SHOPEE_PARTNER_KEY || '',
  shopeeRedirectUri: process.env.SHOPEE_REDIRECT_URI || '',
  amazonLwaClientId: process.env.AMAZON_LWA_CLIENT_ID || '',
  amazonLwaClientSecret: process.env.AMAZON_LWA_CLIENT_SECRET || '',
  amazonRedirectUri: process.env.AMAZON_REDIRECT_URI || '',
  amazonMarketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'A2Q3Y263D00KWC',
  amazonRegionEndpoint: process.env.AMAZON_SP_API_ENDPOINT || 'https://sellingpartnerapi-na.amazon.com'
}
