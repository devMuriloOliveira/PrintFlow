import { env } from '../config/env.js'

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

export const enterRequest = (req, path) => {
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
