import { env } from '../config/env.js'

const REFRESH_COOKIE_NAME = 'printflow_refresh'

export const readCookie = (req, name) => {
  const source = String(req.headers.cookie || '')
  const prefix = `${name}=`
  const entry = source.split(';').map((value) => value.trim()).find((value) => value.startsWith(prefix))
  if (!entry) return ''

  try {
    return decodeURIComponent(entry.slice(prefix.length))
  } catch {
    return ''
  }
}

const sameSite = () => ['lax', 'strict', 'none'].includes(env.authCookieSameSite)
  ? env.authCookieSameSite
  : 'lax'

const cookieAttributes = () => [
  'Path=/api/auth',
  'HttpOnly',
  `SameSite=${sameSite()[0].toUpperCase()}${sameSite().slice(1)}`,
  ...(env.isProductionLike ? ['Secure'] : [])
]

export const createRefreshCookie = (refreshToken) => [
  `${REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}`,
  `Max-Age=${env.refreshTokenTtlSeconds}`,
  ...cookieAttributes()
].join('; ')

export const clearRefreshCookie = () => [
  `${REFRESH_COOKIE_NAME}=`,
  'Max-Age=0',
  ...cookieAttributes()
].join('; ')

export const readRefreshCookie = (req) => readCookie(req, REFRESH_COOKIE_NAME)
