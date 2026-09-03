import { env } from '../config/env.js'

export const configureCors = (req, res) => {
  const origin = String(req.headers.origin || '').replace(/\/$/, '')
  if (!origin) return true
  if (!env.corsAllowedOrigins.includes(origin)) return false
  res.corsHeaders = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
  return true
}

export const sendJson = (res, status, body, extraHeaders = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type, Origin, X-Requested-With, X-Tenant-Id, X-Agent-Id, X-Agent-Secret, X-PrintFlow-File-Name, X-PrintFlow-File-Format, X-PrintFlow-Webhook-Secret',
    ...res.corsHeaders,
    ...extraHeaders
  })

  res.end(status === 204 ? null : JSON.stringify(body))
}
