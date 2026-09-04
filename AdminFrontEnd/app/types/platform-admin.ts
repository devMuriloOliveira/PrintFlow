export type Overview = {
  tenants: number
  activeTenants: number
  suspendedTenants: number
  paymentAttention: number
  agents: number
  onlineAgents: number
  printers: number
  connectedPrinters: number
}

export type Tenant = {
  id: string
  name: string
  cnpj: string
  accountStatus: string
  billingStatus: string
  users: number
  activeUsers: number
  agents: number
  onlineAgents: number
  printers: number
}

export type AuditRequest = {
  id: string
  tenantId: string
  requestedBy: string
  requesterName: string
  status: string
  subject: string
  category: 'technical' | 'financial' | 'integration' | 'account' | 'data_backup' | 'audit'
  priority: 'low' | 'normal' | 'high'
  requesterRole: string
  reason: string
  scope: { entityType?: string; entityId?: string; periodStart?: string; periodEnd?: string }
  reviewerId?: string | null
  reviewReason?: string
  decision?: 'approved' | 'rejected' | null
  expiresAt?: string | null
  chatOpenedAt?: string | null
  chatClosedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type Message = {
  id: string
  sender_type: 'owner' | 'requester' | 'superadmin'
  sender_id: string
  body: string
  created_at: string
}

export type TenantAudit = {
  id: string
  action: string
  summary: string
  context?: string
  actorType: string
  entityType: string
  entityId: string
  createdAt: string
}

export type PlatformAudit = {
  id: string
  action: string
  summary: string
  context?: string
  targetTenantId?: string
  targetResource: string
  targetResourceId: string
  reason: string
  createdAt: string
}

export type DeletionAudit = {
  id: string
  requestId: string
  eventType: string
  summary: string
  context?: string
  evidence?: Record<string, unknown>
  createdAt: string
}

export type AuthorizedTenantAudit = {
  tenant: Tenant
  accessRequestId: string
  events: TenantAudit[]
}
