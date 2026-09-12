import { getAuthUser } from './auth.js'
import ExcelJS from 'exceljs'
import { readJsonBody } from '../http/body.js'
import { sendBuffer, sendJson, sendText } from '../http/response.js'
import { withTenant } from '../db/pool.js'
import {
  getPlatformOverview,
  createDataAccessRequest,
  getTenantAuditReport,
  verifyDataAccessRequest,
  requireApprovedDataAccess,
  isPlatformSuperAdmin,
  listPlatformAdminAudit,
  listPlatformSupportHistory,
  listPlatformChatAssignees,
  listPlatformTenants,
  listPlatformPlans,
  updatePlatformPlanBillingConfiguration,
  getPlatformTenantDetails,
  listPlatformTenantUsers,
  listPlatformTenantSubscriptionEvents,
  updatePlatformTenantSubscription,
  createPlatformTenantBillingRecord,
  listPlatformTenantBillingRecords,
  listTenantOperationalAudit,
  updatePlatformTenantStatus,
  writePlatformAudit
} from '../services/platformAdmin.js'
import { listTenantDeletionAudit } from '../services/tenantDeletion.js'
import { listPlatformAdminNotifications, markPlatformAdminNotificationRead } from '../services/platformAdminNotifications.js'
import { addPlatformAuditMessage, addPlatformChatCollaborator, autoAssignPlatformSupport, bulkUpdatePlatformSupport, claimPlatformAuditChat, closePlatformAuditChat, decidePlatformAuditRequest, getPlatformAuditChatReport, getPlatformPrivacyPortabilityExport, getPlatformSupportMetrics, listPlatformAuditRequests, listPlatformSupportMacros, listPlatformSupportSlaRules, platformAuditMessages, reopenPlatformSupportChat, snoozePlatformSupport, transferPlatformAuditChat, updatePlatformSupportMetadata, updatePlatformSupportRequest, updatePlatformSupportSlaRule } from '../services/tenantAuditRequests.js'
import { formatTenantDataCsv } from './settings.js'
import { addPlatformSupportAttachment, listPlatformSupportAttachments, readPlatformSupportAttachment } from '../services/supportAttachments.js'

const requirePlatformAdmin = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user || !(await isPlatformSuperAdmin(user))) {
    sendJson(res, 404, { error: 'Recurso nao encontrado' })
    return null
  }
  return user
}

export const handlePlatformOverview = async (req, res) => {
  const user = await requirePlatformAdmin(req, res)
  if (!user) return
  const overview = await getPlatformOverview()
  await writePlatformAudit(req, user, { action: 'platform.overview.read' })
  return sendJson(res, 200, overview)
}

export const handlePlatformTenantsList = async (req, res, url) => {
  const user = await requirePlatformAdmin(req, res)
  if (!user) return
  const tenants = await listPlatformTenants({ limit: url?.searchParams.get('limit'), offset: url?.searchParams.get('offset') })
  await writePlatformAudit(req, user, { action: 'platform.tenants.list' })
  return sendJson(res, 200, tenants)
}

export const handlePlatformPlansList = async (req, res) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  return sendJson(res, 200, await listPlatformPlans())
}

export const handlePlatformPlanBillingConfigurationUpdate = async (req, res, planId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const payload = await readJsonBody(req)
  const reason = String(payload.reason || '').trim()
  if (reason.length < 8) return sendJson(res, 400, { error: 'Informe um motivo com pelo menos 8 caracteres.' })
  const plan = await updatePlatformPlanBillingConfiguration(planId, payload)
  await writePlatformAudit(req, user, {
    action: 'platform.billing_plan.updated', targetResource: 'platform_plan', targetResourceId: plan.id, reason,
    details: {
      code: plan.code,
      monthlyReferencePrice: plan.monthlyReferencePrice,
      yearlyReferencePrice: plan.yearlyReferencePrice,
      trialDays: plan.trialDays,
      monthlyPlanConfigured: Boolean(plan.stripeMonthlyPriceId),
      yearlyPlanConfigured: Boolean(plan.stripeYearlyPriceId)
    }
  })
  return sendJson(res, 200, plan)
}

export const handlePlatformTenantDetails = async (req, res, tenantId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  return sendJson(res, 200, await getPlatformTenantDetails(tenantId))
}

export const handlePlatformTenantUsers = async (req, res, tenantId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  return sendJson(res, 200, await listPlatformTenantUsers(tenantId))
}

export const handlePlatformTenantSubscriptionEvents = async (req, res, tenantId, url) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  return sendJson(res, 200, await listPlatformTenantSubscriptionEvents(tenantId, url.searchParams.get('limit')))
}

export const handlePlatformTenantBillingRecords = async (req, res, tenantId, url) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  return sendJson(res, 200, await listPlatformTenantBillingRecords(tenantId, url.searchParams.get('limit')))
}

export const handlePlatformTenantSubscriptionUpdate = async (req, res, tenantId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const payload = await readJsonBody(req)
  const details = await updatePlatformTenantSubscription(tenantId, payload, user.id)
  await writePlatformAudit(req, user, { action: 'platform.tenant_subscription.updated', targetTenantId: tenantId, targetResource: 'tenant_subscription', reason: payload.reason, details: { status: payload.status, planId: payload.planId || null, billingCycle: payload.billingCycle } })
  return sendJson(res, 200, details)
}

export const handlePlatformTenantBillingRecordCreate = async (req, res, tenantId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const payload = await readJsonBody(req)
  const record = await createPlatformTenantBillingRecord(tenantId, payload, user.id)
  await writePlatformAudit(req, user, { action: 'platform.tenant_billing_record.created', targetTenantId: tenantId, targetResource: 'tenant_billing_record', targetResourceId: record.id, reason: payload.reason || payload.notes, details: { amount: record.amount, status: record.status } })
  return sendJson(res, 201, record)
}

export const handlePlatformAdminAudit = async (req, res, url) => {
  const user = await requirePlatformAdmin(req, res)
  if (!user) return
  const events = await listPlatformAdminAudit(url.searchParams.get('limit'))
  return sendJson(res, 200, events)
}

const platformReportCsv = (title, rows) => `\ufeff${[[title], ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`
const reportRange = (url) => ({
  from: /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : null,
  to: /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : null
})

export const handlePlatformAdminAuditExport = async (req, res, url) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const range = reportRange(url); const events = await listPlatformAdminAudit(200, range)
  await writePlatformAudit(req, user, { action: 'platform.admin_audit.exported', targetResource: 'platform_admin_audit_export', details: { eventCount: events.length, format: 'csv', ...range } })
  return sendText(res, 200, platformReportCsv('Relatorio de atividades administrativas', [
    ['Data', 'Acao', 'Empresa', 'Recurso', 'Identificador', 'Motivo'],
    ...events.map((event) => [event.createdAt, event.summary, event.targetTenantId || '', event.targetResource, event.targetResourceId, event.reason || ''])
  ]), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="Relatorio_Atividades_Administrativas.csv"', 'Cache-Control': 'no-store' })
}

export const handlePlatformTenantDeletionAudit = async (req, res, url) => {
  const user = await requirePlatformAdmin(req, res)
  if (!user) return
  const events = await listTenantDeletionAudit(url.searchParams.get('limit'))
  await writePlatformAudit(req, user, { action: 'platform.tenant_deletions.read', targetResource: 'tenant_deletion_audit' })
  return sendJson(res, 200, events)
}

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`

export const formatTenantAuditCsv = (report) => {
  const lines = [
    ['Relatorio de auditoria PrintFlow', report.companyName, report.cnpj],
    ['Motivo da solicitacao', report.reason],
    ['Acesso confirmado em', new Date(report.verifiedAt).toISOString()],
    ['Acesso expira em', new Date(report.expiresAt).toISOString()],
    [],
    ['Data', 'Acao', 'Codigo tecnico', 'Contexto', 'Origem', 'Recurso', 'Identificador']
  ]
  for (const event of report.events) {
    lines.push([
      new Date(event.createdAt).toISOString(), event.summary, event.action, event.context,
      event.actorType, event.entityType, event.entityId
    ])
  }
  return `\ufeff${lines.map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`
}

const reportTimestamp = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
}).format(date).replace(' ', '_').replaceAll(':', '-')

export const auditReportFilename = (format, date = new Date()) =>
  `Relatorio_Auditoria_de_Empresa_${reportTimestamp(date)}.${format === 'xlsx' ? 'xlsx' : 'csv'}`

export const formatTenantAuditWorkbook = async (report) => {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'PrintFlow'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Auditoria')
  sheet.columns = [
    { header: 'Data', key: 'createdAt', width: 22 },
    { header: 'Acao', key: 'summary', width: 34 },
    { header: 'Codigo tecnico', key: 'action', width: 34 },
    { header: 'Contexto', key: 'context', width: 44 },
    { header: 'Origem', key: 'actorType', width: 16 },
    { header: 'Recurso', key: 'entityType', width: 20 },
    { header: 'Identificador', key: 'entityId', width: 20 }
  ]
  sheet.addRow(['Relatorio de auditoria PrintFlow'])
  sheet.addRow(['Empresa', report.companyName])
  sheet.addRow(['CNPJ', report.cnpj])
  sheet.addRow(['Motivo da solicitacao', report.reason])
  sheet.addRow(['Acesso confirmado em', new Date(report.verifiedAt).toISOString()])
  sheet.addRow(['Acesso expira em', new Date(report.expiresAt).toISOString()])
  sheet.addRow([])
  const header = sheet.addRow(['Data', 'Acao', 'Codigo tecnico', 'Contexto', 'Origem', 'Recurso', 'Identificador'])
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1768F2' } }
  for (const event of report.events) {
    sheet.addRow({
      createdAt: new Date(event.createdAt).toISOString(), summary: event.summary, action: event.action,
      context: event.context, actorType: event.actorType, entityType: event.entityType, entityId: event.entityId
    })
  }
  sheet.views = [{ state: 'frozen', ySplit: 8 }]
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export const handlePlatformTenantAudit = async (req, res, tenantId, url) => {
  const user = await requirePlatformAdmin(req, res)
  if (!user) return
  const requestId = url.searchParams.get('accessRequestId') || ''
  await requireApprovedDataAccess(user, requestId, tenantId)
  const range = reportRange(url)
  const events = await listTenantOperationalAudit(tenantId, url.searchParams.get('limit'), range)
  await writePlatformAudit(req, user, { action: 'platform.tenant_audit.read', targetTenantId: tenantId, targetResource: 'operational_audit', targetResourceId: requestId })
  return sendJson(res, 200, events)
}

export const handlePlatformTenantAuditExport = async (req, res, tenantId, url) => {
  const user = await requirePlatformAdmin(req, res)
  if (!user) return
  const requestId = url.searchParams.get('accessRequestId') || ''
  const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv'
  const range = reportRange(url)
  const report = await getTenantAuditReport(user, requestId, tenantId, 500, range)
  await writePlatformAudit(req, user, {
    action: 'platform.tenant_audit.exported', targetTenantId: tenantId,
    targetResource: 'operational_audit_export', targetResourceId: requestId,
    reason: report.reason, details: { eventCount: report.events.length, ...range }
  })
  const filename = auditReportFilename(format)
  const headers = {
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store'
  }
  if (format === 'xlsx') {
    return sendBuffer(res, 200, await formatTenantAuditWorkbook(report), {
      ...headers,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
  }
  return sendText(res, 200, formatTenantAuditCsv(report), { ...headers, 'Content-Type': 'text/csv; charset=utf-8' })
}

export const handleDataAccessRequest = async (req, res, tenantId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const payload = await readJsonBody(req)
  const access = await createDataAccessRequest(user, tenantId, payload.reason, 'user_audit')
  await writePlatformAudit(req, user, { action: 'platform.data_access.requested', targetTenantId: tenantId, targetResource: 'data_access', targetResourceId: access.id, reason: payload.reason })
  return sendJson(res, 201, access)
}

export const handleDataAccessVerify = async (req, res, requestId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const payload = await readJsonBody(req)
  try { const access = await verifyDataAccessRequest(user, requestId, payload.cnpj); await writePlatformAudit(req, user, { action: 'platform.data_access.verified', targetTenantId: access.tenantId, targetResource: 'data_access', targetResourceId: requestId }); return sendJson(res, 200, access) }
  catch (error) { await writePlatformAudit(req, user, { action: 'platform.data_access.rejected', targetResource: 'data_access', targetResourceId: requestId }); throw error }
}

export const handlePlatformAuditRequestsList = async (req, res, url) => { const user = await requirePlatformAdmin(req, res); if (user) return sendJson(res, 200, await listPlatformAuditRequests(user, { search: url?.searchParams.get('search'), category: url?.searchParams.get('category'), status: url?.searchParams.get('status'), assigneeId: url?.searchParams.get('assigneeId'), tenantId: url?.searchParams.get('tenantId'), from: url?.searchParams.get('from'), to: url?.searchParams.get('to'), limit: url?.searchParams.get('limit'), offset: url?.searchParams.get('offset') })) }
export const handlePlatformNotificationsList = async (req, res) => { const user = await requirePlatformAdmin(req, res); if (user) return sendJson(res, 200, await listPlatformAdminNotifications(user)) }
export const handlePlatformNotificationRead = async (req, res, notificationId) => { const user = await requirePlatformAdmin(req, res); if (user) return sendJson(res, 200, await markPlatformAdminNotificationRead(user, notificationId)) }
export const handlePlatformChatAssigneesList = async (req, res) => { const user = await requirePlatformAdmin(req, res); if (user) return sendJson(res, 200, await listPlatformChatAssignees()) }
export const handlePlatformSupportMacrosList = async (req, res) => { const user = await requirePlatformAdmin(req, res); if (user) return sendJson(res, 200, await listPlatformSupportMacros()) }
export const handlePlatformSupportRequestsReport = async (req, res, url) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const requests = await listPlatformAuditRequests(user, { search: url?.searchParams.get('search'), category: url?.searchParams.get('category'), status: url?.searchParams.get('status'), assigneeId: url?.searchParams.get('assigneeId'), tenantId: url?.searchParams.get('tenantId'), from: url?.searchParams.get('from'), to: url?.searchParams.get('to'), limit: url?.searchParams.get('limit') })
  await writePlatformAudit(req, user, {
    action: 'platform.support.requests_report_exported', targetResource: 'support_requests_report',
    details: { requestCount: requests.length, format: 'csv' }
  })
  return sendText(res, 200, platformReportCsv('Relatorio interno de solicitacoes', [
    ['Protocolo', 'Empresa', 'Tipo', 'Direito LGPD', 'Status', 'Responsavel', 'Prazo', 'Criado em', 'Atualizado em'],
    ...requests.map((request) => [request.id, request.tenantId, request.requestKind === 'privacy' ? 'LGPD' : request.category, request.privacyRight || '', request.status, request.responsibleName || request.chatAssigneeName || '', request.dueAt || '', request.createdAt, request.updatedAt || ''])
  ]), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="Relatorio_Solicitacoes_PrintFlow.csv"', 'Cache-Control': 'no-store' })
}
export const handlePlatformSupportMetrics = async (req, res, url) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  return sendJson(res, 200, await getPlatformSupportMetrics({ from: url?.searchParams.get('from'), to: url?.searchParams.get('to') }))
}
export const handlePlatformSupportHistory = async (req, res, requestId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  return sendJson(res, 200, await listPlatformSupportHistory(user, requestId))
}
export const handlePlatformSupportAttachmentsList = async (req, res, requestId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  return sendJson(res, 200, await listPlatformSupportAttachments(user, requestId))
}
export const handlePlatformSupportAttachmentCreate = async (req, res, requestId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const attachment = await addPlatformSupportAttachment(user, requestId, await readJsonBody(req, 8 * 1024 * 1024))
  await writePlatformAudit(req, user, { action: 'platform.support.attachment_added', targetTenantId: attachment.tenantId, targetResource: 'support_request_attachment', targetResourceId: attachment.id, details: { requestId, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes } })
  return sendJson(res, 201, attachment)
}
export const handlePlatformSupportAttachmentRead = async (req, res, requestId, attachmentId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const attachment = await readPlatformSupportAttachment(user, requestId, attachmentId)
  return sendBuffer(res, 200, attachment.body, { 'Content-Type': attachment.mime_type, 'Content-Disposition': `attachment; filename="${attachment.original_name.replace(/"/g, '')}"` })
}
export const handlePlatformAuditMessagesList = async (req, res, requestId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const url = new URL(req.url, 'http://localhost')
  const result = await platformAuditMessages(requestId, { since: url.searchParams.get('since') || '' }, user)
  return sendJson(res, 200, result.messages)
}
export const handlePlatformAuditChatReport = async (req, res, requestId, url) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const range = reportRange(url); const report = await getPlatformAuditChatReport(requestId, range, user)
  await writePlatformAudit(req, user, { action: 'platform.support.chat_report_exported', targetTenantId: report.tenantId, targetResource: 'support_chat_report', targetResourceId: requestId, details: { messageCount: report.messages.length, format: 'csv', ...range } })
  return sendText(res, 200, platformReportCsv('Relatorio de conversa de suporte', [
    ['Protocolo', report.id], ['Empresa', report.companyName], ['Solicitante', report.requesterName], ['Assunto', report.subject], ['Aberto em', report.createdAt], [],
    ['Data', 'Remetente', 'Mensagem'], ...report.messages.map((message) => [message.created_at, message.sender_type === 'superadmin' ? 'Suporte tecnico' : report.requesterName, message.body])
  ]), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="Relatorio_Conversa_${requestId}.csv"`, 'Cache-Control': 'no-store' })
}
export const handlePlatformAuditMessageCreate = async (req, res, requestId) => { const user = await requirePlatformAdmin(req, res); if (user) { const payload = await readJsonBody(req); await addPlatformAuditMessage(user, requestId, payload); await writePlatformAudit(req, user, { action: payload.visibility === 'internal' ? 'platform.support.internal_note_added' : 'platform.support.message_sent', targetResource: 'support_request', targetResourceId: requestId }); return sendJson(res, 201, {}) } }
export const handlePlatformAuditDecision = async (req, res, requestId) => { const user = await requirePlatformAdmin(req, res); if (user) { const payload = await readJsonBody(req); const decision = await decidePlatformAuditRequest(user, requestId, payload.approved === true, payload.reason); await writePlatformAudit(req, user, { action: payload.approved === true ? 'platform.data_access.approved' : 'platform.data_access.rejected', targetTenantId: decision.tenantId, targetResource: 'audit_request', targetResourceId: requestId, reason: payload.reason }); return sendJson(res, 200, decision) } }
export const handlePlatformAuditChatClose = async (req, res, requestId) => { const user = await requirePlatformAdmin(req, res); if (user) { const result = await closePlatformAuditChat(user, requestId); await writePlatformAudit(req, user, { action: 'platform.support.chat_closed', targetTenantId: result.tenant_id, targetResource: 'support_request_chat', targetResourceId: requestId, details: { openedAt: result.chat_opened_at, closedAt: result.chat_closed_at } }); return sendJson(res, 200, result) } }
export const handlePlatformSupportReopen = async (req, res, requestId) => { const user = await requirePlatformAdmin(req, res); if (!user) return; const payload = await readJsonBody(req); const result = await reopenPlatformSupportChat(user, requestId, payload.reason); await writePlatformAudit(req, user, { action: 'platform.support.reopened', targetTenantId: result.tenant_id, targetResource: 'support_request_chat', targetResourceId: requestId, reason: payload.reason }); return sendJson(res, 200, result) }
export const handlePlatformSupportSnooze = async (req, res, requestId) => { const user = await requirePlatformAdmin(req, res); if (!user) return; const payload = await readJsonBody(req); const result = await snoozePlatformSupport(user, requestId, payload.until); await writePlatformAudit(req, user, { action: 'platform.support.snoozed', targetTenantId: result.tenantId, targetResource: 'support_request', targetResourceId: requestId, details: { until: result.supportSnoozedUntil } }); return sendJson(res, 200, result) }
export const handlePlatformChatClaim = async (req, res, requestId) => { const user = await requirePlatformAdmin(req, res); if (!user) return; const result = await claimPlatformAuditChat(user, requestId); await writePlatformAudit(req, user, { action: 'platform.support.chat_claimed', targetTenantId: result.tenantId, targetResource: 'support_request_chat', targetResourceId: requestId }); return sendJson(res, 200, result) }
export const handlePlatformChatTransfer = async (req, res, requestId) => { const user = await requirePlatformAdmin(req, res); if (!user) return; const payload = await readJsonBody(req); const result = await transferPlatformAuditChat(user, requestId, payload.targetUserId, payload.reason); await writePlatformAudit(req, user, { action: 'platform.support.chat_transferred', targetTenantId: result.tenant_id, targetResource: 'support_request_chat', targetResourceId: requestId, reason: payload.reason, details: { targetUserId: result.chat_assigned_to } }); return sendJson(res, 200, result) }
export const handlePlatformChatCollaboratorAdd = async (req, res, requestId) => { const user = await requirePlatformAdmin(req, res); if (!user) return; const payload = await readJsonBody(req); const result = await addPlatformChatCollaborator(user, requestId, payload.targetUserId); await writePlatformAudit(req, user, { action: 'platform.support.chat_collaborator_added', targetTenantId: result.tenant_id, targetResource: 'support_request_chat', targetResourceId: requestId, details: { collaboratorId: result.user_id } }); return sendJson(res, 201, result) }
export const handlePlatformPrivacyRequestUpdate = async (req, res, requestId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const updated = await updatePlatformSupportRequest(user, requestId, await readJsonBody(req))
  await writePlatformAudit(req, user, { action: 'platform.privacy_request.updated', targetTenantId: updated.tenantId, targetResource: 'privacy_request', targetResourceId: requestId, reason: updated.reviewReason, details: { status: updated.status, dueAt: updated.dueAt, responsibleId: updated.responsibleId } })
  return sendJson(res, 200, updated)
}

export const handlePlatformSupportMetadataUpdate = async (req, res, requestId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const updated = await updatePlatformSupportMetadata(user, requestId, await readJsonBody(req))
  await writePlatformAudit(req, user, { action: 'platform.support.metadata_updated', targetTenantId: updated.tenantId, targetResource: 'support_request', targetResourceId: requestId, details: { supportStatus: updated.supportStatus, tags: updated.supportTags, firstResponseDueAt: updated.supportFirstResponseDueAt, resolutionDueAt: updated.supportResolutionDueAt } })
  return sendJson(res, 200, updated)
}
export const handlePlatformSupportBulkUpdate = async (req, res) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const payload = await readJsonBody(req)
  const rows = await bulkUpdatePlatformSupport(user, payload.requestIds, payload.operation, payload.supportStatus)
  for (const row of rows) {
    await writePlatformAudit(req, user, {
      action: payload.operation === 'claim' ? 'platform.support.chat_claimed' : 'platform.support.bulk_updated',
      targetTenantId: row.tenant_id, targetResource: 'support_request', targetResourceId: row.id,
      details: { bulk: true, operation: payload.operation, supportStatus: row.support_status }
    })
  }
  return sendJson(res, 200, { updated: rows.map((row) => ({ id: row.id, supportStatus: row.support_status, chatAssigneeId: row.chat_assigned_to })) })
}

export const handlePlatformSupportSlaRulesList = async (req, res) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  return sendJson(res, 200, await listPlatformSupportSlaRules())
}

export const handlePlatformSupportSlaRuleUpdate = async (req, res, ruleId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const updated = await updatePlatformSupportSlaRule(user, ruleId, await readJsonBody(req))
  await writePlatformAudit(req, user, { action: 'platform.support.sla_rule_updated', targetResource: 'support_sla_rule', targetResourceId: ruleId, details: { category: updated.category, priority: updated.priority, firstResponseMinutes: updated.firstResponseMinutes, resolutionMinutes: updated.resolutionMinutes, active: updated.active } })
  return sendJson(res, 200, updated)
}

export const handlePlatformSupportAutoAssign = async (req, res) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const payload = await readJsonBody(req)
  const reason = String(payload.reason || '').trim()
  if (reason.length < 8) return sendJson(res, 400, { error: 'Informe um motivo com pelo menos 8 caracteres.' })
  const rows = await autoAssignPlatformSupport(payload.requestIds)
  for (const row of rows) {
    await writePlatformAudit(req, user, {
      action: 'platform.support.auto_assigned',
      targetTenantId: row.tenant_id,
      targetResource: 'support_request',
      targetResourceId: row.id,
      reason,
      details: { assignedTo: row.chat_assigned_to, mode: 'least_loaded' }
    })
  }
  return sendJson(res, 200, { updated: rows.map((row) => ({ id: row.id, chatAssigneeId: row.chat_assigned_to, supportStatus: row.support_status })) })
}

export const handlePlatformPrivacyPortabilityExport = async (req, res, requestId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const report = await getPlatformPrivacyPortabilityExport(requestId)
  const fileName = `PrintFlow_Portabilidade_${report.tenantId}_${new Date().toISOString().slice(0, 10)}.csv`
  const recordCount = Object.values(report.data).reduce((total, value) => total + (Array.isArray(value) ? value.length : value ? 1 : 0), 0)
  await withTenant(report.tenantId, (client) => client.query(
    'insert into export_history (tenant_id, file_name, export_type, file_format, record_count) values ($1, $2, $3, $4, $5)',
    [report.tenantId, fileName, 'privacy_portability', 'csv', recordCount]
  ))
  await writePlatformAudit(req, user, {
    action: 'platform.privacy_portability.exported', targetTenantId: report.tenantId,
    targetResource: 'privacy_portability_export', targetResourceId: requestId,
    details: { format: 'csv', recordCount }
  })
  return sendText(res, 200, formatTenantDataCsv(report.data), {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store'
  })
}

export const handlePlatformTenantStatusUpdate = async (req, res, tenantId) => {
  const user = await requirePlatformAdmin(req, res)
  if (!user) return
  const payload = await readJsonBody(req)
  const reason = String(payload.reason || '').trim()
  if (!reason || reason.length < 8) return sendJson(res, 400, { error: 'Informe um motivo com pelo menos 8 caracteres.' })
  const tenant = await updatePlatformTenantStatus(tenantId, payload)
  await writePlatformAudit(req, user, {
    action: 'platform.tenant_status.update', targetTenantId: tenantId, targetResource: 'tenant', targetResourceId: tenantId,
    reason, details: { accountStatus: tenant.accountStatus, billingStatus: tenant.billingStatus }
  })
  return sendJson(res, 200, tenant)
}
