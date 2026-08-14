import { env } from './env.js'

const TENANT_HEADER = 'x-tenant-id'
const DEFAULT_TENANT_ID = 'demo'

export const getTenantId = (req) => {
  const rawTenant = req.headers[TENANT_HEADER]
  const tenantId = Array.isArray(rawTenant) ? rawTenant[0] : rawTenant

  if (!tenantId) {
    if (!env.allowDemoTenant) {
      throw new Error('Tenant nao identificado')
    }

    return DEFAULT_TENANT_ID
  }

  const normalized = String(tenantId).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 80)
  return normalized || DEFAULT_TENANT_ID
}
