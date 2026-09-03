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
  await writePlatformAudit(req, user, { action: 'platform.admin_audit.read', targetResource: 'platform_admin_audit' })
  return sendJson(res, 200, events)
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
  const events = await listTenantOperationalAudit(tenantId, url.searchParams.get('limit'))
  await writePlatformAudit(req, user, { action: 'platform.tenant_audit.read', targetTenantId: tenantId, targetResource: 'operational_audit', targetResourceId: requestId })
  return sendJson(res, 200, events)
}

export const handlePlatformTenantAuditExport = async (req, res, tenantId, url) => {
  const user = await requirePlatformAdmin(req, res)
  if (!user) return
  const requestId = url.searchParams.get('accessRequestId') || ''
  const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv'
  const report = await getTenantAuditReport(user, requestId, tenantId)
  await writePlatformAudit(req, user, {
    action: 'platform.tenant_audit.exported', targetTenantId: tenantId,
    targetResource: 'operational_audit_export', targetResourceId: requestId,
    reason: report.reason, details: { eventCount: report.events.length }
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
