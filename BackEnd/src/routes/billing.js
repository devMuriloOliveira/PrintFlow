import { readJsonBody, readRawBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { getAuthUser } from './auth.js'
import {
  createMercadoPagoCheckout,
  getMercadoPagoBillingSummary,
  mercadoPagoWebhookSignatureMatches,
  processMercadoPagoWebhook
} from '../services/mercadoPagoBilling.js'
import { changeStripeSubscriptionPlan, createStripeCheckout, getStripeBillingSummary, processStripeWebhook, setStripeSubscriptionCancellation, stripeWebhookSignatureMatches } from '../services/stripeBilling.js'

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

export const handleStripeBillingSummary = async (req, res) => {
  const user = await owner(req, res); if (!user) return
  return sendJson(res, 200, await getStripeBillingSummary(user.tenantId))
}

export const handleStripeCheckoutCreate = async (req, res) => {
  const user = await owner(req, res); if (!user) return
  const body = await readJsonBody(req)
  return sendJson(res, 201, await createStripeCheckout({ tenantId: user.tenantId, actorId: user.userId || user.id, actorEmail: user.email, planCode: String(body.planCode || ''), billingCycle: String(body.billingCycle || '') }))
}

export const handleStripeSubscriptionCancellation = async (req, res, cancelAtPeriodEnd) => {
  const user = await owner(req, res); if (!user) return
  return sendJson(res, 200, await setStripeSubscriptionCancellation({ tenantId: user.tenantId, actorId: user.userId || user.id, cancelAtPeriodEnd }))
}
export const handleStripeSubscriptionPlanChange = async (req, res) => {
  const user = await owner(req, res); if (!user) return
  const body = await readJsonBody(req)
  return sendJson(res, 200, await changeStripeSubscriptionPlan({ tenantId: user.tenantId, actorId: user.userId || user.id, billingCycle: String(body.billingCycle || '') }))
}

export const handleStripeWebhook = async (req, res) => {
  const rawBody = await readRawBody(req, 256_000)
  if (!stripeWebhookSignatureMatches({ header: req.headers['stripe-signature'], rawBody })) return sendJson(res, 401, { error: 'Webhook nao autorizado.' })
  let event = {}
  try { event = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {} } catch { return sendJson(res, 400, { error: 'Webhook com JSON invalido.' }) }
  return sendJson(res, 200, await processStripeWebhook({ event }))
}
