import { isIP } from 'node:net'
import { env } from '../config/env.js'

export const getClientIp = (req) => {
  const trustedHeader = env.trustedClientIpHeader
  const forwardedIp = trustedHeader ? String(req.headers[trustedHeader] || '').trim() : ''
  if (isIP(forwardedIp)) return forwardedIp

  const socketIp = String(req.socket?.remoteAddress || '').trim()
  return isIP(socketIp) ? socketIp : 'unknown'
}
