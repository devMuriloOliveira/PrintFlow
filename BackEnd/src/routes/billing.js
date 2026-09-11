import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { getAuthUser } from './auth.js'
import {
  createMercadoPagoCheckout,
  getMercadoPagoBillingSummary,
  mercadoPagoWebhookSignatureMatches,
  processMercadoPagoWebhook
} from '../services/mercadoPagoBilling.js'

const owner = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) {
    sendJson(res, 401, { error: 'Login necessario.' })
    return null
  }
  if (user.role !== 'owner') {
    sendJson(res, 403, { error: 'Somente o Owner pode gerenciar a assinatura da empresa.' })
    return null
  }
  return user
}

export const handleMercadoPagoBillingSummary = async (req, res) => {
  const user = await owner(req, res)
  if (!user) return
  return sendJson(res, 200, await getMercadoPagoBillingSummary(user.tenantId))
}

export const handleMercadoPagoCheckoutCreate = async (req, res) => {
  const user = await owner(req, res)
  if (!user) return
  const body = await readJsonBody(req)
  const result = await createMercadoPagoCheckout({
    tenantId: user.tenantId,
    actorId: user.userId || user.id,
    actorEmail: user.email,
    planCode: String(body.planCode || ''),
    billingCycle: String(body.billingCycle || '')
  })
  return sendJson(res, 201, result)
}

export const handleMercadoPagoWebhook = async (req, res, url) => {
  const resourceId = url?.searchParams?.get('data.id') || ''
  if (!mercadoPagoWebhookSignatureMatches({
    xSignature: req.headers['x-signature'],
    xRequestId: req.headers['x-request-id'],
    dataId: resourceId
  })) {
    return sendJson(res, 401, { error: 'Webhook nao autorizado.' })
  }
  const notification = await readJsonBody(req, 256_000)
  const bodyResourceId = String(notification?.data?.id || '')
  if (bodyResourceId && bodyResourceId !== resourceId) return sendJson(res, 400, { error: 'Webhook com recurso inconsistente.' })
  const result = await processMercadoPagoWebhook({ notification, resourceId })
  return sendJson(res, 200, result)
}

export const handleMercadoPagoWebhookProbe = async (_req, res) => sendJson(res, 200, { ok: true, service: 'mercado-pago-webhook' })
