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

export const env = {
  port: Number(process.env.PORT || 3333),
  databaseUrl: process.env.DATABASE_URL || '',
  allowDemoTenant: process.env.ALLOW_DEMO_TENANT === 'true',
  authSecret: process.env.AUTH_SECRET || 'printflow-dev-secret',
  authTokenTtlSeconds: Number(process.env.AUTH_TOKEN_TTL_SECONDS || 600),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 120),
  rateLimitAuthMaxRequests: Number(process.env.RATE_LIMIT_AUTH_MAX_REQUESTS || 12),
  maxConcurrentRequestsPerIp: Number(process.env.MAX_CONCURRENT_REQUESTS_PER_IP || 25)
}
