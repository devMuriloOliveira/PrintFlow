import { env } from '../config/env.js'
import { hasDatabase, query } from '../db/pool.js'

const windows = new Map()
const activeRequests = new Map()

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for']
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return String(firstForwarded || req.socket.remoteAddress || 'unknown').split(',')[0].trim()
}

const isAuthPath = (path) => [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify-email',
  '/api/auth/password-reset/request',
  '/api/auth/password-reset/confirm',
  '/api/auth/mfa/login',
  '/api/auth/change-password',
  '/api/auth/invitations/accept'
].includes(path)

const isRefreshPath = (path) => path === '/api/auth/refresh'

const rateConfigFor = (path) => ({
  windowMs: env.rateLimitWindowMs,
  maxRequests: isAuthPath(path)
    ? env.rateLimitAuthMaxRequests
    : isRefreshPath(path)
      ? env.rateLimitRefreshMaxRequests
      : env.rateLimitMaxRequests
})

const pruneExpiredWindows = (now) => {
  for (const [key, entry] of windows) {
    if (entry.resetAt <= now) windows.delete(key)
  }
}

export const enterRequest = async (req, path) => {
  const ip = getClientIp(req)
  const now = Date.now()
  const active = activeRequests.get(ip) || 0

  if (active >= env.maxConcurrentRequestsPerIp) {
    return {
      allowed: false,
      status: 429,
      body: { error: 'Muitas requisicoes simultaneas. Tente novamente em alguns segundos.' },
      headers: { 'Retry-After': '5' }
    }
  }

  pruneExpiredWindows(now)

  const config = rateConfigFor(path)
  const key = `${ip}:${isAuthPath(path) ? 'auth' : isRefreshPath(path) ? 'refresh' : 'api'}`

  if (env.rateLimitShared && hasDatabase) {
    const result = await query(`
      insert into api_rate_limits (rate_key, request_count, reset_at)
      values ($1, 1, now() + ($2::text || ' milliseconds')::interval)
      on conflict (rate_key) do update set
        request_count = case when api_rate_limits.reset_at <= now() then 1 else api_rate_limits.request_count + 1 end,
        reset_at = case when api_rate_limits.reset_at <= now() then now() + ($2::text || ' milliseconds')::interval else api_rate_limits.reset_at end,
        updated_at = now()
      returning request_count, reset_at
    `, [key, config.windowMs])
    const sharedEntry = result.rows[0]
    if (sharedEntry.request_count > config.maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((new Date(sharedEntry.reset_at).getTime() - now) / 1000))
      return { allowed: false, status: 429, body: { error: 'Limite de requisicoes atingido. Tente novamente em instantes.' }, headers: { 'Retry-After': String(retryAfter) } }
    }
  }

  const entry = windows.get(key) || { count: 0, resetAt: now + config.windowMs }

  if (entry.resetAt <= now) {
    entry.count = 0
    entry.resetAt = now + config.windowMs
  }

  entry.count += 1
  windows.set(key, entry)

  if (entry.count > config.maxRequests) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    return {
      allowed: false,
      status: 429,
      body: { error: 'Limite de requisicoes atingido. Tente novamente em instantes.' },
      headers: { 'Retry-After': String(retryAfter) }
    }
  }

  activeRequests.set(ip, active + 1)
  let released = false

  return {
    allowed: true,
    release: () => {
      if (released) return
      released = true
      const current = activeRequests.get(ip) || 0
      if (current <= 1) activeRequests.delete(ip)
      else activeRequests.set(ip, current - 1)
    }
  }
}
