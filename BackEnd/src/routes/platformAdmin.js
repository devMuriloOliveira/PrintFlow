import { getAuthUser } from './auth.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import {
  getPlatformOverview,
  createDataAccessRequest,
  verifyDataAccessRequest,
  requireApprovedDataAccess,
  isPlatformSuperAdmin,
  listPlatformAdminAudit,
  listPlatformUserAudit,
  listPlatformTenants,
  listTenantOperationalAudit,
  updatePlatformTenantStatus,
  writePlatformAudit
} from '../services/platformAdmin.js'

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

export const handlePlatformUserAudit = async (req, res, url) => {
  const user = await requirePlatformAdmin(req, res)
  if (!user) return
  const events = await listPlatformUserAudit({
    tenantId: url.searchParams.get('tenantId') || '', action: url.searchParams.get('action') || '',
    from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '', limit: url.searchParams.get('limit') || 100
  })
  await writePlatformAudit(req, user, { action: 'platform.user_audit.read', targetResource: 'operational_audit', details: { tenantId: url.searchParams.get('tenantId') || '', action: url.searchParams.get('action') || '' } })
  return sendJson(res, 200, events)
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
