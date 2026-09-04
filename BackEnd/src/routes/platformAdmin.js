import { getAuthUser } from './auth.js'
import ExcelJS from 'exceljs'
import { readJsonBody } from '../http/body.js'
import { sendBuffer, sendJson, sendText } from '../http/response.js'
import {
  getPlatformOverview,
  createDataAccessRequest,
  getTenantAuditReport,
  verifyDataAccessRequest,
  requireApprovedDataAccess,
  isPlatformSuperAdmin,
  listPlatformAdminAudit,
  listPlatformTenants,
  listTenantOperationalAudit,
  updatePlatformTenantStatus,
  writePlatformAudit
} from '../services/platformAdmin.js'
import { listTenantDeletionAudit } from '../services/tenantDeletion.js'
import { addPlatformAuditMessage, closePlatformAuditChat, decidePlatformAuditRequest, getPlatformAuditChatReport, listPlatformAuditRequests, platformAuditMessages } from '../services/tenantAuditRequests.js'

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

export const handlePlatformTenantsList = async (req, res) => {
  const user = await requirePlatformAdmin(req, res)
  if (!user) return
  const tenants = await listPlatformTenants()
  await writePlatformAudit(req, user, { action: 'platform.tenants.list' })
  return sendJson(res, 200, tenants)
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

export const handlePlatformAuditRequestsList = async (req, res) => { const user = await requirePlatformAdmin(req, res); if (user) return sendJson(res, 200, await listPlatformAuditRequests()) }
export const handlePlatformAuditMessagesList = async (req, res, requestId) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const result = await platformAuditMessages(requestId)
  return sendJson(res, 200, result.messages)
}
export const handlePlatformAuditChatReport = async (req, res, requestId, url) => {
  const user = await requirePlatformAdmin(req, res); if (!user) return
  const range = reportRange(url); const report = await getPlatformAuditChatReport(requestId, range)
  await writePlatformAudit(req, user, { action: 'platform.support.chat_report_exported', targetTenantId: report.tenantId, targetResource: 'support_chat_report', targetResourceId: requestId, details: { messageCount: report.messages.length, format: 'csv', ...range } })
  return sendText(res, 200, platformReportCsv('Relatorio de conversa de suporte', [
    ['Protocolo', report.id], ['Empresa', report.companyName], ['Solicitante', report.requesterName], ['Assunto', report.subject], ['Aberto em', report.createdAt], [],
    ['Data', 'Remetente', 'Mensagem'], ...report.messages.map((message) => [message.created_at, message.sender_type === 'superadmin' ? 'Suporte tecnico' : report.requesterName, message.body])
  ]), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="Relatorio_Conversa_${requestId}.csv"`, 'Cache-Control': 'no-store' })
}
export const handlePlatformAuditMessageCreate = async (req, res, requestId) => { const user = await requirePlatformAdmin(req, res); if (user) { await addPlatformAuditMessage(user, requestId, (await readJsonBody(req)).body); await writePlatformAudit(req, user, { action: 'platform.support.message_sent', targetResource: 'support_request', targetResourceId: requestId }); return sendJson(res, 201, {}) } }
export const handlePlatformAuditDecision = async (req, res, requestId) => { const user = await requirePlatformAdmin(req, res); if (user) { const payload = await readJsonBody(req); const decision = await decidePlatformAuditRequest(user, requestId, payload.approved === true, payload.reason); await writePlatformAudit(req, user, { action: payload.approved === true ? 'platform.data_access.approved' : 'platform.data_access.rejected', targetTenantId: decision.tenantId, targetResource: 'audit_request', targetResourceId: requestId, reason: payload.reason }); return sendJson(res, 200, decision) } }
export const handlePlatformAuditChatClose = async (req, res, requestId) => { const user = await requirePlatformAdmin(req, res); if (user) { const result = await closePlatformAuditChat(user, requestId); await writePlatformAudit(req, user, { action: 'platform.support.chat_closed', targetTenantId: result.tenant_id, targetResource: 'support_request_chat', targetResourceId: requestId, details: { openedAt: result.chat_opened_at, closedAt: result.chat_closed_at } }); return sendJson(res, 200, result) } }

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
