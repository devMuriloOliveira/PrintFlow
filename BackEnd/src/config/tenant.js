import { env } from './env.js'
import { getAuthUser } from '../routes/auth.js'

const TENANT_HEADER = 'x-tenant-id'
const DEFAULT_TENANT_ID = 'demo'

export const getTenantId = (req) => {
  const user = getAuthUser(req)
  if (user?.tenantId) return user.tenantId

  if (!env.allowDemoTenant) {
    throw new Error('Tenant nao identificado')
  }

  const rawTenant = req.headers[TENANT_HEADER]
  const tenantId = Array.isArray(rawTenant) ? rawTenant[0] : rawTenant

  if (!tenantId) {
    return DEFAULT_TENANT_ID
  }

  const normalized = String(tenantId).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 80)
  return normalized || DEFAULT_TENANT_ID
}
