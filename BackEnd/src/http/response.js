import { env } from '../config/env.js'
import { brotliCompressSync, gzipSync } from 'node:zlib'

const compress = (res, value) => {
  const raw = Buffer.from(String(value), 'utf8')
  if (raw.length < 1024 || !res.compressionEncoding) return { body: raw, encoding: '' }
  return res.compressionEncoding === 'br' ? { body: brotliCompressSync(raw), encoding: 'br' } : { body: gzipSync(raw), encoding: 'gzip' }
}

export const configureCors = (req, res) => {
  const origin = String(req.headers.origin || '').replace(/\/$/, '')
  if (!origin) return true
  if (!env.corsAllowedOrigins.includes(origin)) return false
  res.corsHeaders = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Disposition',
    Vary: 'Origin'
  }
  return true
}

const securityHeaders = () => ({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  ...(env.isProductionLike ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {})
})

export const sendJson = (res, status, body, extraHeaders = {}) => {
  const payload = status === 204 ? { body: Buffer.alloc(0), encoding: '' } : compress(res, JSON.stringify(body))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type, Origin, X-Requested-With, X-Tenant-Id, X-Agent-Id, X-Agent-Secret, X-PrintFlow-File-Name, X-PrintFlow-File-Format, X-PrintFlow-Webhook-Secret',
    ...securityHeaders(),
    ...res.corsHeaders,
    ...(payload.encoding ? { 'Content-Encoding': payload.encoding, Vary: [res.corsHeaders?.Vary, 'Accept-Encoding'].filter(Boolean).join(', ') } : {}),
    ...extraHeaders
  })

  res.end(status === 204 ? null : payload.body)
}

export const sendText = (res, status, body, extraHeaders = {}) => {
  const payload = compress(res, body)
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...securityHeaders(),
    ...res.corsHeaders,
    ...(payload.encoding ? { 'Content-Encoding': payload.encoding, Vary: [res.corsHeaders?.Vary, 'Accept-Encoding'].filter(Boolean).join(', ') } : {}),
    ...extraHeaders
  })
  res.end(payload.body)
}

export const sendBuffer = (res, status, body, extraHeaders = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-store',
    ...securityHeaders(),
    ...res.corsHeaders,
    ...extraHeaders
  })
  res.end(body)
}
