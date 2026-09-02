import { getAuthUser } from './auth.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import {
  getPlatformOverview,
  isPlatformSuperAdmin,
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

export const handlePlatformTenantAudit = async (req, res, tenantId, url) => {
  const user = await requirePlatformAdmin(req, res)
  if (!user) return
  const events = await listTenantOperationalAudit(tenantId, url.searchParams.get('limit'))
  await writePlatformAudit(req, user, { action: 'platform.tenant_audit.read', targetTenantId: tenantId, targetResource: 'operational_audit' })
  return sendJson(res, 200, events)
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
