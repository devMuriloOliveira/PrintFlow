import { timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'

const headerValue = (value) => Array.isArray(value) ? value[0] : value

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  return left.length === right.length && timingSafeEqual(left, right)
}

export const verifyWebhookSecret = (req) => {
  if (!env.webhookSharedSecret) return false

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const received = headerValue(req.headers['x-printflow-webhook-secret']) || url.searchParams.get('secret')
  return safeEqual(received, env.webhookSharedSecret)
}
