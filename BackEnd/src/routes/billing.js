import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { getAuthUser } from './auth.js'
import {
  asaasWebhookTokenMatches,
  createAsaasPaymentLink,
  getAsaasBillingSummary,
  processAsaasWebhook
} from '../services/asaasBilling.js'

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

export const handleAsaasBillingSummary = async (req, res) => {
  const user = await owner(req, res)
  if (!user) return
  return sendJson(res, 200, await getAsaasBillingSummary(user.tenantId))
}

export const handleAsaasPaymentLinkCreate = async (req, res) => {
  const user = await owner(req, res)
  if (!user) return
  const body = await readJsonBody(req)
  const result = await createAsaasPaymentLink({
    tenantId: user.tenantId,
    actorId: user.userId,
    planCode: String(body.planCode || ''),
    billingCycle: String(body.billingCycle || '')
  })
  return sendJson(res, 201, result)
}

export const handleAsaasWebhook = async (req, res) => {
  if (!asaasWebhookTokenMatches(req.headers['asaas-access-token'])) {
    return sendJson(res, 401, { error: 'Webhook nao autorizado.' })
  }
  const result = await processAsaasWebhook(await readJsonBody(req, 256_000))
  return sendJson(res, 200, result)
}
