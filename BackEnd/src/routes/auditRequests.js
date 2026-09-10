import { getAuthUser } from './auth.js'
import { readJsonBody } from '../http/body.js'
import { sendBuffer, sendJson } from '../http/response.js'
import { addTenantAuditMessage, cancelTenantAuditRequest, createTenantAuditRequest, listTenantAuditMessages, listTenantAuditRequests } from '../services/tenantAuditRequests.js'
import { addTenantSupportAttachment, listTenantSupportAttachments, readTenantSupportAttachment } from '../services/supportAttachments.js'

const user = async (req, res) => { const value = await getAuthUser(req); if (!value) sendJson(res, 401, { error: 'Login necessario' }); return value }
export const handleTenantAuditRequestsList = async (req, res) => { const current = await user(req, res); if (current) return sendJson(res, 200, await listTenantAuditRequests(current)) }
export const handleTenantAuditRequestCreate = async (req, res) => { const current = await user(req, res); if (current) return sendJson(res, 201, await createTenantAuditRequest(current, await readJsonBody(req))) }
export const handleTenantAuditRequestCancel = async (req, res, id) => { const current = await user(req, res); if (current) { await cancelTenantAuditRequest(current, id); return sendJson(res, 204, {}) } }
export const handleTenantAuditMessagesList = async (req, res, id) => { const current = await user(req, res); if (current) return sendJson(res, 200, await listTenantAuditMessages(current, id)) }
export const handleTenantAuditMessageCreate = async (req, res, id) => { const current = await user(req, res); if (current) return sendJson(res, 201, await addTenantAuditMessage(current, id, (await readJsonBody(req)).body)) }
export const handleTenantSupportAttachmentsList = async (req, res, id) => { const current = await user(req, res); if (current) return sendJson(res, 200, await listTenantSupportAttachments(current, id)) }
export const handleTenantSupportAttachmentCreate = async (req, res, id) => { const current = await user(req, res); if (current) return sendJson(res, 201, await addTenantSupportAttachment(current, id, await readJsonBody(req, 8 * 1024 * 1024))) }
export const handleTenantSupportAttachmentRead = async (req, res, id, attachmentId) => { const current = await user(req, res); if (current) { const attachment = await readTenantSupportAttachment(current, id, attachmentId); return sendBuffer(res, 200, attachment.body, { 'Content-Type': attachment.mime_type, 'Content-Disposition': `attachment; filename="${attachment.original_name.replace(/"/g, '')}"` }) } }
