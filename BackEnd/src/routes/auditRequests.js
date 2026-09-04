import { getAuthUser } from './auth.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { addTenantAuditMessage, cancelTenantAuditRequest, createTenantAuditRequest, listTenantAuditMessages, listTenantAuditRequests } from '../services/tenantAuditRequests.js'

const user = async (req, res) => { const value = await getAuthUser(req); if (!value) sendJson(res, 401, { error: 'Login necessario' }); return value }
export const handleTenantAuditRequestsList = async (req, res) => { const current = await user(req, res); if (current) return sendJson(res, 200, await listTenantAuditRequests(current)) }
export const handleTenantAuditRequestCreate = async (req, res) => { const current = await user(req, res); if (current) return sendJson(res, 201, await createTenantAuditRequest(current, await readJsonBody(req))) }
export const handleTenantAuditRequestCancel = async (req, res, id) => { const current = await user(req, res); if (current) { await cancelTenantAuditRequest(current, id); return sendJson(res, 204, {}) } }
export const handleTenantAuditMessagesList = async (req, res, id) => { const current = await user(req, res); if (current) return sendJson(res, 200, await listTenantAuditMessages(current, id)) }
export const handleTenantAuditMessageCreate = async (req, res, id) => { const current = await user(req, res); if (current) { await addTenantAuditMessage(current, id, (await readJsonBody(req)).body); return sendJson(res, 201, {}) } }
